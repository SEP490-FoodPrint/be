import { z } from "zod";
import { HttpError } from "../../utils/http-error";

const complaintTypes = [
  "MEAL_QUALITY",
  "FOOD_HYGIENE",
  "HEALTH_ISSUE",
  "OTHER",
] as const;
const complaintStatuses = [
  "SUBMITTED",
  "IN_REVIEW",
  "RESOLVED",
  "CLOSED",
] as const;
const uuid = z.string().uuid("ID không đúng định dạng UUID");
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày phải có dạng YYYY-MM-DD");

const listSchema = z.strictObject({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(complaintStatuses).optional(),
  complaintType: z.enum(complaintTypes).optional(),
  from: date.optional(),
  to: date.optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

export const createComplaintSchema = z.strictObject({
  mealAllocationId: uuid,
  complaintType: z.enum(complaintTypes),
  description: z
    .string()
    .trim()
    .min(10, "Nội dung tối thiểu 10 ký tự")
    .max(2000),
});

export const respondComplaintSchema = z
  .strictObject({
    action: z.enum(["START_REVIEW", "RESOLVE"]),
    resolution: z.string().trim().min(10).max(2000).optional(),
  })
  .superRefine((value, context) => {
    if (value.action === "RESOLVE" && !value.resolution)
      context.addIssue({
        code: "custom",
        path: ["resolution"],
        message: "Cần nhập kết quả xử lý",
      });
    if (value.action === "START_REVIEW" && value.resolution !== undefined)
      context.addIssue({
        code: "custom",
        path: ["resolution"],
        message: "Không gửi kết quả khi mới tiếp nhận",
      });
  });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const details = result.error.issues
    .map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`)
    .join("; ");
  throw new HttpError(400, `Dữ liệu khiếu nại không hợp lệ: ${details}`);
}

export function validateFeedbackListQuery(value: unknown) {
  const query = parse(listSchema, value);
  if (query.from && query.to && query.from > query.to)
    throw new HttpError(400, "Ngày bắt đầu không được sau ngày kết thúc");
  return query;
}
export const validateCreateComplaint = (value: unknown) =>
  parse(createComplaintSchema, value);
export const validateRespondComplaint = (value: unknown) =>
  parse(respondComplaintSchema, value);
export const validateComplaintId = (value: unknown) => parse(uuid, value);
