import { z } from "zod";
import {
  emptyQuerySchema,
  paginationSchema,
} from "../../utils/directory-validation";
import {
  parseRequest,
  requestUuidSchema,
} from "../../utils/request-validation";
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
  ticketEmptyBodySchema,
  ticketReopenBodySchema,
  ticketResolveInputSchema,
};

/** Loại vấn đề C02 (plan v6 Q34). */
export const INGREDIENT_ISSUE_TYPES = [
  "SPOILED_OR_NOT_FRESH",
  "QUANTITY_MISMATCH",
  "WRONG_SPECIFICATION",
  "EXPIRED_OR_MISSING_LABEL",
  "LATE_DELIVERY",
  "OTHER",
] as const;

export const ingredientQualityFeedbackListQuerySchema = paginationSchema;

export const ingredientQualityFeedbackParamsSchema = z.strictObject({
  feedbackId: requestUuidSchema,
});

export const ingredientQualityFeedbackEmptyQuerySchema = emptyQuerySchema;

export const createIngredientQualityFeedbackBodySchema = z.strictObject({
  deliveryId: requestUuidSchema,
  // multipart không gửi được null: chuỗi rỗng = không chọn lô.
  ingredientLotId: z.preprocess(
    (value) => (value === "" ? null : value),
    requestUuidSchema.nullable().optional(),
  ),
  title: ticketTitleSchema,
  issueType: z.enum(INGREDIENT_ISSUE_TYPES, {
    error: "Loại vấn đề không hợp lệ",
  }),
  description: z
    .string({ error: "Nội dung phải là văn bản" })
    .trim()
    .refine((value) => Array.from(value).length >= 10, {
      error: "Nội dung tối thiểu 10 ký tự",
    })
    .refine((value) => Array.from(value).length <= 2000, {
      error: "Nội dung chỉ nhận tối đa 2000 ký tự",
    }),
  files: evidenceFilesSchema,
});

export const validateIngredientQualityFeedbackListQuery = (value: unknown) =>
  parseRequest(
    ingredientQualityFeedbackListQuerySchema,
    value === undefined ? {} : value,
  );

export const validateIngredientQualityFeedbackParams = (value: unknown) =>
  parseRequest(ingredientQualityFeedbackParamsSchema, value);

export const validateIngredientQualityFeedbackEmptyQuery = (value: unknown) =>
  parseRequest(
    ingredientQualityFeedbackEmptyQuerySchema,
    value === undefined ? {} : value,
  );

export const validateFeedbackCommentBody = (value: unknown) =>
  parseRequest(ticketCommentInputSchema, value);

export const validateFeedbackResolveBody = (value: unknown) =>
  parseRequest(ticketResolveInputSchema, value);

export const validateFeedbackReopenBody = (value: unknown) =>
  parseRequest(ticketReopenBodySchema, value === undefined ? {} : value);

export const validateFeedbackEmptyBody = (value: unknown) =>
  parseRequest(ticketEmptyBodySchema, value === undefined ? {} : value);

export const validateCreateIngredientQualityFeedbackBody = (value: unknown) =>
  parseRequest(createIngredientQualityFeedbackBodySchema, value);
