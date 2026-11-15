import type { DeliveryStatus } from "../../generated/prisma/client";

export type SupplierOrderSourceType = "REQUEST" | "STANDALONE";

export interface SupplierOrderItemDTO {
  id: string;
  ingredientId: string;
  ingredientName: string;
  ingredientEntryId: string | null;
  supplyRequestItemId: string | null;
  actualQuantity: string;
  unit: string;
  note: string | null;
}

export interface SupplierOrderSummaryDTO {
  id: string;
  deliveryNo: string;
  sourceType: SupplierOrderSourceType;
  schoolId: string;
  schoolName: string;
  supplierId: string;
  supplyRequestId: string | null;
  requestNo: string | null;
  status: DeliveryStatus;
  expectedArrivalAt: string | null;
  arrivedAt: string | null;
  receivedAt: string | null;
  vehiclePlate: string | null;
  note: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierOrderDetailDTO extends SupplierOrderSummaryDTO {
  items: SupplierOrderItemDTO[];
}

export interface SupplierOrderCreateResultDTO extends SupplierOrderDetailDTO {
  created: boolean;
}

export interface SupplierOrderListResponseDTO {
  items: SupplierOrderSummaryDTO[];
  pagination: {
    page: number;
    limit: number;
    hasNext: boolean;
  };
}

export interface SupplierSchoolOptionDTO {
  id: string;
  code: string | null;
  name: string;
}

export interface SupplierSchoolOptionListResponseDTO {
  items: SupplierSchoolOptionDTO[];
  pagination: {
    page: number;
    limit: number;
    hasNext: boolean;
  };
}

export interface SupplierIngredientOptionDTO {
  id: string;
  name: string;
  defaultUnit: string;
  categoryId: string | null;
  categoryName: string | null;
}

export interface SupplierIngredientOptionListResponseDTO {
  items: SupplierIngredientOptionDTO[];
  pagination: {
    page: number;
    limit: number;
    hasNext: boolean;
  };
}
