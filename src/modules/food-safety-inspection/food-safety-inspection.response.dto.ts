import type {
  INSPECTION_CONCLUSIONS,
  SUPPLIER_FINDINGS,
} from "./food-safety-inspection.validation";

export type FoodSafetyIncidentStatusAfterDTO =
  "UNDER_INSPECTION" | "INSPECTION_COMPLETED" | "CLOSED";

/** v6 (PR-G): file kết quả kiểm tra; `url` là URL ký 10 phút (`null` khi chưa ký được). */
export interface FoodSafetyInspectionAttachmentDTO {
  id: string;
  stage: "INSPECTION_RESULT";
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  url: string | null;
}

export interface FoodSafetyInspectionDTO {
  id: string;
  incidentId: string;
  status: "PLANNED" | "COMPLETED";
  teamDescription: string;
  scheduledAt: string;
  resultSummary: string | null;
  overallConclusion: (typeof INSPECTION_CONCLUSIONS)[number] | null;
  completedAt: string | null;
  createdAt: string;
  findings: {
    supplier: { id: string; name: string };
    finding: (typeof SUPPLIER_FINDINGS)[number];
    evidenceNote: string | null;
  }[];
  attachments: FoodSafetyInspectionAttachmentDTO[];
}

export interface FoodSafetyInspectionActionResponseDTO {
  incidentStatus: FoodSafetyIncidentStatusAfterDTO;
  inspection: FoodSafetyInspectionDTO;
}

export interface FoodSafetyIncidentCloseResponseDTO {
  id: string;
  status: "CLOSED";
}

export interface FoodSafetyInspectionSupplierOptionDTO {
  id: string;
  name: string;
}

export interface FoodSafetyInspectionSupplierOptionsResponseDTO {
  /** SNAPSHOT: NCC trong snapshot truy xuất; SCHOOL_RELATIONSHIP: hồ sơ không có NCC trong snapshot. */
  source: "SNAPSHOT" | "SCHOOL_RELATIONSHIP";
  items: FoodSafetyInspectionSupplierOptionDTO[];
}
