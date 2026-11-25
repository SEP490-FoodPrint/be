import type {
  TicketAttachmentDTO,
  TicketCommentDTO,
  TicketFieldsDTO,
} from "../complaint-ticket/complaint-ticket.response.dto";

export interface IngredientQualityFeedbackPaginationDto {
  page: number;
  limit: number;
  hasNext: boolean;
}

export interface FeedbackSchoolRefDto {
  id: string;
  name: string;
  code: string | null;
}

export interface FeedbackDeliveryRefDto {
  id: string;
  deliveryNo: string;
}

export interface FeedbackUserRefDto {
  id: string;
  fullName: string;
}

export interface FeedbackIngredientLotRefDto {
  id: string;
  lotCode: string;
}

export interface FeedbackListItem extends TicketFieldsDTO {
  id: string;
  /** `FP-CP-NNNNN` (hoặc mã tuần tự cũ). */
  code: string;
  title: string;
  /** Loại vấn đề (plan v6 Q34); `null` với đơn tạo trước khi có trường này. */
  issueType: string | null;
  school: FeedbackSchoolRefDto;
  delivery: FeedbackDeliveryRefDto;
  submittedAt: string;
  updatedAt: string;
}

export interface FeedbackList {
  items: FeedbackListItem[];
  pagination: IngredientQualityFeedbackPaginationDto;
}

export interface FeedbackDetail extends FeedbackListItem {
  description: string;
  submittedBy: FeedbackUserRefDto;
  ingredientLot: FeedbackIngredientLotRefDto | null;
  /** File gửi kèm lúc tạo đơn (specs/complaint-attachments). */
  attachments: TicketAttachmentDTO[];
  comments: TicketCommentDTO[];
}
