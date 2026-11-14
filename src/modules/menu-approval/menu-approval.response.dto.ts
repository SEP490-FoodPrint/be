export interface MenuApprovalDishResponseDTO {
  name: string;
  description: string | null;
  supplier: string | null;
}

export interface MenuApprovalDayResponseDTO {
  id: string;
  shortLabel: string;
  date: string;
  portions: number;
  lunch: MenuApprovalDishResponseDTO[];
  snack: MenuApprovalDishResponseDTO[];
}

export interface MenuApprovalDetailResponseDTO {
  id: string;
  title: string | null;
  status: "DRAFT" | "PENDING_APPROVAL" | "REVISION_REQUIRED" | "APPROVED";
  canDecide: boolean;
  submittedAt: string | null;
  submissionVersion: string | null;
  summary: {
    audience: string;
    audienceDetail: string;
    servingPeriod: string;
    proposer: string;
    proposerDetail: string;
    supplier: string;
  };
  compliance: never[];
  days: MenuApprovalDayResponseDTO[];
  medicalReview: {
    status: string;
    isApproved: boolean;
    reviewer: string;
    role: string;
    reviewedAt: string;
    note: string;
    documents: never[];
  };
  approval: {
    approver: string | null;
    role: string;
    note: string;
    reviewedAt: string | null;
  };
}

export interface MenuApprovalDecisionResponseDTO {
  weeklyMenuId: string;
  weeklyStatus: "APPROVED" | "REVISION_REQUIRED";
  reviewedAt: string;
  reviewer: {
    id: string;
    fullName: string;
  };
}
