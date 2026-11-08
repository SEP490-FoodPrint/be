import type { z } from "zod";
import type {
  schoolSupplierListQuerySchema,
  schoolSupplierSchoolParamsSchema,
} from "./school-supplier.validation";
export type SchoolSupplierListRequestDTO = z.infer<
  typeof schoolSupplierListQuerySchema
>;
export type SchoolSupplierSchoolRequestDTO = {
  query: SchoolSupplierListRequestDTO;
  params: z.infer<typeof schoolSupplierSchoolParamsSchema>;
};
