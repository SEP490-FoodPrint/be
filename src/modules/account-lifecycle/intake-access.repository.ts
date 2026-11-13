import type { Prisma } from "../../generated/prisma/client";

export interface ParentLocks {
  schoolId?: string;
  supplierId?: string;
  schoolIds?: string[];
  supplierIds?: string[];
  userIds?: string[];
  roleIds?: string[];
}

export type OrderScope =
  | { schoolId: string; supplierId?: never }
  | { supplierId: string; schoolId?: never };

export function createIntakeAccessRepository() {
  return {
    async lockParents(tx: Prisma.TransactionClient, scope: ParentLocks) {
      for (const id of [
        ...new Set([
          ...(scope.schoolIds ?? []),
          ...(scope.schoolId ? [scope.schoolId] : []),
        ]),
      ].sort()) {
        await tx.$queryRaw`SELECT id FROM foodprint.schools WHERE id = ${id}::uuid FOR UPDATE`;
      }
      for (const id of [
        ...new Set([
          ...(scope.supplierIds ?? []),
          ...(scope.supplierId ? [scope.supplierId] : []),
        ]),
      ].sort()) {
        await tx.$queryRaw`SELECT id FROM foodprint.suppliers WHERE id = ${id}::uuid FOR UPDATE`;
      }
      for (const id of [...new Set(scope.userIds ?? [])].sort()) {
        await tx.$queryRaw`SELECT id FROM foodprint.users WHERE id = ${id}::uuid FOR UPDATE`;
      }
      for (const id of [...new Set(scope.roleIds ?? [])].sort()) {
        await tx.$queryRaw`SELECT id FROM foodprint.roles WHERE id = ${id}::uuid FOR SHARE`;
      }
    },
    async lockOrder(tx: Prisma.TransactionClient, id: string) {
      await tx.$queryRaw`SELECT id FROM foodprint.supply_requests WHERE id = ${id}::uuid FOR UPDATE`;
    },
    async lockForwarding(tx: Prisma.TransactionClient, id: string) {
      await tx.$queryRaw`SELECT id FROM foodprint.food_safety_report_forwardings WHERE id = ${id}::uuid FOR UPDATE`;
    },
    async lockIncident(tx: Prisma.TransactionClient, id: string) {
      await tx.$queryRaw`SELECT id FROM foodprint.food_safety_incidents WHERE id = ${id}::uuid FOR UPDATE`;
    },
    async readOrder(tx: Prisma.TransactionClient, id: string) {
      return await tx.supplyRequest.findUnique({
        where: { id },
        select: { id: true, schoolId: true, supplierId: true, status: true },
      });
    },
    async readSchool(tx: Prisma.TransactionClient, id: string) {
      return await tx.school.findUnique({
        where: { id },
        select: { status: true, intakeState: true },
      });
    },
    async readSupplier(tx: Prisma.TransactionClient, id: string) {
      return await tx.supplier.findUnique({
        where: { id },
        select: { status: true, intakeState: true },
      });
    },
    async readSchoolAdmin(tx: Prisma.TransactionClient, schoolId: string) {
      return await tx.user.findFirst({
        where: { schoolId, roleCode: "SCHOOL_ADMINISTRATION" },
        select: { status: true },
      });
    },
    async readSupplierAdmin(tx: Prisma.TransactionClient, supplierId: string) {
      return await tx.user.findFirst({
        where: { supplierId, roleCode: "INGREDIENT_SUPPLIER_ADMIN" },
        select: { status: true },
      });
    },
    async readOfficer(tx: Prisma.TransactionClient, id: string) {
      return await tx.user.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          intakeState: true,
          roleCode: true,
          communeFoodSafetyUnitId: true,
          Role: { select: { type: true } },
        },
      });
    },
    async readIncident(tx: Prisma.TransactionClient, id: string) {
      return await tx.foodSafetyIncident.findUnique({
        where: { id },
        select: { id: true, schoolId: true },
      });
    },
    async readMember(tx: Prisma.TransactionClient, id: string) {
      return await tx.user.findUnique({
        where: { id },
        select: {
          id: true,
          roleCode: true,
          status: true,
          schoolId: true,
          supplierId: true,
          communeFoodSafetyUnitId: true,
        },
      });
    },
    async readForwarding(tx: Prisma.TransactionClient, id: string) {
      return await tx.foodSafetyReportForwarding.findUnique({
        where: { id },
        select: {
          id: true,
          incidentId: true,
          recipientUserId: true,
          recipientCommuneFoodSafetyUnitId: true,
          receivedAt: true,
          FoodSafetyIncident: { select: { status: true } },
        },
      });
    },
    async hasOngoingOrders(tx: Prisma.TransactionClient, scope: OrderScope) {
      return Boolean(
        await tx.supplyRequest.findFirst({
          where: { ...scope, status: "IN_PROGRESS" },
          select: { id: true },
        }),
      );
    },
    async hasOpenReports(
      tx: Prisma.TransactionClient,
      userId: string,
      unitId: string,
    ) {
      return Boolean(
        await tx.foodSafetyReportForwarding.findFirst({
          where: {
            OR: [
              { recipientUserId: userId },
              {
                recipientUserId: null,
                recipientCommuneFoodSafetyUnitId: unitId,
              },
            ],
            FoodSafetyIncident: { status: { not: "CLOSED" } },
          },
          select: { id: true },
        }),
      );
    },
  };
}

export type IntakeAccessRepository = ReturnType<
  typeof createIntakeAccessRepository
>;
