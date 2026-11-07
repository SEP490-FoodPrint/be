import { z } from "zod";
import {
  parseRequest,
  requestUuidSchema,
} from "../../utils/request-validation";
import { academicYearEnd } from "./academic-year";

function positiveIntegerQuery(name: string, fallback: number) {
  const message = `${name} phải là số nguyên dương`;
  return z
    .string({ error: message })
    .regex(/^[1-9]\d*$/, { error: message })
    .transform(Number)
    .refine(Number.isSafeInteger, { error: `${name} vượt giới hạn cho phép` })
    .default(fallback);
}

const academicYearSchema = z
  .string({ error: "Niên khóa phải là chuỗi" })
  .refine((value) => academicYearEnd(value) !== null, {
    error: "Niên khóa phải có dạng 2026-2027",
  });

const optionalAcademicYearSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  academicYearSchema.optional(),
);

export const classListQuerySchema = z
  .strictObject({
    page: positiveIntegerQuery("page", 1),
    limit: positiveIntegerQuery("limit", 20).refine((value) => value <= 100, {
      error: "limit tối đa 100",
    }),
    academicYear: optionalAcademicYearSchema,
  })
  .refine(({ page, limit }) => (page - 1) * limit <= 2_147_483_647, {
    path: ["page"],
    error: "page vượt giới hạn phân trang",
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

export const validateClassListQuery = (value: unknown) =>
  parseRequest(classListQuerySchema, value);

export const validateEligibleTeachersQuery = (value: unknown) =>
  parseRequest(eligibleTeachersQuerySchema, value);

export const validateClassIdParams = (value: unknown) =>
  parseRequest(classIdParamsSchema, value);

export const validateHomeroomAssignment = (value: unknown) =>
  parseRequest(homeroomAssignmentSchema, value);
