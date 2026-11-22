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
  "FORWARD" | "CANCEL" | "ADD_ALLOCATIONS" | "PLAN_INSPECTION" | "CLOSE";

/** PR6a: đợt kiểm tra theo projection người báo (Q23) — không có teamDescription, người ghi chỉ tên/vai trò. */
export interface FoodSafetyIncidentInspectionReporterDTO {
  id: string;
  status: "PLANNED" | "COMPLETED";
  scheduledAt: string;
  completedAt: string | null;
  resultSummary: string | null;
  overallConclusion:
    | "SUPPLIER_AT_FAULT"
    | "SCHOOL_AT_FAULT"
    | "MIXED_FAULT"
    | "NOT_FOOD_RELATED"
    | "INCONCLUSIVE"
    | null;
  recordedBy: { fullName: string; roleCode: string } | null;
  findings: {
    supplier: { id: string; name: string };
    finding: "AT_FAULT" | "CLEARED" | "INCONCLUSIVE";
    evidenceNote: string | null;
  }[];
}

export interface FoodSafetyIncidentInspectionFullDTO extends Omit<
  FoodSafetyIncidentInspectionReporterDTO,
  "recordedBy"
> {
  teamDescription: string;
  createdAt: string;
  createdBy: { id: string; fullName: string };
  recordedBy: { id: string; fullName: string; roleCode: string } | null;
}

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
  inspections: FoodSafetyIncidentInspectionReporterDTO[];
  allowedActions: FoodSafetyIncidentActionDTO[];
  createdAt: string;
  updatedAt: string;
}

/** Projection đầy đủ cho BGH, ATTP nhận hồ sơ và System Admin. */
export interface FoodSafetyIncidentFullDetailDTO extends Omit<
  FoodSafetyIncidentReporterDetailDTO,
  "view" | "histories" | "inspections"
> {
  inspections: FoodSafetyIncidentInspectionFullDTO[];
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
    /** PR5b: phiên bản snapshot gửi kèm; NULL với bản chuyển cũ. */
    traceSnapshotVersion: number | null;
  }[];
  traceCompleteness: TraceCompletenessDTO | null;
  traceSnapshots: FoodSafetyIncidentTraceSnapshotSummaryDTO[];
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

export type TraceCompletenessDTO = "COMPLETE" | "PARTIAL" | "MISSING";

export type TraceMissingReasonDTO =
  | { code: "NO_ALLOCATIONS" }
  | { code: "ALLOCATION_WITHOUT_COOKING_BATCH"; mealAllocationId: string }
  | {
      code:
        | "COOKING_BATCH_DISH_WITHOUT_LOTS"
        | "COOKING_BATCH_DISH_WITHOUT_RETAINED_SAMPLE";
      cookingBatchId: string;
      dishId: string;
    };

export interface FoodSafetyIncidentTraceSnapshotSummaryDTO {
  id: string;
  version: number;
  completeness: TraceCompletenessDTO;
  missingReasons: TraceMissingReasonDTO[];
  payloadVersion: number;
  hashAlgorithm: string;
  payloadHash: string;
  createdAt: string;
  createdBy: { id: string; fullName: string };
}

/** Payload chuẩn hóa v1: chỉ kiểu nguyên thủy, mảng sắp xếp theo ID. */
export interface TracePayloadV1DTO {
  incident: { id: string; code: string | null; schoolId: string };
  allocations: {
    id: string;
    dailyMealPortionId: string;
    classId: string;
    className: string;
    mealDate: string;
    mealType: string;
    totalPortions: number;
    status: string;
    distributedAt: string | null;
    finalizedAt: string | null;
  }[];
  cookingBatches: {
    id: string;
    batchCode: string;
    menuDayId: string;
    mealType: string;
    status: string;
    completedAt: string | null;
  }[];
  allocationBatches: {
    mealAllocationId: string;
    cookingBatchId: string;
    dishId: string;
    dishName: string;
    allocatedPortions: string;
  }[];
  lotUsages: {
    cookingBatchId: string;
    dishId: string;
    ingredientLotId: string;
    quantityUsed: string;
    unit: string;
  }[];
  ingredientLots: {
    id: string;
    lotCode: string;
    ingredientId: string;
    ingredientName: string;
    supplierId: string;
    deliveryId: string;
    deliveryNo: string;
    sourceFacilityId: string | null;
    manufactureDate: string | null;
    expiryDate: string | null;
    unit: string;
  }[];
  suppliers: { id: string; name: string }[];
  sourceFacilities: {
    id: string;
    supplierId: string;
    name: string;
    facilityCode: string | null;
  }[];
  retainedSamples: {
    id: string;
    cookingBatchId: string;
    dishId: string;
    sampledAt: string;
    status: string;
    quantity: string | null;
    unit: string | null;
    storageLocation: string | null;
    photoHash: string | null;
  }[];
  potentialExposedPortionCount: number;
}

export interface FoodSafetyIncidentTraceSnapshotDTO extends FoodSafetyIncidentTraceSnapshotSummaryDTO {
  incidentId: string;
  payload: TracePayloadV1DTO;
  /** Hash tính lại từ payload đã lưu khớp `payloadHash`. */
  hashMatches: boolean;
}

export type FoodSafetyIncidentDetailResponseDTO =
  FoodSafetyIncidentReporterDetailDTO | FoodSafetyIncidentFullDetailDTO;

export interface FoodSafetyIncidentAllocationsResponseDTO {
  added: number;
  incident: FoodSafetyIncidentFullDetailDTO;
}
