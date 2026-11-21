import { z } from "zod";
import {
  parseRequest,
  requestUuidSchema,
} from "../../utils/request-validation";
import { TICKET_STATUSES } from "../complaint-ticket/complaint-ticket.lifecycle";
import {
  ticketCommentBodySchema,
  ticketEmptyBodySchema,
  ticketReopenBodySchema,
  ticketResolveBodySchema,
} from "../complaint-ticket/complaint-ticket.validation";

export {
  ticketCommentBodySchema,
  ticketReopenBodySchema,
  ticketResolveBodySchema,
};

export const authorityComplaintListQuerySchema = z.strictObject({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(TICKET_STATUSES).optional(),
});

export const authorityComplaintParamsSchema = z.strictObject({
  id: requestUuidSchema,
});

/** "Chuyển ATTP": đơn C03 gốc và lý do tùy chọn (R6b). */
export const escalateAuthorityComplaintSchema = z.strictObject({
  mealComplaintId: requestUuidSchema,
  reason: ticketReopenBodySchema.shape.reason,
});

export const validateAuthorityComplaintListQuery = (value: unknown) =>
  parseRequest(authorityComplaintListQuerySchema, value ?? {});
export const validateAuthorityComplaintParams = (value: unknown) =>
  parseRequest(authorityComplaintParamsSchema, value);
export const validateEscalateAuthorityComplaint = (value: unknown) =>
  parseRequest(escalateAuthorityComplaintSchema, value);
export const validateAuthorityComplaintComment = (value: unknown) =>
  parseRequest(ticketCommentBodySchema, value);
export const validateAuthorityComplaintResolve = (value: unknown) =>
  parseRequest(ticketResolveBodySchema, value);
export const validateAuthorityComplaintReopen = (value: unknown) =>
  parseRequest(ticketReopenBodySchema, value ?? {});
export const validateAuthorityComplaintEmptyBody = (value: unknown) =>
  parseRequest(ticketEmptyBodySchema, value ?? {});
