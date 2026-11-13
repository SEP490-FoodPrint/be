import type { SupplyRequestStatus } from "../../generated/prisma/client";

export interface OrderDraftResponseDTO {
  id: string;
  status: SupplyRequestStatus;
  requestNo: string;
}
export interface OrderSendResponseDTO {
  id: string;
  status: SupplyRequestStatus;
  contractId: string | null;
}
