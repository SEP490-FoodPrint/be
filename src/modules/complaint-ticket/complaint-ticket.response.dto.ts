import type {
  TicketAction,
  TicketDisplayStatus,
  TicketStatus,
} from "./complaint-ticket.lifecycle";

export interface TicketCommentDTO {
  id: string;
  authorSide: "REQUESTER" | "HANDLER";
  commentType: "MESSAGE" | "RESOLUTION" | "REOPEN_NOTE" | "ESCALATION_NOTE";
  content: string;
  createdAt: string;
  author: { id: string; fullName: string };
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
