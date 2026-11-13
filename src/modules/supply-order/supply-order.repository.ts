import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import { listWindow, type ListQuery } from "../../utils/list-query";

const listSelect = {
  id: true,
  requestNo: true,
  schoolId: true,
  supplierId: true,
  status: true,
  acceptedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.SupplyRequestSelect;
const acceptedSelect = {
  id: true,
  supplierId: true,
  status: true,
  acceptedByUserId: true,
  acceptedAt: true,
} as const satisfies Prisma.SupplyRequestSelect;
export type AcceptedOrderRow = Prisma.SupplyRequestGetPayload<{
  select: typeof acceptedSelect;
}>;

export function createSupplyOrderRepository(connect = getPrisma) {
  return {
    connect,
    async list(query: ListQuery, scope: Prisma.SupplyRequestWhereInput) {
      const db = await connect();
      return db.supplyRequest.findMany({
        ...listWindow(query),
        where: scope,
        select: listSelect,
        orderBy: [{ id: "asc" }],
      });
    },
    async findForSupplier(
      tx: Prisma.TransactionClient,
      id: string,
      supplierId: string,
    ) {
      return await tx.supplyRequest.findFirst({
        where: { id, supplierId },
        select: acceptedSelect,
      });
    },
    async accept(
      tx: Prisma.TransactionClient,
      id: string,
      supplierId: string,
      actorId: string,
      acceptedAt: Date,
    ) {
      const result = await tx.supplyRequest.updateMany({
        where: { id, supplierId, status: "SENT" },
        data: { status: "ACCEPTED", acceptedByUserId: actorId, acceptedAt },
      });
      return result.count;
    },
  };
}
export type SupplyOrderRepository = ReturnType<
  typeof createSupplyOrderRepository
>;
