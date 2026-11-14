import type {
  CookingBatchStatus,
  CookingMode,
  MealType,
  RetainedSampleStatus,
} from "../../generated/prisma/enums";

export interface RetainedSampleBriefDTO {
  id: string;
  dishId: string;
  status: RetainedSampleStatus;
  sampledAt: string;
  disposedAt: string | null;
}

export interface CookingBatchLotDTO {
  dishId: string;
  ingredientLotId: string;
  quantityUsed: string;
  unit: string;
  lotCode: string | null;
  ingredientName: string | null;
  expiryDate: string | null;
}

export interface CookingBatchDetailDTO {
  id: string;
  batchCode: string;
  menuDayId: string;
  dishId: string | null;
  batchGroupId: string;
  BatchGroup: { id: string; batchCode: string };
  dishes: {
    dishId: string;
    name: string;
    plannedPortions: number | null;
    cookingBatchLots: CookingBatchLotDTO[];
  }[];
  mealType: MealType;
  cookingModeApplied: CookingMode;
  status: CookingBatchStatus;
  plannedPortions: number | null;
  note: string | null;
  confirmedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  Dish: {
    name: string;
  } | null;
  MenuDay: {
    menuDate: string;
  };
  cookingBatchLots: CookingBatchLotDTO[];
  retainedFoodSamples?: RetainedSampleBriefDTO[];
}

export interface CookingBatchGroupResponseDTO {
  id: string;
  batchCode: string;
  menuDayId: string;
  mealType: MealType;
  status: "UNCONFIRMED" | "IN_PROGRESS" | "COMPLETED";
  batches: CookingBatchDetailDTO[];
}

export interface CookingBatchPlanResponseDTO {
  created: boolean;
  groups: CookingBatchGroupResponseDTO[];
  batches: CookingBatchDetailDTO[];
}

export interface CookingBatchListResponseDTO {
  items: CookingBatchDetailDTO[];
  pagination: {
    page: number;
    limit: number;
    totalItems: number;
  };
}

export interface CookingBatchStatsResponseDTO {
  total: number;
  unconfirmed: number;
  confirmed: number;
  completed: number;
  storedSamples: number;
  disposedSamples: number;
  pendingSamples: number;
}

export interface SchoolContextResponseDTO {
  grades: { id: string; name: string }[];
  id: string;
  name: string;
  cookingMode: CookingMode | null;
  lunchTime: string | null;
  afternoonMealTime: string | null;
  academicYears: {
    id: string;
    academicYear: string;
    startDate: string;
    endDate: string;
    holidays: {
      date?: string;
      startDate?: string;
      endDate?: string;
      reason: string;
    }[];
  }[];
}

export interface CookingBatchSummaryDTO {
  id: string;
  batchCode: string;
  menuDayId: string;
  dishId: string | null;
  batchGroupId: string;
  BatchGroup: { id: string; batchCode: string };
  dishes: { dishId: string; name: string; plannedPortions: number | null }[];
  mealType: MealType;
  cookingModeApplied: CookingMode;
  status: CookingBatchStatus;
  plannedPortions: number | null;
  confirmedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CookingBatchAllPageResponseDTO {
  items: CookingBatchSummaryDTO[];
  pagination: {
    page: number;
    limit: number;
    hasNext: boolean;
  };
}

export interface CookingBatchPreviewDTO {
  cookingModeApplied: CookingMode;
  planVersion: string;
  batches: {
    plannedPortions: number;
    dishes: {
      dishId: string;
      name: string;
      plannedPortions: number;
      lots: {
        ingredientLotId: string;
        quantityUsed: string;
        unit: string;
        lotCode: string | null;
        ingredientName: string | null;
      }[];
    }[];
  }[];
  seasonings: {
    ingredientLotId: string;
    quantityUsed: string;
    unit: string;
    lotCode: string | null;
    ingredientName: string | null;
  }[];
}
