import type {
  DeliveryInspectionTier,
  DeliveryStatus,
  Prisma,
} from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";

type Tx = Prisma.TransactionClient;

export interface DeliveryInspectionQueryFilter {
  page: number;
  limit: number;
  search?: string;
  status?: DeliveryStatus;
  period: "ALL" | "today" | "week";
  date?: string;
}

export const deliveryListSelect = {
  id: true,
  deliveryNo: true,
  schoolId: true,
  supplyRequestId: true,
  supplierId: true,
  creationMode: true,
  status: true,
  expectedArrivalAt: true,
  arrivedAt: true,
  receivedAt: true,
  vehiclePlate: true,
  note: true,
  createdAt: true,
  updatedAt: true,
  Supplier: {
    select: {
      id: true,
      name: true,
      phone: true,
    },
  },
  SupplyRequest: {
    select: {
      id: true,
      requestNo: true,
      requestedDeliveryDate: true,
      note: true,
      status: true,
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
  deliveryItems: {
    orderBy: { id: "asc" },
    select: {
      id: true,
      ingredientId: true,
      ingredientEntryId: true,
      supplyRequestItemId: true,
      actualQuantity: true,
      unit: true,
      note: true,
      Ingredient: {
        select: {
          id: true,
          name: true,
        },
      },
      IngredientEntry: {
        select: {
          id: true,
          handlingType: true,
        },
      },
      SupplyRequestItem: {
        select: {
          requestedQuantity: true,
          unit: true,
          IngredientEntry: {
            select: {
              handlingType: true,
              Ingredient: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      },
    },
  },
} as const satisfies Prisma.DeliverySelect;

export type DeliveryListRow = Prisma.DeliveryGetPayload<{
  select: typeof deliveryListSelect;
}>;
export type DeliveryListArguments = Pick<
  Prisma.DeliveryFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof deliveryListSelect;
};
export type DeliveryListReader = (
  args: DeliveryListArguments,
) => Promise<DeliveryListRow[]>;

export const readDeliveriesFromDatabase: DeliveryListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.delivery.findMany(args);
};

const summarySelect = {
  id: true,
  deliveryNo: true,
  schoolId: true,
  supplierId: true,
  creationMode: true,
  traceabilityVersion: true,
  workflowVersion: true,
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
            where: { status: "REJECTED" },
          },
        },
      },
    },
  },
  inspectionRoles: {
    select: {
      tier: true,
      Role: { select: { code: true } },
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
      photoPublicId: true,
      photoHash: true,
      decidedAt: true,
      Role: { select: { code: true, name: true } },
      User: { select: { fullName: true } },
    },
  },
  deliveryItems: {
    select: {
      IngredientEntry: { select: { handlingType: true } },
      SupplyRequestItem: {
        select: { IngredientEntry: { select: { handlingType: true } } },
      },
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
      ingredientId: true,
      ingredientEntryId: true,
      supplyRequestItemId: true,
      sourceFacilityId: true,
      sourceFacilityNameSnapshot: true,
      sourceFacilityCodeSnapshot: true,
      ingredientNameSnapshot: true,
      actualQuantity: true,
      unit: true,
      Ingredient: {
        select: {
          id: true,
          name: true,
          supplierId: true,
          ingredientCategory: { select: { categoryName: true } },
        },
      },
      IngredientEntry: {
        select: {
          id: true,
          schoolId: true,
          ingredientId: true,
          status: true,
          handlingType: true,
        },
      },
      SupplyRequestItem: {
        select: {
          supplyRequestId: true,
          ingredientEntryId: true,
          requestedQuantity: true,
          unit: true,
          IngredientEntry: {
            select: {
              schoolId: true,
              ingredientId: true,
              status: true,
              handlingType: true,
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
          sourceFacilityId: true,
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

/**
 * Xe đồ khô: mọi dòng hàng là DRY_STOCK. Chỉ cần 1 dòng đồ tươi là xe đồ tươi.
 * Cùng tiêu chí với requiredInspectionRoles; không suy luận theo nhà cung cấp.
 */
export const dryOnlyDeliveryWhere = {
  deliveryItems: {
    some: {},
    every: {
      OR: [
        { IngredientEntry: { handlingType: "DRY_STOCK" } },
        {
          ingredientEntryId: null,
          SupplyRequestItem: { IngredientEntry: { handlingType: "DRY_STOCK" } },
        },
      ],
    },
  },
} satisfies Prisma.DeliveryWhereInput;

function inspectionWhere(
  schoolId: string,
  query: DeliveryInspectionQueryFilter,
  range?: { gte: Date; lt: Date },
  hideDryOnly = false,
): Prisma.DeliveryWhereInput {
  return {
    schoolId,
    ...(query.status ? { status: query.status } : {}),
    AND: [
      // Xe đồ khô chỉ hiện cho Ban quản lý nguyên liệu.
      ...(hideDryOnly ? [{ NOT: dryOnlyDeliveryWhere }] : []),
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
              // Xe thuộc cả ngày giao dự kiến lẫn ngày đến thực tế: bấm "xe đến" sớm/muộn không làm
              // xe biến khỏi ngày giao của nó với các bộ phận kiểm tra khác.
              OR: [
                { expectedArrivalAt: range },
                { arrivedAt: range },
                { arrivedAt: null, expectedArrivalAt: null, receivedAt: range },
                {
                  arrivedAt: null,
                  expectedArrivalAt: null,
                  receivedAt: null,
                  createdAt: range,
                },
                {
                  SupplyRequest: {
                    requestedDeliveryDate: range,
                  },
                },
              ],
            },
          ]
        : []),
    ],
  };
}

export const deliveryInspectionRepository = {
  listRequestSourceItems(
    tx: Tx,
    supplyRequestId: string,
    schoolId: string,
    supplierId: string,
  ) {
    return tx.supplyRequestItem.findMany({
      where: {
        supplyRequestId,
        SupplyRequest: { id: supplyRequestId, schoolId, supplierId },
      },
      orderBy: { id: "asc" },
      select: {
        id: true,
        supplyRequestId: true,
        ingredientEntryId: true,
        requestedQuantity: true,
        unit: true,
        IngredientEntry: {
          select: {
            ingredientId: true,
            schoolId: true,
            status: true,
            Ingredient: { select: { supplierId: true } },
          },
        },
      },
    });
  },
  async receivedItemsBySourceIds(
    tx: Tx,
    supplyRequestItemIds: readonly string[],
    excludeDeliveryId?: string,
  ) {
    const ids = [...new Set(supplyRequestItemIds)];
    if (!ids.length) return [];
    return tx.deliveryItem.findMany({
      where: {
        supplyRequestItemId: { in: ids },
        Delivery: {
          status: "RECEIVED",
          ...(excludeDeliveryId ? { id: { not: excludeDeliveryId } } : {}),
        },
      },
      select: {
        supplyRequestItemId: true,
        actualQuantity: true,
        unit: true,
      },
    });
  },
  async lock(tx: Tx, schoolId: string, id: string) {
    const scoped = await tx.delivery.findFirst({
      where: { id, schoolId },
      select: { supplyRequestId: true },
    });
    if (!scoped) return false;
    if (scoped.supplyRequestId) {
      await tx.$queryRaw`SELECT id FROM foodprint.supply_requests WHERE id = ${scoped.supplyRequestId}::uuid AND school_id = ${schoolId}::uuid FOR UPDATE`;
    }
    await tx.$queryRaw`SELECT id FROM foodprint.deliveries WHERE id = ${id}::uuid AND school_id = ${schoolId}::uuid FOR UPDATE`;
    return true;
  },
  async findSchoolIngredientEntries(
    tx: Tx,
    schoolId: string,
    ingredientIds: readonly string[],
  ) {
    const ids = [...new Set(ingredientIds)];
    if (!ids.length) return [];
    return tx.ingredientEntry.findMany({
      where: { schoolId, ingredientId: { in: ids } },
      select: {
        id: true,
        schoolId: true,
        ingredientId: true,
        status: true,
        handlingType: true,
      },
    });
  },
  attachDeliveryItemEntry(
    tx: Tx,
    deliveryItemId: string,
    ingredientEntryId: string,
  ) {
    return tx.deliveryItem.update({
      where: { id: deliveryItemId },
      data: { ingredientEntryId },
      select: { id: true, ingredientEntryId: true },
    });
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
    photo: { photoPublicId: string; photoHash: string } | null = null,
  ) {
    return tx.deliveryApproval.create({
      data: { deliveryId, userId, roleId, decision, reason, ...photo },
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
  markArrived(tx: Tx, id: string, schoolId: string, now: Date) {
    return tx.delivery.updateMany({
      where: {
        id,
        schoolId,
        traceabilityVersion: 1,
        status: "IN_TRANSIT",
        arrivedAt: null,
      },
      data: {
        status: "ARRIVED",
        arrivedAt: now,
      },
    });
  },
  findSchoolInspectionTiers(tx: Tx, schoolId: string) {
    if (!tx.schoolDeliveryInspectionRole?.findMany) {
      return Promise.resolve([]);
    }
    return tx.schoolDeliveryInspectionRole.findMany({
      where: { schoolId },
      select: {
        tier: true,
        Role: { select: { code: true } },
      },
    });
  },
  snapshotInspectionRoles(
    tx: Tx,
    deliveryId: string,
    rows: { roleId: string; tier: DeliveryInspectionTier }[],
  ) {
    if (!tx.deliveryInspectionRole?.createMany) {
      return Promise.resolve({ count: rows.length });
    }
    return tx.deliveryInspectionRole.createMany({
      data: rows.map((r) => ({
        deliveryId,
        roleId: r.roleId,
        tier: r.tier,
      })),
    });
  },
  findInspectionRoleIds(tx: Tx, codes: string[]) {
    if (!tx.role?.findMany) {
      return Promise.resolve(
        codes.map((code, idx) => ({ id: `role-id-${idx}`, code })),
      );
    }
    return tx.role.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true },
    });
  },
  rejectedCount(tx: Tx, supplyRequestId: string) {
    return tx.delivery.count({
      where: {
        supplyRequestId,
        status: "REJECTED",
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
            "PREPARING",
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
  async list(
    tx: Tx,
    schoolId: string,
    query: DeliveryInspectionQueryFilter,
    range?: { gte: Date; lt: Date },
    hideDryOnly = false,
  ) {
    return tx.delivery.findMany({
      where: inspectionWhere(schoolId, query, range, hideDryOnly),
      select: summarySelect,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
  },
  async counts(
    tx: Tx,
    schoolId: string,
    query: DeliveryInspectionQueryFilter,
    range?: { gte: Date; lt: Date },
    hideDryOnly = false,
  ) {
    return tx.delivery.groupBy({
      by: ["status"],
      where: inspectionWhere(schoolId, query, range, hideDryOnly),
      _count: { _all: true },
    });
  },
  async detail(tx: Tx, schoolId: string, id: string) {
    return tx.delivery.findFirst({
      where: { id, schoolId },
      select: detailSelect,
    });
  },
  /** Tìm đợt giao của trường theo mã QR dòng hàng, mã QR lô hoặc mã đợt giao. */
  async findByScanCode(
    tx: Tx,
    schoolId: string,
    code: string,
    hideDryOnly = false,
  ) {
    return tx.delivery.findFirst({
      where: {
        schoolId,
        ...(hideDryOnly ? { NOT: dryOnlyDeliveryWhere } : {}),
        OR: [
          { deliveryNo: code },
          { deliveryItems: { some: { qrToken: code } } },
          {
            deliveryItems: {
              some: { ingredientLots: { some: { qrToken: code } } },
            },
          },
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: { id: true, deliveryNo: true },
    });
  },
};
export type DeliveryInspectionRow = Prisma.DeliveryGetPayload<{
  select: typeof summarySelect;
}>;
export type DeliveryInspectionDetailRow = Prisma.DeliveryGetPayload<{
  select: typeof detailSelect;
}>;
