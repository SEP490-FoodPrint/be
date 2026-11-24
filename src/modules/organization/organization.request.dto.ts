import type { z } from "zod";
import type {
  cookingModeBodySchema,
  mealTimesBodySchema,
  samplePolicyBodySchema,
  deliveryInspectionRolesBodySchema,
  organizationSummaryQuerySchema,
  organizationDetailParamsSchema,
  organizationListQuerySchema,
  publicSchoolListQuerySchema,
  publicDailyMenuQuerySchema,
  publicWeeklyMenuQuerySchema,
  publicSchoolGradesQuerySchema,
} from "./organization.validation";

export type CookingModeRequestDTO = z.infer<typeof cookingModeBodySchema>;
export type MealTimesRequestDTO = z.infer<typeof mealTimesBodySchema>;
export type SamplePolicyRequestDTO = z.infer<typeof samplePolicyBodySchema>;
export type DeliveryInspectionRolesRequestDTO = z.infer<
  typeof deliveryInspectionRolesBodySchema
>;

export type OrganizationListRequestDTO = z.infer<
  typeof organizationListQuerySchema
>;

export type PublicSchoolListRequestDTO = z.infer<
  typeof publicSchoolListQuerySchema
>;

export type PublicDailyMenuRequestDTO = z.infer<
  typeof publicDailyMenuQuerySchema
>;

export type PublicSchoolGradesRequestDTO = z.infer<
  typeof publicSchoolGradesQuerySchema
>;

export type PublicWeeklyMenuRequestDTO = z.infer<
  typeof publicWeeklyMenuQuerySchema
>;

export type OrganizationSummaryRequestDTO = z.infer<
  typeof organizationSummaryQuerySchema
>;
export type OrganizationDetailRequestDTO = z.infer<
  typeof organizationDetailParamsSchema
>;
