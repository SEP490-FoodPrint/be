import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import { listWindow, type ListQuery } from "../../utils/list-query";
const listSelect = {
  id: true,
  incidentId: true,
  recipientCommuneFoodSafetyUnitId: true,
  recipientOrganization: true,
  referenceNumber: true,
  status: true,
  attemptedAt: true,
  forwardedAt: true,
  createdAt: true,
} as const satisfies Prisma.FoodSafetyReportForwardingSelect;
const receivedSelect = {
  id: true,
  incidentId: true,
  recipientUserId: true,
  recipientCommuneFoodSafetyUnitId: true,
  receivedAt: true,
  FoodSafetyIncident: { select: { status: true } },
} as const satisfies Prisma.FoodSafetyReportForwardingSelect;
export type ReceivedReportRow = Prisma.FoodSafetyReportForwardingGetPayload<{
  select: typeof receivedSelect;
}>;
export function createReportingRepository(connect = getPrisma) {
  return {
    connect,
    async list(
      query: ListQuery,
      scope: Prisma.FoodSafetyReportForwardingWhereInput,
    ) {
      const db = await connect();
      return db.foodSafetyReportForwarding.findMany({
        ...listWindow(query),
        where: scope,
        select: listSelect,
        orderBy: [{ id: "asc" }],
      });
    },
    async findForOfficer(
      tx: Prisma.TransactionClient,
      id: string,
      officerId: string,
      unitId: string,
    ) {
      return await tx.foodSafetyReportForwarding.findFirst({
        where: {
          id,
          recipientUserId: officerId,
          recipientCommuneFoodSafetyUnitId: unitId,
        },
        select: receivedSelect,
      });
    },
    async receive(
      tx: Prisma.TransactionClient,
      id: string,
      officerId: string,
      unitId: string,
      receivedAt: Date,
    ) {
      const result = await tx.foodSafetyReportForwarding.updateMany({
        where: {
          id,
          recipientUserId: officerId,
          recipientCommuneFoodSafetyUnitId: unitId,
          receivedAt: null,
          FoodSafetyIncident: { status: { not: "CLOSED" } },
        },
        data: { receivedAt },
      });
      return result.count;
    },
  };
}
export type ReportingRepository = ReturnType<typeof createReportingRepository>;
