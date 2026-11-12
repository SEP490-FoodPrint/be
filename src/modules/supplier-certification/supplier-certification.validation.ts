import { z } from "zod";
import {
  paginationSchema,
  emptyQuerySchema,
  parse,
} from "../../utils/directory-validation";
export const certificationListSchema = paginationSchema;
export const supplierCertificationParamsSchema = z.strictObject({
  supplierId: z.string().uuid({ message: "ID nhà cung cấp không hợp lệ" }),
});
export const certificationDocumentParamsSchema = z.strictObject({
  id: z.string().uuid({ message: "ID chứng nhận không hợp lệ" }),
  documentId: z.string().uuid({ message: "ID tài liệu không hợp lệ" }),
});
export const certificationEmptyQuerySchema = emptyQuerySchema;
export const validateSupplierCertificationListQuery = (value: unknown) =>
  parse(certificationListSchema, value);
export const validateSupplierCertificationParams = (value: unknown) =>
  parse(supplierCertificationParamsSchema, value);
export const validateCertificationDocumentParams = (value: unknown) =>
  parse(certificationDocumentParamsSchema, value);
export const validateCertificationEmptyQuery = (value: unknown) =>
  parse(certificationEmptyQuerySchema, value);
