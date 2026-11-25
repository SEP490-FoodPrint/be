import { z } from "zod";
import { paginationSchema } from "../../utils/directory-validation";
import { isoTimestamp } from "../../utils/auth-validation";
import {
  parseRequest,
  requestUuidSchema,
  requiredText,
} from "../../utils/request-validation";
/** QĐ 1246/QĐ-BYT: mẫu thức ăn đặc tối thiểu 100 g, thức ăn lỏng tối thiểu 150 ml. */
export const MINIMUM_SAMPLE_QUANTITY = { g: 100, ml: 150 } as const;
const timestampSchema = z
  .string({ error: "Thời gian phải là ISO 8601 có múi giờ" })
  .transform((value, context) => {
    try {
      return isoTimestamp(value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "Thời gian phải là ISO 8601 hợp lệ có múi giờ",
      });
      return z.NEVER;
    }
  });
export const retainedSampleListQuerySchema = paginationSchema.safeExtend({
  status: z
    .enum(["STORED", "DISPOSED"], { error: "Trạng thái mẫu lưu không hợp lệ" })
    .optional(),
  search: z
    .string({ error: "Từ khóa phải là văn bản" })
    .trim()
    .max(100, { error: "Từ khóa tìm kiếm tối đa 100 ký tự" })
    .transform((value) => value || undefined)
    .optional(),
});
export const retainedSampleBatchParamsSchema = z.strictObject({
  id: requestUuidSchema,
});
export const retainedSampleDisposalParamsSchema = z.strictObject({
  sampleId: requestUuidSchema,
});
export const foodSampleSchema = z
  .strictObject({
    dishId: requestUuidSchema.optional(),
    quantity: z
      .union([z.number(), z.string()], {
        error: "Lượng mẫu phải là số hoặc chuỗi số thập phân",
      })
      .transform(String)
      .refine(
        (value) =>
          /^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/.test(value) && Number(value) > 0,
        { error: "Lượng mẫu phải dương, tối đa 3 chữ số thập phân" },
      )
      .optional(),
    unit: requiredText(30)
      .toLowerCase()
      .refine((value) => ["g", "ml"].includes(value), {
        error: "Đơn vị mẫu lưu phải là g hoặc ml",
      })
      .optional(),
    /** Tủ lưu mẫu của trường (bắt buộc); hệ thống kiểm tra trạng thái và sức chứa. */
    storageUnitId: requestUuidSchema,
    /** Ngăn đã khai báo của tủ; số ngăn tối đa được kiểm tra theo tủ trong service. */
    storageLocation: requiredText(255).regex(/^Ngăn [1-9]\d*$/, {
      error: "Vui lòng chọn ngăn trong tủ lưu mẫu",
    }),
    sampledAt: timestampSchema,
  })
  .superRefine((sample, context) => {
    const hasQuantity = sample.quantity !== undefined;
    const hasUnit = sample.unit !== undefined;
    if (hasQuantity !== hasUnit) {
      context.addIssue({
        code: "custom",
        path: [hasQuantity ? "unit" : "quantity"],
        message: "Lượng mẫu và đơn vị phải được cung cấp cùng nhau",
      });
      return;
    }
    if (!hasQuantity || !hasUnit) return;
    const minimum =
      MINIMUM_SAMPLE_QUANTITY[
        sample.unit as keyof typeof MINIMUM_SAMPLE_QUANTITY
      ];
    if (minimum !== undefined && Number(sample.quantity) < minimum)
      context.addIssue({
        code: "custom",
        path: ["quantity"],
        message:
          sample.unit === "g"
            ? `Mẫu thức ăn đặc tối thiểu ${minimum} g (QĐ 1246/QĐ-BYT)`
            : `Mẫu thức ăn lỏng tối thiểu ${minimum} ml (QĐ 1246/QĐ-BYT)`,
      });
  });
export const sampleDisposalSchema = z.strictObject({
  disposedAt: timestampSchema,
  disposalNote: requiredText(2000),
});
export function validateRetainedSampleListQuery(value: unknown) {
  return parseRequest(retainedSampleListQuerySchema, value);
}
export function validateFoodSample(value: unknown) {
  return parseRequest(foodSampleSchema, value);
}
export function validateSampleDisposal(value: unknown) {
  return parseRequest(sampleDisposalSchema, value);
}
export function validateRetainedSampleBatchParams(value: unknown) {
  return parseRequest(retainedSampleBatchParamsSchema, value);
}
export function validateRetainedSampleDisposalParams(value: unknown) {
  return parseRequest(retainedSampleDisposalParamsSchema, value);
}
