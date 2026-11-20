import type { z } from "zod";
import type {
  complaintListQuerySchema,
  createComplaintSchema,
  ticketCommentBodySchema,
  ticketReopenBodySchema,
  ticketResolveBodySchema,
} from "./feedback.validation";
export type CreateComplaintRequestDTO = z.infer<typeof createComplaintSchema>;
export type ComplaintListQueryDTO = z.infer<typeof complaintListQuerySchema>;
export type ComplaintCommentRequestDTO = z.infer<
  typeof ticketCommentBodySchema
>;
export type ComplaintResolveRequestDTO = z.infer<
  typeof ticketResolveBodySchema
>;
export type ComplaintReopenRequestDTO = z.infer<typeof ticketReopenBodySchema>;
