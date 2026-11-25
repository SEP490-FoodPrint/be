import { ORG_TYPES } from "../../constants/roles";
import type { AuthPrincipal } from "../../types/auth";
import {
  authorizationTransaction,
  databaseOperation,
  withSchoolTransaction,
} from "../../utils/authorization";
import { isStoredBusinessCode } from "../../utils/business-code";
import { getPrisma } from "../../utils/database";
import {
  cloudinaryEvidenceStorage,
  withStoredEvidence,
  type EvidenceStorage,
} from "../../utils/evidence-files";
import { HttpError } from "../../utils/http-error";
import { RequestValidationError } from "../../utils/request-validation";
import { listWindow, readListPage } from "../../utils/list-query";
import { withReadTransaction } from "../../utils/read-transaction";
import {
  ingredientQualityFeedbackReadScope,
  ingredientQualityFeedbackResponseScope,
  type IngredientQualityFeedbackResponseScope,
} from "../../utils/resource-access";
import {
  assertTicketAction,
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
  addCommentWithEvidence,
  mapTicketAttachments,
  mapTicketComments,
  mapTicketFields,
  queueRequesterEmail,
} from "../complaint-ticket/complaint-ticket.service";
import type {
  CreateIngredientQualityFeedbackRequest,
  FeedbackCommentBodyRequest,
  FeedbackReopenBodyRequest,
  FeedbackResolveBodyRequest,
  IngredientQualityFeedbackListQueryRequest,
  IngredientQualityFeedbackParamsRequest,
} from "./ingredient-quality-feedback.request.dto";
import type {
  FeedbackDetail,
  FeedbackList,
  FeedbackListItem,
} from "./ingredient-quality-feedback.response.dto";
import {
  ingredientQualityFeedbackRepository,
  type FeedbackDetailRow,
  type FeedbackDetailScope,
  type FeedbackListRow,
  type FeedbackLotRow,
  type FeedbackTicketTargetRow,
  type IngredientQualityFeedbackRepository,
  type IngredientQualityFeedbackTx,
} from "./ingredient-quality-feedback.repository";

const NOT_FOUND_MESSAGE = "Không tìm thấy khiếu nại trong phạm vi được phép";
const SCOPE_CHANGED_MESSAGE = "Phạm vi tài khoản đã thay đổi";
const CORRUPT_DATA_MESSAGE = "Không thể tải dữ liệu. Vui lòng thử lại sau.";
const REQUESTER_PERMISSION = "ingredient_quality_feedback.submit";
/** Chỉ chuyến giao trường đã kiểm nhận xong mới được phản ánh. */
const FEEDBACK_DELIVERY_STATUSES: readonly string[] = ["RECEIVED", "REJECTED"];

type Side = Exclude<TicketViewer, "OBSERVER">;

function assertStoredComplaintCode(code: string): string {
  // Chấp nhận mã cũ tuần tự FP-CP-… đã phát hành và mã Feistel FP-CP-NNNNN mới.
  if (!isStoredBusinessCode("CP", code)) {
    throw new HttpError(503, CORRUPT_DATA_MESSAGE);
  }
  return code;
}

function viewerOf(
  row: { senderUserId: string },
  principal: AuthPrincipal,
): TicketViewer {
  if (row.senderUserId === principal.id) return "REQUESTER";
  if (
    principal.orgType === ORG_TYPES.SUPPLIER &&
    principal.permissions.includes("ingredient_quality_feedback.respond")
  )
    return "HANDLER";
  return "OBSERVER";
}

function mapListItem(
  row: FeedbackListRow | FeedbackDetailRow,
  principal: AuthPrincipal,
  now: Date,
  latestCommentSide: "REQUESTER" | "HANDLER" | null,
): FeedbackListItem {
  const child = row.ingredientQualityFeedback;
  if (!child) throw new HttpError(503, CORRUPT_DATA_MESSAGE);
  return {
    id: row.id,
    code: assertStoredComplaintCode(row.code),
    title: row.title,
    issueType: child.issueType ?? null,
    school: {
      id: child.Delivery.School.id,
      name: child.Delivery.School.name,
      code: child.Delivery.School.code ?? null,
    },
    delivery: {
      id: child.Delivery.id,
      deliveryNo: child.Delivery.deliveryNo,
    },
    submittedAt: row.submittedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...mapTicketFields(viewerOf(row, principal), row, latestCommentSide, now),
  };
}

function mapFeedbackDetail(
  row: FeedbackDetailRow,
  lot: FeedbackLotRow | null,
  principal: AuthPrincipal,
  now: Date,
  storage: Pick<EvidenceStorage, "url">,
): FeedbackDetail {
  if (row.ingredientQualityFeedback?.ingredientLotId && lot === null) {
    throw new HttpError(503, CORRUPT_DATA_MESSAGE);
  }
  return {
    ...mapListItem(
      row,
      principal,
      now,
      row.comments.at(-1)?.authorSide ?? null,
    ),
    description: row.description,
    submittedBy: {
      id: row.senderUser.id,
      fullName: row.senderUser.fullName,
    },
    ingredientLot: lot ? { id: lot.id, lotCode: lot.lotCode } : null,
    attachments: mapTicketAttachments(row.attachments, storage),
    comments: mapTicketComments(row.comments, storage),
  };
}

function assertActorMatchesOriginal(
  current: AuthPrincipal,
  original: AuthPrincipal,
  originalScope: IngredientQualityFeedbackResponseScope,
): void {
  const currentScope = ingredientQualityFeedbackResponseScope(current);
  if (
    current.id !== original.id ||
    current.roleId !== original.roleId ||
    current.role !== original.role ||
    current.orgType !== ORG_TYPES.SUPPLIER ||
    currentScope.supplierId !== originalScope.supplierId ||
    current.schoolId !== null ||
    current.communeFoodSafetyUnitId !== null
  ) {
    throw new HttpError(403, SCOPE_CHANGED_MESSAGE);
  }
}

type TicketRun = (
  tx: IngredientQualityFeedbackTx,
  target: FeedbackTicketTargetRow,
  actor: TicketActor,
  at: Date,
) => Promise<void>;

export function createIngredientQualityFeedbackService(
  repository: IngredientQualityFeedbackRepository = ingredientQualityFeedbackRepository,
  connect = getPrisma,
  now = () => new Date(),
  tickets: ComplaintTicketRepository = complaintTicketRepository,
  storage: EvidenceStorage = cloudinaryEvidenceStorage,
) {
  async function readAndMapDetail(
    tx: IngredientQualityFeedbackTx,
    feedbackId: string,
    scope: FeedbackDetailScope,
    principal: AuthPrincipal,
    at: Date,
  ): Promise<FeedbackDetail> {
    const row = await repository.findDetail(tx, feedbackId, scope);
    if (!row?.ingredientQualityFeedback)
      throw new HttpError(404, NOT_FOUND_MESSAGE);
    const { ingredientLotId, deliveryId } = row.ingredientQualityFeedback;
    const lot =
      ingredientLotId !== null
        ? await repository.findLotInDelivery(
            tx,
            ingredientLotId,
            deliveryId,
            scope,
          )
        : null;
    return mapFeedbackDetail(row, lot, principal, at, storage);
  }

  async function transition(
    tx: IngredientQualityFeedbackTx,
    target: FeedbackTicketTargetRow,
    actor: TicketActor,
    at: Date,
    action: Exclude<TicketAction, "COMMENT">,
  ): Promise<void> {
    const rule = TICKET_TRANSITIONS[action];
    const ok = await tickets.transition(tx, {
      complaintId: target.id,
      kind: "INGREDIENT",
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

  function assertState(
    side: Side,
    target: FeedbackTicketTargetRow,
    action: TicketAction,
    at: Date,
  ): void {
    assertTicketAction(
      side,
      {
        status: toTicketStatus(target.status),
        lastResolvedAt: target.lastResolvedAt,
      },
      action,
      at,
    );
  }

  /** Bên xử lý là NCC của chuyến giao: giữ thứ tự khóa và kiểm tra lại actor trước/sau khóa. */
  async function supplierAct(
    params: IngredientQualityFeedbackParamsRequest,
    principal: AuthPrincipal,
    action: TicketAction,
    run: TicketRun,
  ): Promise<FeedbackDetail> {
    const originalScope = ingredientQualityFeedbackResponseScope(principal);
    const db = await databaseOperation(() => connect());
    return authorizationTransaction(db, async (tx) => {
      const initialActor = await repository.readActor(tx, principal.id);
      assertActorMatchesOriginal(initialActor, principal, originalScope);

      const metadata = await repository.findResponseMetadata(
        tx,
        params.feedbackId,
        originalScope,
      );
      await repository.lockResponseContext(tx, originalScope, {
        feedbackId: params.feedbackId,
        actorUserId: principal.id,
        actorRoleId: principal.roleId,
        schoolId: metadata?.schoolId,
        deliveryId: metadata?.deliveryId,
      });

      const currentActor = await repository.readActor(tx, principal.id);
      assertActorMatchesOriginal(currentActor, principal, originalScope);

      if (!metadata) throw new HttpError(404, NOT_FOUND_MESSAGE);

      const target = await repository.findSupplierTarget(
        tx,
        params.feedbackId,
        originalScope,
      );
      if (!target) throw new HttpError(404, NOT_FOUND_MESSAGE);
      if (
        target.deliveryId !== metadata.deliveryId ||
        target.schoolId !== metadata.schoolId
      ) {
        throw new HttpError(503, CORRUPT_DATA_MESSAGE);
      }
      const at = now();
      assertState("HANDLER", target, action, at);
      await run(
        tx,
        target,
        { userId: currentActor.id, roleCode: currentActor.role },
        at,
      );
      return readAndMapDetail(
        tx,
        params.feedbackId,
        { kind: "SUPPLIER", supplierId: originalScope.supplierId },
        currentActor,
        at,
      );
    });
  }

  /** Người gửi là tài khoản trường đã gửi đơn: nạp lại actor + khóa trường trong transaction. */
  async function requesterAct(
    params: IngredientQualityFeedbackParamsRequest,
    principal: AuthPrincipal,
    action: TicketAction,
    run: TicketRun,
  ): Promise<FeedbackDetail> {
    if (principal.orgType !== ORG_TYPES.SCHOOL)
      throw new HttpError(403, "Chỉ người gửi đơn được thực hiện thao tác này");
    return withSchoolTransaction(
      await databaseOperation(() => connect()),
      principal,
      REQUESTER_PERMISSION,
      async (tx, actor, schoolId) => {
        const readScope = ingredientQualityFeedbackReadScope(actor, "detail");
        const target = await repository.findRequesterTarget(
          tx,
          params.feedbackId,
          { schoolId, senderUserId: actor.id },
        );
        if (!target) throw new HttpError(404, NOT_FOUND_MESSAGE);
        const at = now();
        assertState("REQUESTER", target, action, at);
        await run(tx, target, { userId: actor.id, roleCode: actor.role }, at);
        return readAndMapDetail(tx, params.feedbackId, readScope, actor, at);
      },
    );
  }

  return {
    /** Tài khoản trường có quyền gửi phản ánh chuyến giao (tùy chọn lô) của trường mình. */
    async create(
      body: CreateIngredientQualityFeedbackRequest,
      principal: AuthPrincipal,
    ): Promise<FeedbackDetail> {
      const db = await databaseOperation(() => connect());
      return withStoredEvidence(storage, body.files, principal.id, (files) =>
        withSchoolTransaction(
          db,
          principal,
          REQUESTER_PERMISSION,
          async (tx, actor, schoolId) => {
            const readScope = ingredientQualityFeedbackReadScope(
              actor,
              "detail",
            );
            const delivery = await repository.findDeliveryForFeedback(
              tx,
              body.deliveryId,
              schoolId,
            );
            if (!delivery)
              throw new HttpError(
                404,
                "Không tìm thấy chuyến giao trong phạm vi được phép",
              );
            if (!FEEDBACK_DELIVERY_STATUSES.includes(delivery.status))
              throw new HttpError(
                409,
                "Chỉ phản ánh được chuyến giao đã nhận hoặc đã từ chối",
              );
            const ingredientLotId = body.ingredientLotId ?? null;
            if (
              ingredientLotId !== null &&
              !(await repository.findLotInDelivery(
                tx,
                ingredientLotId,
                delivery.id,
                readScope,
              ))
            )
              throw new RequestValidationError([
                {
                  field: "ingredientLotId",
                  message: "Lô nguyên liệu không thuộc chuyến giao đã chọn",
                },
              ]);
            const created = await repository.create(tx, {
              code: await tickets.allocateCode(tx, "CP"),
              title: body.title,
              description: body.description,
              senderUserId: actor.id,
              senderRoleCode: actor.role,
              senderSchoolId: schoolId,
              deliveryId: delivery.id,
              ingredientLotId,
              issueType: body.issueType,
            });
            await tickets.addAttachments(tx, {
              complaintId: created.id,
              commentId: null,
              uploaderUserId: actor.id,
              side: "REQUESTER",
              files,
            });
            await tickets.recordCreated(tx, created.id, {
              userId: actor.id,
              roleCode: actor.role,
            });
            await queueRequesterEmail(tx, tickets, created.id, "CREATED");
            return readAndMapDetail(tx, created.id, readScope, actor, now());
          },
        ),
      );
    },
    async getAll(
      query: IngredientQualityFeedbackListQueryRequest,
      principal: AuthPrincipal,
    ): Promise<FeedbackList> {
      const scope = ingredientQualityFeedbackReadScope(principal, "list");
      const { skip, take } = listWindow(query);
      const page = await readListPage(
        () => repository.list(scope, skip, take),
        query,
      );
      const at = now();
      return {
        items: page.items.map((row) =>
          mapListItem(row, principal, at, row.comments[0]?.authorSide ?? null),
        ),
        pagination: page.pagination,
      };
    },
    async getDetail(
      params: IngredientQualityFeedbackParamsRequest,
      principal: AuthPrincipal,
    ): Promise<FeedbackDetail> {
      const scope = ingredientQualityFeedbackReadScope(principal, "detail");
      return withReadTransaction(
        (tx) =>
          readAndMapDetail(tx, params.feedbackId, scope, principal, now()),
        connect,
      );
    },
    accept(
      params: IngredientQualityFeedbackParamsRequest,
      principal: AuthPrincipal,
    ): Promise<FeedbackDetail> {
      return supplierAct(params, principal, "ACCEPT", (tx, target, actor, at) =>
        transition(tx, target, actor, at, "ACCEPT"),
      );
    },
    resolve(
      params: IngredientQualityFeedbackParamsRequest,
      body: FeedbackResolveBodyRequest,
      principal: AuthPrincipal,
    ): Promise<FeedbackDetail> {
      return withStoredEvidence(storage, body.files, principal.id, (files) =>
        supplierAct(
          params,
          principal,
          "RESOLVE",
          async (tx, target, actor, at) => {
            await transition(tx, target, actor, at, "RESOLVE");
            await addCommentWithEvidence(tx, tickets, {
              complaintId: target.id,
              actor,
              side: "HANDLER",
              type: "RESOLUTION",
              content: body.content,
              files,
            });
            await queueRequesterEmail(tx, tickets, target.id, "RESOLVED");
          },
        ),
      );
    },
    comment(
      params: IngredientQualityFeedbackParamsRequest,
      body: FeedbackCommentBodyRequest,
      principal: AuthPrincipal,
    ): Promise<FeedbackDetail> {
      const side: Side =
        principal.orgType === ORG_TYPES.SUPPLIER ? "HANDLER" : "REQUESTER";
      return withStoredEvidence(storage, body.files, principal.id, (files) => {
        const run: TicketRun = async (tx, target, actor) => {
          await addCommentWithEvidence(tx, tickets, {
            complaintId: target.id,
            actor,
            side,
            type: "MESSAGE",
            content: body.content,
            files,
          });
          if (side === "HANDLER")
            await queueRequesterEmail(
              tx,
              tickets,
              target.id,
              "HANDLER_COMMENT",
            );
        };
        return side === "HANDLER"
          ? supplierAct(params, principal, "COMMENT", run)
          : requesterAct(params, principal, "COMMENT", run);
      });
    },
    satisfy(
      params: IngredientQualityFeedbackParamsRequest,
      principal: AuthPrincipal,
    ): Promise<FeedbackDetail> {
      return requesterAct(
        params,
        principal,
        "SATISFY",
        (tx, target, actor, at) => transition(tx, target, actor, at, "SATISFY"),
      );
    },
    reopen(
      params: IngredientQualityFeedbackParamsRequest,
      body: FeedbackReopenBodyRequest,
      principal: AuthPrincipal,
    ): Promise<FeedbackDetail> {
      return requesterAct(
        params,
        principal,
        "REOPEN",
        async (tx, target, actor, at) => {
          await transition(tx, target, actor, at, "REOPEN");
          if (body.reason)
            await tickets.addComment(tx, {
              complaintId: target.id,
              actor,
              side: "REQUESTER",
              type: "REOPEN_NOTE",
              content: body.reason,
            });
        },
      );
    },
  };
}

export const ingredientQualityFeedbackService =
  createIngredientQualityFeedbackService();
export type IngredientQualityFeedbackService = ReturnType<
  typeof createIngredientQualityFeedbackService
>;
