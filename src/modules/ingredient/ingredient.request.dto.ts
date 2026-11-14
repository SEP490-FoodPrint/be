import type { z } from "zod";
import type {
  ingredientCreateSchema,
  ingredientUpdateSchema,
  ingredientQuerySchema,
  ingredientParamsSchema,
  ingredientHideSchema,
  ingredientSingleUploadSchema,
  ingredientMultipleUploadSchema,
} from "./ingredient.validation";
export type IngredientCreateRequest = z.infer<typeof ingredientCreateSchema>;
export type IngredientUpdateRequest = z.infer<typeof ingredientUpdateSchema>;
export type IngredientQueryRequest = z.infer<typeof ingredientQuerySchema>;
export type IngredientParamsRequest = z.infer<typeof ingredientParamsSchema>;
export type IngredientHideRequest = z.infer<typeof ingredientHideSchema>;

export type IngredientSingleUploadRequest = z.infer<
  typeof ingredientSingleUploadSchema
>;
export type IngredientMultipleUploadRequest = z.infer<
  typeof ingredientMultipleUploadSchema
>;
