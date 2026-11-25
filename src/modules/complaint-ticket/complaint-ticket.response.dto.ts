import type {
  TicketAction,
  TicketDisplayStatus,
  TicketStatus,
} from "./complaint-ticket.lifecycle";

/** File chứng cứ (specs/complaint-attachments FR-004); `url` là URL ký có hạn, `null` khi chưa ký được. */
export interface TicketAttachmentDTO {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploaderSide: "REQUESTER" | "HANDLER";
  createdAt: string;
  url: string | null;
}

export interface TicketCommentDTO {
  id: string;
  authorSide: "REQUESTER" | "HANDLER";
  commentType: "MESSAGE" | "RESOLUTION" | "REOPEN_NOTE" | "ESCALATION_NOTE";
  content: string;
  createdAt: string;
  author: { id: string; fullName: string };
  attachments: TicketAttachmentDTO[];
}

/** Trường ticket chung của mọi loại đơn khiếu nại (FR-009). */
export interface TicketFieldsDTO {
  status: TicketStatus;
  displayStatus: TicketDisplayStatus;
  hasNewMessage: boolean;
  closeReason: "SATISFIED" | "ESCALATED" | "AUTO_CLOSED" | null;
  lastResolvedAt: string | null;
  resolvedCount: number;
  feedbackDeadlineAt: string | null;
  closedAt: string | null;
  allowedActions: TicketAction[];
}
