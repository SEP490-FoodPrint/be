import { z } from "zod";
import { HttpError } from "../../utils/http-error";
import {
  SYSTEM_COMPLAINT_CATEGORIES,
  TICKET_STATUSES,
} from "../complaint-ticket/complaint-ticket.lifecycle";
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

const uuid = z.string().uuid("ID không đúng định dạng UUID");
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày phải có dạng YYYY-MM-DD");
const category = z.enum(SYSTEM_COMPLAINT_CATEGORIES, {
  error: "Phân loại khiếu nại không hợp lệ",
});

export const systemComplaintListQuerySchema = z.strictObject({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(TICKET_STATUSES).optional(),
  category: category.optional(),
  from: date.optional(),
  to: date.optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

export const createSystemComplaintSchema = z.strictObject({
  category,
  description: z
    .string({ error: "Nội dung phải là văn bản" })
    .trim()
    .refine((value) => Array.from(value).length >= 10, {
      error: "Nội dung tối thiểu 10 ký tự",
    })
    .refine((value) => Array.from(value).length <= 2000, {
      error: "Nội dung chỉ nhận tối đa 2000 ký tự",
    }),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const details = result.error.issues
    .map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`)
    .join("; ");
  throw new HttpError(400, `Dữ liệu khiếu nại không hợp lệ: ${details}`);
}

export function validateSystemComplaintListQuery(value: unknown) {
  const query = parse(systemComplaintListQuerySchema, value);
  if (query.from && query.to && query.from > query.to)
    throw new HttpError(400, "Ngày bắt đầu không được sau ngày kết thúc");
  return query;
}
export const validateCreateSystemComplaint = (value: unknown) =>
  parse(createSystemComplaintSchema, value);
export const validateSystemComplaintId = (value: unknown) => parse(uuid, value);
export const validateSystemComplaintComment = (value: unknown) =>
  parse(ticketCommentBodySchema, value);
export const validateSystemComplaintResolve = (value: unknown) =>
  parse(ticketResolveBodySchema, value);
export const validateSystemComplaintReopen = (value: unknown) =>
  parse(ticketReopenBodySchema, value ?? {});
export const validateSystemComplaintEmptyBody = (value: unknown) =>
  parse(ticketEmptyBodySchema, value ?? {});
