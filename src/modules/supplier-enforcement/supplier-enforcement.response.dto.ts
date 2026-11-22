import type {
  ENFORCEMENT_ACTION_TYPES,
  ENFORCEMENT_DECISION_STATUSES,
  ENFORCEMENT_EXECUTION_STATUSES,
  RESTRICTION_TYPES,
} from "./supplier-enforcement.validation";

export interface EnforcementActorDTO {
  id: string;
  fullName: string;
  roleCode: string;
}

export interface SupplierEnforcementActionDTO {
  id: string;
  incident: { id: string; code: string | null; title: string; status: string };
  supplier: { id: string; name: string };
  actionType: (typeof ENFORCEMENT_ACTION_TYPES)[number];
  requestReason: string;
  evidenceInspection: {
    id: string;
    status: "PLANNED" | "COMPLETED";
    overallConclusion: string | null;
    completedAt: string | null;
  } | null;
  requestedBy: EnforcementActorDTO;
  decisionStatus: (typeof ENFORCEMENT_DECISION_STATUSES)[number];
  decidedBy: EnforcementActorDTO | null;
  decidedAt: string | null;
  decisionNote: string | null;
  executionStatus: (typeof ENFORCEMENT_EXECUTION_STATUSES)[number];
  executedAt: string | null;
  executionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierRestrictionDTO {
  id: string;
  restrictionType: (typeof RESTRICTION_TYPES)[number];
  incidentId: string | null;
  activatedAt: string;
  lockedAccountCount: number;
}

export interface SupplierEnforcementActionDetailDTO extends SupplierEnforcementActionDTO {
  /** Chỉ System Admin: hạn chế đang hiệu lực của NCC (mọi sự cố). */
  activeRestrictions: SupplierRestrictionDTO[] | null;
}

export interface SupplierEnforcementListResponseDTO {
  items: SupplierEnforcementActionDTO[];
  pagination: { page: number; limit: number; hasNext: boolean };
}

export interface SupplierEnforcementDecisionResponseDTO {
  action: SupplierEnforcementActionDTO;
  /** Số tài khoản chuyển LOCKED/ACTIVE trong lần thực thi này. */
  lockedAccountCount: number;
  unlockedAccountCount: number;
  supplierIntakeState: string;
}
