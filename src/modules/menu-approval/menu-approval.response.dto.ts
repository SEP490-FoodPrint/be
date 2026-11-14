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

export interface MenuApprovalGradeCoverageItemDTO {
  id: string;
  name: string;
  activeClasses: number;
  /** Tổng suất đã chốt trong tuần (mỗi ngày lấy bữa đông nhất). */
  portions: number;
  inThisMenu: boolean;
  /** Khối có thực đơn trong tuần (thực đơn này, thực đơn khối khác hoặc toàn trường). */
  hasMenuThisWeek: boolean;
}

export interface MenuApprovalGradeCoverageDTO {
  academicYear: string;
  grades: MenuApprovalGradeCoverageItemDTO[];
  unassignedActiveClasses: number;
  warnings: string[];
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
  gradeCoverage: MenuApprovalGradeCoverageDTO;
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
