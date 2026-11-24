import type { z } from "zod";
import type {
  authorityOfficerCreateSchema,
  authorityOfficerListQuerySchema,
  authorityOfficerParamsSchema,
} from "./authority-officer.validation";

export type AuthorityOfficerCreateRequest = z.infer<
  typeof authorityOfficerCreateSchema
>;
export type AuthorityOfficerListQueryRequest = z.infer<
  typeof authorityOfficerListQuerySchema
>;
export type AuthorityOfficerParamsRequest = z.infer<
  typeof authorityOfficerParamsSchema
>;
