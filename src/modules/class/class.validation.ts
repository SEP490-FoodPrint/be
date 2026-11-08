import { z } from "zod";
import { paginationSchema, parse } from "../../utils/directory-validation";
export const classListQuerySchema = paginationSchema;
export const classSchoolParamsSchema = z.strictObject({
  schoolId: z.string().uuid({ error: "ID trường học không hợp lệ" }),
});
export function validateClassListQuery(value: unknown) {
  return parse(classListQuerySchema, value);
}
export function validateClassSchoolParams(value: unknown) {
  return parse(classSchoolParamsSchema, value);
}
