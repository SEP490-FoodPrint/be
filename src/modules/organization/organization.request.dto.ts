import type { z } from "zod";
import type {
  cookingModeBodySchema,
  organizationListQuerySchema,
  publicSchoolListQuerySchema,
  publicDailyMenuQuerySchema,
  publicWeeklyMenuQuerySchema,
} from "./organization.validation";

export type CookingModeRequestDTO = z.infer<typeof cookingModeBodySchema>;

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
