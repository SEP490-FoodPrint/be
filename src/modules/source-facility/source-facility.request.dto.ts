import type { z } from "zod";
import type {
  sourceFacilityQuerySchema,
  sourceFacilityParamsSchema,
  sourceFacilityCreateSchema,
  sourceFacilityUpdateSchema,
  sourceFacilityDeactivateSchema,
} from "./source-facility.validation";

export type SourceFacilityQueryRequest = z.infer<
  typeof sourceFacilityQuerySchema
>;
export type SourceFacilityParamsRequest = z.infer<
  typeof sourceFacilityParamsSchema
>;
export type SourceFacilityCreateRequest = z.infer<
  typeof sourceFacilityCreateSchema
>;
export type SourceFacilityUpdateRequest = z.infer<
  typeof sourceFacilityUpdateSchema
>;
export type SourceFacilityDeactivateRequest = z.infer<
  typeof sourceFacilityDeactivateSchema
>;
