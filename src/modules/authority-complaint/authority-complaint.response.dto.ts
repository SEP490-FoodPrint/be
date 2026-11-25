import type {
  TicketAttachmentDTO,
  TicketCommentDTO,
  TicketFieldsDTO,
} from "../complaint-ticket/complaint-ticket.response.dto";

export interface AuthorityComplaintRefDTO {
  id: string;
  name: string;
}

export interface AuthorityComplaintResponseDTO extends TicketFieldsDTO {
  id: string;
  /** `FP-AC-NNNNN`. */
  code: string;
  title: string;
  description: string;
  submittedAt: string;
  updatedAt: string;
  sender: { id: string; fullName: string };
  school: AuthorityComplaintRefDTO;
  recipientUnit: AuthorityComplaintRefDTO;
  /** Đơn C03 gốc (`FP-MC-NNNNN`). */
  escalatedFrom: { id: string; code: string };
}

/** C03 gốc chỉ đọc kèm toàn bộ bình luận PH ↔ BGH (FR-007). */
export interface AuthorityComplaintSourceDTO {
  id: string;
  code: string;
  title: string;
  complaintType: string;
  description: string;
  submittedAt: string;
  meal: {
    dailyMealPortionId: string;
    classId: string;
    className: string;
    mealDate: string;
    mealType: string;
  };
  /** File gửi kèm lúc tạo C03 gốc (plan v6 Q32); file trong bình luận nằm ở `comments[].attachments`. */
  attachments: TicketAttachmentDTO[];
  comments: TicketCommentDTO[];
}

export interface AuthorityComplaintDetailResponseDTO extends Omit<
  AuthorityComplaintResponseDTO,
  "escalatedFrom"
> {
  escalatedFrom: AuthorityComplaintSourceDTO;
  /** File phụ huynh gửi kèm khi Chuyển ATTP. */
  attachments: TicketAttachmentDTO[];
  comments: TicketCommentDTO[];
}

export interface AuthorityComplaintListResponseDTO {
  items: AuthorityComplaintResponseDTO[];
  pagination: { page: number; limit: number; hasNext: boolean };
}
