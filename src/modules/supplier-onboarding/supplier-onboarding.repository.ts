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
      include: { Ingredient: { select: { defaultUnit: true } } },
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
        supplyRequestItems: {
          create: input.items.map((item) => ({
            ingredientEntryId: item.ingredientEntryId,
            requestedQuantity: item.quantity,
            unit: item.unit,
          })),
        },
      },
      select: { id: true, status: true, requestNo: true },
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
