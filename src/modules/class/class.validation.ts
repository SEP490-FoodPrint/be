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
