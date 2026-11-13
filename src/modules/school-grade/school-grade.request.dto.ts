import type { z } from "zod";
import type {
  createSchoolGradeSchema,
  updateSchoolGradeSchema,
} from "./school-grade.validation";

export type CreateSchoolGradeRequest = z.infer<typeof createSchoolGradeSchema>;
export type UpdateSchoolGradeRequest = z.infer<typeof updateSchoolGradeSchema>;
