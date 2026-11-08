import type { z } from "zod";
import type {
  ingredientCreateSchema,
  ingredientUpdateSchema,
  ingredientQuerySchema,
  ingredientParamsSchema,
  ingredientHideSchema,
} from "./ingredient.validation";
export type IngredientCreateRequest = z.infer<typeof ingredientCreateSchema>;
export type IngredientUpdateRequest = z.infer<typeof ingredientUpdateSchema>;
export type IngredientQueryRequest = z.infer<typeof ingredientQuerySchema>;
export type IngredientParamsRequest = z.infer<typeof ingredientParamsSchema>;
export type IngredientHideRequest = z.infer<typeof ingredientHideSchema>;
