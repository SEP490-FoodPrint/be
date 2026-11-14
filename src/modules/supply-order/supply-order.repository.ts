import type {
  Prisma,
  SupplyRequestStatus,
} from "../../generated/prisma/client";
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
const supplierOrderStatuses = [
  "SENT",
  "ACCEPTED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] satisfies SupplyRequestStatus[];
type SupplierOrderListQuery = ListQuery & {
  status?: Exclude<SupplyRequestStatus, "DRAFT">;
};
const supplierListSelect = {
  ...listSelect,
  requestedDeliveryDate: true,
  sentAt: true,
  School: { select: { id: true, name: true } },
} as const satisfies Prisma.SupplyRequestSelect;
const supplierDetailSelect = {
  ...supplierListSelect,
  note: true,
  acceptedByUserId: true,
  supplyRequestItems: {
    select: {
      id: true,
      ingredientEntryId: true,
      requestedQuantity: true,
      unit: true,
      note: true,
      IngredientEntry: {
        select: { Ingredient: { select: { name: true } } },
      },
    },
    orderBy: [{ id: "asc" }],
  },
} as const satisfies Prisma.SupplyRequestSelect;
export type SupplierOrderListRow = Prisma.SupplyRequestGetPayload<{
  select: typeof supplierListSelect;
}>;
export type SupplierOrderDetailRow = Prisma.SupplyRequestGetPayload<{
  select: typeof supplierDetailSelect;
}>;
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
    async listForSupplier(
      query: SupplierOrderListQuery,
      scope: Prisma.SupplyRequestWhereInput,
    ) {
      const db = await connect();
      return db.supplyRequest.findMany({
        ...listWindow(query),
        where: {
          AND: [
            scope,
            { status: { in: supplierOrderStatuses } },
            ...(query.status ? [{ status: query.status }] : []),
          ],
        },
        select: supplierListSelect,
        orderBy: [{ id: "asc" }],
      });
    },
    async findDetailForSupplier(id: string, supplierId: string) {
      const db = await connect();
      return db.supplyRequest.findFirst({
        where: { id, supplierId, status: { in: supplierOrderStatuses } },
        select: supplierDetailSelect,
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
