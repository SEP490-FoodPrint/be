type MealType = "LUNCH" | "AFTERNOON";
type DecimalWireValue<T> = T extends number ? string : T;
export type DecimalPortionFields<T> = T extends readonly (infer Item)[]
  ? DecimalPortionFields<Item>[]
  : T extends object
    ? {
        [Key in keyof T]: Key extends
          | "allocatedPortions"
          | "availablePortions"
          | "plannedPortions"
          | "totalRequiredPortions"
          ? DecimalWireValue<T[Key]>
          : DecimalPortionFields<T[Key]>;
      }
    : T;
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

export interface DishBatchSlot {
  cookingBatchId: string;
  batchCode?: string;
  batchNumber?: number | null;
  plannedPortions: number;
  availablePortions: number;
  autoAssigned: boolean;
  allocationVersion?: number;
  allocatedForGrade?: string;
  entries: {
    dailyMealPortionId: string;
    className?: string;
    allocatedPortions: number;
    locked: boolean;
  }[];
}

export interface DishAllocationGroup {
  dishId: string;
  dishName: string;
  mealType: MealType;
  totalRequiredPortions: number;
  classRequirements?: {
    demandId: string;
    className: string;
    requiredPortions: number;
    excludedPortions: number;
    allergens?: string[];
  }[];
  autoAssigned: boolean;
  batches: DishBatchSlot[];
}

export interface GradeAllocationGroup {
  gradeId: string;
  gradeName: string;
  demands: {
    id: string;
    classId: string;
    className: string;
    totalPortions: number;
    locked: boolean;
  }[];
  dishes: DishAllocationGroup[];
}

export interface AllocationDayResponse {
  editorGrades?: GradeAllocationGroup[];
  hasUnappliedDrafts?: boolean;
  materialEditing?: boolean;
  materialPlanPending?: boolean;
  materialDraftStale?: boolean;
  draftRevision?: string;
  materialPlan?: import("./material-allocation.response.dto").PublicMaterialPlanDTO;
  materialPlanError?: string;
  supportsMaterialAllocation?: boolean;
  mealType: MealType | null;
  date: string;
  status: Status;
  message: string;
  action: "RETRY" | "COOKING" | "SAMPLES" | null;
  totals: Totals;
  meals: (Totals & { mealType: MealType })[];
  missingSampleBatches: number;
  revision: string;
  distribution: {
    status: "PENDING" | "READY" | "DISTRIBUTED";
    canConfirmDistribution: boolean;
    message: string;
    meals: { mealType: MealType; allocatedPortions: number }[];
    demands: {
      id: string;
      classId: string;
      className: string;
      mealType: MealType;
      requiredPortions: number;
      allocatedPortions: number;
      allocationStatus:
        "ALLOCATED" | "DISTRIBUTED" | "FINALIZED" | "CANCELLED" | null;
      demandFinalized: boolean;
      batches: {
        batchId: string;
        allocatedPortions: number;
        batchCode?: string;
        batchNumber?: number | null;
      }[];
    }[];
  };
  batches: {
    eligibleDemandIds?: string[];
    scopeLabel?: string;
    id: string;
    batchCode?: string;
    batchNumber?: number | null;
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
  grades?: GradeAllocationGroup[];
}
