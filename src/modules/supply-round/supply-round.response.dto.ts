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
  cookingMode: "SEPARATE_BY_LOT" | "COMBINE_LOTS" | null;
  /** Mẻ Đợt 1 của ngày đã tạo (Đợt 1 nhận đủ hàng hoặc ngày không đồ tươi). */
  round1Ready: boolean;
  batch2NotNeeded: boolean;
  /** Phần lưu mẫu đã cắt ở Đợt 1, bù ở Đợt 2 (FRESH: đặt NCC; STOCK: giữ từ kho). */
  compensations: {
    ingredientEntryId: string;
    ingredientName: string;
    kind: "FRESH" | "STOCK";
    quantity: string;
    unit: string;
  }[];
  /** Phần dư Đợt 1 do lệch tỉ lệ; `surplus` = Đợt 2 không cần nên hiển thị thừa (V37). */
  leftovers: {
    ingredientName: string;
    source: string | null;
    lotCode: string;
    dishName: string;
    mealType: string;
    quantity: string;
    unit: string;
    surplus: boolean;
  }[];
}
