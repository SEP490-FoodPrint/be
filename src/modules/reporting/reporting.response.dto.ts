import type { NotificationStatus } from "../../generated/prisma/client";
export interface ReportingListResponseDTO {
  items: {
    id: string;
    incidentId: string;
    recipientCommuneFoodSafetyUnitId: string | null;
    recipientOrganization: string;
    referenceNumber: string | null;
    status: NotificationStatus;
    attemptedAt: string | null;
    forwardedAt: string | null;
    /** Thời điểm cán bộ ATTP tiếp nhận; null khi chưa tiếp nhận (specs/frontend-api-gaps FR-002). */
    receivedAt: string | null;
    createdAt: string;
  }[];
  pagination: { page: number; limit: number; hasNext: boolean };
}
export interface ReportingReceiveResponseDTO {
  id: string;
  incidentId: string;
  recipientUserId: string;
  receivedAt: string;
}
