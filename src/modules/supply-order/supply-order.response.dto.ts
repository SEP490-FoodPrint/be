import type { SupplyRequestStatus } from "../../generated/prisma/client";
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

export interface SupplierOrderListItemResponseDTO {
  id: string;
  requestNo: string;
  schoolId: string;
  supplierId: string;
  schoolName: string;
  status: SupplyRequestStatus;
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
