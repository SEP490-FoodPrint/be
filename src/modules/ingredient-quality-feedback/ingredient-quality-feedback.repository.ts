import type { Prisma } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import {
  identitySelect,
  principalFromIdentity,
} from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import type {
  IngredientQualityFeedbackDetailScope,
  IngredientQualityFeedbackReadScope,
  IngredientQualityFeedbackResponseScope,
} from "../../utils/resource-access";
import { createIntakeAccessRepository } from "../account-lifecycle/intake-access.repository";
import {
  complaintTicketRepository,
  latestCommentSideSelect,
  ticketCommentsArgs,
} from "../complaint-ticket/complaint-ticket.repository";

export type IngredientQualityFeedbackTx = Prisma.TransactionClient;

export type FeedbackReadScope = IngredientQualityFeedbackReadScope;
export type FeedbackDetailScope = IngredientQualityFeedbackDetailScope;
export type SupplierResponseScope = IngredientQualityFeedbackResponseScope;

export interface FeedbackResponseMetadataRow {
  id: string;
  deliveryId: string;
  schoolId: string;
}

/** Trạng thái hiện tại của đơn để kiểm tra thao tác ticket trong transaction. */
export interface FeedbackTicketTargetRow {
  id: string;
  deliveryId: string;
  schoolId: string;
  status: string;
  senderUserId: string;
  lastResolvedAt: Date | null;
}

export interface ResponseLockContext {
  feedbackId: string;
  actorUserId: string;
  actorRoleId: string;
  schoolId?: string;
  deliveryId?: string;
}

const FEEDBACK_RESPONSE_PERMISSION_CODES = [
  "ingredient_quality_feedback.view_details",
  "ingredient_quality_feedback.respond",
] as const;

const parentLocks = createIntakeAccessRepository();

const deliveryRefSelect = {
  id: true,
  deliveryNo: true,
  School: { select: { id: true, name: true, code: true } },
} as const satisfies Prisma.DeliverySelect;

const feedbackListSelect = {
  id: true,
  code: true,
  title: true,
  status: true,
  senderUserId: true,
  lastResolvedAt: true,
  resolvedCount: true,
  closeReason: true,
  closedAt: true,
  submittedAt: true,
  updatedAt: true,
  ingredientQualityFeedback: {
    select: {
      deliveryId: true,
      ingredientLotId: true,
      Delivery: { select: deliveryRefSelect },
    },
  },
  comments: latestCommentSideSelect,
} as const satisfies Prisma.ComplaintSelect;

export type FeedbackListRow = Prisma.ComplaintGetPayload<{
  select: typeof feedbackListSelect;
}>;

const feedbackDetailSelect = {
  ...feedbackListSelect,
  description: true,
  senderUser: { select: { id: true, fullName: true } },
  comments: ticketCommentsArgs,
} as const satisfies Prisma.ComplaintSelect;

export type FeedbackDetailRow = Prisma.ComplaintGetPayload<{
  select: typeof feedbackDetailSelect;
}>;

const feedbackLotSelect = {
  id: true,
  lotCode: true,
} as const satisfies Prisma.IngredientLotSelect;

export type FeedbackLotRow = Prisma.IngredientLotGetPayload<{
  select: typeof feedbackLotSelect;
}>;

/** Áp phạm vi tin cậy (do service xác lập từ AuthPrincipal) lên bảng cha `complaints`. */
function scopeWhere(scope: FeedbackReadScope): Prisma.ComplaintWhereInput {
  if (scope.kind === "SYSTEM") return { kind: "INGREDIENT" };
  if (scope.kind === "SUPPLIER")
    return {
      kind: "INGREDIENT",
      ingredientQualityFeedback: {
        is: { Delivery: { supplierId: scope.supplierId } },
      },
    };
  return {
    kind: "INGREDIENT",
    ingredientQualityFeedback: {
      is: { Delivery: { schoolId: scope.schoolId } },
    },
    ...(scope.submittedByUserId
      ? { senderUserId: scope.submittedByUserId }
      : {}),
  };
}

function toTarget(
  row: {
    id: string;
    status: string;
    senderUserId: string;
    lastResolvedAt: Date | null;
    ingredientQualityFeedback: {
      deliveryId: string;
      Delivery: { schoolId: string };
    } | null;
  } | null,
): FeedbackTicketTargetRow | null {
  if (!row?.ingredientQualityFeedback) return null;
  return {
    id: row.id,
    status: row.status,
    senderUserId: row.senderUserId,
    lastResolvedAt: row.lastResolvedAt,
    deliveryId: row.ingredientQualityFeedback.deliveryId,
    schoolId: row.ingredientQualityFeedback.Delivery.schoolId,
  };
}

const ticketTargetSelect = {
  id: true,
  status: true,
  senderUserId: true,
  lastResolvedAt: true,
  ingredientQualityFeedback: {
    select: { deliveryId: true, Delivery: { select: { schoolId: true } } },
  },
} as const satisfies Prisma.ComplaintSelect;

export function createIngredientQualityFeedbackRepository(connect = getPrisma) {
  return {
    /**
     * Cấp mã khiếu nại mới FP-CP-NNNNN (hậu tố Feistel) trong cùng transaction tạo.
     * Mã đã có ở bảng cha (kể cả mã tuần tự cũ) không bị cấp trùng.
     */
    allocateComplaintCode(tx: IngredientQualityFeedbackTx): Promise<string> {
      return complaintTicketRepository.allocateCode(tx, "CP");
    },
    /** Tạo bản ghi cha `complaints` + bản ghi con `ingredient_quality_feedback` (producer dùng chung, PR3 gắn HTTP). */
    create(
      tx: IngredientQualityFeedbackTx,
      data: {
        code: string;
        title: string;
        description: string;
        senderUserId: string;
        senderRoleCode: string;
        senderSchoolId: string;
        deliveryId: string;
        ingredientLotId: string | null;
      },
    ): Promise<{ id: string }> {
      return tx.complaint.create({
        data: {
          kind: "INGREDIENT",
          code: data.code,
          title: data.title,
          description: data.description,
          senderUserId: data.senderUserId,
          senderRoleCode: data.senderRoleCode,
          senderSchoolId: data.senderSchoolId,
          status: "NEW",
          ingredientQualityFeedback: {
            create: {
              deliveryId: data.deliveryId,
              ingredientLotId: data.ingredientLotId,
            },
          },
        },
        select: { id: true },
      });
    },
    /** Chuyến giao thuộc trường của người gửi (phạm vi tin cậy do service xác lập). */
    findDeliveryForFeedback(
      tx: IngredientQualityFeedbackTx,
      deliveryId: string,
      schoolId: string,
    ): Promise<{ id: string; deliveryNo: string; status: string } | null> {
      return tx.delivery.findFirst({
        where: { id: deliveryId, schoolId },
        select: { id: true, deliveryNo: true, status: true },
      });
    },
    async list(
      scope: FeedbackReadScope,
      skip: number,
      take: number,
      tx?: IngredientQualityFeedbackTx,
    ): Promise<FeedbackListRow[]> {
      const db = tx ?? (await connect());
      return db.complaint.findMany({
        where: scopeWhere(scope),
        skip,
        take,
        select: feedbackListSelect,
        orderBy: [{ submittedAt: "desc" }, { id: "asc" }],
      });
    },
    async findDetail(
      tx: IngredientQualityFeedbackTx,
      feedbackId: string,
      scope: FeedbackDetailScope,
    ): Promise<FeedbackDetailRow | null> {
      return tx.complaint.findFirst({
        where: { AND: [scopeWhere(scope), { id: feedbackId }] },
        select: feedbackDetailSelect,
      });
    },
    async findLotInDelivery(
      tx: IngredientQualityFeedbackTx,
      lotId: string,
      deliveryId: string,
      scope: FeedbackDetailScope,
    ): Promise<FeedbackLotRow | null> {
      return tx.ingredientLot.findFirst({
        where: {
          id: lotId,
          DeliveryItem: {
            deliveryId,
            Delivery:
              scope.kind === "SUPPLIER"
                ? { id: deliveryId, supplierId: scope.supplierId }
                : { id: deliveryId, schoolId: scope.schoolId },
          },
        },
        select: feedbackLotSelect,
      });
    },
    async readActor(
      tx: IngredientQualityFeedbackTx,
      userId: string,
    ): Promise<AuthPrincipal> {
      // Keep query errors raw so authorizationTransaction can retry serialization conflicts.
      return principalFromIdentity(
        await tx.user.findUnique({
          where: { id: userId },
          select: identitySelect,
        }),
      );
    },
    async findResponseMetadata(
      tx: IngredientQualityFeedbackTx,
      feedbackId: string,
      scope: SupplierResponseScope,
    ): Promise<FeedbackResponseMetadataRow | null> {
      const row = await tx.ingredientQualityFeedback.findFirst({
        where: { id: feedbackId, Delivery: { supplierId: scope.supplierId } },
        select: {
          id: true,
          deliveryId: true,
          Delivery: { select: { schoolId: true } },
        },
      });
      if (!row) return null;
      return {
        id: row.id,
        deliveryId: row.deliveryId,
        schoolId: row.Delivery.schoolId,
      };
    },
    async lockResponseContext(
      tx: IngredientQualityFeedbackTx,
      scope: SupplierResponseScope,
      context: ResponseLockContext,
    ): Promise<void> {
      // Lock order matches lifecycle/staff/permission writers:
      // school -> supplier -> actor user -> actor role -> permission rows -> delivery -> complaint.
      await parentLocks.lockParents(tx, {
        ...(context.schoolId ? { schoolId: context.schoolId } : {}),
        supplierId: scope.supplierId,
        userIds: [context.actorUserId],
        roleIds: [context.actorRoleId],
      });
      await tx.$queryRaw<{ id: string }[]>`
        SELECT p.id
        FROM foodprint.permissions p
        WHERE p.code IN (
          ${FEEDBACK_RESPONSE_PERMISSION_CODES[0]},
          ${FEEDBACK_RESPONSE_PERMISSION_CODES[1]}
        )
        ORDER BY p.id ASC
        FOR SHARE OF p
      `;
      if (context.deliveryId && context.schoolId) {
        await parentLocks.lockDelivery(
          tx,
          context.deliveryId,
          scope.supplierId,
        );
        await tx.$queryRaw<{ id: string }[]>`
          SELECT c.id
          FROM foodprint.complaints c
          INNER JOIN foodprint.ingredient_quality_feedback f ON f.id = c.id
          INNER JOIN foodprint.deliveries d ON d.id = f.delivery_id
          WHERE c.id = ${context.feedbackId}::uuid
            AND c.kind = 'INGREDIENT'
            AND d.id = ${context.deliveryId}::uuid
            AND d.supplier_id = ${scope.supplierId}::uuid
            AND d.school_id = ${context.schoolId}::uuid
          FOR UPDATE OF c
        `;
      }
    },
    async findSupplierTarget(
      tx: IngredientQualityFeedbackTx,
      feedbackId: string,
      scope: SupplierResponseScope,
    ): Promise<FeedbackTicketTargetRow | null> {
      return toTarget(
        await tx.complaint.findFirst({
          where: {
            AND: [
              scopeWhere({ kind: "SUPPLIER", supplierId: scope.supplierId }),
              { id: feedbackId },
            ],
          },
          select: ticketTargetSelect,
        }),
      );
    },
    /** Đơn do chính người gửi tạo, thuộc trường hiện tại của họ. */
    async findRequesterTarget(
      tx: IngredientQualityFeedbackTx,
      feedbackId: string,
      scope: { schoolId: string; senderUserId: string },
    ): Promise<FeedbackTicketTargetRow | null> {
      return toTarget(
        await tx.complaint.findFirst({
          where: {
            AND: [
              scopeWhere({
                kind: "SCHOOL",
                schoolId: scope.schoolId,
                submittedByUserId: scope.senderUserId,
              }),
              { id: feedbackId },
            ],
          },
          select: ticketTargetSelect,
        }),
      );
    },
  };
}

export type IngredientQualityFeedbackRepository = ReturnType<
  typeof createIngredientQualityFeedbackRepository
>;

export const ingredientQualityFeedbackRepository =
  createIngredientQualityFeedbackRepository();
