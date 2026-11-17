import type { z } from "zod";
import type {
  supplierSchoolListQuerySchema,
  supplierSchoolParamsSchema,
  supplierSchoolContractListQuerySchema,
  supplierSchoolContractParamsSchema,
  supplierSchoolDocumentParamsSchema,
  supplierSchoolDocumentQuerySchema,
  supplierSchoolEmptyQuerySchema,
} from "./supplier-school.validation";

export type SupplierSchoolListQueryRequest = z.infer<
  typeof supplierSchoolListQuerySchema
>;
export type SupplierSchoolParamsRequest = z.infer<
  typeof supplierSchoolParamsSchema
>;
export type SupplierSchoolContractListQueryRequest = z.infer<
  typeof supplierSchoolContractListQuerySchema
>;
export type SupplierSchoolContractParamsRequest = z.infer<
  typeof supplierSchoolContractParamsSchema
>;
export type SupplierSchoolDocumentParamsRequest = z.infer<
  typeof supplierSchoolDocumentParamsSchema
>;
export type SupplierSchoolDocumentQueryRequest = z.infer<
  typeof supplierSchoolDocumentQuerySchema
>;
export type SupplierSchoolEmptyQueryRequest = z.infer<
  typeof supplierSchoolEmptyQuerySchema
>;
