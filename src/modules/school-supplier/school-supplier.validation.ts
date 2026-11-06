import { z } from "zod";
import { paginationSchema, parse } from "../../utils/directory-validation";
export const schoolSupplierListQuerySchema = paginationSchema;
export const schoolSupplierSchoolParamsSchema = z.strictObject({
  schoolId: z.string().uuid({ error: "ID trường học không hợp lệ" }),
});
export function validateSchoolSupplierListQuery(value: unknown) {
  return parse(schoolSupplierListQuerySchema, value);
}
export function validateSchoolSupplierSchoolParams(value: unknown) {
  return parse(schoolSupplierSchoolParamsSchema, value);
}
