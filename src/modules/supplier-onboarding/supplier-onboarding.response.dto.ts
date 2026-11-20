import type { SupplyRequestStatus } from "../../generated/prisma/client";

export interface OrderDraftResponseDTO {
  id: string;
  status: SupplyRequestStatus;
  requestNo: string;
  orderType: "DIRECT_USE" | "DRY_STOCK";
  batchNo: 1 | 2 | null;
}
export interface OrderSendResponseDTO {
  id: string;
  status: SupplyRequestStatus;
  contractId: string | null;
}

type IngredientHandlingType = "DRY_STOCK" | "DIRECT_USE";

export interface SuppliedIngredientResponseDTO {
  ingredientId: string;
  name: string;
  unit: string;
  category: string | null;
  handlingType: IngredientHandlingType | null;
  contracts: {
    id: string;
    number: string | null;
    startsOn: string | null;
    endsOn: string | null;
  }[];
}
export interface IngredientHandlingResponseDTO {
  changes: {
    ingredientId: string;
    name: string;
    from: IngredientHandlingType | null;
    to: IngredientHandlingType;
  }[];
}
