import type { z } from "zod";
import type {
  supplierStaffQuerySchema,
  supplierStaffParamsSchema,
  supplierStaffPermissionParamsSchema,
  supplierStaffCreateSchema,
  supplierStaffStatusSchema,
  supplierStaffEmptySchema,
} from "./supplier-staff.validation";

export type SupplierStaffQueryRequest = z.infer<
  typeof supplierStaffQuerySchema
>;
export type SupplierStaffParamsRequest = z.infer<
  typeof supplierStaffParamsSchema
>;
export type SupplierStaffPermissionParamsRequest = z.infer<
  typeof supplierStaffPermissionParamsSchema
>;
export type SupplierStaffCreateRequest = z.infer<
  typeof supplierStaffCreateSchema
>;
export type SupplierStaffStatusRequest = z.infer<
  typeof supplierStaffStatusSchema
>;
export type SupplierStaffEmptyRequest = z.infer<
  typeof supplierStaffEmptySchema
>;
