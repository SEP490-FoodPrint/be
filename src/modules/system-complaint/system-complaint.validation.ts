import { z } from "zod";

export const createSystemComplaintSchema = z.object({
  title: z
    .string()
    .trim()
    .min(5, "Tiêu đề phải có ít nhất 5 ký tự")
    .max(255, "Tiêu đề không được vượt quá 255 ký tự"),
  description: z
    .string()
    .trim()
    .min(10, "Mô tả chi tiết phải có ít nhất 10 ký tự")
    .max(5000, "Mô tả không được vượt quá 5000 ký tự"),
});

export type CreateSystemComplaintInput = z.infer<
  typeof createSystemComplaintSchema
>;

export const respondSystemComplaintSchema = z.object({
  content: z
    .string()
    .trim()
    .min(10, "Nội dung phản hồi phải có ít nhất 10 ký tự")
    .max(5000, "Nội dung phản hồi không được vượt quá 5000 ký tự"),
  changeReason: z
    .string()
    .trim()
    .min(5, "Lý do thay đổi phản hồi phải có ít nhất 5 ký tự")
    .max(500, "Lý do thay đổi không được vượt quá 500 ký tự")
    .optional(),
});

export type RespondSystemComplaintInput = z.infer<
  typeof respondSystemComplaintSchema
>;

export const systemComplaintListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["SUBMITTED", "IN_REVIEW", "RESPONDED"]).optional(),
  search: z.string().trim().optional(),
});

export type SystemComplaintListQuery = z.infer<
  typeof systemComplaintListQuerySchema
>;
