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
