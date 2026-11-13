import type { IntakeState, Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import {
  createIntakeAccessRepository,
  type OrderScope,
  type ParentLocks,
} from "./intake-access.repository";

const targetSelect = {
  id: true,
  roleCode: true,
  status: true,
  schoolId: true,
  supplierId: true,
  communeFoodSafetyUnitId: true,
  intakeState: true,
  updatedAt: true,
  Role: { select: { type: true } },
  School: { select: { intakeState: true, updatedAt: true } },
  Supplier: { select: { intakeState: true, updatedAt: true } },
} as const satisfies Prisma.UserSelect;
export type LifecycleTarget = Prisma.UserGetPayload<{
  select: typeof targetSelect;
}>;

export function createAccountLifecycleRepository(connect = getPrisma) {
  const intake = createIntakeAccessRepository();
  return {
    connect,
    async findTarget(tx: Prisma.TransactionClient, id: string) {
      return await tx.user.findUnique({ where: { id }, select: targetSelect });
    },
    async lockParents(tx: Prisma.TransactionClient, scope: ParentLocks) {
      await intake.lockParents(tx, scope);
    },
    async hasOngoingOrders(tx: Prisma.TransactionClient, scope: OrderScope) {
      return await intake.hasOngoingOrders(tx, scope);
    },
    async hasOpenReports(
      tx: Prisma.TransactionClient,
      userId: string,
      unitId: string,
    ) {
      return await intake.hasOpenReports(tx, userId, unitId);
    },
    async countAccounts(tx: Prisma.TransactionClient, scope: OrderScope) {
      const [total, active] = await Promise.all([
        tx.user.count({ where: scope }),
        tx.user.count({ where: { ...scope, status: { not: "DEACTIVATED" } } }),
      ]);
      return { total, active };
    },
    async deactivateAccounts(tx: Prisma.TransactionClient, scope: OrderScope) {
      await tx.user.updateMany({
        where: { ...scope, status: { not: "DEACTIVATED" } },
        data: { status: "DEACTIVATED" },
      });
    },
    async deactivateOfficer(tx: Prisma.TransactionClient, id: string) {
      await tx.user.updateMany({
        where: {
          id,
          roleCode: "COMMUNE_FOOD_SAFETY_OFFICER",
          status: { not: "DEACTIVATED" },
        },
        data: { status: "DEACTIVATED" },
      });
    },
    async setIntakeState(
      tx: Prisma.TransactionClient,
      target: LifecycleTarget,
      state: IntakeState,
    ) {
      if (target.roleCode === "SCHOOL_ADMINISTRATION" && target.schoolId) {
        await tx.school.update({
          where: { id: target.schoolId },
          data: { intakeState: state },
        });
      } else if (
        target.roleCode === "INGREDIENT_SUPPLIER_ADMIN" &&
        target.supplierId
      ) {
        await tx.supplier.update({
          where: { id: target.supplierId },
          data: { intakeState: state },
        });
      } else if (
        target.roleCode === "COMMUNE_FOOD_SAFETY_OFFICER" &&
        target.communeFoodSafetyUnitId
      ) {
        await tx.user.update({
          where: { id: target.id },
          data: { intakeState: state },
        });
      } else {
        throw new Error("Unsupported lifecycle target");
      }
    },
  };
}

export type AccountLifecycleRepository = ReturnType<
  typeof createAccountLifecycleRepository
>;
