type MealType = "LUNCH" | "AFTERNOON";
type Status =
  | "EMPTY"
  | "DEMAND_PENDING"
  | "COOKING_PENDING"
  | "SAMPLES_PENDING"
  | "RECONCILE"
  | "READY";

interface Totals {
  finalized: number;
  planned: number;
  cooked: number;
  sampled: number;
}

export interface AllocationDayResponse {
  date: string;
  status: Status;
  message: string;
  action: "RETRY" | "COOKING" | "SAMPLES" | null;
  totals: Totals;
  meals: (Totals & { mealType: MealType })[];
  missingSampleBatches: number;
  revision: string;
  batches: {
    id: string;
    mealType: MealType;
    plannedPortions: number | null;
    note: string | null;
    status: "UNCONFIRMED" | "CONFIRMED" | "COMPLETED";
    hasSample: boolean;
    entries: {
      dailyMealPortionId: string;
      allocatedPortions: number;
      locked: boolean;
    }[];
  }[];
  demands: {
    id: string;
    name: string;
    mealType: MealType;
    totalPortions: number;
    locked: boolean;
  }[];
}
