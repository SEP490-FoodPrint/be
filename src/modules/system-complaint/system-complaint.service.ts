import { ORG_TYPES, ROLES } from "../../constants/roles";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import {
  authorizationTransaction,
  loadPrincipal,
} from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import { listScopes } from "../../utils/resource-access";
import {
  assertTicketAction,
  feedbackWindowStart,
  systemComplaintTitle,
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
  createSystemComplaintRepository,
  type SystemComplaintDetailRow,
  type SystemComplaintRepository,
  type SystemComplaintRow,
  type SystemComplaintTicketTarget,
} from "./system-complaint.repository";
import type {
  CreateSystemComplaintRequestDTO,
  SystemComplaintCommentRequestDTO,
  SystemComplaintListQueryDTO,
  SystemComplaintReopenRequestDTO,
  SystemComplaintResolveRequestDTO,
} from "./system-complaint.request.dto";
import type {
  SystemComplaintDetailResponseDTO,
  SystemComplaintListResponseDTO,
  SystemComplaintOrganizationDTO,
  SystemComplaintResponseDTO,
} from "./system-complaint.response.dto";

const NOT_FOUND = "Không tìm thấy khiếu nại gửi tới hệ thống";
const CORRUPT_DATA = "Không thể tải dữ liệu. Vui lòng thử lại sau.";
const FORBIDDEN_ACTION = "Vai trò không được phép thực hiện thao tác này";

type Side = Exclude<TicketViewer, "OBSERVER">;

/** Bên xử lý: System Admin có đồng thời quyền xem và quyền xử lý (FR-007). */
function isHandler(principal: AuthPrincipal): boolean {
  return (
    principal.orgType === ORG_TYPES.SYSTEM &&
    principal.role === ROLES.SYSTEM_ADMIN &&
    principal.permissions.includes("system_complaint.view") &&
    principal.permissions.includes("system_complaint.respond")
  );
}

/** Người gửi: mọi vai trò ngoài System Admin, có quyền gửi (FR-004, FR-008). */
function isRequester(principal: AuthPrincipal): boolean {
  return (
    principal.orgType !== ORG_TYPES.SYSTEM &&
    principal.role !== ROLES.SYSTEM_ADMIN &&
    principal.permissions.includes("system_complaint.submit")
  );
}

function sideOf(principal: AuthPrincipal): Side {
  if (isHandler(principal)) return "HANDLER";
  if (isRequester(principal)) return "REQUESTER";
  throw new HttpError(403, FORBIDDEN_ACTION);
}

function viewerOf(
  row: { senderUserId: string },
  principal: AuthPrincipal,
): TicketViewer {
  if (row.senderUserId === principal.id) return "REQUESTER";
  return isHandler(principal) ? "HANDLER" : "OBSERVER";
}

/** Đúng một tổ chức theo loại tổ chức của người gửi; không tự gán khi thiếu (Edge Cases). */
function senderOrganizationOf(actor: AuthPrincipal) {
  const none = {
    senderSchoolId: null,
    senderSupplierId: null,
    senderCommuneFoodSafetyUnitId: null,
  };
  if (actor.orgType === ORG_TYPES.SCHOOL && actor.schoolId)
    return { ...none, senderSchoolId: actor.schoolId };
  if (actor.orgType === ORG_TYPES.SUPPLIER && actor.supplierId)
    return { ...none, senderSupplierId: actor.supplierId };
  if (actor.orgType === ORG_TYPES.AUTHORITY && actor.communeFoodSafetyUnitId)
    return {
      ...none,
      senderCommuneFoodSafetyUnitId: actor.communeFoodSafetyUnitId,
    };
  throw new HttpError(
    403,
    "Tài khoản chưa gắn tổ chức hợp lệ để gửi khiếu nại",
  );
}

function organizationOf(
  row: SystemComplaintRow | SystemComplaintDetailRow,
): SystemComplaintOrganizationDTO | null {
  if (row.senderSchool) return { type: "SCHOOL", ...row.senderSchool };
  if (row.senderSupplier) return { type: "SUPPLIER", ...row.senderSupplier };
  if (row.senderCommuneFoodSafetyUnit)
    return { type: "AUTHORITY", ...row.senderCommuneFoodSafetyUnit };
  return null;
}

function toResponse(
  row: SystemComplaintRow | SystemComplaintDetailRow,
  principal: AuthPrincipal,
  now: Date,
  latestCommentSide: "REQUESTER" | "HANDLER" | null,
): SystemComplaintResponseDTO {
  const child = row.systemComplaint;
  if (!child) throw new HttpError(503, CORRUPT_DATA);
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    category: child.category,
    description: row.description,
    submittedAt: row.submittedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    sender: { id: row.senderUser.id, fullName: row.senderUser.fullName },
    senderRole: { code: row.senderRole.code, name: row.senderRole.name },
    senderOrganization: organizationOf(row),
    ...mapTicketFields(viewerOf(row, principal), row, latestCommentSide, now),
  };
}

function toDetail(
  row: SystemComplaintDetailRow,
  principal: AuthPrincipal,
  now: Date,
): SystemComplaintDetailResponseDTO {
  return {
    ...toResponse(row, principal, now, row.comments.at(-1)?.authorSide ?? null),
    comments: row.comments.map(mapTicketComment),
  };
}

export function createSystemComplaintService(
  repository: SystemComplaintRepository = createSystemComplaintRepository(),
  connect: () => Promise<PrismaClient> = getPrisma,
  now = () => new Date(),
  tickets: ComplaintTicketRepository = complaintTicketRepository,
) {
  /**
   * Khung chung cho thao tác ticket: nạp lại actor trong transaction, kiểm tra vai trò/quyền/phạm vi/trạng thái,
   * chạy thao tác rồi đọc lại chi tiết bằng cùng transaction.
   */
  async function act(
    id: string,
    principal: AuthPrincipal,
    side: Side,
    action: TicketAction,
    run: (
      tx: Prisma.TransactionClient,
      target: SystemComplaintTicketTarget,
      actor: TicketActor,
      at: Date,
    ) => Promise<void>,
  ): Promise<SystemComplaintDetailResponseDTO> {
    if (sideOf(principal) !== side) throw new HttpError(403, FORBIDDEN_ACTION);
    return authorizationTransaction(await connect(), async (tx) => {
      const actor = await loadPrincipal(principal.id, tx);
      if (sideOf(actor) !== side)
        throw new HttpError(403, "Phạm vi tài khoản đã thay đổi");
      const scope = listScopes["system-complaint"](actor);
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
    target: SystemComplaintTicketTarget,
    actor: TicketActor,
    at: Date,
    action: Exclude<TicketAction, "COMMENT">,
  ) {
    const rule = TICKET_TRANSITIONS[action];
    const ok = await tickets.transition(tx, {
      complaintId: target.id,
      kind: "SYSTEM",
      fromStatus: toTicketStatus(target.status),
      toStatus: rule.to,
      actor,
      now: at,
      markResolved: action === "RESOLVE",
      ...("closeReason" in rule ? { closeReason: rule.closeReason } : {}),
      ...(action === "SATISFY" || action === "REOPEN"
        ? { resolvedAfter: feedbackWindowStart(at) }
        : {}),
    });
    if (!ok) throw new HttpError(409, ticketConflictMessage(action));
  }

  return {
    async getAll(
      query: SystemComplaintListQueryDTO,
      principal: AuthPrincipal,
    ): Promise<SystemComplaintListResponseDTO> {
      const rows = await repository.list(
        await connect(),
        listScopes["system-complaint"](principal),
        query,
      );
      const at = now();
      return {
        items: rows
          .slice(0, query.limit)
          .map((row) =>
            toResponse(row, principal, at, row.comments[0]?.authorSide ?? null),
          ),
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
    ): Promise<SystemComplaintDetailResponseDTO> {
      const row = await repository.findOne(
        await connect(),
        listScopes["system-complaint"](principal),
        id,
      );
      if (!row) throw new HttpError(404, NOT_FOUND);
      return toDetail(row, principal, now());
    },
    async create(
      input: CreateSystemComplaintRequestDTO,
      principal: AuthPrincipal,
    ): Promise<SystemComplaintDetailResponseDTO> {
      if (!isRequester(principal))
        throw new HttpError(
          403,
          "Vai trò không được phép gửi khiếu nại tới hệ thống",
        );
      const expected = senderOrganizationOf(principal);
      return authorizationTransaction(await connect(), async (tx) => {
        const actor = await loadPrincipal(principal.id, tx);
        if (!isRequester(actor))
          throw new HttpError(403, "Phạm vi tài khoản đã thay đổi");
        const organization = senderOrganizationOf(actor);
        if (
          organization.senderSchoolId !== expected.senderSchoolId ||
          organization.senderSupplierId !== expected.senderSupplierId ||
          organization.senderCommuneFoodSafetyUnitId !==
            expected.senderCommuneFoodSafetyUnitId
        )
          throw new HttpError(403, "Phạm vi tài khoản đã thay đổi");
        const code = await tickets.allocateCode(tx, "SC");
        const created = await repository.create(tx, {
          code,
          title: systemComplaintTitle(input.category),
          description: input.description,
          category: input.category,
          senderUserId: actor.id,
          senderRoleCode: actor.role,
          ...organization,
        });
        const ticketActor = { userId: actor.id, roleCode: actor.role };
        await tickets.recordCreated(tx, created.id, ticketActor);
        const row = await repository.findOne(
          tx,
          listScopes["system-complaint"](actor),
          created.id,
        );
        if (!row) throw new HttpError(503, CORRUPT_DATA);
        return toDetail(row, actor, now());
      });
    },
    accept(id: string, principal: AuthPrincipal) {
      return act(id, principal, "HANDLER", "ACCEPT", (tx, target, actor, at) =>
        transition(tx, target, actor, at, "ACCEPT"),
      );
    },
    comment(
      id: string,
      input: SystemComplaintCommentRequestDTO,
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
      input: SystemComplaintResolveRequestDTO,
      principal: AuthPrincipal,
    ) {
      return act(
        id,
        principal,
        "HANDLER",
        "RESOLVE",
        async (tx, target, actor, at) => {
          await transition(tx, target, actor, at, "RESOLVE");
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
        (tx, target, actor, at) => transition(tx, target, actor, at, "SATISFY"),
      );
    },
    reopen(
      id: string,
      input: SystemComplaintReopenRequestDTO,
      principal: AuthPrincipal,
    ) {
      return act(
        id,
        principal,
        "REQUESTER",
        "REOPEN",
        async (tx, target, actor, at) => {
          await transition(tx, target, actor, at, "REOPEN");
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

export const systemComplaintService = createSystemComplaintService();
export type SystemComplaintService = ReturnType<
  typeof createSystemComplaintService
>;
