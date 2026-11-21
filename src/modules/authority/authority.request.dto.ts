import type { z } from "zod";
import type {
  assignAuthorityLocationBodySchema,
  authorityParamsSchema,
} from "./authority.validation";

export type AuthorityParamsRequest = z.infer<typeof authorityParamsSchema>;

export type AssignAuthorityLocationRequest = z.infer<
  typeof assignAuthorityLocationBodySchema
>;
