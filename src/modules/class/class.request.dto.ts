import type { z } from "zod";
import type {
  classIdParamsSchema,
  classListQuerySchema,
  eligibleTeachersQuerySchema,
  homeroomAssignmentSchema,
} from "./class.validation";

export type ClassListRequestDTO = z.infer<typeof classListQuerySchema>;
export type EligibleTeachersRequestDTO = z.infer<
  typeof eligibleTeachersQuerySchema
>;
export type ClassIdRequestDTO = z.infer<typeof classIdParamsSchema>;
export type HomeroomAssignmentRequestDTO = z.infer<
  typeof homeroomAssignmentSchema
>;
