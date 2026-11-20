import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import {
  allocateBusinessCode,
  type BusinessCodeType,
} from "../../utils/business-code";
import type { TicketStatus } from "./complaint-ticket.lifecycle";

type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;

export type ComplaintKindValue = "MEAL" | "INGREDIENT" | "AUTHORITY" | "SYSTEM";
export type CommentSide = "REQUESTER" | "HANDLER";
export type CommentType =
  "MESSAGE" | "RESOLUTION" | "REOPEN_NOTE" | "ESCALATION_NOTE";

export interface TicketActor {
  userId: string;
  roleCode: string;
}

export const ticketCommentSelect = {
  id: true,
  authorSide: true,
  commentType: true,
  content: true,
  createdAt: true,
  authorUser: { select: { id: true, fullName: true } },
} as const satisfies Prisma.ComplaintCommentSelect;
export type TicketCommentRow = Prisma.ComplaintCommentGetPayload<{
  select: typeof ticketCommentSelect;
}>;

/** Bình luận mới nhất (để tính nhãn "Có tin nhắn mới"); dùng trong include/select của bảng cha. */
export const latestCommentSideSelect = {
  orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  take: 1,
  select: { authorSide: true },
} as const satisfies Prisma.Complaint$commentsArgs;

/** Danh sách bình luận của chi tiết đơn, theo thời gian tăng dần. */
export const ticketCommentsArgs = {
  orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  select: ticketCommentSelect,
} as const satisfies Prisma.Complaint$commentsArgs;

export interface TransitionInput {
  complaintId: string;
  kind: ComplaintKindValue;
  fromStatus: TicketStatus;
  toStatus: TicketStatus;
  actor: TicketActor;
  now: Date;
  /** Chỉ cập nhật khi đơn còn trong hạn đánh giá: `lastResolvedAt > resolvedAfter`. */
  resolvedAfter?: Date;
  closeReason?: "SATISFIED" | "ESCALATED";
  markResolved?: boolean;
}

export function createComplaintTicketRepository() {
  return {
    /** Cấp mã `FP-<XX>-NNNNN` trong transaction tạo; mã đã có ở bảng cha (kể cả mã CP cũ) bị bỏ qua. */
    allocateCode(tx: Tx, type: BusinessCodeType): Promise<string> {
      return allocateBusinessCode(tx, type, async (codes) => {
        const rows = await tx.complaint.findMany({
          where: { code: { in: [...codes] } },
          select: { code: true },
        });
        return new Set(rows.map((row) => row.code));
      });
    },
    recordCreated(
      tx: Tx,
      complaintId: string,
      actor: TicketActor,
    ): Promise<unknown> {
      return tx.complaintStatusHistory.create({
        data: {
          complaintId,
          fromStatus: null,
          toStatus: "NEW",
          actorType: "USER",
          actorUserId: actor.userId,
          actorRoleCode: actor.roleCode,
        },
      });
    },
    /**
     * Chuyển trạng thái có điều kiện (trạng thái nguồn + hạn 48h nếu có) và ghi lịch sử trong cùng transaction.
     * Trả `false` khi không còn khớp điều kiện (thao tác đồng thời hoặc đã quá hạn) để service trả 409.
     */
    async transition(tx: Tx, input: TransitionInput): Promise<boolean> {
      const closing = input.toStatus === "CLOSED";
      const result = await tx.complaint.updateMany({
        where: {
          id: input.complaintId,
          kind: input.kind,
          status: input.fromStatus,
          ...(input.resolvedAfter
            ? { lastResolvedAt: { gt: input.resolvedAfter } }
            : {}),
        },
        data: {
          status: input.toStatus,
          ...(input.markResolved
            ? { lastResolvedAt: input.now, resolvedCount: { increment: 1 } }
            : {}),
          ...(closing
            ? {
                closeReason: input.closeReason,
                closedAt: input.now,
                closedByUserId: input.actor.userId,
              }
            : {}),
        },
      });
      if (result.count !== 1) return false;
      await tx.complaintStatusHistory.create({
        data: {
          complaintId: input.complaintId,
          fromStatus: input.fromStatus,
          toStatus: input.toStatus,
          closeReason: closing ? input.closeReason : null,
          actorType: "USER",
          actorUserId: input.actor.userId,
          actorRoleCode: input.actor.roleCode,
        },
      });
      return true;
    },
    addComment(
      tx: Tx,
      input: {
        complaintId: string;
        actor: TicketActor;
        side: CommentSide;
        type: CommentType;
        content: string;
      },
    ): Promise<unknown> {
      return tx.complaintComment.create({
        data: {
          complaintId: input.complaintId,
          authorUserId: input.actor.userId,
          authorRoleCode: input.actor.roleCode,
          authorSide: input.side,
          commentType: input.type,
          content: input.content,
        },
      });
    },
    /** Đơn `RESOLVED` đã hết hạn đánh giá (`lastResolvedAt <= cutoff`), cũ nhất trước. */
    async findDueResolved(
      db: Db,
      cutoff: Date,
      take: number,
    ): Promise<string[]> {
      const rows = await db.complaint.findMany({
        where: { status: "RESOLVED", lastResolvedAt: { lte: cutoff } },
        orderBy: [{ lastResolvedAt: "asc" }, { id: "asc" }],
        take,
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    /** Hệ thống tự đóng một đơn quá hạn; idempotent (đơn đã đổi trạng thái thì bỏ qua). */
    async autoClose(
      tx: Tx,
      complaintId: string,
      cutoff: Date,
      now: Date,
    ): Promise<boolean> {
      const result = await tx.complaint.updateMany({
        where: {
          id: complaintId,
          status: "RESOLVED",
          lastResolvedAt: { lte: cutoff },
        },
        data: {
          status: "CLOSED",
          closeReason: "AUTO_CLOSED",
          closedAt: now,
          closedByUserId: null,
        },
      });
      if (result.count !== 1) return false;
      await tx.complaintStatusHistory.create({
        data: {
          complaintId,
          fromStatus: "RESOLVED",
          toStatus: "CLOSED",
          closeReason: "AUTO_CLOSED",
          actorType: "SYSTEM",
          actorUserId: null,
          actorRoleCode: null,
        },
      });
      return true;
    },
  };
}

export type ComplaintTicketRepository = ReturnType<
  typeof createComplaintTicketRepository
>;
export const complaintTicketRepository = createComplaintTicketRepository();
