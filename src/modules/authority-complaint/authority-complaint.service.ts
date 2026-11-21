import { ORG_TYPES, ROLES } from "../../constants/roles";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import {
  authorizationTransaction,
  databaseOperation,
  loadPrincipal,
  withSchoolTransaction,
} from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import { listScopes } from "../../utils/resource-access";
import {
  assertTicketAction,
  authorityComplaintTitle,
  feedbackWindowStart,
  ticketConflictMessage,
  toTicketStatus,
  TICKET_TRANSITIONS,
  type TicketAction,
  type TicketViewer,
} from "../complaint-ticket/complaint-ticket.lifecycle";
import {
  complaintTicketRepository,
  type ComplaintTicketRepository,
  type TicketActor,
} from "../complaint-ticket/complaint-ticket.repository";
import {
  mapTicketComment,
  mapTicketFields,
} from "../complaint-ticket/complaint-ticket.service";
import {
  createAuthorityComplaintRepository,
  type AuthorityComplaintDetailRow,
  type AuthorityComplaintRepository,
  type AuthorityComplaintRow,
  type AuthorityComplaintTicketTarget,
} from "./authority-complaint.repository";
import type {
  AuthorityComplaintCommentRequestDTO,
  AuthorityComplaintListQueryDTO,
  AuthorityComplaintReopenRequestDTO,
  AuthorityComplaintResolveRequestDTO,
  EscalateAuthorityComplaintRequestDTO,
} from "./authority-complaint.request.dto";
import type {
  AuthorityComplaintDetailResponseDTO,
  AuthorityComplaintListResponseDTO,
  AuthorityComplaintResponseDTO,
} from "./authority-complaint.response.dto";

const NOT_FOUND = "Không tìm thấy khiếu nại leo thang";
const SOURCE_NOT_FOUND = "Không tìm thấy khiếu nại suất ăn của bạn";
const CORRUPT_DATA = "Không thể tải dữ liệu. Vui lòng thử lại sau.";
const FORBIDDEN_ACTION = "Vai trò không được phép thực hiện thao tác này";
const SUBMIT_PERMISSION = "authority_complaint.submit";

type Side = Exclude<TicketViewer, "OBSERVER">;

/** Bên xử lý: cán bộ ATTP có quyền xem + xử lý (FR-006); đơn vị khớp được kiểm tra qua phạm vi đọc. */
export function isAuthorityHandler(principal: AuthPrincipal): boolean {
  return (
    principal.orgType === ORG_TYPES.AUTHORITY &&
    principal.role === ROLES.COMMUNE_FOOD_SAFETY_OFFICER &&
    !!principal.communeFoodSafetyUnitId &&
    principal.permissions.includes("authority_complaint.view") &&
    principal.permissions.includes("authority_complaint.respond")
  );
}

/** Người gửi: phụ huynh (Ban đại diện) có quyền Chuyển ATTP (Q19). */
export function isAuthorityRequester(principal: AuthPrincipal): boolean {
  return (
    principal.orgType === ORG_TYPES.SCHOOL &&
    principal.role === ROLES.PARENTS_COMMITTEE &&
    principal.permissions.includes(SUBMIT_PERMISSION)
  );
}

function sideOf(principal: AuthPrincipal): Side {
  if (isAuthorityHandler(principal)) return "HANDLER";
  if (isAuthorityRequester(principal)) return "REQUESTER";
  throw new HttpError(403, FORBIDDEN_ACTION);
}

function viewerOf(
  row: {
    senderUserId: string;
    authorityComplaint: { recipientCommuneFoodSafetyUnitId: string } | null;
  },
  principal: AuthPrincipal,
): TicketViewer {
  if (row.senderUserId === principal.id) return "REQUESTER";
  return isAuthorityHandler(principal) &&
    row.authorityComplaint?.recipientCommuneFoodSafetyUnitId ===
      principal.communeFoodSafetyUnitId
    ? "HANDLER"
    : "OBSERVER";
}

function baseResponse(
  row: AuthorityComplaintRow | AuthorityComplaintDetailRow,
  principal: AuthPrincipal,
  now: Date,
  latestCommentSide: "REQUESTER" | "HANDLER" | null,
) {
  const child = row.authorityComplaint;
  if (!child) throw new HttpError(503, CORRUPT_DATA);
  return {
    child,
    response: {
      id: row.id,
      code: row.code,
      title: row.title,
      description: row.description,
      submittedAt: row.submittedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      sender: { id: row.senderUser.id, fullName: row.senderUser.fullName },
      school: { id: child.School.id, name: child.School.name },
      recipientUnit: {
        id: child.RecipientUnit.id,
        name: child.RecipientUnit.name,
      },
      ...mapTicketFields(viewerOf(row, principal), row, latestCommentSide, now),
    },
  };
}

function toListItem(
  row: AuthorityComplaintRow,
  principal: AuthPrincipal,
  now: Date,
): AuthorityComplaintResponseDTO {
  const { child, response } = baseResponse(
    row,
    principal,
    now,
    row.comments[0]?.authorSide ?? null,
  );
  return {
    ...response,
    escalatedFrom: {
      id: child.EscalatedFrom.id,
      code: child.EscalatedFrom.Complaint.code,
    },
  };
}

function toDetail(
  row: AuthorityComplaintDetailRow,
  principal: AuthPrincipal,
  now: Date,
): AuthorityComplaintDetailResponseDTO {
  const { response } = baseResponse(
    row,
    principal,
    now,
    row.comments.at(-1)?.authorSide ?? null,
  );
  const source = row.authorityComplaint?.EscalatedFrom;
  if (!source) throw new HttpError(503, CORRUPT_DATA);
  const portion = source.DailyMealPortion;
  return {
    ...response,
    escalatedFrom: {
      id: source.id,
      code: source.Complaint.code,
      title: source.Complaint.title,
      complaintType: source.complaintType,
      description: source.Complaint.description,
      submittedAt: source.Complaint.submittedAt.toISOString(),
      meal: {
        dailyMealPortionId: portion.id,
        classId: portion.Class.id,
        className: portion.Class.name,
        mealDate: portion.mealDate.toISOString().slice(0, 10),
        mealType: portion.mealType,
      },
      comments: source.Complaint.comments.map(mapTicketComment),
    },
    comments: row.comments.map(mapTicketComment),
  };
}

/** Mô tả C05 = mô tả C03 gốc + lý do chuyển (nếu có). */
export function authorityComplaintDescription(
  original: string,
  reason: string | undefined,
): string {
  return reason ? `${original}\n\nLý do chuyển ATTP: ${reason}` : original;
}

export function createAuthorityComplaintService(
  repository: AuthorityComplaintRepository = createAuthorityComplaintRepository(),
  connect: () => Promise<PrismaClient> = getPrisma,
  now = () => new Date(),
  tickets: ComplaintTicketRepository = complaintTicketRepository,
) {
  /**
   * Khung chung cho thao tác ticket C05: nạp lại actor trong transaction, kiểm tra vai trò/quyền/phạm vi/trạng thái,
   * chạy thao tác rồi đọc lại chi tiết bằng cùng transaction.
   */
  async function act(
    id: string,
    principal: AuthPrincipal,
    side: Side,
    action: TicketAction,
    run: (
      tx: Prisma.TransactionClient,
      target: AuthorityComplaintTicketTarget,
      actor: TicketActor,
      at: Date,
    ) => Promise<void>,
  ): Promise<AuthorityComplaintDetailResponseDTO> {
    if (sideOf(principal) !== side) throw new HttpError(403, FORBIDDEN_ACTION);
    const db = await databaseOperation(() => connect());
    return authorizationTransaction(db, async (tx) => {
      const actor = await loadPrincipal(principal.id, tx);
      if (
        sideOf(actor) !== side ||
        actor.schoolId !== principal.schoolId ||
        actor.communeFoodSafetyUnitId !== principal.communeFoodSafetyUnitId
      )
        throw new HttpError(403, "Phạm vi tài khoản đã thay đổi");
      const scope = listScopes["authority-complaint"](actor);
      const target = await repository.findTicketTarget(tx, scope, id);
      if (!target) throw new HttpError(404, NOT_FOUND);
      if (side === "REQUESTER" && target.senderUserId !== actor.id)
        throw new HttpError(404, NOT_FOUND);
      const at = now();
      assertTicketAction(
        side,
        {
          status: toTicketStatus(target.status),
          lastResolvedAt: target.lastResolvedAt,
        },
        action,
        at,
      );
      await run(tx, target, { userId: actor.id, roleCode: actor.role }, at);
      const row = await repository.findOne(tx, scope, id);
      if (!row) throw new HttpError(404, NOT_FOUND);
      return toDetail(row, actor, at);
    });
  }

  async function transition(
    tx: Prisma.TransactionClient,
    target: { id: string; status: string },
    kind: "AUTHORITY" | "MEAL",
    actor: TicketActor,
    at: Date,
    action: Exclude<TicketAction, "COMMENT">,
  ) {
    const rule = TICKET_TRANSITIONS[action];
    const ok = await tickets.transition(tx, {
      complaintId: target.id,
      kind,
      fromStatus: toTicketStatus(target.status),
      toStatus: rule.to,
      actor,
      now: at,
      markResolved: action === "RESOLVE",
      ...("closeReason" in rule ? { closeReason: rule.closeReason } : {}),
      ...(action === "SATISFY" || action === "REOPEN" || action === "ESCALATE"
        ? { resolvedAfter: feedbackWindowStart(at) }
        : {}),
    });
    if (!ok) throw new HttpError(409, ticketConflictMessage(action));
  }

  return {
    async getAll(
      query: AuthorityComplaintListQueryDTO,
      principal: AuthPrincipal,
    ): Promise<AuthorityComplaintListResponseDTO> {
      const rows = await repository.list(
        await connect(),
        listScopes["authority-complaint"](principal),
        query,
      );
      const at = now();
      return {
        items: rows
          .slice(0, query.limit)
          .map((row) => toListItem(row, principal, at)),
        pagination: {
          page: query.page,
          limit: query.limit,
          hasNext: rows.length > query.limit,
        },
      };
    },
    async getOne(
      id: string,
      principal: AuthPrincipal,
    ): Promise<AuthorityComplaintDetailResponseDTO> {
      const row = await repository.findOne(
        await connect(),
        listScopes["authority-complaint"](principal),
        id,
      );
      if (!row) throw new HttpError(404, NOT_FOUND);
      return toDetail(row, principal, now());
    },
    /**
     * "Chuyển ATTP" (FR-003, FR-004): đóng C03 gốc `ESCALATED` và tạo C05 trong cùng transaction.
     * Đơn vị nhận suy ra từ phường/xã của trường, người gửi không chọn tay.
     */
    async escalate(
      input: EscalateAuthorityComplaintRequestDTO,
      principal: AuthPrincipal,
    ): Promise<AuthorityComplaintDetailResponseDTO> {
      if (!isAuthorityRequester(principal))
        throw new HttpError(403, "Chỉ phụ huynh gửi đơn được chuyển ATTP");
      const db = await databaseOperation(() => connect());
      return withSchoolTransaction(
        db,
        principal,
        SUBMIT_PERMISSION,
        async (tx, actor, schoolId) => {
          if (!isAuthorityRequester(actor))
            throw new HttpError(403, "Phạm vi tài khoản đã thay đổi");
          const readScope = listScopes["authority-complaint"](actor);
          await repository.lockMealComplaint(tx, input.mealComplaintId);
          const source = await repository.findEscalationSource(
            tx,
            input.mealComplaintId,
            { schoolId, senderUserId: actor.id },
          );
          if (!source || source.senderRoleCode !== ROLES.PARENTS_COMMITTEE)
            throw new HttpError(404, SOURCE_NOT_FOUND);
          if (source.mealComplaint?.authorityEscalation)
            throw new HttpError(409, "Khiếu nại đã được chuyển ATTP");
          const at = now();
          assertTicketAction(
            "REQUESTER",
            {
              status: toTicketStatus(source.status),
              lastResolvedAt: source.lastResolvedAt,
            },
            "ESCALATE",
            at,
            { canEscalate: true },
          );
          const locationId = await repository.findSchoolLocationId(
            tx,
            schoolId,
          );
          if (!locationId)
            throw new HttpError(
              409,
              "Trường chưa được gắn phường/xã nên chưa thể chuyển ATTP",
            );
          const unit = await repository.findRecipientUnit(tx, locationId);
          if (!unit)
            throw new HttpError(
              409,
              "Phường/xã của trường chưa có đơn vị ATTP đang hoạt động",
            );
          const ticketActor = { userId: actor.id, roleCode: actor.role };
          await transition(tx, source, "MEAL", ticketActor, at, "ESCALATE");
          if (input.reason)
            await tickets.addComment(tx, {
              complaintId: source.id,
              actor: ticketActor,
              side: "REQUESTER",
              type: "ESCALATION_NOTE",
              content: input.reason,
            });
          const created = await repository.create(tx, {
            code: await tickets.allocateCode(tx, "AC"),
            title: authorityComplaintTitle(source.code),
            description: authorityComplaintDescription(
              source.description,
              input.reason,
            ),
            senderUserId: actor.id,
            senderRoleCode: actor.role,
            schoolId,
            recipientCommuneFoodSafetyUnitId: unit.id,
            escalatedFromMealComplaintId: source.id,
          });
          await tickets.recordCreated(tx, created.id, ticketActor);
          const row = await repository.findOne(tx, readScope, created.id);
          if (!row) throw new HttpError(503, CORRUPT_DATA);
          return toDetail(row, actor, at);
        },
      );
    },
    accept(id: string, principal: AuthPrincipal) {
      return act(id, principal, "HANDLER", "ACCEPT", (tx, target, actor, at) =>
        transition(tx, target, "AUTHORITY", actor, at, "ACCEPT"),
      );
    },
    comment(
      id: string,
      input: AuthorityComplaintCommentRequestDTO,
      principal: AuthPrincipal,
    ) {
      const side = sideOf(principal);
      return act(id, principal, side, "COMMENT", async (tx, target, actor) => {
        await tickets.addComment(tx, {
          complaintId: target.id,
          actor,
          side,
          type: "MESSAGE",
          content: input.content,
        });
      });
    },
    resolve(
      id: string,
      input: AuthorityComplaintResolveRequestDTO,
      principal: AuthPrincipal,
    ) {
      return act(
        id,
        principal,
        "HANDLER",
        "RESOLVE",
        async (tx, target, actor, at) => {
          await transition(tx, target, "AUTHORITY", actor, at, "RESOLVE");
          await tickets.addComment(tx, {
            complaintId: target.id,
            actor,
            side: "HANDLER",
            type: "RESOLUTION",
            content: input.content,
          });
        },
      );
    },
    satisfy(id: string, principal: AuthPrincipal) {
      return act(
        id,
        principal,
        "REQUESTER",
        "SATISFY",
        (tx, target, actor, at) =>
          transition(tx, target, "AUTHORITY", actor, at, "SATISFY"),
      );
    },
    reopen(
      id: string,
      input: AuthorityComplaintReopenRequestDTO,
      principal: AuthPrincipal,
    ) {
      return act(
        id,
        principal,
        "REQUESTER",
        "REOPEN",
        async (tx, target, actor, at) => {
          await transition(tx, target, "AUTHORITY", actor, at, "REOPEN");
          if (input.reason)
            await tickets.addComment(tx, {
              complaintId: target.id,
              actor,
              side: "REQUESTER",
              type: "REOPEN_NOTE",
              content: input.reason,
            });
        },
      );
    },
  };
}

export const authorityComplaintService = createAuthorityComplaintService();
export type AuthorityComplaintService = ReturnType<
  typeof createAuthorityComplaintService
>;
