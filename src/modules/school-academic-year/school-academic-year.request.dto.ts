import type { z } from "zod";
import type {
  createAcademicYearBodySchema,
  updateAcademicYearBodySchema,
} from "./school-academic-year.validation";

export type CreateAcademicYearRequestDTO = z.infer<
  typeof createAcademicYearBodySchema
>;
export type UpdateAcademicYearRequestDTO = z.infer<
  typeof updateAcademicYearBodySchema
>;
