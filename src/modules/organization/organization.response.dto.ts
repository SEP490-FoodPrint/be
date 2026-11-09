import type { CookingMode } from "../../generated/prisma/client";

export interface CookingModeResponseDTO {
  cookingMode: CookingMode | null;
}

export interface MealTimesResponseDTO {
  lunchTime: string | null;
  afternoonMealTime: string | null;
}

export interface OrganizationListItemResponseDTO {
  id: string;
  name: string;
  code: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationListResponseDTO {
  items: OrganizationListItemResponseDTO[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasNext: boolean;
  };
}

export interface PublicSchoolDTO {
  id: string;
  code: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  locationId: string | null;
  address: string;
  district: string | null;
  city: string;
  websiteUrl: string | null;
  description: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  cookingMode: string | null;
  lunchTime: string | null;
  afternoonMealTime: string | null;
  boardingScale: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicSchoolListResult {
  items: PublicSchoolDTO[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
  };
}

export interface PublicLocationDTO {
  id: string;
  code: string;
  name: string;
  type: string;
  level: number;
  parentId: string | null;
}

export interface DishItemDTO {
  id: string;
  name: string;
  portion: string;
  portionSize: number | null;
  portionUnit: string | null;
  order: number | null;
  mealType: "LUNCH" | "AFTERNOON";
  description: string | null;
}

export interface SnackItemDTO {
  id: string;
  name: string;
  desc: string;
  icon: "cake" | "coffee";
}

export interface PortionGroupDTO {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface WeeklyMenuDayDTO {
  id: string;
  dayOfWeek: string;
  date: string;
  dateIso: string;
  status: "SERVED" | "TODAY" | "UPCOMING";
  statusLabel: string;
  isToday: boolean;
  lunchDishes: string[];
  snackSummary: string;
  dishes: DishItemDTO[];
}

export interface PublicDailyMenuDTO {
  date: string;
  dateLabel: string;
  updatedAt: string;
  lunch: {
    title: string;
    servingWindow: string;
    trayImageUrl: string;
    trayType: string;
    standardsNote: string;
    allergyWarning: string;
    dishes: DishItemDTO[];
  };
  snack: {
    title: string;
    servingWindow: string;
    imageUrl: string;
    items: SnackItemDTO[];
    dishes: DishItemDTO[];
  };
}

export interface AvailableWeekSummaryDTO {
  id: string;
  title: string;
  weekNumber: number;
  weekStartDate: string;
  weekRange: string;
  status: string;
}

export interface PublicWeeklyMenuDTO {
  id: string;
  title: string;
  weekNumber: number;
  weekStartDate: string;
  weekRange: string;
  status: string;
  portionGroups: PortionGroupDTO[];
  gradeGroups: Array<{ key: string; label: string }>;
  days: WeeklyMenuDayDTO[];
  availableWeeks: AvailableWeekSummaryDTO[];
}

export interface OrganizationSummaryResponseDTO {
  total: number;
  activeCount: number;
}
