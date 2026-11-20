import type { z } from "zod";
import type {
  contractItemsSchema,
  ingredientHandlingParamsSchema,
  ingredientHandlingSchema,
  orderDraftSchema,
  orderSendParamsSchema,
  orderSendSchema,
} from "./supplier-onboarding.validation";

export type OrderDraftRequestDTO = z.infer<typeof orderDraftSchema>;
export type OrderSendParamsRequestDTO = z.infer<typeof orderSendParamsSchema>;
export type OrderSendRequestDTO = z.infer<typeof orderSendSchema>;
export type ContractItemsRequestDTO = z.infer<typeof contractItemsSchema>;
export type IngredientHandlingParamsRequestDTO = z.infer<
  typeof ingredientHandlingParamsSchema
>;
export type IngredientHandlingRequestDTO = z.infer<
  typeof ingredientHandlingSchema
>;
