import type { z } from "zod";
import type {
  menuListQuerySchema,
  menuMealSchema,
  menuStandardsSchema,
  menuPortionGroupsSchema,
  menuWriteSchema,
  menuReviewSchema,
  menuFiltersSchema,
  menuAllergyCheckSchema,
  menuIngredientKindSchema,
  menuWeekScheduleQuerySchema,
  menuIdParamsSchema,
  menuSubmitSchema,
  menuAcademicCalendarQuerySchema,
} from "./menu.validation";

export type MenuListQuery = z.infer<typeof menuListQuerySchema>;
export type MenuMeal = z.infer<typeof menuMealSchema>;
export type MenuStandardsInput = z.infer<typeof menuStandardsSchema>;
export type MenuPortionGroupsInput = z.infer<typeof menuPortionGroupsSchema>;
export type MenuWrite = z.infer<typeof menuWriteSchema>;
export type MenuReviewInput = z.infer<typeof menuReviewSchema>;
export type MenuFilters = z.infer<typeof menuFiltersSchema>;
export type MenuAllergyCheckInput = z.infer<typeof menuAllergyCheckSchema>;
export type MenuIngredientKind = z.infer<typeof menuIngredientKindSchema>;
export type MenuWeekScheduleQuery = z.infer<typeof menuWeekScheduleQuerySchema>;
export type MenuIdParams = z.infer<typeof menuIdParamsSchema>;
export type MenuSubmitInput = z.infer<typeof menuSubmitSchema>;
export type MenuAcademicCalendarQuery = z.infer<
  typeof menuAcademicCalendarQuerySchema
>;
