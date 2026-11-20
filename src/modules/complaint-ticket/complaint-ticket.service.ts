import {
  allowedTicketActions,
  displayStatus,
  feedbackDeadline,
  hasNewMessage,
  toTicketStatus,
  type TicketViewer,
} from "./complaint-ticket.lifecycle";
import type { TicketCommentRow } from "./complaint-ticket.repository";
import type {
  TicketCommentDTO,
  TicketFieldsDTO,
} from "./complaint-ticket.response.dto";

/** Dữ liệu bảng cha cần để dựng trường ticket. */
export interface TicketRowFields {
  status: string;
  lastResolvedAt: Date | null;
  resolvedCount: number;
  closeReason: "SATISFIED" | "ESCALATED" | "AUTO_CLOSED" | null;
  closedAt: Date | null;
}

/** Ánh xạ trường ticket theo lớp người xem; `latestCommentSide` là phía của bình luận mới nhất. */
export function mapTicketFields(
  viewer: TicketViewer,
  row: TicketRowFields,
  latestCommentSide: "REQUESTER" | "HANDLER" | null,
  now: Date,
): TicketFieldsDTO {
  const status = toTicketStatus(row.status);
  const state = { status, lastResolvedAt: row.lastResolvedAt };
  return {
    status,
    displayStatus: displayStatus(viewer, status),
    hasNewMessage: hasNewMessage(viewer, status, latestCommentSide),
    closeReason: row.closeReason,
    lastResolvedAt: row.lastResolvedAt?.toISOString() ?? null,
    resolvedCount: row.resolvedCount,
    feedbackDeadlineAt: feedbackDeadline(state)?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    allowedActions: allowedTicketActions(viewer, state, now),
  };
}

export function mapTicketComment(row: TicketCommentRow): TicketCommentDTO {
  return {
    id: row.id,
    authorSide: row.authorSide,
    commentType: row.commentType,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    author: { id: row.authorUser.id, fullName: row.authorUser.fullName },
  };
}
