import { ORG_TYPES, ROLES } from "../../constants/roles";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import {
  assertPermission,
  withSchoolTransaction,
} from "../../utils/authorization";
import { currentAcademicYear } from "../class/academic-year";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import { isComplaintSubmitter, listScopes } from "../../utils/resource-access";
import {
  assertTicketAction,
  feedbackWindowStart,
  mealComplaintTitle,
  ticketConflictMessage,
  ticketStatusFilter,
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
  queueRequesterEmail,
} from "../complaint-ticket/complaint-ticket.service";
import {
  createFeedbackRepository,
  type ComplaintDetailRow,
  type ComplaintRow,
  type ComplaintTicketTarget,
  type FeedbackRepository,
} from "./feedback.repository";
import type {
  ComplaintCommentRequestDTO,
  ComplaintListQueryDTO,
  ComplaintReopenRequestDTO,
  ComplaintResolveRequestDTO,
  CreateComplaintRequestDTO,
} from "./feedback.request.dto";
import type {
  ComplaintDetailResponseDTO,
  ComplaintListResponseDTO,
  ComplaintMealOptionsDTO,
  ComplaintResponseDTO,
} from "./feedback.response.dto";

const NOT_FOUND = "Không tìm thấy khiếu nại";
const CORRUPT_DATA = "Không thể tải dữ liệu. Vui lòng thử lại sau.";

type Side = Exclude<TicketViewer, "OBSERVER">;

function isHandler(principal: AuthPrincipal): boolean {
  return (
    principal.orgType === ORG_TYPES.SCHOOL &&
    principal.role === ROLES.SCHOOL_MANAGEMENT_BOARD &&
    principal.permissions.includes("meal_complaint.respond")
  );
}

function viewerOf(
  row: { senderUserId: string },
  principal: AuthPrincipal,
): TicketViewer {
  if (row.senderUserId === principal.id) return "REQUESTER";
  return isHandler(principal) ? "HANDLER" : "OBSERVER";
}

/** "Chuyển ATTP" chỉ có ở C03: người gửi là phụ huynh và có quyền chuyển (specs/authority-complaints). */
function canEscalate(
  row: { senderUserId: string; senderRoleCode: string },
  principal: AuthPrincipal,
): boolean {
  return (
    row.senderUserId === principal.id &&
    row.senderRoleCode === ROLES.PARENTS_COMMITTEE &&
    principal.role === ROLES.PARENTS_COMMITTEE &&
    principal.permissions.includes("authority_complaint.submit")
  );
}

function toResponse(
  row: ComplaintRow | ComplaintDetailRow,
  principal: AuthPrincipal,
  now: Date,
  latestCommentSide: "REQUESTER" | "HANDLER" | null,
): ComplaintResponseDTO {
  const child = row.mealComplaint;
  if (!child) throw new HttpError(503, CORRUPT_DATA);
  const portion = child.DailyMealPortion;
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    complaintType: child.complaintType,
    description: row.description,
    submittedAt: row.submittedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    submitter: row.senderUser,
    meal: {
      dailyMealPortionId: portion.id,
      allocationId: portion.MealAllocation?.id ?? null,
      allocationStatus: portion.MealAllocation?.status ?? null,
      classId: portion.Class.id,
      className: portion.Class.name,
      academicYear: portion.Class.academicYear,
      mealDate: portion.mealDate.toISOString().slice(0, 10),
      mealType: portion.mealType,
    },
    // Chỉ người gửi thấy hồ sơ C05 đã chuyển; BGH không xem thông tin leo thang (specs/board-escalation-view FR-002).
    escalatedAuthorityComplaint:
      child.authorityEscalation && row.senderUserId === principal.id
        ? {
            id: child.authorityEscalation.id,
            code: child.authorityEscalation.Complaint.code,
          }
        : null,
    ...mapTicketFields(viewerOf(row, principal), row, latestCommentSide, now, {
      canEscalate: canEscalate(row, principal),
    }),
  };
}

function toListItem(
  row: ComplaintRow,
  principal: AuthPrincipal,
  now: Date,
): ComplaintResponseDTO {
  return toResponse(row, principal, now, row.comments[0]?.authorSide ?? null);
}

function toDetail(
  row: ComplaintDetailRow,
  principal: AuthPrincipal,
  now: Date,
): ComplaintDetailResponseDTO {
  return {
    ...toResponse(row, principal, now, row.comments.at(-1)?.authorSide ?? null),
    comments: row.comments.map(mapTicketComment),
  };
}

export function createFeedbackService(
  repository: FeedbackRepository = createFeedbackRepository(),
  connect: () => Promise<PrismaClient> = getPrisma,
  now = () => new Date(),
  tickets: ComplaintTicketRepository = complaintTicketRepository,
) {
  const formatDate = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Ho_Chi_Minh",
  });
  async function readMealOptions(
    db: Parameters<FeedbackRepository["findMealOptions"]>[0],
    principal: AuthPrincipal,
  ): Promise<ComplaintMealOptionsDTO> {
    assertPermission(principal, "meal_complaint.submit");
    if (
      principal.orgType !== ORG_TYPES.SCHOOL ||
      !principal.schoolId ||
      !isComplaintSubmitter(principal.role)
    )
      throw new HttpError(403, "Vai trò không được phép gửi khiếu nại");
    const timestamp = now();
    const mealDate = formatDate.format(timestamp);
    const teacher =
      principal.role === ROLES.HOMEROOM_TEACHER
        ? {
            id: principal.id,
            academicYear: currentAcademicYear(timestamp),
            now: timestamp,
          }
        : undefined;
    const classes = await repository.findMealOptions(
      db,
      principal.schoolId,
      new Date(mealDate),
      teacher,
    );
    if (teacher && classes.length !== 1)
      throw new HttpError(
        classes.length ? 409 : 404,
        classes.length
          ? "Phân công chủ nhiệm đang có mâu thuẫn"
          : "Chưa có phân công chủ nhiệm trong niên khóa hiện tại",
      );
    return {
      mealDate,
      classes: classes.map((item) => {
        const option = (mealType: "LUNCH" | "AFTERNOON") => {
          const portion = item.dailyMealPortions.find(
            (row) => row.mealType === mealType,
          );
          const status = portion?.MealAllocation?.status;
          return portion
            ? {
                dailyMealPortionId: portion.id,
                canComplain: status === "DISTRIBUTED" || status === "FINALIZED",
              }
            : null;
        };
        return {
          classId: item.id,
          className: item.name,
          lunch: option("LUNCH"),
          afternoon: option("AFTERNOON"),
        };
      }),
    };
  }

  function sideOf(principal: AuthPrincipal): Side {
    if (
      principal.orgType === ORG_TYPES.SCHOOL &&
      principal.role === ROLES.SCHOOL_MANAGEMENT_BOARD
    )
      return "HANDLER";
    if (
      principal.orgType === ORG_TYPES.SCHOOL &&
      isComplaintSubmitter(principal.role)
    )
      return "REQUESTER";
    throw new HttpError(403, "Vai trò không được phép thao tác khiếu nại");
  }

  /**
   * Khung chung cho thao tác ticket: nạp lại actor trong transaction, kiểm tra vai trò/phạm vi/trạng thái,
   * chạy thao tác rồi đọc lại chi tiết bằng cùng transaction.
   */
  async function act(
    id: string,
    principal: AuthPrincipal,
    side: Side,
    action: TicketAction,
    run: (
      tx: Prisma.TransactionClient,
      target: ComplaintTicketTarget,
      actor: TicketActor,
      at: Date,
    ) => Promise<void>,
  ): Promise<ComplaintDetailResponseDTO> {
    if (sideOf(principal) !== side)
      throw new HttpError(
        403,
        "Vai trò không được phép thực hiện thao tác này",
      );
    const permission =
      side === "HANDLER" ? "meal_complaint.respond" : "meal_complaint.submit";
    return withSchoolTransaction(
      await connect(),
      principal,
      permission,
      async (tx, actor) => {
        if (sideOf(actor) !== side)
          throw new HttpError(403, "Phạm vi tài khoản đã thay đổi");
        const scope = listScopes.feedback(actor);
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
      },
    );
  }

  async function transition(
    tx: Prisma.TransactionClient,
    target: ComplaintTicketTarget,
    actor: TicketActor,
    at: Date,
    action: Exclude<TicketAction, "COMMENT">,
  ) {
    const rule = TICKET_TRANSITIONS[action];
    const ok = await tickets.transition(tx, {
      complaintId: target.id,
      kind: "MEAL",
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
    async mealOptions(principal: AuthPrincipal) {
      return readMealOptions(await connect(), principal);
    },
    async getAll(
      query: ComplaintListQueryDTO,
      principal: AuthPrincipal,
    ): Promise<ComplaintListResponseDTO> {
      const scope = listScopes.feedback(principal);
      // Phụ huynh/GVCN chỉ xem đơn mình gửi (listScopes.feedback): lọc theo trạng thái hiển thị.
      const statuses = ticketStatusFilter(
        query.status,
        principal.orgType === ORG_TYPES.SCHOOL &&
          isComplaintSubmitter(principal.role),
      );
      const rows = await repository.list(
        await connect(),
        scope,
        query,
        statuses,
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
    async getOne(id: string, principal: AuthPrincipal) {
      const row = await repository.findOne(
        await connect(),
        listScopes.feedback(principal),
        id,
      );
      if (!row) throw new HttpError(404, NOT_FOUND);
      return toDetail(row, principal, now());
    },
    async create(input: CreateComplaintRequestDTO, principal: AuthPrincipal) {
      if (!isComplaintSubmitter(principal.role))
        throw new HttpError(403, "Vai trò không được phép gửi khiếu nại");
      return withSchoolTransaction(
        await connect(),
        principal,
        "meal_complaint.submit",
        async (tx, actor, schoolId) => {
          const options = await readMealOptions(tx, actor);
          const match = options.classes
            .flatMap((item) =>
              [item.lunch, item.afternoon].map((option, index) => ({
                option,
                className: item.className,
                mealType: index === 0 ? "LUNCH" : "AFTERNOON",
              })),
            )
            .find(
              ({ option }) =>
                option?.dailyMealPortionId === input.dailyMealPortionId,
            );
          if (!match?.option)
            throw new HttpError(
              404,
              "Suất ăn không thuộc phạm vi được gửi hôm nay",
            );
          if (!match.option.canComplain)
            throw new HttpError(409, "Bữa ăn chưa được xác nhận giao");
          const code = await tickets.allocateCode(tx, "MC");
          const created = await repository.create(tx, {
            code,
            title: mealComplaintTitle({
              className: match.className,
              mealType: match.mealType,
              mealDate: new Date(`${options.mealDate}T00:00:00.000Z`),
            }),
            description: input.description,
            senderUserId: actor.id,
            senderRoleCode: actor.role,
            schoolId,
            dailyMealPortionId: input.dailyMealPortionId,
            complaintType: input.complaintType,
          });
          await tickets.recordCreated(tx, created.id, {
            userId: actor.id,
            roleCode: actor.role,
          });
          await queueRequesterEmail(tx, tickets, created.id, "CREATED");
          const row = await repository.findOne(
            tx,
            listScopes.feedback(actor),
            created.id,
          );
          if (!row) throw new HttpError(503, CORRUPT_DATA);
          return toDetail(row, actor, now());
        },
      );
    },
    accept(id: string, principal: AuthPrincipal) {
      return act(id, principal, "HANDLER", "ACCEPT", (tx, target, actor, at) =>
        transition(tx, target, actor, at, "ACCEPT"),
      );
    },
    comment(
      id: string,
      input: ComplaintCommentRequestDTO,
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
        if (side === "HANDLER")
          await queueRequesterEmail(tx, tickets, target.id, "HANDLER_COMMENT");
      });
    },
    resolve(
      id: string,
      input: ComplaintResolveRequestDTO,
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
          await queueRequesterEmail(tx, tickets, target.id, "RESOLVED");
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
      input: ComplaintReopenRequestDTO,
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
export const feedbackService = createFeedbackService();
export type FeedbackService = ReturnType<typeof createFeedbackService>;
