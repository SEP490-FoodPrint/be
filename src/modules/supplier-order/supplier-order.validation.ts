import { z } from "zod";
import {
  parseRequest,
  requestUuidSchema,
  requiredText,
} from "../../utils/request-validation";

const optionalTrimmedText = (maximum: number, label: string) =>
  z
    .union([
      z
        .string({ error: `${label} phải là văn bản` })
        .trim()
        .max(maximum, { error: `${label} chỉ nhận tối đa ${maximum} ký tự` }),
      z.null(),
    ])
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null));

const positiveInteger = (fallback: number) =>
  z
    .string({ error: "Phải là số nguyên dương" })
    .regex(/^[1-9]\d*$/, { error: "Phải là số nguyên dương" })
    .transform(Number)
    .refine(Number.isSafeInteger, { error: "Số vượt giới hạn cho phép" })
    .default(fallback);

const positiveDecimalQuantitySchema = z
  .string({ error: "Số lượng phải lớn hơn 0." })
  .regex(/^(?:0|[1-9]\d{0,10})(?:\.\d{1,3})?$/, {
    error:
      "actualQuantity chỉ nhận tối đa 11 chữ số nguyên và 3 chữ số thập phân",
  })
  .refine((value) => !/^0(?:\.0{1,3})?$/.test(value), {
    error: "Số lượng phải lớn hơn 0.",
  })
  .transform((value) =>
    value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value,
  );

export const supplierTopUpSchema = z.strictObject({
  lots: z
    .array(
      z.strictObject({
        ingredientLotId: requestUuidSchema,
        sampleTopUpQuantity: positiveDecimalQuantitySchema,
      }),
    )
    .min(1)
    .max(500),
});

export const validateSupplierTopUp = (value: unknown) =>
  parseRequest(supplierTopUpSchema, value);

export const requiredVehiclePlateSchema = z
  .string({ error: "Biển số xe là bắt buộc" })
  .trim()
  .min(1, { error: "Biển số xe không được để trống" })
  .max(40, { error: "Biển số xe chỉ nhận tối đa 40 ký tự" });

export const requiredIsoDateTimeSchema = z.iso
  .datetime({
    offset: true,
    error: "Giờ dự kiến đến chưa đúng.",
  })
  .refine((value) => Number.isFinite(Date.parse(value)), {
    error: "Giờ dự kiến đến chưa đúng.",
  })
  .transform((value) => new Date(value).toISOString());

export const optionalIsoDateTimeSchema = z
  .union([
    z.iso
      .datetime({
        offset: true,
        error: "Giờ dự kiến đến chưa đúng.",
      })
      .refine((value) => Number.isFinite(Date.parse(value)), {
        error: "Giờ dự kiến đến chưa đúng.",
      })
      .transform((value) => new Date(value).toISOString()),
    z.null(),
  ])
  .optional()
  .transform((value) => value ?? null);

export const supplierOrderIdempotencyHeaderSchema = z.strictObject({
  "Idempotency-Key": z
    .string({ error: "Thiếu header Idempotency-Key hợp lệ" })
    .trim()
    .pipe(requestUuidSchema),
});

/** Ngày của lô (YYYY-MM-DD); không gửi hoặc null nghĩa là không có. */
const optionalLotDateSchema = z
  .union([
    z
      .string({ error: "Ngày không hợp lệ." })
      .regex(/^\d{4}-\d{2}-\d{2}$/, {
        error: "Ngày không hợp lệ.",
      })
      .refine(
        (value) =>
          Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
          new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value,
        { error: "Ngày không hợp lệ" },
      ),
    z.null(),
  ])
  .optional()
  .transform((value) => value ?? null);

/** Ngày sản xuất không được sau hạn dùng. */
const lotDatesOrder = (
  value: { manufactureDate: string | null; expiryDate: string | null },
  ctx: z.RefinementCtx,
) => {
  if (
    value.manufactureDate &&
    value.expiryDate &&
    value.manufactureDate > value.expiryDate
  )
    ctx.addIssue({
      code: "custom",
      path: ["expiryDate"],
      message: "Hạn dùng phải sau hoặc bằng ngày sản xuất",
    });
};

export const requestSourceSelectionSchema = z
  .strictObject({
    supplyRequestItemId: requestUuidSchema,
    sourceFacilityId: requestUuidSchema,
    actualQuantity: positiveDecimalQuantitySchema,
    manufactureDate: optionalLotDateSchema,
    expiryDate: optionalLotDateSchema,
  })
  .superRefine(lotDatesOrder);

export const createFromRequestBodySchema = z.strictObject({
  sourceType: z.literal("REQUEST", {
    error: "Loại đơn không hợp lệ.",
  }),
  supplyRequestId: requestUuidSchema,
  replacesDeliveryId: requestUuidSchema.nullable().optional(),
  sources: z
    .array(requestSourceSelectionSchema, {
      error: "Danh sách nguồn cung ứng phải là mảng",
    })
    .min(1, { error: "Đơn theo yêu cầu phải chọn ít nhất 1 nguồn cung ứng" })
    .superRefine((sources, ctx) => {
      const seen = new Set<string>();
      for (let i = 0; i < sources.length; i += 1) {
        const pairKey = `${sources[i].supplyRequestItemId}:${sources[i].sourceFacilityId}`;
        if (seen.has(pairKey)) {
          ctx.addIssue({
            code: "custom",
            path: [i, "sourceFacilityId"],
            message:
              "Nguồn cung ứng cho dòng yêu cầu bị trùng lặp cơ sở cung cấp",
          });
        } else {
          seen.add(pairKey);
        }
      }
    }),
  note: optionalTrimmedText(2000, "Ghi chú"),
});

export const standaloneDeliveryItemSchema = z
  .strictObject({
    ingredientId: requestUuidSchema,
    sourceFacilityId: requestUuidSchema,
    actualQuantity: positiveDecimalQuantitySchema,
    unit: requiredText(30),
    manufactureDate: optionalLotDateSchema,
    expiryDate: optionalLotDateSchema,
  })
  .superRefine(lotDatesOrder);

export const createStandaloneBodySchema = z.strictObject({
  sourceType: z.literal("STANDALONE", {
    error: "Loại đơn không hợp lệ.",
  }),
  schoolId: requestUuidSchema,
  note: optionalTrimmedText(2000, "Ghi chú"),
  items: z
    .array(standaloneDeliveryItemSchema, {
      error: "Danh sách nguyên liệu phải là mảng",
    })
    .min(1, { error: "Đơn độc lập phải có ít nhất 1 nguyên liệu" })
    .max(100, { error: "Đơn độc lập tối đa 100 nguyên liệu" })
    .superRefine((items, ctx) => {
      const seen = new Set<string>();
      for (let i = 0; i < items.length; i += 1) {
        const pairKey = `${items[i].ingredientId}:${items[i].sourceFacilityId}`;
        if (seen.has(pairKey)) {
          ctx.addIssue({
            code: "custom",
            path: [i, "sourceFacilityId"],
            message:
              "Nguyên liệu và cơ sở cung cấp bị trùng lặp trong cùng đơn giao",
          });
        } else {
          seen.add(pairKey);
        }
      }
    }),
});

export const createSupplierOrderBodySchema = z.discriminatedUnion(
  "sourceType",
  [createFromRequestBodySchema, createStandaloneBodySchema],
);

export const supplierOrderOptionsQuerySchema = z
  .strictObject({
    page: positiveInteger(1),
    limit: positiveInteger(20).refine((value) => value <= 100, {
      error: "limit tối đa 100",
    }),
  })
  .refine((value) => (value.page - 1) * value.limit <= 2147483647, {
    path: ["page"],
    error: "page vượt giới hạn phân trang",
  });

export const supplierSchoolOptionsQuerySchema = z
  .strictObject({
    page: positiveInteger(1),
    limit: positiveInteger(20).refine((value) => value <= 100, {
      error: "limit tối đa 100",
    }),
    search: z
      .string({ error: "Từ khóa tìm kiếm phải là chuỗi văn bản" })
      .trim()
      .max(100, { error: "Từ khóa tìm kiếm tối đa 100 ký tự" })
      .optional(),
  })
  .refine((value) => (value.page - 1) * value.limit <= 2147483647, {
    path: ["page"],
    error: "page vượt giới hạn phân trang",
  })
  .transform(
    ({
      search,
      ...rest
    }): {
      page: number;
      limit: number;
      search?: string;
    } => (search && search.length > 0 ? { ...rest, search } : rest),
  );

export const supplierOrderLabelsQuerySchema = supplierOrderOptionsQuerySchema;

export const supplierOrderListQuerySchema = z
  .strictObject({
    page: positiveInteger(1),
    limit: positiveInteger(20).refine((value) => value <= 100, {
      error: "limit tối đa 100",
    }),
    sourceType: z
      .enum(["REQUEST", "STANDALONE"], {
        error: "Loại nguồn đơn giao không hợp lệ",
      })
      .optional(),
    status: z
      .enum(
        [
          "CREATED",
          "PREPARING",
          "IN_TRANSIT",
          "ARRIVED",
          "PENDING_APPROVAL",
          "APPROVED",
          "REJECTED",
          "CANCELLED_MEAL",
          "RECEIVED",
          "CANCELLED",
        ],
        { error: "Trạng thái đơn giao không hợp lệ" },
      )
      .optional(),
  })
  .refine((value) => (value.page - 1) * value.limit <= 2147483647, {
    path: ["page"],
    error: "page vượt giới hạn phân trang",
  });

export const supplierOrderDetailParamsSchema = z.strictObject({
  id: requestUuidSchema,
});

export const supplierOrderEmptyQuerySchema = z.strictObject({});

export const dispatchSupplierOrderBodySchema = z.strictObject({
  expectedArrivalAt: requiredIsoDateTimeSchema,
  vehiclePlate: requiredVehiclePlateSchema,
});

export function validateSupplierOrderIdempotencyKey(value: unknown): string {
  return parseRequest(supplierOrderIdempotencyHeaderSchema, {
    "Idempotency-Key": value,
  })["Idempotency-Key"];
}

export function validateCreateSupplierOrderBody(value: unknown) {
  return parseRequest(createSupplierOrderBodySchema, value);
}

export function validateSupplierOrderOptionsQuery(value: unknown) {
  return parseRequest(supplierOrderOptionsQuerySchema, value);
}

export function validateSupplierSchoolOptionsQuery(value: unknown) {
  return parseRequest(supplierSchoolOptionsQuerySchema, value);
}

export function validateSupplierOrderLabelsQuery(value: unknown) {
  return parseRequest(supplierOrderLabelsQuerySchema, value);
}

export function validateSupplierOrderListQuery(value: unknown) {
  return parseRequest(supplierOrderListQuerySchema, value);
}

export function validateSupplierOrderDetailParams(value: unknown) {
  return parseRequest(supplierOrderDetailParamsSchema, value);
}

export function validateSupplierOrderEmptyQuery(value: unknown) {
  return parseRequest(supplierOrderEmptyQuerySchema, value);
}

export function validateDispatchSupplierOrderBody(value: unknown) {
  return parseRequest(dispatchSupplierOrderBodySchema, value);
}
