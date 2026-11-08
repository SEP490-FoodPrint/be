import type { z } from "zod";
import type {
  classListQuerySchema,
  classSchoolParamsSchema,
} from "./class.validation";
export type ClassListRequestDTO = z.infer<typeof classListQuerySchema>;
export type ClassSchoolRequestDTO = {
  query: ClassListRequestDTO;
  params: z.infer<typeof classSchoolParamsSchema>;
};
