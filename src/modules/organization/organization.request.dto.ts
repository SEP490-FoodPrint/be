import type { z } from "zod";
import type {
  organizationListQuerySchema,
  publicSchoolListQuerySchema,
  publicDailyMenuQuerySchema,
  publicWeeklyMenuQuerySchema,
} from "./organization.validation";

export type OrganizationListRequestDTO = z.infer<
  typeof organizationListQuerySchema
>;

export type PublicSchoolListRequestDTO = z.infer<
  typeof publicSchoolListQuerySchema
>;

export type PublicDailyMenuRequestDTO = z.infer<
  typeof publicDailyMenuQuerySchema
>;

export type PublicWeeklyMenuRequestDTO = z.infer<
  typeof publicWeeklyMenuQuerySchema
>;
