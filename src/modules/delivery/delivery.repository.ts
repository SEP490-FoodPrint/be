import type { Prisma } from "../../generated/prisma/client";
import type { DeliveryInspectionQueryDTO } from "./delivery.request.dto";

type Tx = Prisma.TransactionClient;
const summarySelect = {
  id: true,
  deliveryNo: true,
  supplyRequestId: true,
  status: true,
  expectedArrivalAt: true,
  arrivedAt: true,
  receivedAt: true,
  vehiclePlate: true,
  note: true,
  Supplier: { select: { name: true } },
  SupplyRequest: {
    select: {
      requestNo: true,
      schoolId: true,
      supplierId: true,
      status: true,
      _count: {
        select: {
          deliveries: {
            where: { deliveryApprovals: { some: { decision: "REJECT" } } },
          },
        },
      },
    },
  },
  deliveryApprovals: {
    orderBy: [{ decidedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      roleId: true,
      userId: true,
      decision: true,
      reason: true,
      decidedAt: true,
      Role: { select: { code: true, name: true } },
      User: { select: { fullName: true } },
    },
  },
} as const satisfies Prisma.DeliverySelect;

const detailSelect = {
  ...summarySelect,
  supplierId: true,
  deliveryItems: {
    orderBy: { id: "asc" },
    select: {
      id: true,
      actualQuantity: true,
      supplyRequestItemId: true,
      unit: true,
      SupplyRequestItem: {
        select: {
          supplyRequestId: true,
          ingredientEntryId: true,
          requestedQuantity: true,
          unit: true,
          IngredientEntry: {
            select: {
              schoolId: true,
              Ingredient: {
                select: {
                  name: true,
                  supplierId: true,
                  ingredientCategory: { select: { categoryName: true } },
                },
              },
            },
          },
        },
      },
      ingredientLots: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          lotCode: true,
          qrToken: true,
          manufactureDate: true,
          expiryDate: true,
          receivedQuantity: true,
          availableQuantity: true,
          unit: true,
          status: true,
          SourceFacility: { select: { name: true, supplierId: true } },
        },
      },
    },
  },
} as const satisfies Prisma.DeliverySelect;

function inspectionWhere(
  schoolId: string,
  query: DeliveryInspectionQueryDTO,
  range?: { gte: Date; lt: Date },
): Prisma.DeliveryWhereInput {
  return {
    SupplyRequest: { schoolId },
    ...(query.status ? { status: query.status } : {}),
    AND: [
      ...(query.search
        ? [
            {
              OR: [
                {
                  deliveryNo: {
                    contains: query.search,
                    mode: "insensitive" as const,
                  },
                },
                {
                  Supplier: {
                    name: {
                      contains: query.search,
                      mode: "insensitive" as const,
                    },
                  },
                },
              ],
            },
          ]
        : []),
      ...(range
        ? [
            {
              OR: [
                { arrivedAt: range },
                { arrivedAt: null, expectedArrivalAt: range },
                { arrivedAt: null, expectedArrivalAt: null, receivedAt: range },
                {
                  arrivedAt: null,
                  expectedArrivalAt: null,
                  receivedAt: null,
                  createdAt: range,
                },
              ],
            },
          ]
        : []),
    ],
  };
}

export const deliveryInspectionRepository = {
  receivedItems(tx: Tx, supplyRequestItemId: string) {
    return tx.deliveryItem.findMany({
      where: { supplyRequestItemId, Delivery: { status: "RECEIVED" } },
      select: { actualQuantity: true, unit: true },
    });
  },
  async lock(tx: Tx, schoolId: string, id: string) {
    const scoped = await tx.delivery.findFirst({
      where: { id, SupplyRequest: { schoolId } },
      select: { supplyRequestId: true },
    });
    if (!scoped) return false;
    await tx.$queryRaw`SELECT id FROM foodprint.supply_requests WHERE id = ${scoped.supplyRequestId}::uuid AND school_id = ${schoolId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM foodprint.deliveries WHERE id = ${id}::uuid FOR UPDATE`;
    return true;
  },
  async lockLots(tx: Tx, ids: string[]) {
    for (const id of [...new Set(ids)].sort())
      await tx.$queryRaw`SELECT id FROM foodprint.ingredient_lots WHERE id = ${id}::uuid FOR UPDATE`;
  },
  historyCount(tx: Tx, ids: string[]) {
    return tx.inventoryTransaction.count({
      where: { ingredientLotId: { in: ids } },
    });
  },
  decide(
    tx: Tx,
    deliveryId: string,
    userId: string,
    roleId: string,
    decision: "APPROVE" | "REJECT",
    reason: string | null,
  ) {
    return tx.deliveryApproval.create({
      data: { deliveryId, userId, roleId, decision, reason },
    });
  },
  setStatus(
    tx: Tx,
    id: string,
    status: "PENDING_APPROVAL" | "REJECTED" | "RECEIVED",
    actorId: string,
    now: Date,
  ) {
    return tx.delivery.update({
      where: { id },
      data: {
        status,
        ...(status === "RECEIVED"
          ? { receivedAt: now, receivedByUserId: actorId }
          : {}),
      },
    });
  },
  rejectedCount(tx: Tx, supplyRequestId: string) {
    return tx.delivery.count({
      where: {
        supplyRequestId,
        deliveryApprovals: { some: { decision: "REJECT" } },
      },
    });
  },
  async cancelRemainder(tx: Tx, supplyRequestId: string) {
    await tx.supplyRequest.update({
      where: { id: supplyRequestId },
      data: { status: "CANCELLED" },
    });
    await tx.delivery.updateMany({
      where: {
        supplyRequestId,
        status: {
          in: [
            "CREATED",
            "IN_TRANSIT",
            "ARRIVED",
            "PENDING_APPROVAL",
            "APPROVED",
          ],
        },
      },
      data: { status: "CANCELLED" },
    });
    await tx.ingredientLot.updateMany({
      where: {
        DeliveryItem: {
          Delivery: { supplyRequestId, status: { not: "RECEIVED" } },
        },
        status: "AVAILABLE",
      },
      data: { status: "BLOCKED" },
    });
  },
  async receiveLot(
    tx: Tx,
    lot: { id: string; receivedQuantity: Prisma.Decimal; unit: string },
    deliveryId: string,
    actorId: string,
  ) {
    const result = await tx.ingredientLot.updateMany({
      where: { id: lot.id, status: "BLOCKED", availableQuantity: 0 },
      data: { availableQuantity: lot.receivedQuantity, status: "AVAILABLE" },
    });
    if (result.count !== 1) return false;
    await tx.inventoryTransaction.create({
      data: {
        ingredientLotId: lot.id,
        movementType: "RECEIPT",
        quantity: lot.receivedQuantity,
        unit: lot.unit,
        createdByUserId: actorId,
        referenceType: "DELIVERY",
        referenceId: deliveryId,
      },
    });
    return true;
  },
  list(
    tx: Tx,
    schoolId: string,
    query: DeliveryInspectionQueryDTO,
    range?: { gte: Date; lt: Date },
  ) {
    return tx.delivery.findMany({
      where: inspectionWhere(schoolId, query, range),
      select: summarySelect,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
  },
  counts(
    tx: Tx,
    schoolId: string,
    query: DeliveryInspectionQueryDTO,
    range?: { gte: Date; lt: Date },
  ) {
    return tx.delivery.groupBy({
      by: ["status"],
      where: inspectionWhere(schoolId, query, range),
      _count: { _all: true },
    });
  },
  detail(tx: Tx, schoolId: string, id: string) {
    return tx.delivery.findFirst({
      where: { id, SupplyRequest: { schoolId } },
      select: detailSelect,
    });
  },
};
export type DeliveryInspectionRow = Prisma.DeliveryGetPayload<{
  select: typeof summarySelect;
}>;
export type DeliveryInspectionDetailRow = Prisma.DeliveryGetPayload<{
  select: typeof detailSelect;
}>;
