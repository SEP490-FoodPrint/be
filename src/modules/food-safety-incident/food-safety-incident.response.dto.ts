import type {
  CANCELLATION_REASONS,
  FOOD_SAFETY_INCIDENT_STATUSES,
  PRELIMINARY_ASSESSMENTS,
} from "./food-safety-incident.validation";

export type FoodSafetyIncidentStatusDTO =
  (typeof FOOD_SAFETY_INCIDENT_STATUSES)[number];
export type FoodSafetyIncidentSourceDTO =
  "PARENT_REPORT" | "TEACHER_REPORT" | "SCHOOL_DIRECT" | "LEGACY_IMPORT";
export type FoodSafetyIncidentActionDTO =
  "FORWARD" | "CANCEL" | "ADD_ALLOCATIONS";

export interface FoodSafetyIncidentListItemDTO {
  id: string;
  code: string | null;
  schoolId: string;
  reportedByUserId: string | null;
  title: string;
  description: string;
  status: FoodSafetyIncidentStatusDTO;
  source: FoodSafetyIncidentSourceDTO;
  reportedSymptomaticCount: number | null;
  recipientCommuneFoodSafetyUnitId: string | null;
  occurredAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FoodSafetyIncidentListResponseDTO {
  items: FoodSafetyIncidentListItemDTO[];
  pagination: { page: number; limit: number; hasNext: boolean };
}

export interface FoodSafetyIncidentHistoryDTO {
  fromStatus: FoodSafetyIncidentStatusDTO | null;
  toStatus: FoodSafetyIncidentStatusDTO;
  createdAt: string;
}

/** Projection cho người báo (Q23): chỉ nội dung đã gửi, tiến độ và lý do hủy. */
export interface FoodSafetyIncidentReporterDetailDTO {
  view: "REPORTER";
  id: string;
  code: string | null;
  title: string;
  description: string;
  status: FoodSafetyIncidentStatusDTO;
  source: FoodSafetyIncidentSourceDTO;
  reportedSymptomaticCount: number | null;
  symptomDescription: string | null;
  occurredAt: string | null;
  reportedClass: { id: string; name: string } | null;
  cancellationReason: (typeof CANCELLATION_REASONS)[number] | null;
  cancellationNote: string | null;
  histories: FoodSafetyIncidentHistoryDTO[];
  allowedActions: FoodSafetyIncidentActionDTO[];
  createdAt: string;
  updatedAt: string;
}

/** Projection đầy đủ cho BGH, ATTP nhận hồ sơ và System Admin. */
export interface FoodSafetyIncidentFullDetailDTO extends Omit<
  FoodSafetyIncidentReporterDetailDTO,
  "view" | "histories"
> {
  view: "FULL";
  school: { id: string; name: string };
  reportedBy: { id: string; fullName: string } | null;
  reportedRoleCode: string | null;
  preliminaryAssessment: (typeof PRELIMINARY_ASSESSMENTS)[number] | null;
  preliminaryNote: string | null;
  reviewedBy: { id: string; fullName: string } | null;
  reviewedAt: string | null;
  recipientUnit: { id: string; name: string } | null;
  resolvedAt: string | null;
  forwardings: {
    id: string;
    recipientCommuneFoodSafetyUnitId: string | null;
    recipientOrganization: string;
    status: "PENDING" | "SENT" | "FAILED";
    forwardedAt: string | null;
    receivedAt: string | null;
    createdAt: string;
  }[];
  allocations: {
    mealAllocationId: string;
    status: "ALLOCATED" | "DISTRIBUTED" | "FINALIZED" | "CANCELLED";
    mealDate: string;
    mealType: string;
    classId: string;
    className: string;
  }[];
  histories: (FoodSafetyIncidentHistoryDTO & {
    actor: { id: string; fullName: string; roleCode: string } | null;
    note: string | null;
  })[];
}

export type FoodSafetyIncidentDetailResponseDTO =
  FoodSafetyIncidentReporterDetailDTO | FoodSafetyIncidentFullDetailDTO;

export interface FoodSafetyIncidentAllocationsResponseDTO {
  added: number;
  incident: FoodSafetyIncidentFullDetailDTO;
}
