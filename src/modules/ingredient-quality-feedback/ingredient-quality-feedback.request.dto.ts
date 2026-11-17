import type { z } from "zod";
import type {
  ingredientQualityFeedbackEmptyQuerySchema,
  ingredientQualityFeedbackListQuerySchema,
  ingredientQualityFeedbackParamsSchema,
  ingredientQualityFeedbackResponseBodySchema,
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

export type IngredientQualityFeedbackResponseBodyRequest = z.infer<
  typeof ingredientQualityFeedbackResponseBodySchema
>;
