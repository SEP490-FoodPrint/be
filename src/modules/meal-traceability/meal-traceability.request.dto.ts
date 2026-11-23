import type { z } from "zod";
import type {
  getGradeMealTraceabilitySchema,
  getMealTraceabilitySchema,
  publicSchoolClassesParamsSchema,
} from "./meal-traceability.validation";

export type GetMealTraceabilityRequestDto = z.infer<
  typeof getMealTraceabilitySchema
>;

export type GetGradeMealTraceabilityRequestDto = z.infer<
  typeof getGradeMealTraceabilitySchema
>;

export type PublicSchoolClassesParamsDto = z.infer<
  typeof publicSchoolClassesParamsSchema
>;
