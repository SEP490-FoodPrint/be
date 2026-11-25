import type { z } from "zod";
import type {
  createIngredientQualityFeedbackBodySchema,
  ingredientQualityFeedbackEmptyQuerySchema,
  ingredientQualityFeedbackListQuerySchema,
  ingredientQualityFeedbackParamsSchema,
  ticketCommentInputSchema,
  ticketReopenBodySchema,
  ticketResolveInputSchema,
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
  typeof ticketCommentInputSchema
>;

export type FeedbackResolveBodyRequest = z.infer<
  typeof ticketResolveInputSchema
>;

export type FeedbackReopenBodyRequest = z.infer<typeof ticketReopenBodySchema>;

export type CreateIngredientQualityFeedbackRequest = z.infer<
  typeof createIngredientQualityFeedbackBodySchema
>;
