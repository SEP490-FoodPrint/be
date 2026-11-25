import type {
  DeliveryPreparationStage,
  DishPlanStatus,
  SupplyRoundStatus,
} from "../../generated/prisma/client";

export interface RoundSampleLineDTO {
  lotId: string;
  lotCode: string;
  source: string | null;
  quantity: string;
  unit: string;
  batchCode: string | null;
  dishName: string | null;
  sampleQuantity: string | null;
  sampleUnit: string | null;
  mealType: string;
}

export interface RoundSampleGroupDTO {
  ingredientName: string;
  supplierName: string | null;
  totalQuantity: string;
  unit: string;
  lines: RoundSampleLineDTO[];
}

export interface SupplyRoundResponseDTO {
  id: string | null;
  date: string;
  batchNo: number;
  status: SupplyRoundStatus | null;
  dishes: {
    id: string;
    name: string;
    status: DishPlanStatus;
    planVersion: string | null;
    failureMessage: string | null;
    waitingSuppliers: string[];
  }[];
  deliveries: {
    id: string;
    supplierName: string;
    preparationStage: DeliveryPreparationStage | null;
  }[];
  topUps: RoundSampleGroupDTO[];
  fromStock: RoundSampleGroupDTO[];
}
