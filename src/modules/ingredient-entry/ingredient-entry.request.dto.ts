import type { z } from "zod";
import type {
  ingredientWasteRateParamsSchema,
  ingredientWasteRateBodySchema,
} from "./ingredient-entry.validation";

export type IngredientWasteRateParamsRequest = z.infer<
  typeof ingredientWasteRateParamsSchema
>;
export type IngredientWasteRateUpdateRequest = z.infer<
  typeof ingredientWasteRateBodySchema
>;
