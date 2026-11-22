import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";

type Tx = Prisma.TransactionClient;
type Db = Pick<
  Tx,
  | "foodSafetyIncident"
  | "foodSafetyIncidentTraceSnapshot"
  | "supplier"
  | "schoolSupplierRelationship"
>;
export type IncidentStatus = Prisma.FoodSafetyIncidentCreateInput["status"];
export type InspectionConclusion = NonNullable<
  Prisma.FoodSafetyInspectionCreateInput["overallConclusion"]
>;
export type SupplierFindingValue =
  Prisma.FoodSafetyInspectionSupplierFindingCreateManyInput["finding"];

const inspectionSelect = {
  id: true,
  incidentId: true,
  status: true,
  teamDescription: true,
  scheduledAt: true,
  resultSummary: true,
  overallConclusion: true,
  completedAt: true,
  createdAt: true,
  findings: {
    select: {
      finding: true,
      evidenceNote: true,
      Supplier: { select: { id: true, name: true } },
    },
    orderBy: { supplierId: "asc" },
  },
} as const satisfies Prisma.FoodSafetyInspectionSelect;

export type FoodSafetyInspectionRow = Prisma.FoodSafetyInspectionGetPayload<{
  select: typeof inspectionSelect;
}>;
export type InspectionIncidentTarget = {
  id: string;
  schoolId: string;
  status: IncidentStatus;
  source: Prisma.FoodSafetyIncidentCreateInput["source"];
};
export type InspectionActor = { id: string; roleCode: string };

export function createFoodSafetyInspectionRepository(connect = getPrisma) {
  return {
    connect,
    async lockIncident(tx: Tx, id: string): Promise<void> {
      await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM foodprint.food_safety_incidents
        WHERE id = ${id}::uuid
        FOR UPDATE
      `;
    },
    /** Hồ sơ do đơn vị của cán bộ đang nhận (FR-004). */
    findOfficerTarget(
      db: Pick<Tx, "foodSafetyIncident">,
      id: string,
      unitId: string,
    ): Promise<InspectionIncidentTarget | null> {
      return db.foodSafetyIncident.findFirst({
        where: { id, recipientCommuneFoodSafetyUnitId: unitId },
        select: { id: true, schoolId: true, status: true, source: true },
      });
    },
    async countInspections(
      tx: Tx,
      incidentId: string,
    ): Promise<{ planned: number; completed: number }> {
      const rows = await tx.foodSafetyInspection.groupBy({
        by: ["status"],
        where: { incidentId },
        _count: { _all: true },
      });
      const count = (status: string) =>
        rows.find((row) => row.status === status)?._count._all ?? 0;
      return { planned: count("PLANNED"), completed: count("COMPLETED") };
    },
    createInspection(
      tx: Tx,
      data: {
        incidentId: string;
        teamDescription: string;
        scheduledAt: Date;
        createdByUserId: string;
        at: Date;
      },
    ): Promise<FoodSafetyInspectionRow> {
      return tx.foodSafetyInspection.create({
        data: {
          incidentId: data.incidentId,
          teamDescription: data.teamDescription,
          scheduledAt: data.scheduledAt,
          createdByUserId: data.createdByUserId,
          createdAt: data.at,
          updatedAt: data.at,
        },
        select: inspectionSelect,
      });
    },
    findInspection(
      tx: Tx,
      incidentId: string,
      inspectionId: string,
    ): Promise<{ id: string; status: string } | null> {
      return tx.foodSafetyInspection.findFirst({
        where: { id: inspectionId, incidentId },
        select: { id: true, status: true },
      });
    },
    /** Ghi kết quả một lần: chỉ đợt còn PLANNED (Q26). */
    async recordResult(
      tx: Tx,
      inspectionId: string,
      data: {
        resultSummary: string;
        overallConclusion: InspectionConclusion;
        recordedByUserId: string;
        at: Date;
      },
    ): Promise<number> {
      const result = await tx.foodSafetyInspection.updateMany({
        where: { id: inspectionId, status: "PLANNED" },
        data: {
          status: "COMPLETED",
          resultSummary: data.resultSummary,
          overallConclusion: data.overallConclusion,
          recordedByUserId: data.recordedByUserId,
          completedAt: data.at,
        },
      });
      return result.count;
    },
    async createFindings(
      tx: Tx,
      inspectionId: string,
      findings: readonly {
        supplierId: string;
        finding: SupplierFindingValue;
        evidenceNote: string | null;
      }[],
    ): Promise<void> {
      if (!findings.length) return;
      await tx.foodSafetyInspectionSupplierFinding.createMany({
        data: findings.map((item) => ({ inspectionId, ...item })),
      });
    },
    readInspection(
      tx: Tx,
      id: string,
    ): Promise<FoodSafetyInspectionRow | null> {
      return tx.foodSafetyInspection.findUnique({
        where: { id },
        select: inspectionSelect,
      });
    },
    async moveIncident(
      tx: Tx,
      id: string,
      from: NonNullable<IncidentStatus>,
      to: NonNullable<IncidentStatus>,
    ): Promise<number> {
      const result = await tx.foodSafetyIncident.updateMany({
        where: { id, status: from },
        data: { status: to },
      });
      return result.count;
    },
    async recordHistory(
      tx: Tx,
      data: {
        incidentId: string;
        fromStatus: NonNullable<IncidentStatus>;
        toStatus: NonNullable<IncidentStatus>;
        actor: InspectionActor;
        note?: string;
        at: Date;
      },
    ): Promise<void> {
      await tx.foodSafetyIncidentStatusHistory.create({
        data: {
          incidentId: data.incidentId,
          fromStatus: data.fromStatus,
          toStatus: data.toStatus,
          actorUserId: data.actor.id,
          actorRoleCode: data.actor.roleCode,
          note: data.note ?? null,
          createdAt: data.at,
        },
      });
    },
    async snapshotPayloads(db: Db, incidentId: string): Promise<unknown[]> {
      const rows = await db.foodSafetyIncidentTraceSnapshot.findMany({
        where: { incidentId },
        select: { payload: true },
      });
      return rows.map((row) => row.payload);
    },
    suppliersByIds(
      db: Db,
      ids: readonly string[],
    ): Promise<{ id: string; name: string }[]> {
      return db.supplier.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, name: true },
        orderBy: { id: "asc" },
      });
    },
    /** NCC có quan hệ cung cấp với trường (khác UNLINKED). */
    schoolSuppliers(
      db: Db,
      schoolId: string,
    ): Promise<{ id: string; name: string }[]> {
      return db.supplier.findMany({
        where: {
          schoolSupplierRelationships: {
            some: { schoolId, status: { not: "UNLINKED" } },
          },
        },
        select: { id: true, name: true },
        orderBy: { id: "asc" },
      });
    },
  };
}

export const foodSafetyInspectionRepository =
  createFoodSafetyInspectionRepository();
export type FoodSafetyInspectionRepository = ReturnType<
  typeof createFoodSafetyInspectionRepository
>;
