import { z } from "zod";
import { paginationSchema, parse } from "../../utils/directory-validation";
export const userListQuerySchema = paginationSchema;
export const userSchoolParamsSchema = z.strictObject({
  schoolId: z.string().uuid({ error: "ID trường học không hợp lệ" }),
});
export function validateUserListQuery(value: unknown) {
  return parse(userListQuerySchema, value);
}
export function validateUserSchoolParams(value: unknown) {
  return parse(userSchoolParamsSchema, value);
}
