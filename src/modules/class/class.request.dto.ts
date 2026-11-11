import type { z } from "zod";
import type {
  classListQuerySchema,
  classSchoolParamsSchema,
  eligibleTeachersQuerySchema,
  classIdParamsSchema,
  homeroomAssignmentSchema,
  createClassSchema,
  updateClassSchema,
  classStatusSchema,
  copyClassesSchema,
} from "./class.validation";
export type ClassListRequestDTO = z.infer<typeof classListQuerySchema>;
export type ClassSchoolRequestDTO = {
  query: ClassListRequestDTO;
  params: z.infer<typeof classSchoolParamsSchema>;
};
export type EligibleTeachersRequestDTO = z.infer<
  typeof eligibleTeachersQuerySchema
>;
export type ClassIdRequestDTO = z.infer<typeof classIdParamsSchema>;
export type HomeroomAssignmentRequestDTO = z.infer<
  typeof homeroomAssignmentSchema
>;
export type CreateClassRequestDTO = z.infer<typeof createClassSchema>;
export type UpdateClassRequestDTO = z.infer<typeof updateClassSchema>;
export type ClassStatusRequestDTO = z.infer<typeof classStatusSchema>;
export type CopyClassesRequestDTO = z.infer<typeof copyClassesSchema>;
