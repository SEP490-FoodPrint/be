import type {
  DeliveryStatus,
  SupplyRequestStatus,
} from "../../generated/prisma/client";
export interface SupplyOrderListResponseDTO {
  items: {
    id: string;
    requestNo: string;
    schoolId: string;
    supplierId: string;
    status: SupplyRequestStatus;
    acceptedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }[];
  pagination: { page: number; limit: number; hasNext: boolean };
}
export interface SupplyOrderAcceptResponseDTO {
  id: string;
  status: SupplyRequestStatus;
  acceptedByUserId: string | null;
  acceptedAt: string | null;
}

export type SupplyOrderNextAction =
  | "ADD_INGREDIENTS"
  | "ENTER_SHIPPING"
  | "TRACK_DELIVERY"
  | "VIEW_DELIVERY"
  | "NONE";

export interface SupplyOrderProgressResponseDTO {
  stage: DeliveryStatus | "CONFIRMED";
  statusLabel: string;
  deliveryId: string | null;
  nextAction: SupplyOrderNextAction;
}

export interface SupplierOrderListItemResponseDTO {
  id: string;
  requestNo: string;
  schoolId: string;
  supplierId: string;
  schoolName: string;
  status: SupplyRequestStatus;
  orderProgress: SupplyOrderProgressResponseDTO | null;
  requestedDeliveryDate: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierOrderListResponseDTO {
  items: SupplierOrderListItemResponseDTO[];
  pagination: { page: number; limit: number; hasNext: boolean };
}

export interface SupplierOrderDetailResponseDTO extends SupplierOrderListItemResponseDTO {
  note: string | null;
  acceptedByUserId: string | null;
  items: {
    id: string;
    ingredientEntryId: string;
    ingredientName: string;
    requestedQuantity: string;
    unit: string;
    note: string | null;
  }[];
}
