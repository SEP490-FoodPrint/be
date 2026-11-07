import type { z } from "zod";
import type {
  certificationListSchema,
  supplierCertificationParamsSchema,
  certificationDocumentParamsSchema,
} from "./supplier-certification.validation";
export type CertificationListRequestDTO = z.infer<
  typeof certificationListSchema
>;
export type SupplierCertificationParamsDTO = z.infer<
  typeof supplierCertificationParamsSchema
>;
export type CertificationDocumentRequestDTO = z.infer<
  typeof certificationDocumentParamsSchema
>;
