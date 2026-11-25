import type { z } from "zod";
import type {
  authorityComplaintListQuerySchema,
  authorityComplaintParamsSchema,
  escalateAuthorityComplaintSchema,
  ticketCommentInputSchema,
  ticketReopenBodySchema,
  ticketResolveInputSchema,
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
  typeof ticketCommentInputSchema
>;
export type AuthorityComplaintResolveRequestDTO = z.infer<
  typeof ticketResolveInputSchema
>;
export type AuthorityComplaintReopenRequestDTO = z.infer<
  typeof ticketReopenBodySchema
>;
