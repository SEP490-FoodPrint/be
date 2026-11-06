import type { z } from "zod";
import type {
  supplierListQuerySchema,
  supplierSummaryQuerySchema,
  supplierDetailParamsSchema,
} from "./supplier.validation";
export type SupplierListRequestDTO = z.infer<typeof supplierListQuerySchema>;
export type SupplierSummaryRequestDTO = z.infer<
  typeof supplierSummaryQuerySchema
>;
export type SupplierDetailRequestDTO = z.infer<
  typeof supplierDetailParamsSchema
>;
