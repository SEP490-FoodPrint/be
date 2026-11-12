import type { z } from "zod";
import type {
  createComplaintSchema,
  respondComplaintSchema,
} from "./feedback.validation";
export type CreateComplaintRequestDTO = z.infer<typeof createComplaintSchema>;
export type RespondComplaintRequestDTO = z.infer<typeof respondComplaintSchema>;
export interface ComplaintListQueryDTO {
  page: number;
  limit: number;
  status?: "SUBMITTED" | "IN_REVIEW" | "RESOLVED" | "CLOSED";
  complaintType?: "MEAL_QUALITY" | "FOOD_HYGIENE" | "HEALTH_ISSUE" | "OTHER";
  from?: string;
  to?: string;
  search?: string;
}
