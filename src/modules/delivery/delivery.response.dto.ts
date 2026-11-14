import type {
  ApprovalDecision,
  DeliveryStatus,
  IngredientLotStatus,
} from "../../generated/prisma/enums";

export interface DeliveryInspectionDTO {
  id: string;
  deliveryNo: string;
  supplyRequestId: string;
  requestNo: string;
  supplierName: string;
  status: DeliveryStatus;
  expectedArrivalAt: string | null;
  arrivedAt: string | null;
  receivedAt: string | null;
  vehiclePlate: string | null;
  note: string | null;
  currentRole: string;
  canInspect: boolean;
  redeliveryRequiredCount: number;
  redeliveryLimit: number;
  cancellationNotice: string | null;
  requiredRoles: { code: string; name: string }[];
  deliveryApprovals: {
    id: string;
    roleCode: string;
    roleName: string;
    userName: string;
    decision: ApprovalDecision;
    reason: string | null;
    photoUrl: string | null;
    decidedAt: string;
  }[];
  deliveryItems?: {
    id: string;
    ingredientName: string;
    category: string | null;
    actualQuantity: string;
    unit: string;
    ingredientLots: {
      id: string;
      lotCode: string;
      qrToken: string;
      sourceFacility: string | null;
      manufactureDate: string | null;
      expiryDate: string | null;
      receivedQuantity: string;
      unit: string;
      status: IngredientLotStatus;
    }[];
  }[];
}

export interface DeliveryApprovalItemDTO {
  id: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  userId: string;
  userName: string;
  decision: ApprovalDecision;
  reason: string | null;
  decidedAt: string;
}

export interface DeliveryItemSummaryDTO {
  id: string;
  actualQuantity: string;
  unit: string;
  note: string | null;
  requestedQuantity: string | null;
  ingredientName: string | null;
  handlingType: string | null;
}

export interface DeliveryListItemDTO {
  id: string;
  deliveryNo: string;
  supplyRequestId: string;
  orderNo: string | null;
  requestNo: string | null;
  supplierId: string;
  supplierName: string | null;
  supplierPhone?: string | null;
  status: DeliveryStatus;
  vehiclePlate: string | null;
  expectedArrivalAt: string | null;
  arrivedAt: string | null;
  receivedAt: string | null;
  requestedDeliveryDate?: string | null;
  note: string | null;
  deliveryApprovals: DeliveryApprovalItemDTO[];
  deliveryItems?: DeliveryItemSummaryDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryListResponseDTO {
  items: DeliveryListItemDTO[];
  pagination: {
    page: number;
    limit: number;
    hasNext: boolean;
  };
}
