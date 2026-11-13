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
    dailyMealPortionId: string;
    allocationId: string | null;
    allocationStatus: string | null;
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

export interface ComplaintMealOptionDTO {
  dailyMealPortionId: string;
  canComplain: boolean;
}

export interface ComplaintMealOptionsDTO {
  mealDate: string;
  classes: {
    classId: string;
    className: string;
    lunch: ComplaintMealOptionDTO | null;
    afternoon: ComplaintMealOptionDTO | null;
  }[];
}
