import type { SystemComplaintCategory } from "../complaint-ticket/complaint-ticket.lifecycle";
import type {
  TicketCommentDTO,
  TicketFieldsDTO,
} from "../complaint-ticket/complaint-ticket.response.dto";

/** Tổ chức của người gửi tại lúc gửi; `null` khi không gắn tổ chức. */
export interface SystemComplaintOrganizationDTO {
  type: "SCHOOL" | "SUPPLIER" | "AUTHORITY";
  id: string;
  name: string;
}

export interface SystemComplaintResponseDTO extends TicketFieldsDTO {
  id: string;
  /** `FP-SC-NNNNN`. */
  code: string;
  title: string;
  category: SystemComplaintCategory;
  description: string;
  submittedAt: string;
  updatedAt: string;
  sender: { id: string; fullName: string };
  senderRole: { code: string; name: string };
  senderOrganization: SystemComplaintOrganizationDTO | null;
}

export interface SystemComplaintDetailResponseDTO extends SystemComplaintResponseDTO {
  comments: TicketCommentDTO[];
}

export interface SystemComplaintListResponseDTO {
  items: SystemComplaintResponseDTO[];
  pagination: { page: number; limit: number; hasNext: boolean };
}
