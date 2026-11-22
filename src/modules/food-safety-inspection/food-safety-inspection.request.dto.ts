import type { z } from "zod";
import type {
  closeFoodSafetyIncidentSchema,
  planFoodSafetyInspectionSchema,
  recordFoodSafetyInspectionResultSchema,
} from "./food-safety-inspection.validation";

export type PlanFoodSafetyInspectionRequestDTO = z.output<
  typeof planFoodSafetyInspectionSchema
>;
export type RecordFoodSafetyInspectionResultRequestDTO = z.output<
  typeof recordFoodSafetyInspectionResultSchema
>;
export type CloseFoodSafetyIncidentRequestDTO = z.output<
  typeof closeFoodSafetyIncidentSchema
>;
