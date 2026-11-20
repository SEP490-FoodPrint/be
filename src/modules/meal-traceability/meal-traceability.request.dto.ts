import type { z } from "zod";
import type {
  getMealTraceabilitySchema,
  publicSchoolClassesParamsSchema,
} from "./meal-traceability.validation";

export type GetMealTraceabilityRequestDto = z.infer<
  typeof getMealTraceabilitySchema
>;

export type PublicSchoolClassesParamsDto = z.infer<
  typeof publicSchoolClassesParamsSchema
>;
