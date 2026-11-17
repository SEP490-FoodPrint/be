import { z } from "zod";
import { paginationSchema } from "../../utils/directory-validation";
import {
  parseRequest,
  requestUuidSchema,
} from "../../utils/request-validation";

export const supplierSchoolListQuerySchema = paginationSchema;
export const supplierSchoolContractListQuerySchema = paginationSchema;

export const supplierSchoolParamsSchema = z.strictObject({
  schoolId: requestUuidSchema,
});

export const supplierSchoolContractParamsSchema = z.strictObject({
  schoolId: requestUuidSchema,
  contractId: requestUuidSchema,
});

export const supplierSchoolDocumentParamsSchema = z.strictObject({
  schoolId: requestUuidSchema,
  contractId: requestUuidSchema,
  documentId: requestUuidSchema,
});

export const supplierSchoolEmptyQuerySchema = z.strictObject({});

export const supplierSchoolDocumentQuerySchema = z.strictObject({
  disposition: z
    .enum(["inline", "attachment"], {
      error: "disposition chỉ nhận inline hoặc attachment",
    })
    .default("inline"),
});

export const validateSupplierSchoolListQuery = (value: unknown) =>
  parseRequest(supplierSchoolListQuerySchema, value);

export const validateSupplierSchoolParams = (value: unknown) =>
  parseRequest(supplierSchoolParamsSchema, value);

export const validateSupplierSchoolContractListQuery = (value: unknown) =>
  parseRequest(supplierSchoolContractListQuerySchema, value);

export const validateSupplierSchoolContractParams = (value: unknown) =>
  parseRequest(supplierSchoolContractParamsSchema, value);

export const validateSupplierSchoolDocumentParams = (value: unknown) =>
  parseRequest(supplierSchoolDocumentParamsSchema, value);

export const validateSupplierSchoolDocumentQuery = (value: unknown) =>
  parseRequest(
    supplierSchoolDocumentQuerySchema,
    value === undefined ? {} : value,
  );

export const validateSupplierSchoolEmptyQuery = (value: unknown) =>
  parseRequest(
    supplierSchoolEmptyQuerySchema,
    value === undefined ? {} : value,
  );
