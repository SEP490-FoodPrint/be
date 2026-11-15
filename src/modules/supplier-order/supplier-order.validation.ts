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
  .string({ error: "actualQuantity phải là chuỗi số dương" })
  .regex(/^(?:0|[1-9]\d{0,10})(?:\.\d{1,3})?$/, {
    error:
      "actualQuantity chỉ nhận tối đa 11 chữ số nguyên và 3 chữ số thập phân",
  })
  .refine((value) => !/^0(?:\.0{1,3})?$/.test(value), {
    error: "actualQuantity phải lớn hơn 0",
  })
  .transform((value) =>
    value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value,
  );

export const optionalIsoDateTimeSchema = z
  .union([
    z.iso
      .datetime({
        offset: true,
        error: "expectedArrivalAt phải là thời gian ISO8601 có múi giờ",
      })
      .refine((value) => Number.isFinite(Date.parse(value)), {
        error: "expectedArrivalAt không hợp lệ",
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

export const createFromRequestBodySchema = z.strictObject({
  sourceType: z.literal("REQUEST", {
    error: "sourceType phải là REQUEST hoặc STANDALONE",
  }),
  supplyRequestId: requestUuidSchema,
  expectedArrivalAt: optionalIsoDateTimeSchema,
  vehiclePlate: optionalTrimmedText(40, "Biển số xe"),
  note: optionalTrimmedText(2000, "Ghi chú"),
});

export const standaloneDeliveryItemSchema = z.strictObject({
  ingredientId: requestUuidSchema,
  actualQuantity: positiveDecimalQuantitySchema,
  unit: requiredText(30),
});

export const createStandaloneBodySchema = z.strictObject({
  sourceType: z.literal("STANDALONE", {
    error: "sourceType phải là REQUEST hoặc STANDALONE",
  }),
  schoolId: requestUuidSchema,
  expectedArrivalAt: optionalIsoDateTimeSchema,
  vehiclePlate: optionalTrimmedText(40, "Biển số xe"),
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
        const ingredientId = items[i].ingredientId;
        if (seen.has(ingredientId)) {
          ctx.addIssue({
            code: "custom",
            path: [i, "ingredientId"],
            message: "Nguyên liệu bị trùng lặp trong cùng đơn giao",
          });
        } else {
          seen.add(ingredientId);
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

export function validateSupplierOrderListQuery(value: unknown) {
  return parseRequest(supplierOrderListQuerySchema, value);
}

export function validateSupplierOrderDetailParams(value: unknown) {
  return parseRequest(supplierOrderDetailParamsSchema, value);
}

export function validateSupplierOrderEmptyQuery(value: unknown) {
  return parseRequest(supplierOrderEmptyQuerySchema, value);
}
