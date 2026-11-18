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
  respondedRoleCode?: string;
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
  Complaint: {
    select: {
      senderUserId: true,
      title: true,
      description: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      currentResponseVersion: {
        select: {
          createdAt: true,
        },
      },
    },
  },
} as const satisfies Prisma.IngredientQualityFeedbackSelect;

export type LegacyFeedbackRow = Prisma.IngredientQualityFeedbackGetPayload<{
  select: typeof legacyFeedbackSelect;
}>;

const supplierFeedbackListSelect = {
  id: true,
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
  Complaint: {
    select: {
      complaintCode: true,
      title: true,
      status: true,
      createdAt: true,
      currentResponseVersion: {
        select: {
          createdAt: true,
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
  deliveryId: true,
  ingredientLotId: true,
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
  Complaint: {
    select: {
      complaintCode: true,
      title: true,
      description: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      senderUser: {
        select: {
          id: true,
          fullName: true,
        },
      },
      currentResponseVersion: {
        select: {
          content: true,
          createdAt: true,
          respondedByUser: {
            select: {
              id: true,
              fullName: true,
            },
          },
        },
      },
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
    async nextComplaintCodeSequence(
      tx: IngredientQualityFeedbackTx,
    ): Promise<bigint> {
      const rows = await tx.$queryRaw<{ value: bigint | string | number }[]>`
        SELECT nextval('foodprint.complaint_code_seq'::regclass) AS value
      `;
      const row = rows[0];
      if (!row) {
        throw new Error("Không thể cấp mã khiếu nại từ sequence.");
      }
      if (typeof row.value === "bigint") return row.value;
      if (typeof row.value === "string" && /^[1-9]\d*$/.test(row.value)) {
        return BigInt(row.value);
      }
      throw new Error("Giá trị sequence mã khiếu nại không hợp lệ.");
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
                ? { Complaint: { senderUserId: scope.submittedByUserId } }
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
        orderBy: [{ Complaint: { createdAt: "desc" } }, { id: "asc" }],
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
                  ? { Complaint: { senderUserId: scope.submittedByUserId } }
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
          Delivery: { select: { schoolId: true } },
          Complaint: { select: { status: true } },
        },
      });
      if (!row) return null;
      return {
        id: row.id,
        deliveryId: row.deliveryId,
        schoolId: row.Delivery.schoolId,
        status: row.Complaint.status,
      };
    },
    async respondIfSubmitted(
      tx: IngredientQualityFeedbackTx,
      input: RespondIfSubmittedInput,
    ): Promise<number> {
      const target = await tx.ingredientQualityFeedback.findFirst({
        where: {
          id: input.feedbackId,
          Delivery: { supplierId: input.supplierId },
          Complaint: { status: "SUBMITTED" },
        },
        select: {
          id: true,
        },
      });
      if (!target) return 0;

      const version = await tx.complaintResponseVersion.create({
        data: {
          complaintId: input.feedbackId,
          version: 1,
          content: input.supplierResponse,
          respondedByUserId: input.respondedByUserId,
          respondedRoleCode: input.respondedRoleCode,
          createdAt: input.respondedAt,
        },
      });

      await tx.complaint.update({
        where: { id: input.feedbackId },
        data: {
          status: "RESPONDED",
          currentResponseVersionId: version.id,
        },
      });

      await tx.complaintStatusHistory.create({
        data: {
          complaintId: input.feedbackId,
          fromStatus: "SUBMITTED",
          toStatus: "RESPONDED",
          responseVersionId: version.id,
          actorUserId: input.respondedByUserId,
          actorRoleCode: input.respondedRoleCode,
          createdAt: input.respondedAt,
        },
      });

      return 1;
    },
  };
}

export type IngredientQualityFeedbackRepository = ReturnType<
  typeof createIngredientQualityFeedbackRepository
>;

export const ingredientQualityFeedbackRepository =
  createIngredientQualityFeedbackRepository();
