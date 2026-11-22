import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import { allocateBusinessCode } from "../../utils/business-code";
import { listWindow, type ListQuery } from "../../utils/list-query";

type Tx = Prisma.TransactionClient;
type Status = Prisma.FoodSafetyIncidentCreateInput["status"];

const listSelect = {
  id: true,
  code: true,
  schoolId: true,
  reportedByUserId: true,
  title: true,
  description: true,
  status: true,
  source: true,
  reportedSymptomaticCount: true,
  recipientCommuneFoodSafetyUnitId: true,
  occurredAt: true,
  resolvedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.FoodSafetyIncidentSelect;

const person = { select: { id: true, fullName: true } } as const;

const detailSelect = {
  ...listSelect,
  reportedRoleCode: true,
  symptomDescription: true,
  schoolPreliminaryAssessment: true,
  schoolPreliminaryNote: true,
  schoolReviewedAt: true,
  cancellationReason: true,
  cancellationNote: true,
  School: { select: { id: true, name: true } },
  User: person,
  SchoolReviewedBy: person,
  ReportedClass: { select: { id: true, name: true } },
  RecipientUnit: { select: { id: true, name: true } },
  foodSafetyReportForwardings: {
    select: {
      id: true,
      recipientCommuneFoodSafetyUnitId: true,
      recipientOrganization: true,
      status: true,
      forwardedAt: true,
      receivedAt: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  foodSafetyIncidentAllocations: {
    select: {
      mealAllocationId: true,
      MealAllocation: {
        select: {
          status: true,
          DailyMealPortion: {
            select: {
              mealDate: true,
              mealType: true,
              Class: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
    orderBy: { mealAllocationId: "asc" },
  },
  statusHistories: {
    select: {
      fromStatus: true,
      toStatus: true,
      note: true,
      createdAt: true,
      actorRoleCode: true,
      actorUser: person,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} as const satisfies Prisma.FoodSafetyIncidentSelect;

export type FoodSafetyIncidentListRow = Prisma.FoodSafetyIncidentGetPayload<{
  select: typeof listSelect;
}>;
export type FoodSafetyIncidentDetailRow = Prisma.FoodSafetyIncidentGetPayload<{
  select: typeof detailSelect;
}>;
export type FoodSafetyIncidentTarget = {
  id: string;
  status: NonNullable<Status>;
  source: Prisma.FoodSafetyIncidentCreateInput["source"];
};
export type IncidentActor = { id: string; roleCode: string };
export type IncidentRecipient = {
  unitId: string;
  unitName: string;
  officerId: string;
};

export function createFoodSafetyIncidentRepository(connect = getPrisma) {
  return {
    connect,
    async list(
      query: ListQuery,
      where: Prisma.FoodSafetyIncidentWhereInput,
    ): Promise<FoodSafetyIncidentListRow[]> {
      const db = await connect();
      return db.foodSafetyIncident.findMany({
        ...listWindow(query),
        where,
        select: listSelect,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
    },
    findDetail(
      db: Pick<Tx, "foodSafetyIncident">,
      id: string,
      scope: Prisma.FoodSafetyIncidentWhereInput,
    ): Promise<FoodSafetyIncidentDetailRow | null> {
      return db.foodSafetyIncident.findFirst({
        where: { AND: [{ id }, scope] },
        select: detailSelect,
      });
    },
    async lockIncident(tx: Tx, id: string): Promise<void> {
      await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM foodprint.food_safety_incidents
        WHERE id = ${id}::uuid
        FOR UPDATE
      `;
    },
    findTarget(
      tx: Tx,
      id: string,
      schoolId: string,
    ): Promise<FoodSafetyIncidentTarget | null> {
      return tx.foodSafetyIncident.findFirst({
        where: { id, schoolId },
        select: { id: true, status: true, source: true },
      });
    },
    findActiveClass(
      tx: Tx,
      classId: string,
      schoolId: string,
    ): Promise<{ id: string } | null> {
      return tx.class.findFirst({
        where: { id: classId, schoolId, status: "ACTIVE" },
        select: { id: true },
      });
    },
    /** GVCN đang chủ nhiệm lớp tại thời điểm báo cáo. */
    async isCurrentHomeroom(
      tx: Tx,
      classId: string,
      teacherUserId: string,
      at: Date,
    ): Promise<boolean> {
      const row = await tx.classHomeroomAssignment.findFirst({
        where: {
          classId,
          teacherUserId,
          assignedAt: { lte: at },
          OR: [{ endedAt: null }, { endedAt: { gt: at } }],
        },
        select: { id: true },
      });
      return row !== null;
    },
    async findSchoolLocationId(
      tx: Tx,
      schoolId: string,
    ): Promise<string | null> {
      const row = await tx.school.findUnique({
        where: { id: schoolId },
        select: { locationId: true },
      });
      return row?.locationId ?? null;
    },
    /** Đơn vị ATTP đang hoạt động phụ trách phường/xã (Q10). */
    findRecipientUnit(
      tx: Tx,
      locationId: string,
    ): Promise<{ id: string; name: string } | null> {
      return tx.communeFoodSafetyUnit.findFirst({
        where: { locationId, status: "ACTIVE" },
        select: { id: true, name: true },
      });
    },
    /** Mỗi đơn vị có tối đa một cán bộ (uq_users_commune_officer); chỉ nhận cán bộ đang hoạt động. */
    findUnitOfficer(tx: Tx, unitId: string): Promise<{ id: string } | null> {
      return tx.user.findFirst({
        where: {
          communeFoodSafetyUnitId: unitId,
          roleCode: "COMMUNE_FOOD_SAFETY_OFFICER",
          status: "ACTIVE",
        },
        select: { id: true },
      });
    },
    allocateCode(tx: Tx): Promise<string> {
      return allocateBusinessCode(tx, "IC", async (codes) => {
        const rows = await tx.foodSafetyIncident.findMany({
          where: { code: { in: [...codes] } },
          select: { code: true },
        });
        return new Set(rows.flatMap((row) => (row.code ? [row.code] : [])));
      });
    },
    async create(
      tx: Tx,
      data: Prisma.FoodSafetyIncidentUncheckedCreateInput,
    ): Promise<string> {
      const row = await tx.foodSafetyIncident.create({
        data,
        select: { id: true },
      });
      return row.id;
    },
    async recordHistory(
      tx: Tx,
      data: {
        incidentId: string;
        fromStatus: Status | null;
        toStatus: NonNullable<Status>;
        actor: IncidentActor;
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
    /** Chuyển có điều kiện PENDING_SCHOOL_REVIEW → SUBMITTED_TO_AUTHORITY kèm nhận định sơ bộ. */
    async markForwarded(
      tx: Tx,
      id: string,
      data: {
        assessment: NonNullable<
          Prisma.FoodSafetyIncidentCreateInput["schoolPreliminaryAssessment"]
        >;
        note: string | null;
        reviewerId: string;
        unitId: string;
        at: Date;
      },
    ): Promise<number> {
      const result = await tx.foodSafetyIncident.updateMany({
        where: { id, status: "PENDING_SCHOOL_REVIEW" },
        data: {
          status: "SUBMITTED_TO_AUTHORITY",
          schoolPreliminaryAssessment: data.assessment,
          schoolPreliminaryNote: data.note,
          schoolReviewedByUserId: data.reviewerId,
          schoolReviewedAt: data.at,
          recipientCommuneFoodSafetyUnitId: data.unitId,
        },
      });
      return result.count;
    },
    async createForwarding(
      tx: Tx,
      data: {
        incidentId: string;
        recipient: IncidentRecipient;
        forwardedByUserId: string;
        at: Date;
      },
    ): Promise<void> {
      await tx.foodSafetyReportForwarding.create({
        data: {
          incidentId: data.incidentId,
          recipientCommuneFoodSafetyUnitId: data.recipient.unitId,
          recipientUserId: data.recipient.officerId,
          recipientOrganization: data.recipient.unitName,
          forwardingChannel: "IN_APP",
          status: "SENT",
          forwardedByUserId: data.forwardedByUserId,
          attemptedAt: data.at,
          forwardedAt: data.at,
          createdAt: data.at,
        },
      });
    },
    async markCancelled(
      tx: Tx,
      id: string,
      data: {
        reason: NonNullable<
          Prisma.FoodSafetyIncidentCreateInput["cancellationReason"]
        >;
        note: string;
      },
    ): Promise<number> {
      const result = await tx.foodSafetyIncident.updateMany({
        where: { id, status: "PENDING_SCHOOL_REVIEW" },
        data: {
          status: "CANCELLED_BY_SCHOOL",
          cancellationReason: data.reason,
          cancellationNote: data.note,
        },
      });
      return result.count;
    },
    findSchoolAllocations(
      tx: Tx,
      ids: readonly string[],
      schoolId: string,
    ): Promise<{ id: string; status: string }[]> {
      return tx.mealAllocation.findMany({
        where: {
          id: { in: [...ids] },
          DailyMealPortion: { Class: { schoolId } },
        },
        select: { id: true, status: true },
      });
    },
    async addAllocations(
      tx: Tx,
      incidentId: string,
      ids: readonly string[],
    ): Promise<number> {
      const result = await tx.foodSafetyIncidentAllocation.createMany({
        data: ids.map((mealAllocationId) => ({ incidentId, mealAllocationId })),
        skipDuplicates: true,
      });
      return result.count;
    },
  };
}

export const foodSafetyIncidentRepository =
  createFoodSafetyIncidentRepository();
export type FoodSafetyIncidentRepository = ReturnType<
  typeof createFoodSafetyIncidentRepository
>;
