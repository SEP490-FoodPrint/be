import type { z } from "zod";
import type { getMealTraceabilitySchema } from "./meal-traceability.validation";

export type GetMealTraceabilityRequestDto = z.infer<
  typeof getMealTraceabilitySchema
>;
