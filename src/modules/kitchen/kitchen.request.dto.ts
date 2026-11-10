import type { z } from "zod";
import type {
  kitchenPlanSchema,
  kitchenCompleteSchema,
  kitchenFiltersSchema,
  kitchenListQuerySchema,
} from "./kitchen.validation";
export type KitchenPlanRequestDTO = z.infer<typeof kitchenPlanSchema>;
export type KitchenCompleteRequestDTO = z.infer<typeof kitchenCompleteSchema>;
export type KitchenFiltersRequestDTO = z.infer<typeof kitchenFiltersSchema>;
export type KitchenListQueryRequestDTO = z.infer<typeof kitchenListQuerySchema>;
export type KitchenPlanInput = KitchenPlanRequestDTO;
export type KitchenCompleteInput = KitchenCompleteRequestDTO;
export type KitchenInspection = KitchenCompleteRequestDTO;
export type KitchenFilters = KitchenFiltersRequestDTO;
