import type { z } from "zod";
import type {
  complaintListQuerySchema,
  createComplaintSchema,
  ticketCommentInputSchema,
  ticketReopenBodySchema,
  ticketResolveInputSchema,
} from "./feedback.validation";
export type CreateComplaintRequestDTO = z.infer<typeof createComplaintSchema>;
export type ComplaintListQueryDTO = z.infer<typeof complaintListQuerySchema>;
export type ComplaintCommentRequestDTO = z.infer<
  typeof ticketCommentInputSchema
>;
export type ComplaintResolveRequestDTO = z.infer<
  typeof ticketResolveInputSchema
>;
export type ComplaintReopenRequestDTO = z.infer<typeof ticketReopenBodySchema>;
