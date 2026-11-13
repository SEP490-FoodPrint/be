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
