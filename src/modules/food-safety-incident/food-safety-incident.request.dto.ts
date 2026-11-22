import type { z } from "zod";
import type {
  addFoodSafetyIncidentAllocationsSchema,
  cancelFoodSafetyIncidentSchema,
  directFoodSafetyIncidentSchema,
  foodSafetyIncidentListQuerySchema,
  forwardFoodSafetyIncidentSchema,
  reportFoodSafetyIncidentSchema,
} from "./food-safety-incident.validation";

export type FoodSafetyIncidentListRequestDTO = z.output<
  typeof foodSafetyIncidentListQuerySchema
>;
export type ReportFoodSafetyIncidentRequestDTO = z.output<
  typeof reportFoodSafetyIncidentSchema
>;
export type DirectFoodSafetyIncidentRequestDTO = z.output<
  typeof directFoodSafetyIncidentSchema
>;
export type ForwardFoodSafetyIncidentRequestDTO = z.output<
  typeof forwardFoodSafetyIncidentSchema
>;
export type CancelFoodSafetyIncidentRequestDTO = z.output<
  typeof cancelFoodSafetyIncidentSchema
>;
export type AddFoodSafetyIncidentAllocationsRequestDTO = z.output<
  typeof addFoodSafetyIncidentAllocationsSchema
>;
