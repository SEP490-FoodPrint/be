import { z } from "zod";
import {
  parseRequest,
  requestUuidSchema,
} from "../../utils/request-validation";

const kind = z.enum(
  [
    "deliveries",
    "delivery-declarations",
    "cooking-batches",
    "retained-samples",
    "registrations",
    "meal-distributions",
  ],
  { error: "Loại bằng chứng không hợp lệ" },
);

export const recordParamsSchema = z.strictObject({
  kind,
  recordId: requestUuidSchema,
});
export const versionParamsSchema = z.strictObject({
  kind,
  versionId: requestUuidSchema,
});
export const chainParamsSchema = z.strictObject({
  mealAllocationId: requestUuidSchema,
});
export const chainQuerySchema = z.strictObject({
  verify: z
    .enum(["true", "false"], { error: "verify phải là true hoặc false" })
    .optional()
    .transform((value) => value === "true"),
});

const day = z
  .string({ error: "Ngày không hợp lệ." })
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Ngày không hợp lệ." })
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
    error: "Ngày không hợp lệ",
  });
const mealType = z.enum(["LUNCH", "AFTERNOON"], {
  error: "Bữa ăn phải là LUNCH hoặc AFTERNOON",
});
const verify = chainQuerySchema.shape.verify;
/** A grade id, or `none` for classes not yet in a grade (becomes null). */
const gradeId = z
  .union([requestUuidSchema, z.literal("none")], {
    error: "Khối không hợp lệ",
  })
  .transform((value) => (value === "none" ? null : value));
const schoolCode = z
  .string({ error: "Mã trường không hợp lệ" })
  .trim()
  .min(1, { error: "Mã trường không hợp lệ" })
  .max(80, { error: "Mã trường không hợp lệ" });

export const gradeMealsQuerySchema = z.strictObject({
  date: day,
  schoolId: requestUuidSchema.optional(),
});
export const gradeParamsSchema = z.strictObject({ gradeId });
export const gradeChainQuerySchema = z.strictObject({
  date: day,
  mealType,
  verify,
  schoolId: requestUuidSchema.optional(),
});
export const publicSchoolParamsSchema = z.strictObject({ schoolCode });
export const publicGradeMealsQuerySchema = z.strictObject({ date: day });
export const publicGradeParamsSchema = z.strictObject({ schoolCode, gradeId });
export const publicGradeChainQuerySchema = z.strictObject({
  date: day,
  mealType,
  verify,
});

export const validateRecordParams = (value: unknown) =>
  parseRequest(recordParamsSchema, value);
export const validateVersionParams = (value: unknown) =>
  parseRequest(versionParamsSchema, value);
export const validateChainParams = (value: unknown) =>
  parseRequest(chainParamsSchema, value);
export const validateChainQuery = (value: unknown) =>
  parseRequest(chainQuerySchema, value);
export const validateGradeMealsQuery = (value: unknown) =>
  parseRequest(gradeMealsQuerySchema, value);
export const validateGradeParams = (value: unknown) =>
  parseRequest(gradeParamsSchema, value);
export const validateGradeChainQuery = (value: unknown) =>
  parseRequest(gradeChainQuerySchema, value);
export const validatePublicSchoolParams = (value: unknown) =>
  parseRequest(publicSchoolParamsSchema, value);
export const validatePublicGradeMealsQuery = (value: unknown) =>
  parseRequest(publicGradeMealsQuerySchema, value);
export const validatePublicGradeParams = (value: unknown) =>
  parseRequest(publicGradeParamsSchema, value);
export const validatePublicGradeChainQuery = (value: unknown) =>
  parseRequest(publicGradeChainQuerySchema, value);
