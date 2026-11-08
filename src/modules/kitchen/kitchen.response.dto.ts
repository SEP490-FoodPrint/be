import type {
  CookingBatchStatus,
  CookingMode,
  MealType,
  RetainedSampleStatus,
} from "../../generated/prisma/enums";

export interface RetainedSampleBriefDTO {
  id: string;
  status: RetainedSampleStatus;
  sampledAt: Date;
  disposedAt: Date | null;
}

export interface CookingBatchLotDTO {
  ingredientLotId: string;
  quantityUsed: string;
  unit: string;
}

export interface CookingBatchDetailDTO {
  id: string;
  batchCode: string;
  menuDayId: string;
  dishId: string;
  mealType: MealType;
  cookingModeApplied: CookingMode;
  status: CookingBatchStatus;
  plannedPortions: number | null;
  note: string | null;
  confirmedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  Dish: {
    name: string;
  };
  MenuDay: {
    menuDate: Date;
  };
  cookingBatchLots: CookingBatchLotDTO[];
  retainedFoodSample?: RetainedSampleBriefDTO | null;
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

export interface CookingBatchSummaryDTO {
  id: string;
  batchCode: string;
  menuDayId: string;
  dishId: string;
  mealType: MealType;
  cookingModeApplied: CookingMode;
  status: CookingBatchStatus;
  plannedPortions: number | null;
  confirmedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CookingBatchAllPageResponseDTO {
  items: CookingBatchSummaryDTO[];
  pagination: {
    page: number;
    limit: number;
    hasNext: boolean;
  };
}
