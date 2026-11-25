import type {
  DeliveryPreparationStage,
  DeliveryStatus,
} from "../../generated/prisma/client";
import type { SupplierDeliveryNextAction } from "../../utils/delivery-status";

export type SupplierOrderSourceType = "REQUEST" | "STANDALONE";

export type SupplierOrderNextAction = SupplierDeliveryNextAction;

export interface SupplierOrderSourceFacilityDTO {
  id: string;
  name: string;
  facilityCode: string | null;
}

export interface SupplierOrderItemDTO {
  id: string;
  ingredientId: string;
  ingredientName: string;
  ingredientEntryId: string | null;
  supplyRequestItemId: string | null;
  sourceFacility: SupplierOrderSourceFacilityDTO | null;
  traceUrl: string | null;
  actualQuantity: string;
  sampleTopUpQuantity?: string;
  unit: string;
  note: string | null;
}

export interface SupplierOrderSummaryDTO {
  id: string;
  deliveryNo: string;
  sourceType: SupplierOrderSourceType;
  traceabilityVersion: number | null;
  workflowVersion: number | null;
  nextAction: SupplierOrderNextAction;
  schoolId: string;
  schoolName: string;
  supplierId: string;
  supplyRequestId: string | null;
  requestNo: string | null;
  orderType: "DIRECT_USE" | "DRY_STOCK" | null;
  batchNo: number | null;
  status: DeliveryStatus;
  preparationStage?: DeliveryPreparationStage;
  statusLabel: string;
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
  topUpLots?: {
    ingredientLotId: string;
    lotCode: string;
    unit: string;
    sampleTopUpQuantity: string;
  }[];
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

export interface SupplierSourceFacilityOptionDTO {
  id: string;
  facilityCode: string | null;
  name: string;
}

export interface SupplierSourceFacilityOptionListResponseDTO {
  items: SupplierSourceFacilityOptionDTO[];
  pagination: {
    page: number;
    limit: number;
    hasNext: boolean;
  };
}

export interface DeliveryLabelSourceFacilityDTO {
  name: string;
  facilityCode: string | null;
}

export interface DeliveryLabelItemDTO {
  deliveryItemId: string;
  deliveryNo: string;
  supplierName: string;
  ingredientName: string;
  actualQuantity: string;
  unit: string;
  sourceFacility: DeliveryLabelSourceFacilityDTO;
  traceUrl: string;
  qrImageDataUrl: string;
}

export interface DeliveryLabelListResponseDTO {
  items: DeliveryLabelItemDTO[];
  pagination: {
    page: number;
    limit: number;
    hasNext: boolean;
  };
}
