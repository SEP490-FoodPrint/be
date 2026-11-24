import type { z } from "zod";
import type {
  assignAuthorityLocationBodySchema,
  assignOrganizationLocationBodySchema,
  authorityParamsSchema,
  authoritySchoolListQuerySchema,
  authoritySchoolParamsSchema,
  schoolLocationParamsSchema,
  supplierLocationParamsSchema,
} from "./authority.validation";

export type AuthorityParamsRequest = z.infer<typeof authorityParamsSchema>;

export type AssignAuthorityLocationRequest = z.infer<
  typeof assignAuthorityLocationBodySchema
>;

export type SchoolLocationParamsRequest = z.infer<
  typeof schoolLocationParamsSchema
>;
export type SupplierLocationParamsRequest = z.infer<
  typeof supplierLocationParamsSchema
>;
export type AssignOrganizationLocationRequest = z.infer<
  typeof assignOrganizationLocationBodySchema
>;
export type AuthoritySchoolListRequest = z.infer<
  typeof authoritySchoolListQuerySchema
>;
export type AuthoritySchoolParamsRequest = z.infer<
  typeof authoritySchoolParamsSchema
>;
