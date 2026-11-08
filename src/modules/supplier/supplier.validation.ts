import { z } from "zod";
import {
  paginationSchema,
  emptyQuerySchema,
  idParamsSchema,
  parse,
} from "../../utils/directory-validation";
export const supplierListQuerySchema = paginationSchema.safeExtend({
  search: z
    .string({ error: "Từ khóa phải là chuỗi" })
    .trim()
    .max(255, { error: "Từ khóa tối đa 255 ký tự" })
    .transform((v) => v || undefined)
    .optional(),
  status: z
    .enum(["ACTIVE", "INACTIVE"], { error: "Trạng thái không hợp lệ" })
    .optional(),
});
export const supplierSummaryQuerySchema = emptyQuerySchema;
export const supplierDetailParamsSchema = idParamsSchema;
export const validateSupplierListQuery = (value: unknown) =>
  parse(supplierListQuerySchema, value);
export const validateSupplierSummaryQuery = (value: unknown) =>
  parse(supplierSummaryQuerySchema, value);
export const validateSupplierDetailParams = (value: unknown) =>
  parse(supplierDetailParamsSchema, value);
