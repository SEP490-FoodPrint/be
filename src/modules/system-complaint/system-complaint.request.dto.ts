import type { z } from "zod";
import type {
  createSystemComplaintSchema,
  systemComplaintListQuerySchema,
  ticketCommentBodySchema,
  ticketReopenBodySchema,
  ticketResolveBodySchema,
} from "./system-complaint.validation";

export type CreateSystemComplaintRequestDTO = z.infer<
  typeof createSystemComplaintSchema
>;
export type SystemComplaintListQueryDTO = z.infer<
  typeof systemComplaintListQuerySchema
>;
export type SystemComplaintCommentRequestDTO = z.infer<
  typeof ticketCommentBodySchema
>;
export type SystemComplaintResolveRequestDTO = z.infer<
  typeof ticketResolveBodySchema
>;
export type SystemComplaintReopenRequestDTO = z.infer<
  typeof ticketReopenBodySchema
>;
