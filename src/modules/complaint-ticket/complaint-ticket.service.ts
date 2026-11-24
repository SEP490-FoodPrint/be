import type { Prisma } from "../../generated/prisma/client";
import { readEmailAppUrl, readEmailLogoUrl } from "../../utils/branded-email";
import {
  buildComplaintEmail,
  type ComplaintEmailEvent,
} from "../../utils/complaint-email";
import {
  allowedTicketActions,
  displayStatus,
  feedbackDeadline,
  hasNewMessage,
  toTicketStatus,
  type TicketActionOptions,
  type TicketViewer,
} from "./complaint-ticket.lifecycle";
import type {
  ComplaintTicketRepository,
  TicketCommentRow,
} from "./complaint-ticket.repository";
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
  options: TicketActionOptions = {},
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
    allowedActions: allowedTicketActions(viewer, state, now, options),
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

/**
 * Ghi email thông báo cho người gửi vào outbox trong cùng transaction với thao tác
 * (tạo đơn, bình luận của bên xử lý, Đã xử lý). Người gửi không còn `ACTIVE` thì bỏ qua.
 * Gọi sau khi đã ghi bình luận để email trích đúng bình luận mới nhất của bên xử lý.
 */
export async function queueRequesterEmail(
  tx: Prisma.TransactionClient,
  tickets: Pick<ComplaintTicketRepository, "findEmailRecipient" | "queueEmail">,
  complaintId: string,
  event: ComplaintEmailEvent,
): Promise<void> {
  const row = await tickets.findEmailRecipient(tx, complaintId);
  if (!row || row.senderUser.status !== "ACTIVE" || !row.senderUser.email)
    return;
  const latest = event === "CREATED" ? undefined : row.comments.at(0);
  const email = buildComplaintEmail(
    {
      event,
      kind: row.kind,
      code: row.code,
      title: row.title,
      description: row.description,
      recipientName: row.senderUser.fullName,
      comment: latest
        ? {
            authorName: latest.authorUser.fullName,
            createdAt: latest.createdAt,
            content: latest.content,
          }
        : null,
      appUrl: readEmailAppUrl(),
    },
    { logoUrl: readEmailLogoUrl() },
  );
  await tickets.queueEmail(tx, {
    complaintId,
    event,
    recipientEmail: row.senderUser.email,
    ...email,
  });
}
