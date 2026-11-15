import type { AccountStatus, Prisma } from "../../generated/prisma/client";

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
    async lockSupplierSchoolPair(
      tx: Prisma.TransactionClient,
      schoolId: string,
      supplierId: string,
    ) {
      const pairKey = `${schoolId}:${supplierId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${pairKey}, 0))`;
    },
    async lockRelationship(
      tx: Prisma.TransactionClient,
      schoolId: string,
      supplierId: string,
    ) {
      await tx.$queryRaw`SELECT id FROM foodprint.school_supplier_relationships WHERE school_id = ${schoolId}::uuid AND supplier_id = ${supplierId}::uuid FOR UPDATE`;
    },
    async lockIngredients(
      tx: Prisma.TransactionClient,
      ingredientIds: readonly string[],
    ) {
      for (const id of [...new Set(ingredientIds)].sort()) {
        await tx.$queryRaw`SELECT id FROM foodprint.ingredients WHERE id = ${id}::uuid FOR UPDATE`;
      }
    },
    async lockSourceFacilities(
      tx: Prisma.TransactionClient,
      sourceFacilityIds: readonly string[],
      supplierId?: string,
    ) {
      for (const id of [...new Set(sourceFacilityIds)].sort()) {
        if (supplierId) {
          await tx.$queryRaw`SELECT id FROM foodprint.source_facilities WHERE id = ${id}::uuid AND supplier_id = ${supplierId}::uuid FOR UPDATE`;
        } else {
          await tx.$queryRaw`SELECT id FROM foodprint.source_facilities WHERE id = ${id}::uuid FOR UPDATE`;
        }
      }
    },
    async lockForwarding(tx: Prisma.TransactionClient, id: string) {
      await tx.$queryRaw`SELECT id FROM foodprint.food_safety_report_forwardings WHERE id = ${id}::uuid FOR UPDATE`;
    },
    async lockIncident(tx: Prisma.TransactionClient, id: string) {
      await tx.$queryRaw`SELECT id FROM foodprint.food_safety_incidents WHERE id = ${id}::uuid FOR UPDATE`;
    },
    async lockDelivery(
      tx: Prisma.TransactionClient,
      id: string,
      supplierId?: string,
    ) {
      if (supplierId) {
        await tx.$queryRaw`SELECT id FROM foodprint.deliveries WHERE id = ${id}::uuid AND supplier_id = ${supplierId}::uuid FOR UPDATE`;
      } else {
        await tx.$queryRaw`SELECT id FROM foodprint.deliveries WHERE id = ${id}::uuid FOR UPDATE`;
      }
    },
    async readOrder(tx: Prisma.TransactionClient, id: string) {
      return await tx.supplyRequest.findUnique({
        where: { id },
        select: { id: true, schoolId: true, supplierId: true, status: true },
      });
    },
    async readDelivery(
      tx: Prisma.TransactionClient,
      id: string,
      supplierId: string,
    ) {
      return await tx.delivery.findFirst({
        where: { id, supplierId },
        select: {
          id: true,
          schoolId: true,
          supplierId: true,
          supplyRequestId: true,
          status: true,
          workflowVersion: true,
          traceabilityVersion: true,
          expectedArrivalAt: true,
          vehiclePlate: true,
        },
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
      const rows = await tx.$queryRaw<{ status: AccountStatus }[]>`
        SELECT status::text AS status
        FROM foodprint.users
        WHERE school_id = ${schoolId}::uuid
          AND role_code = 'SCHOOL_ADMINISTRATION'
        LIMIT 1
        FOR SHARE
      `;
      return rows[0] ?? null;
    },
    async readSupplierAdmin(tx: Prisma.TransactionClient, supplierId: string) {
      const rows = await tx.$queryRaw<{ status: AccountStatus }[]>`
        SELECT status::text AS status
        FROM foodprint.users
        WHERE supplier_id = ${supplierId}::uuid
          AND role_code = 'INGREDIENT_SUPPLIER_ADMIN'
        LIMIT 1
        FOR SHARE
      `;
      return rows[0] ?? null;
    },
    async readRelationship(
      tx: Prisma.TransactionClient,
      schoolId: string,
      supplierId: string,
    ) {
      return await tx.schoolSupplierRelationship.findFirst({
        where: {
          schoolId,
          supplierId,
          status: { in: ["ACTIVE", "SUSPENDED"] },
        },
        orderBy: [{ linkedAt: "desc" }, { id: "desc" }],
        select: { id: true, status: true },
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
