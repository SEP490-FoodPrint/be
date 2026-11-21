import type { z } from "zod";
import type {
  ingredientQualityFeedbackEmptyQuerySchema,
  ingredientQualityFeedbackListQuerySchema,
  ingredientQualityFeedbackParamsSchema,
  ticketCommentBodySchema,
  ticketReopenBodySchema,
  ticketResolveBodySchema,
} from "./ingredient-quality-feedback.validation";

export type IngredientQualityFeedbackListQueryRequest = z.infer<
  typeof ingredientQualityFeedbackListQuerySchema
>;

export type IngredientQualityFeedbackParamsRequest = z.infer<
  typeof ingredientQualityFeedbackParamsSchema
>;

export type IngredientQualityFeedbackEmptyQueryRequest = z.infer<
  typeof ingredientQualityFeedbackEmptyQuerySchema
>;

export type FeedbackCommentBodyRequest = z.infer<
  typeof ticketCommentBodySchema
>;

export type FeedbackResolveBodyRequest = z.infer<
  typeof ticketResolveBodySchema
>;

export type FeedbackReopenBodyRequest = z.infer<typeof ticketReopenBodySchema>;
