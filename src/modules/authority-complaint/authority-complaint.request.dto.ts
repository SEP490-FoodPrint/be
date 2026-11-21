import type { z } from "zod";
import type {
  authorityComplaintListQuerySchema,
  authorityComplaintParamsSchema,
  escalateAuthorityComplaintSchema,
  ticketCommentBodySchema,
  ticketReopenBodySchema,
  ticketResolveBodySchema,
} from "./authority-complaint.validation";

export type AuthorityComplaintListQueryDTO = z.infer<
  typeof authorityComplaintListQuerySchema
>;
export type AuthorityComplaintParamsDTO = z.infer<
  typeof authorityComplaintParamsSchema
>;
export type EscalateAuthorityComplaintRequestDTO = z.infer<
  typeof escalateAuthorityComplaintSchema
>;
export type AuthorityComplaintCommentRequestDTO = z.infer<
  typeof ticketCommentBodySchema
>;
export type AuthorityComplaintResolveRequestDTO = z.infer<
  typeof ticketResolveBodySchema
>;
export type AuthorityComplaintReopenRequestDTO = z.infer<
  typeof ticketReopenBodySchema
>;
