import { z } from "zod";
import { HttpError } from "../../utils/http-error";
import { RequestValidationError } from "../../utils/request-validation";
import { TICKET_STATUSES } from "../complaint-ticket/complaint-ticket.lifecycle";
import {
  evidenceFilesSchema,
  ticketCommentInputSchema,
  ticketEmptyBodySchema,
  ticketReopenBodySchema,
  ticketResolveInputSchema,
  ticketTitleSchema,
} from "../complaint-ticket/complaint-ticket.validation";

export {
  ticketCommentInputSchema,
  ticketReopenBodySchema,
  ticketResolveInputSchema,
};

/** Loại khiếu nại được lọc (kể cả `HEALTH_ISSUE` của dữ liệu cũ). */
const complaintTypes = [
  "MEAL_QUALITY",
  "FOOD_HYGIENE",
  "HEALTH_ISSUE",
  "OTHER",
] as const;
/** Đơn mới không nhận `HEALTH_ISSUE` (Q21): vấn đề sức khỏe đi qua luồng báo cáo sự cố. */
const submittableComplaintTypes = [
  "MEAL_QUALITY",
  "FOOD_HYGIENE",
  "OTHER",
] as const;
const uuid = z.string().uuid("Mục đã chọn không hợp lệ.");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ.");

export const complaintListQuerySchema = z.strictObject({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(TICKET_STATUSES).optional(),
  complaintType: z.enum(complaintTypes).optional(),
  from: date.optional(),
  to: date.optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

const mealOptionsQuerySchema = z.strictObject({});
export const validateMealOptionsQuery = (query: unknown) =>
  parse(mealOptionsQuerySchema, query);

export const createComplaintSchema = z.strictObject({
  dailyMealPortionId: uuid,
  complaintType: z.enum(submittableComplaintTypes, {
    error: "Loại khiếu nại không hợp lệ; vấn đề sức khỏe gửi qua báo cáo sự cố",
  }),
  title: ticketTitleSchema,
  description: z
    .string()
    .trim()
    .min(10, "Nội dung tối thiểu 10 ký tự")
    .max(2000),
  files: evidenceFilesSchema,
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new RequestValidationError(
    result.error.issues.map((issue) => ({
      field: issue.path.join(".") || "body",
      message: /[^\u0020-\u007E]/.test(issue.message)
        ? issue.message
        : "Giá trị không hợp lệ",
    })),
  );
}

export function validateFeedbackListQuery(value: unknown) {
  const query = parse(complaintListQuerySchema, value);
  if (query.from && query.to && query.from > query.to)
    throw new HttpError(400, "Ngày bắt đầu không được sau ngày kết thúc");
  return query;
}
export const validateCreateComplaint = (value: unknown) =>
  parse(createComplaintSchema, value);
export const validateComplaintId = (value: unknown) => parse(uuid, value);
export const validateComplaintComment = (value: unknown) =>
  parse(ticketCommentInputSchema, value);
export const validateComplaintResolve = (value: unknown) =>
  parse(ticketResolveInputSchema, value);
export const validateComplaintReopen = (value: unknown) =>
  parse(ticketReopenBodySchema, value ?? {});
export const validateComplaintEmptyBody = (value: unknown) =>
  parse(ticketEmptyBodySchema, value ?? {});
