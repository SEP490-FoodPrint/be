export interface ComplaintResponseDTO {
  id: string;
  complaintType: string;
  description: string;
  status: string;
  submittedAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolution: string | null;
  submitter: { id: string; fullName: string };
  handler: { id: string; fullName: string } | null;
  meal: {
    allocationId: string;
    allocationStatus: string;
    classId: string;
    className: string;
    academicYear: string | null;
    mealDate: string;
    mealType: string;
  };
  allowedActions: Array<"START_REVIEW" | "RESOLVE">;
}
export interface ComplaintListResponseDTO {
  items: ComplaintResponseDTO[];
  pagination: { page: number; limit: number; hasNext: boolean };
}
