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
  orderType: true,
  batchNo: true,
  acceptedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.SupplyRequestSelect;
type TypeBatchFilter = {
  orderType?: "DIRECT_USE" | "DRY_STOCK";
  batchNo?: number;
};
function withTypeBatch(
  scope: Prisma.SupplyRequestWhereInput,
  query: TypeBatchFilter,
): Prisma.SupplyRequestWhereInput {
  const extra: Prisma.SupplyRequestWhereInput[] = [];
  if (query.orderType) extra.push({ orderType: query.orderType });
  if (query.batchNo !== undefined) extra.push({ batchNo: query.batchNo });
  return extra.length ? { AND: [scope, ...extra] } : scope;
}
/** Danh sách của trường kèm dữ liệu chi tiết (?include=items); chỉ gồm trường mà API chi tiết đã trả cho trường. */
const schoolListWithItemsSelect = {
  ...listSelect,
  requestedDeliveryDate: true,
  note: true,
  sentAt: true,
  Supplier: { select: { name: true, phone: true } },
  supplyRequestItems: {
    select: {
      id: true,
      ingredientEntryId: true,
      requestedQuantity: true,
      sampleTopUpQuantity: true,
      carryOverQuantity: true,
      sampleCompensationQuantity: true,
      unit: true,
      note: true,
      IngredientEntry: {
        select: { handlingType: true, Ingredient: { select: { name: true } } },
      },
    },
    orderBy: [{ id: "asc" as const }],
  },
} as const satisfies Prisma.SupplyRequestSelect;
export type SchoolOrderListWithItemsRow = Prisma.SupplyRequestGetPayload<{
  select: typeof schoolListWithItemsSelect;
}>;
const supplierOrderStatuses = [
  "SENT",
  "ACCEPTED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] satisfies SupplyRequestStatus[];
type SupplierOrderListQuery = ListQuery &
  TypeBatchFilter & {
    status?: Exclude<SupplyRequestStatus, "DRAFT">;
  };
const supplierListSelect = {
  ...listSelect,
  requestedDeliveryDate: true,
  sentAt: true,
  School: { select: { id: true, name: true, cookingMode: true } },
  _count: { select: { deliveries: true } },
  deliveries: {
    where: { creationMode: "REQUEST" as const },
    select: {
      id: true,
      status: true,
      workflowVersion: true,
    },
    orderBy: [{ id: "asc" as const }],
    take: 2,
  },
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
      sampleTopUpQuantity: true,
      carryOverQuantity: true,
      sampleCompensationQuantity: true,
      unit: true,
      note: true,
      IngredientEntry: {
        select: { handlingType: true, Ingredient: { select: { name: true } } },
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
    async list(
      query: ListQuery & TypeBatchFilter,
      scope: Prisma.SupplyRequestWhereInput,
    ) {
      const db = await connect();
      return db.supplyRequest.findMany({
        ...listWindow(query),
        where: withTypeBatch(scope, query),
        select: listSelect,
        orderBy: [{ id: "asc" }],
      });
    },
    async listWithItems(
      query: ListQuery & TypeBatchFilter,
      scope: Prisma.SupplyRequestWhereInput,
    ) {
      const db = await connect();
      return db.supplyRequest.findMany({
        ...listWindow(query),
        where: withTypeBatch(scope, query),
        select: schoolListWithItemsSelect,
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
            withTypeBatch(scope, query),
            { status: { in: supplierOrderStatuses } },
            ...(query.status ? [{ status: query.status }] : []),
          ],
        },
        select: supplierListSelect,
        // Ngày giao dự kiến mới nhất lên đầu; đơn chưa có ngày xếp cuối, id giữ thứ tự ổn định khi phân trang
        orderBy: [
          { requestedDeliveryDate: { sort: "desc", nulls: "last" } },
          { id: "asc" },
        ],
      });
    },
    async findDetailForSupplier(id: string, supplierId: string) {
      const db = await connect();
      return db.supplyRequest.findFirst({
        where: { id, supplierId, status: { in: supplierOrderStatuses } },
        select: supplierDetailSelect,
      });
    },
    async findDetailForSchool(id: string, schoolId: string) {
      const db = await connect();
      return db.supplyRequest.findFirst({
        where: { id, schoolId },
        select: supplierDetailSelect,
      });
    },
    async findDetailById(id: string) {
      const db = await connect();
      return db.supplyRequest.findFirst({
        where: { id },
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
