import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";

export async function lockSupplier(
  tx: Prisma.TransactionClient,
  schoolId: string,
  supplierId: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${schoolId + ":" + supplierId}, 0))`;
}

const documentSelect = {
  id: true,
  kind: true,
  fileName: true,
  mimeType: true,
  size: true,
  sha256: true,
  createdAt: true,
} as const;
export const contractInclude = {
  items: {
    include: {
      ingredient: {
        select: {
          id: true,
          name: true,
          ingredientCategory: { select: { categoryName: true } },
          defaultUnit: true,
          status: true,
        },
      },
    },
  },
  documents: { select: documentSelect, orderBy: { createdAt: "asc" } },
  certification: true,
  createdBy: { select: { fullName: true } },
  activatedBy: { select: { fullName: true } },
} as const satisfies Prisma.SupplierContractInclude;

type DraftInput = {
  schoolId: string;
  supplierId: string;
  createdByUserId: string;
  requestNo: string;
  deliveryDate: Date;
  orderType: "DIRECT_USE" | "DRY_STOCK";
  batchNo: 1 | 2 | null;
  note?: string;
  items: { ingredientEntryId: string; quantity: number; unit: string }[];
};

export const supplierOrderRepository = {
  async findOwner(id: string, schoolId: string) {
    const db = await getPrisma();
    return db.supplyRequest.findFirst({
      where: { id, schoolId },
      select: { supplierId: true },
    });
  },
  async findEntries(
    tx: Prisma.TransactionClient,
    ids: string[],
    schoolId: string,
    supplierId: string,
  ) {
    return tx.ingredientEntry.findMany({
      where: {
        id: { in: ids },
        schoolId,
        status: "ACTIVE",
        Ingredient: { supplierId, status: "ACTIVE" },
      },
      include: {
        Ingredient: { select: { defaultUnit: true, name: true } },
      },
    });
  },
  async createDraft(tx: Prisma.TransactionClient, input: DraftInput) {
    return tx.supplyRequest.create({
      data: {
        schoolId: input.schoolId,
        supplierId: input.supplierId,
        createdByUserId: input.createdByUserId,
        requestNo: input.requestNo,
        requestedDeliveryDate: input.deliveryDate,
        note: input.note,
        orderType: input.orderType,
        batchNo: input.batchNo,
        supplyRequestItems: {
          create: input.items.map((item) => ({
            ingredientEntryId: item.ingredientEntryId,
            requestedQuantity: item.quantity,
            unit: item.unit,
          })),
        },
      },
      select: {
        id: true,
        status: true,
        requestNo: true,
        orderType: true,
        batchNo: true,
      },
    });
  },
  async findOrderForSend(
    tx: Prisma.TransactionClient,
    id: string,
    schoolId: string,
  ) {
    return tx.supplyRequest.findFirst({
      where: { id, schoolId },
      include: {
        supplyRequestItems: {
          include: { IngredientEntry: { include: { Ingredient: true } } },
        },
      },
    });
  },
  async findEligibleContract(
    tx: Prisma.TransactionClient,
    id: string,
    schoolId: string,
    supplierId: string,
  ) {
    return tx.supplierContract.findFirst({
      where: {
        id,
        schoolId,
        supplierId,
        status: "ACTIVE",
        relationship: { status: "ACTIVE", schoolId, supplierId },
        supplier: { status: "ACTIVE" },
      },
      include: contractInclude,
    });
  },
  async markSent(
    tx: Prisma.TransactionClient,
    id: string,
    contractId: string,
    contractSnapshot: Prisma.InputJsonObject,
  ) {
    return tx.supplyRequest.update({
      where: { id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        contractId,
        contractSnapshot,
      },
      select: { id: true, status: true, contractId: true },
    });
  },
};

type HandlingType = "DRY_STOCK" | "DIRECT_USE";

export const ingredientHandlingRepository = {
  findEntries(
    tx: Prisma.TransactionClient,
    schoolId: string,
    ingredientIds: string[],
  ) {
    return tx.ingredientEntry.findMany({
      where: { schoolId, ingredientId: { in: ingredientIds } },
      select: {
        id: true,
        ingredientId: true,
        handlingType: true,
        status: true,
      },
    });
  },
  createEntries(
    tx: Prisma.TransactionClient,
    schoolId: string,
    createdByUserId: string,
    items: { ingredientId: string; handlingType: HandlingType }[],
  ) {
    return tx.ingredientEntry.createMany({
      data: items.map((item) => ({
        schoolId,
        ingredientId: item.ingredientId,
        handlingType: item.handlingType,
        status: "ACTIVE" as const,
        createdByUserId,
      })),
    });
  },
  updateEntry(
    tx: Prisma.TransactionClient,
    id: string,
    handlingType: HandlingType,
  ) {
    return tx.ingredientEntry.update({
      where: { id },
      data: { handlingType, status: "ACTIVE" },
      select: { id: true },
    });
  },
  /** Dòng hàng của mọi hợp đồng ACTIVE giữa trường và NCC (liên kết ACTIVE/SUSPENDED). */
  activeContractItems(
    db: Prisma.TransactionClient,
    schoolId: string,
    supplierId: string,
  ) {
    return db.supplierContractItem.findMany({
      where: {
        contract: {
          schoolId,
          supplierId,
          status: "ACTIVE",
          relationship: { status: { in: ["ACTIVE", "SUSPENDED"] } },
        },
      },
      select: {
        ingredientId: true,
        ingredient: {
          select: {
            name: true,
            defaultUnit: true,
            ingredientCategory: { select: { categoryName: true } },
          },
        },
        contract: {
          select: {
            id: true,
            number: true,
            startsOn: true,
            endsOn: true,
            relationshipId: true,
          },
        },
      },
      orderBy: [
        { ingredient: { name: "asc" } },
        { contract: { startsOn: "asc" } },
      ],
    });
  },
  /** Xe đã đến/đang chờ duyệt của trường có chở một trong các nguyên liệu. */
  pendingDeliveries(
    tx: Prisma.TransactionClient,
    schoolId: string,
    ingredientIds: string[],
  ) {
    return tx.delivery.findMany({
      where: {
        schoolId,
        status: { in: ["ARRIVED", "PENDING_APPROVAL"] },
        deliveryItems: { some: { ingredientId: { in: ingredientIds } } },
      },
      select: { deliveryNo: true },
      orderBy: { deliveryNo: "asc" },
      take: 20,
    });
  },
  createEvent(
    tx: Prisma.TransactionClient,
    data: {
      relationshipId: string;
      actorId: string;
      actorName: string;
      action: string;
      reason: string;
    },
  ) {
    return tx.supplierRelationshipEvent.create({ data, select: { id: true } });
  },
};

/** Đối soát chỉ đọc: hợp đồng ACTIVE thiếu IngredientEntry và dòng hồ sơ chưa có loại. */
export async function readHandlingAudit(tx: Prisma.TransactionClient) {
  const items = await tx.supplierContractItem.findMany({
    where: {
      OR: [{ handlingType: null }, { contract: { status: "ACTIVE" } }],
    },
    select: {
      ingredientId: true,
      handlingType: true,
      ingredient: { select: { name: true } },
      contract: {
        select: {
          id: true,
          number: true,
          status: true,
          schoolId: true,
          school: { select: { name: true } },
          supplier: { select: { name: true } },
        },
      },
    },
    orderBy: [{ contract: { schoolId: "asc" } }, { contractId: "asc" }],
  });
  const active = items.filter((item) => item.contract.status === "ACTIVE");
  const entries = active.length
    ? await tx.ingredientEntry.findMany({
        where: {
          OR: active.map((item) => ({
            schoolId: item.contract.schoolId,
            ingredientId: item.ingredientId,
          })),
        },
        select: { schoolId: true, ingredientId: true },
      })
    : [];
  return { items, entries };
}
