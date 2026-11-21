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
  ticketCommentBodySchema,
  ticketEmptyBodySchema,
  ticketReopenBodySchema,
  ticketResolveBodySchema,
} from "../complaint-ticket/complaint-ticket.validation";

export {
  ticketCommentBodySchema,
  ticketEmptyBodySchema,
  ticketReopenBodySchema,
  ticketResolveBodySchema,
};

export const ingredientQualityFeedbackListQuerySchema = paginationSchema;

export const ingredientQualityFeedbackParamsSchema = z.strictObject({
  feedbackId: requestUuidSchema,
});

export const ingredientQualityFeedbackEmptyQuerySchema = emptyQuerySchema;

export const createIngredientQualityFeedbackBodySchema = z.strictObject({
  deliveryId: requestUuidSchema,
  ingredientLotId: requestUuidSchema.nullable().optional(),
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
  parseRequest(ticketCommentBodySchema, value);

export const validateFeedbackResolveBody = (value: unknown) =>
  parseRequest(ticketResolveBodySchema, value);

export const validateFeedbackReopenBody = (value: unknown) =>
  parseRequest(ticketReopenBodySchema, value === undefined ? {} : value);

export const validateFeedbackEmptyBody = (value: unknown) =>
  parseRequest(ticketEmptyBodySchema, value === undefined ? {} : value);

export const validateCreateIngredientQualityFeedbackBody = (value: unknown) =>
  parseRequest(createIngredientQualityFeedbackBodySchema, value);
