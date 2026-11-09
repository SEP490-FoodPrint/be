import type {
  validateKitchenPlan,
  validateKitchenUpdate,
  validateKitchenComplete,
  validateKitchenFilters,
} from "./kitchen.validation";
import type { ListQuery } from "../../utils/list-query";

export type KitchenPlanRequestDTO = ReturnType<typeof validateKitchenPlan>;
export type KitchenUpdateRequestDTO = ReturnType<typeof validateKitchenUpdate>;
export type KitchenCompleteRequestDTO = ReturnType<
  typeof validateKitchenComplete
>;
export type KitchenFiltersRequestDTO = ReturnType<
  typeof validateKitchenFilters
>;
export type KitchenListQueryRequestDTO = ListQuery;

export type KitchenPlanInput = KitchenPlanRequestDTO;
export type KitchenUpdateInput = KitchenUpdateRequestDTO;
export type KitchenCompleteInput = KitchenCompleteRequestDTO;
export type KitchenInspection = KitchenCompleteRequestDTO;
export type KitchenFilters = KitchenFiltersRequestDTO;
