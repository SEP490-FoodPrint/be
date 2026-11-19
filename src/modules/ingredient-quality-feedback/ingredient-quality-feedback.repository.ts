import type { Prisma } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import {
  identitySelect,
  principalFromIdentity,
} from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import { allocateBusinessCode } from "../../utils/business-code";
import type {
  IngredientQualityFeedbackDetailScope,
  IngredientQualityFeedbackReadScope,
  IngredientQualityFeedbackResponseScope,
} from "../../utils/resource-access";
import { createIntakeAccessRepository } from "../account-lifecycle/intake-access.repository";

export type IngredientQualityFeedbackTx = Prisma.TransactionClient;

export type LegacyFeedbackScope = Extract<
  IngredientQualityFeedbackReadScope,
  { kind: "SCHOOL" | "SYSTEM" }
>;

export type SupplierFeedbackScope = Extract<
  IngredientQualityFeedbackReadScope,
  { kind: "SUPPLIER" }
>;

export type FeedbackDetailScope = IngredientQualityFeedbackDetailScope;
export type SupplierResponseScope = IngredientQualityFeedbackResponseScope;

export interface FeedbackResponseMetadataRow {
  id: string;
  deliveryId: string;
  schoolId: string;
}

export interface FeedbackResponseTargetRow {
  id: string;
  deliveryId: string;
  schoolId: string;
  status: string;
}

export interface ResponseLockContext {
  feedbackId: string;
  actorUserId: string;
  actorRoleId: string;
  schoolId?: string;
  deliveryId?: string;
}

export interface RespondIfSubmittedInput {
  feedbackId: string;
  supplierId: string;
  supplierResponse: string;
  respondedByUserId: string;
  respondedAt: Date;
}

const FEEDBACK_RESPONSE_PERMISSION_CODES = [
  "ingredient_quality_feedback.view_details",
  "ingredient_quality_feedback.respond",
] as const;

const parentLocks = createIntakeAccessRepository();

const legacyFeedbackSelect = {
  id: true,
  deliveryId: true,
  ingredientLotId: true,
  submittedByUserId: true,
  title: true,
  description: true,
  status: true,
  respondedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.IngredientQualityFeedbackSelect;

export type LegacyFeedbackRow = Prisma.IngredientQualityFeedbackGetPayload<{
  select: typeof legacyFeedbackSelect;
}>;

const supplierFeedbackListSelect = {
  id: true,
  complaintCode: true,
  title: true,
  status: true,
  createdAt: true,
  respondedAt: true,
  Delivery: {
    select: {
      id: true,
      deliveryNo: true,
      School: {
        select: {
          id: true,
          name: true,
          code: true,
        },
      },
    },
  },
} as const satisfies Prisma.IngredientQualityFeedbackSelect;

export type SupplierFeedbackListRow =
  Prisma.IngredientQualityFeedbackGetPayload<{
    select: typeof supplierFeedbackListSelect;
  }>;

const feedbackDetailSelect = {
  id: true,
  complaintCode: true,
  deliveryId: true,
  ingredientLotId: true,
  title: true,
  description: true,
  status: true,
  supplierResponse: true,
  respondedAt: true,
  createdAt: true,
  updatedAt: true,
  Delivery: {
    select: {
      id: true,
      deliveryNo: true,
      School: {
        select: {
          id: true,
          name: true,
          code: true,
        },
      },
    },
  },
  submittedByUser: {
    select: {
      id: true,
      fullName: true,
    },
  },
  respondedByUser: {
    select: {
      id: true,
      fullName: true,
    },
  },
} as const satisfies Prisma.IngredientQualityFeedbackSelect;

export type FeedbackDetailRow = Prisma.IngredientQualityFeedbackGetPayload<{
  select: typeof feedbackDetailSelect;
}>;

const feedbackLotSelect = {
  id: true,
  lotCode: true,
} as const satisfies Prisma.IngredientLotSelect;

export type FeedbackLotRow = Prisma.IngredientLotGetPayload<{
  select: typeof feedbackLotSelect;
}>;

export function createIngredientQualityFeedbackRepository(connect = getPrisma) {
  return {
    /**
     * Cấp mã khiếu nại mới FP-CP-NNNNN (hậu tố Feistel) cho producer tạo khiếu nại, trong cùng transaction tạo.
     * Mã tuần tự cũ đã cấp được giữ nguyên; mã mới không trùng với bất kỳ mã nào đã có.
     */
    allocateComplaintCode(tx: IngredientQualityFeedbackTx): Promise<string> {
      return allocateBusinessCode(tx, "CP", async (codes) => {
        const rows = await tx.ingredientQualityFeedback.findMany({
          where: { complaintCode: { in: [...codes] } },
          select: { complaintCode: true },
        });
        return new Set(rows.map((row) => row.complaintCode));
      });
    },
    async listLegacy(
      scope: LegacyFeedbackScope,
      skip: number,
      take: number,
      tx?: IngredientQualityFeedbackTx,
    ): Promise<LegacyFeedbackRow[]> {
      const db = tx ?? (await connect());
      const where: Prisma.IngredientQualityFeedbackWhereInput =
        scope.kind === "SYSTEM"
          ? {}
          : {
              Delivery: { schoolId: scope.schoolId },
              ...(scope.submittedByUserId
                ? { submittedByUserId: scope.submittedByUserId }
                : {}),
            };
      return db.ingredientQualityFeedback.findMany({
        where,
        skip,
        take,
        select: legacyFeedbackSelect,
        orderBy: [{ id: "asc" }],
      });
    },
    async listSupplier(
      scope: SupplierFeedbackScope,
      skip: number,
      take: number,
      tx?: IngredientQualityFeedbackTx,
    ): Promise<SupplierFeedbackListRow[]> {
      const db = tx ?? (await connect());
      return db.ingredientQualityFeedback.findMany({
        where: { Delivery: { supplierId: scope.supplierId } },
        skip,
        take,
        select: supplierFeedbackListSelect,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      });
    },
    async findDetail(
      tx: IngredientQualityFeedbackTx,
      feedbackId: string,
      scope: FeedbackDetailScope,
    ): Promise<FeedbackDetailRow | null> {
      return tx.ingredientQualityFeedback.findFirst({
        where:
          scope.kind === "SUPPLIER"
            ? { id: feedbackId, Delivery: { supplierId: scope.supplierId } }
            : {
                id: feedbackId,
                Delivery: { schoolId: scope.schoolId },
                ...(scope.submittedByUserId
                  ? { submittedByUserId: scope.submittedByUserId }
                  : {}),
              },
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
          SELECT f.id
          FROM foodprint.ingredient_quality_feedback f
          INNER JOIN foodprint.deliveries d ON d.id = f.delivery_id
          WHERE f.id = ${context.feedbackId}::uuid
            AND d.id = ${context.deliveryId}::uuid
            AND d.supplier_id = ${scope.supplierId}::uuid
            AND d.school_id = ${context.schoolId}::uuid
          FOR UPDATE OF f
        `;
      }
    },
    async findResponseTarget(
      tx: IngredientQualityFeedbackTx,
      feedbackId: string,
      scope: SupplierResponseScope,
    ): Promise<FeedbackResponseTargetRow | null> {
      const row = await tx.ingredientQualityFeedback.findFirst({
        where: { id: feedbackId, Delivery: { supplierId: scope.supplierId } },
        select: {
          id: true,
          deliveryId: true,
          status: true,
          Delivery: { select: { schoolId: true } },
        },
      });
      if (!row) return null;
      return {
        id: row.id,
        deliveryId: row.deliveryId,
        schoolId: row.Delivery.schoolId,
        status: row.status,
      };
    },
    async respondIfSubmitted(
      tx: IngredientQualityFeedbackTx,
      input: RespondIfSubmittedInput,
    ): Promise<number> {
      const result = await tx.ingredientQualityFeedback.updateMany({
        where: {
          id: input.feedbackId,
          status: "SUBMITTED",
          Delivery: { supplierId: input.supplierId },
        },
        data: {
          status: "RESPONDED",
          supplierResponse: input.supplierResponse,
          respondedByUserId: input.respondedByUserId,
          respondedAt: input.respondedAt,
        },
      });
      return result.count;
    },
  };
}

export type IngredientQualityFeedbackRepository = ReturnType<
  typeof createIngredientQualityFeedbackRepository
>;

export const ingredientQualityFeedbackRepository =
  createIngredientQualityFeedbackRepository();
