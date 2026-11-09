import type { WeeklyMenuStatus } from "../../generated/prisma/enums";

export interface MenuSummaryDTO {
  id: string;
  schoolId: string;
  weekStartDate: string;
  title: string | null;
  status: WeeklyMenuStatus;
  submittedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MenuSummaryPageResponseDTO {
  items: MenuSummaryDTO[];
  pagination: {
    page: number;
    limit: number;
    hasNext: boolean;
  };
}
