import { z } from "zod";
import { paginationSchema } from "../../utils/directory-validation";
import { isoTimestamp } from "../../utils/auth-validation";
import {
  parseRequest,
  requestUuidSchema,
  requiredText,
} from "../../utils/request-validation";
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
export const foodSampleSchema = z.strictObject({
  quantity: z
    .union([z.number(), z.string()], {
      error: "Lượng mẫu phải là số hoặc chuỗi số thập phân",
    })
    .transform(String)
    .refine(
      (value) =>
        /^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/.test(value) && Number(value) > 0,
      { error: "Lượng mẫu phải dương, tối đa 3 chữ số thập phân" },
    ),
  unit: requiredText(30)
    .toLowerCase()
    .refine((value) => ["g", "ml"].includes(value), {
      error: "Đơn vị mẫu lưu phải là g hoặc ml",
    }),
  storageLocation: requiredText(255),
  sampledAt: timestampSchema,
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
