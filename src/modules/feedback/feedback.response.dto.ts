import type {
  TicketCommentDTO,
  TicketFieldsDTO,
} from "../complaint-ticket/complaint-ticket.response.dto";

export interface ComplaintResponseDTO extends TicketFieldsDTO {
  id: string;
  /** `FP-MC-NNNNN`. */
  code: string;
  title: string;
  complaintType: string;
  description: string;
  submittedAt: string;
  updatedAt: string;
  submitter: { id: string; fullName: string };
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
}
export interface ComplaintDetailResponseDTO extends ComplaintResponseDTO {
  comments: TicketCommentDTO[];
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
