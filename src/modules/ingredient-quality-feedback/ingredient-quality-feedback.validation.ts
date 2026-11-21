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
