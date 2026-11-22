import { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import { createFoodSafetyInspectionRepository } from "../food-safety-inspection/food-safety-inspection.repository";

type Tx = Prisma.TransactionClient;
type Db = Tx;
export type EnforcementActionType =
  Prisma.SupplierEnforcementActionCreateInput["actionType"];
export type RestrictionType =
  Prisma.SupplierRestrictionCreateManyInput["restrictionType"];
export type IntakeStateValue = NonNullable<
  Prisma.SupplierCreateInput["intakeState"]
>;
export type IncidentStatus = NonNullable<
  Prisma.FoodSafetyIncidentCreateInput["status"]
>;

const actorSelect = {
  id: true,
  fullName: true,
  roleCode: true,
} as const satisfies Prisma.UserSelect;

const actionSelect = {
  id: true,
  actionType: true,
  requestReason: true,
  decisionStatus: true,
  decidedAt: true,
  decisionNote: true,
  executionStatus: true,
  executedAt: true,
  executionNote: true,
  createdAt: true,
  updatedAt: true,
  Incident: { select: { id: true, code: true, title: true, status: true } },
  Supplier: { select: { id: true, name: true } },
  EvidenceInspection: {
    select: {
      id: true,
      status: true,
      overallConclusion: true,
      completedAt: true,
    },
  },
  requestedByUser: { select: actorSelect },
  decidedByUser: { select: actorSelect },
} as const satisfies Prisma.SupplierEnforcementActionSelect;

export type SupplierEnforcementActionRow =
  Prisma.SupplierEnforcementActionGetPayload<{ select: typeof actionSelect }>;

export type EnforcementIncidentTarget = {
  id: string;
  schoolId: string;
  status: IncidentStatus;
};

export type DecisionTarget = {
  id: string;
  incidentId: string;
  supplierId: string;
  actionType: EnforcementActionType;
  evidenceInspectionId: string | null;
  decisionStatus: string;
  executionStatus: string;
};

export type ActiveRestriction = {
  id: string;
  incidentId: string | null;
  restrictionType: RestrictionType;
  activatedAt: Date;
  lockedAccountCount: number;
};

export type OpenLock = {
  restrictionId: string;
  userId: string;
  lockedAt: Date;
  userStatus: string;
};

export type ActionListFilter = {
  incidentId?: string;
  supplierId?: string;
  actionType?: EnforcementActionType;
  decisionStatus?: Prisma.SupplierEnforcementActionWhereInput["decisionStatus"];
  executionStatus?: Prisma.SupplierEnforcementActionWhereInput["executionStatus"];
};

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export function createSupplierEnforcementRepository(connect = getPrisma) {
  const inspections = createFoodSafetyInspectionRepository(connect);
  return {
    connect,
    async lockIncident(tx: Tx, id: string): Promise<void> {
      await inspections.lockIncident(tx, id);
    },
    /** Khóa dòng NCC trước mọi thay đổi hạn chế/tài khoản (§5.2 mục 4). */
    async lockSupplier(tx: Tx, supplierId: string): Promise<void> {
      await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM foodprint.suppliers
        WHERE id = ${supplierId}::uuid
        FOR UPDATE
      `;
    },
    async lockAction(tx: Tx, id: string): Promise<void> {
      await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM foodprint.supplier_enforcement_actions
        WHERE id = ${id}::uuid
        FOR UPDATE
      `;
    },
    findOfficerTarget(
      db: Db,
      id: string,
      unitId: string,
    ): Promise<EnforcementIncidentTarget | null> {
      return db.foodSafetyIncident.findFirst({
        where: { id, recipientCommuneFoodSafetyUnitId: unitId },
        select: { id: true, schoolId: true, status: true },
      });
    },
    snapshotPayloads(db: Db, incidentId: string): Promise<unknown[]> {
      return inspections.snapshotPayloads(db, incidentId);
    },
    async schoolSupplierIds(db: Db, schoolId: string): Promise<string[]> {
      return (await inspections.schoolSuppliers(db, schoolId)).map(
        (item) => item.id,
      );
    },
    async findingSupplierIds(db: Db, incidentId: string): Promise<string[]> {
      const rows = await db.foodSafetyInspectionSupplierFinding.findMany({
        where: { Inspection: { incidentId } },
        select: { supplierId: true },
        distinct: ["supplierId"],
      });
      return rows.map((row) => row.supplierId);
    },
    /** Đợt kiểm tra thuộc hồ sơ và kết luận của đúng NCC (nếu có). */
    async findEvidence(
      db: Db,
      incidentId: string,
      inspectionId: string,
      supplierId: string,
    ): Promise<{ status: string; finding: string | null } | null> {
      const row = await db.foodSafetyInspection.findFirst({
        where: { id: inspectionId, incidentId },
        select: {
          status: true,
          findings: { where: { supplierId }, select: { finding: true } },
        },
      });
      if (!row) return null;
      return { status: row.status, finding: row.findings[0]?.finding ?? null };
    },
    async activeRestrictions(
      db: Db,
      supplierId: string,
      incidentId?: string,
    ): Promise<ActiveRestriction[]> {
      const rows = await db.supplierRestriction.findMany({
        where: {
          supplierId,
          isActive: true,
          ...(incidentId ? { incidentId } : {}),
        },
        select: {
          id: true,
          incidentId: true,
          restrictionType: true,
          activatedAt: true,
          _count: {
            select: { lockedAccounts: { where: { unlockedAt: null } } },
          },
        },
        orderBy: [{ activatedAt: "asc" }, { id: "asc" }],
      });
      return rows.map(({ _count, ...row }) => ({
        ...row,
        lockedAccountCount: _count.lockedAccounts,
      }));
    },
    async hasPending(
      db: Db,
      incidentId: string,
      supplierId: string,
      actionType: EnforcementActionType,
    ): Promise<boolean> {
      return Boolean(
        await db.supplierEnforcementAction.findFirst({
          where: {
            incidentId,
            supplierId,
            actionType,
            decisionStatus: "PENDING",
          },
          select: { id: true },
        }),
      );
    },
    /** Trùng yêu cầu PENDING (đồng thời) → null. */
    async createAction(
      tx: Tx,
      data: {
        incidentId: string;
        supplierId: string;
        actionType: EnforcementActionType;
        requestedByUserId: string;
        requestReason: string;
        evidenceInspectionId: string | null;
        at: Date;
      },
    ): Promise<SupplierEnforcementActionRow | null> {
      try {
        return await tx.supplierEnforcementAction.create({
          data: {
            incidentId: data.incidentId,
            supplierId: data.supplierId,
            actionType: data.actionType,
            requestedByUserId: data.requestedByUserId,
            requestReason: data.requestReason,
            evidenceInspectionId: data.evidenceInspectionId,
            createdAt: data.at,
            updatedAt: data.at,
          },
          select: actionSelect,
        });
      } catch (error) {
        if (isUniqueViolation(error)) return null;
        throw error;
      }
    },
    async listActions(
      db: Db,
      scope: Prisma.SupplierEnforcementActionWhereInput,
      filter: ActionListFilter,
      page: { skip: number; take: number },
    ): Promise<SupplierEnforcementActionRow[]> {
      return db.supplierEnforcementAction.findMany({
        where: {
          AND: [
            scope,
            {
              ...(filter.incidentId ? { incidentId: filter.incidentId } : {}),
              ...(filter.supplierId ? { supplierId: filter.supplierId } : {}),
              ...(filter.actionType ? { actionType: filter.actionType } : {}),
              ...(filter.decisionStatus
                ? { decisionStatus: filter.decisionStatus }
                : {}),
              ...(filter.executionStatus
                ? { executionStatus: filter.executionStatus }
                : {}),
            },
          ],
        },
        select: actionSelect,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: page.skip,
        take: page.take,
      });
    },
    findAction(
      db: Db,
      scope: Prisma.SupplierEnforcementActionWhereInput,
      id: string,
    ): Promise<(SupplierEnforcementActionRow & { supplierId: string }) | null> {
      return db.supplierEnforcementAction.findFirst({
        where: { AND: [scope, { id }] },
        select: { ...actionSelect, supplierId: true },
      });
    },
    findDecisionTarget(tx: Tx, id: string): Promise<DecisionTarget | null> {
      return tx.supplierEnforcementAction.findUnique({
        where: { id },
        select: {
          id: true,
          incidentId: true,
          supplierId: true,
          actionType: true,
          evidenceInspectionId: true,
          decisionStatus: true,
          executionStatus: true,
        },
      });
    },
    /** Chỉ yêu cầu còn PENDING; 0 dòng ⇒ đã có quyết định khác. */
    async decide(
      tx: Tx,
      id: string,
      data: {
        decisionStatus: "APPROVED" | "REJECTED";
        decidedByUserId: string;
        decisionNote: string | null;
        executionStatus: "NOT_APPLIED" | "APPLIED";
        executionNote: string | null;
        at: Date;
      },
    ): Promise<number> {
      const result = await tx.supplierEnforcementAction.updateMany({
        where: { id, decisionStatus: "PENDING" },
        data: {
          decisionStatus: data.decisionStatus,
          decidedByUserId: data.decidedByUserId,
          decidedAt: data.at,
          decisionNote: data.decisionNote,
          executionStatus: data.executionStatus,
          executedAt: data.executionStatus === "APPLIED" ? data.at : null,
          executionNote: data.executionNote,
        },
      });
      return result.count;
    },
    async markExecution(
      db: Db,
      id: string,
      from: "APPLIED" | "FAILED",
      to: "APPLIED" | "FAILED",
      note: string,
    ): Promise<number> {
      const result = await db.supplierEnforcementAction.updateMany({
        where: { id, decisionStatus: "APPROVED", executionStatus: from },
        data: { executionStatus: to, executionNote: note },
      });
      return result.count;
    },
    readAction(
      tx: Tx,
      id: string,
    ): Promise<SupplierEnforcementActionRow | null> {
      return tx.supplierEnforcementAction.findUnique({
        where: { id },
        select: actionSelect,
      });
    },
    async createRestriction(
      tx: Tx,
      data: {
        supplierId: string;
        incidentId: string;
        restrictionType: RestrictionType;
        sourceActionId: string;
        at: Date;
      },
    ): Promise<string> {
      const row = await tx.supplierRestriction.create({
        data: {
          supplierId: data.supplierId,
          incidentId: data.incidentId,
          restrictionType: data.restrictionType,
          sourceActionId: data.sourceActionId,
          activatedAt: data.at,
        },
        select: { id: true },
      });
      return row.id;
    },
    async liftRestrictions(
      tx: Tx,
      ids: readonly string[],
      actionId: string,
      at: Date,
    ): Promise<number> {
      if (!ids.length) return 0;
      const result = await tx.supplierRestriction.updateMany({
        where: { id: { in: [...ids] }, isActive: true },
        data: { isActive: false, liftedAt: at, liftedByActionId: actionId },
      });
      return result.count;
    },
    async supplierIntake(
      tx: Tx,
      supplierId: string,
    ): Promise<IntakeStateValue> {
      const row = await tx.supplier.findUniqueOrThrow({
        where: { id: supplierId },
        select: { intakeState: true },
      });
      return row.intakeState;
    },
    async setSupplierIntake(
      tx: Tx,
      supplierId: string,
      state: IntakeStateValue,
    ): Promise<void> {
      await tx.supplier.update({
        where: { id: supplierId },
        data: { intakeState: state },
      });
    },
    async activeSupplierUserIds(tx: Tx, supplierId: string): Promise<string[]> {
      const rows = await tx.user.findMany({
        where: { supplierId, status: "ACTIVE" },
        select: { id: true },
        orderBy: { id: "asc" },
      });
      return rows.map((row) => row.id);
    },
    async setUserStatus(
      tx: Tx,
      ids: readonly string[],
      from: "ACTIVE" | "LOCKED",
      to: "ACTIVE" | "LOCKED",
    ): Promise<number> {
      if (!ids.length) return 0;
      const result = await tx.user.updateMany({
        where: { id: { in: [...ids] }, status: from },
        data: { status: to },
      });
      return result.count;
    },
    async createLocks(
      tx: Tx,
      restrictionId: string,
      rows: readonly { userId: string; lockedAt: Date }[],
    ): Promise<void> {
      if (!rows.length) return;
      await tx.supplierRestrictionLockedAccount.createMany({
        data: rows.map((row) => ({
          restrictionId,
          userId: row.userId,
          previousStatus: "ACTIVE" as const,
          lockedAt: row.lockedAt,
        })),
        skipDuplicates: true,
      });
    },
    async openLocks(
      tx: Tx,
      restrictionIds: readonly string[],
    ): Promise<OpenLock[]> {
      if (!restrictionIds.length) return [];
      const rows = await tx.supplierRestrictionLockedAccount.findMany({
        where: { restrictionId: { in: [...restrictionIds] }, unlockedAt: null },
        select: {
          restrictionId: true,
          userId: true,
          lockedAt: true,
          User: { select: { status: true } },
        },
        orderBy: [{ userId: "asc" }, { restrictionId: "asc" }],
      });
      return rows.map(({ User, ...row }) => ({
        ...row,
        userStatus: User.status,
      }));
    },
    async closeLocks(
      tx: Tx,
      restrictionIds: readonly string[],
      at: Date,
    ): Promise<void> {
      if (!restrictionIds.length) return;
      await tx.supplierRestrictionLockedAccount.updateMany({
        where: { restrictionId: { in: [...restrictionIds] }, unlockedAt: null },
        data: { unlockedAt: at },
      });
    },
    /** Tài khoản còn LOCKED bởi hạn chế do yêu cầu này tạo (để thu hồi phiên lại). */
    async lockedUserIdsOfAction(tx: Tx, actionId: string): Promise<string[]> {
      const rows = await tx.supplierRestrictionLockedAccount.findMany({
        where: {
          unlockedAt: null,
          Restriction: { sourceActionId: actionId, isActive: true },
          User: { status: "LOCKED" },
        },
        select: { userId: true },
        orderBy: { userId: "asc" },
      });
      return rows.map((row) => row.userId);
    },
    async recordStatusHistories(
      tx: Tx,
      rows: readonly {
        userId: string;
        supplierId: string;
        fromStatus: "ACTIVE" | "LOCKED";
        toStatus: "ACTIVE" | "LOCKED";
        reason: string;
        sourceActionId: string;
        actorUserId: string;
        at: Date;
      }[],
    ): Promise<void> {
      if (!rows.length) return;
      await tx.accountStatusHistory.createMany({
        data: rows.map(({ at, ...row }) => ({ ...row, createdAt: at })),
      });
    },
  };
}

export const supplierEnforcementRepository =
  createSupplierEnforcementRepository();
export type SupplierEnforcementRepository = ReturnType<
  typeof createSupplierEnforcementRepository
>;
