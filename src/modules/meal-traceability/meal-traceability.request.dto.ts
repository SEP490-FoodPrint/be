import type { z } from "zod";
import type { getGradeMealTraceabilitySchema } from "./meal-traceability.validation";

export type GetGradeMealTraceabilityRequestDto = z.infer<
  typeof getGradeMealTraceabilitySchema
>;
