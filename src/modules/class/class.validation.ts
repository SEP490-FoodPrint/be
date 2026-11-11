import { z } from "zod";
import { paginationSchema, parse } from "../../utils/directory-validation";
import { requestUuidSchema } from "../../utils/request-validation";
import { academicYearEnd } from "./academic-year";
const academicYearSchema = z
  .string()
  .refine(
    (value) => academicYearEnd(value) !== null,
    "Niên khóa phải có dạng 2026-2027",
  );
const optionalAcademicYearSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  academicYearSchema.optional(),
);
const classNameSchema = z
  .string({ error: "Tên lớp là bắt buộc" })
  .trim()
  .min(1, "Tên lớp là bắt buộc")
  .max(120, "Tên lớp tối đa 120 ký tự");
const mealPortionsSchema = z
  .number({ error: "Số suất đăng ký phải là số nguyên" })
  .int("Số suất đăng ký phải là số nguyên")
  .min(0, "Số suất đăng ký không được âm")
  .max(2147483647, "Số suất đăng ký quá lớn");
export const classListQuerySchema = paginationSchema.safeExtend({
  academicYear: optionalAcademicYearSchema,
});
export const eligibleTeachersQuerySchema = z.strictObject({
  academicYear: optionalAcademicYearSchema,
});
export const classIdParamsSchema = z.strictObject({
  classId: requestUuidSchema,
});
export const homeroomAssignmentSchema = z.strictObject({
  teacherUserId: requestUuidSchema,
});
export const classSchoolParamsSchema = z.strictObject({
  schoolId: z.string().uuid({ error: "ID trường học không hợp lệ" }),
});
export const createClassSchema = z.strictObject({
  name: classNameSchema,
  academicYear: academicYearSchema,
  registeredMealPortions: mealPortionsSchema.default(0),
});
export const updateClassSchema = z
  .strictObject({
    name: classNameSchema.optional(),
    registeredMealPortions: mealPortionsSchema.optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined || value.registeredMealPortions !== undefined,
    "Cần ít nhất một thông tin cần sửa",
  );
export const classStatusSchema = z.strictObject({
  status: z.enum(["ACTIVE", "INACTIVE"], {
    error: "Trạng thái phải là ACTIVE hoặc INACTIVE",
  }),
});
export const copyClassesSchema = z
  .strictObject({
    fromAcademicYear: academicYearSchema,
    toAcademicYear: academicYearSchema,
  })
  .refine((value) => value.fromAcademicYear !== value.toAcademicYear, {
    message: "Niên khóa đích phải khác niên khóa nguồn",
    path: ["toAcademicYear"],
  });
export function validateClassListQuery(value: unknown) {
  return parse(classListQuerySchema, value);
}
export function validateClassSchoolParams(value: unknown) {
  return parse(classSchoolParamsSchema, value);
}
export const validateEligibleTeachersQuery = (value: unknown) =>
  parse(eligibleTeachersQuerySchema, value);
export const validateClassIdParams = (value: unknown) =>
  parse(classIdParamsSchema, value);
export const validateHomeroomAssignment = (value: unknown) =>
  parse(homeroomAssignmentSchema, value);
export const validateCreateClass = (value: unknown) =>
  parse(createClassSchema, value);
export const validateUpdateClass = (value: unknown) =>
  parse(updateClassSchema, value);
export const validateClassStatus = (value: unknown) =>
  parse(classStatusSchema, value);
export const validateCopyClasses = (value: unknown) =>
  parse(copyClassesSchema, value);
