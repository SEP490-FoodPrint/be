import {
  Prisma,
  type DeliveryCreationMode,
  type DeliveryStatus,
  type PrismaClient,
} from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import type { SupplierOrderScope } from "../../utils/resource-access";

export type SupplierOrderDb = PrismaClient | Prisma.TransactionClient;

export const supplierOrderSummarySelect = {
  id: true,
  deliveryNo: true,
  creationMode: true,
  schoolId: true,
  supplierId: true,
  supplyRequestId: true,
  status: true,
  expectedArrivalAt: true,
  arrivedAt: true,
  receivedAt: true,
  vehiclePlate: true,
  note: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
  School: { select: { name: true } },
  SupplyRequest: { select: { requestNo: true } },
} satisfies Prisma.DeliverySelect;

export const supplierOrderDetailSelect = {
  ...supplierOrderSummarySelect,
  creationFingerprint: true,
  deliveryItems: {
    orderBy: [{ id: "asc" as const }],
    select: {
      id: true,
      ingredientId: true,
      ingredientEntryId: true,
      supplyRequestItemId: true,
      actualQuantity: true,
      unit: true,
      note: true,
      Ingredient: { select: { name: true } },
    },
  },
} satisfies Prisma.DeliverySelect;

export const supplierOrderSupplyRequestSelect = {
  id: true,
  requestNo: true,
  schoolId: true,
  supplierId: true,
  status: true,
  School: { select: { name: true } },
  supplyRequestItems: {
    orderBy: [{ id: "asc" as const }],
    select: {
      id: true,
      ingredientEntryId: true,
      requestedQuantity: true,
      unit: true,
      note: true,
      IngredientEntry: {
        select: {
          id: true,
          ingredientId: true,
          Ingredient: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.SupplyRequestSelect;

export const supplierOrderSchoolOptionSelect = {
  id: true,
  code: true,
  name: true,
} satisfies Prisma.SchoolSelect;

export const supplierOrderIngredientOptionSelect = {
  id: true,
  name: true,
  defaultUnit: true,
  categoryId: true,
  ingredientCategory: { select: { categoryName: true } },
} satisfies Prisma.IngredientSelect;

export const supplierOrderIngredientValidationSelect = {
  id: true,
  supplierId: true,
  name: true,
  defaultUnit: true,
  status: true,
} satisfies Prisma.IngredientSelect;

export type SupplierOrderSummaryRecord = Prisma.DeliveryGetPayload<{
  select: typeof supplierOrderSummarySelect;
}>;

export type SupplierOrderDetailRecord = Prisma.DeliveryGetPayload<{
  select: typeof supplierOrderDetailSelect;
}>;

export type SupplierOrderSupplyRequestRecord = Prisma.SupplyRequestGetPayload<{
  select: typeof supplierOrderSupplyRequestSelect;
}>;

export type SupplierOrderSchoolOptionRecord = Prisma.SchoolGetPayload<{
  select: typeof supplierOrderSchoolOptionSelect;
}>;

export type SupplierOrderIngredientOptionRecord = Prisma.IngredientGetPayload<{
  select: typeof supplierOrderIngredientOptionSelect;
}>;

export type SupplierOrderIngredientValidationRecord =
  Prisma.IngredientGetPayload<{
    select: typeof supplierOrderIngredientValidationSelect;
  }>;

export interface SupplierOrderIngredientEntryMatch {
  id: string;
  ingredientId: string;
}

export interface SupplierOrderCreateDeliveryItemInput {
  supplyRequestItemId: string | null;
  ingredientId: string;
  ingredientEntryId: string | null;
  actualQuantity: Prisma.Decimal;
  unit: string;
  note: string | null;
}

export interface SupplierOrderCreateDeliveryInput {
  deliveryNo: string;
  creationMode: DeliveryCreationMode;
  creationKey: string;
  creationFingerprint: string;
  schoolId: string;
  supplierId: string;
  supplyRequestId: string | null;
  createdByUserId: string;
  expectedArrivalAt: Date | null;
  vehiclePlate: string | null;
  note: string | null;
  status: DeliveryStatus;
  items: SupplierOrderCreateDeliveryItemInput[];
}

export interface SupplierOrderOptionsCommand {
  supplierId: string;
  skip: number;
  take: number;
}

export interface SupplierOrderListCommand {
  scope: SupplierOrderScope & Prisma.DeliveryWhereInput;
  skip: number;
  take: number;
  sourceType?: "REQUEST" | "STANDALONE";
  status?: DeliveryStatus;
}

export interface SupplierOrderRepository {
  connect(): Promise<PrismaClient>;
  findByCreationKey(
    db: SupplierOrderDb,
    supplierId: string,
    createdByUserId: string,
    creationKey: string,
  ): Promise<SupplierOrderDetailRecord | null>;
  findSupplyRequestForCreation(
    db: SupplierOrderDb,
    supplyRequestId: string,
  ): Promise<SupplierOrderSupplyRequestRecord | null>;
  hasDeliveryForRequest(
    db: SupplierOrderDb,
    supplyRequestId: string,
  ): Promise<boolean>;
  createDeliveryWithItems(
    db: SupplierOrderDb,
    input: SupplierOrderCreateDeliveryInput,
  ): Promise<SupplierOrderDetailRecord>;
  markSupplyRequestInProgress(
    db: SupplierOrderDb,
    supplyRequestId: string,
  ): Promise<number>;
  listSchoolOptions(
    db: SupplierOrderDb,
    command: SupplierOrderOptionsCommand,
  ): Promise<SupplierOrderSchoolOptionRecord[]>;
  listIngredientOptions(
    db: SupplierOrderDb,
    command: SupplierOrderOptionsCommand,
  ): Promise<SupplierOrderIngredientOptionRecord[]>;
  findIngredientsByIds(
    db: SupplierOrderDb,
    ingredientIds: readonly string[],
  ): Promise<SupplierOrderIngredientValidationRecord[]>;
  findIngredientEntriesForSchool(
    db: SupplierOrderDb,
    schoolId: string,
    ingredientIds: readonly string[],
  ): Promise<SupplierOrderIngredientEntryMatch[]>;
  listManagementDeliveries(
    db: SupplierOrderDb,
    command: SupplierOrderListCommand,
  ): Promise<SupplierOrderSummaryRecord[]>;
  findManagementDeliveryById(
    db: SupplierOrderDb,
    scope: SupplierOrderScope & Prisma.DeliveryWhereInput,
    id: string,
  ): Promise<SupplierOrderDetailRecord | null>;
}

export const supplierOrderRepository: SupplierOrderRepository = {
  connect() {
    return getPrisma();
  },

  findByCreationKey(db, supplierId, createdByUserId, creationKey) {
    return db.delivery.findFirst({
      where: { supplierId, createdByUserId, creationKey },
      select: supplierOrderDetailSelect,
    });
  },

  findSupplyRequestForCreation(db, supplyRequestId) {
    return db.supplyRequest.findUnique({
      where: { id: supplyRequestId },
      select: supplierOrderSupplyRequestSelect,
    });
  },

  async hasDeliveryForRequest(db, supplyRequestId) {
    const existing = await db.delivery.findFirst({
      where: { supplyRequestId },
      select: { id: true },
    });
    return existing !== null;
  },

  createDeliveryWithItems(db, input) {
    return db.delivery.create({
      data: {
        deliveryNo: input.deliveryNo,
        creationMode: input.creationMode,
        creationKey: input.creationKey,
        creationFingerprint: input.creationFingerprint,
        schoolId: input.schoolId,
        supplierId: input.supplierId,
        supplyRequestId: input.supplyRequestId,
        createdByUserId: input.createdByUserId,
        expectedArrivalAt: input.expectedArrivalAt,
        vehiclePlate: input.vehiclePlate,
        note: input.note,
        status: input.status,
        deliveryItems: {
          create: input.items.map((item) => ({
            supplyRequestItemId: item.supplyRequestItemId,
            ingredientId: item.ingredientId,
            ingredientEntryId: item.ingredientEntryId,
            actualQuantity: item.actualQuantity,
            unit: item.unit,
            note: item.note,
          })),
        },
      },
      select: supplierOrderDetailSelect,
    });
  },

  async markSupplyRequestInProgress(db, supplyRequestId) {
    const updated = await db.supplyRequest.updateMany({
      where: { id: supplyRequestId, status: "ACCEPTED" },
      data: { status: "IN_PROGRESS" },
    });
    return updated.count;
  },

  listSchoolOptions(db, command) {
    return db.school.findMany({
      where: {
        status: "ACTIVE",
        intakeState: "ACTIVE",
        users: {
          none: {
            roleCode: "SCHOOL_ADMINISTRATION",
            status: "DEACTIVATED",
          },
        },
        schoolSupplierRelationships: {
          some: {
            supplierId: command.supplierId,
            status: "ACTIVE",
          },
        },
      },
      select: supplierOrderSchoolOptionSelect,
      orderBy: [{ id: "asc" }],
      skip: command.skip,
      take: command.take,
    });
  },

  listIngredientOptions(db, command) {
    return db.ingredient.findMany({
      where: {
        supplierId: command.supplierId,
        status: "ACTIVE",
      },
      select: supplierOrderIngredientOptionSelect,
      orderBy: [{ id: "asc" }],
      skip: command.skip,
      take: command.take,
    });
  },

  findIngredientsByIds(db, ingredientIds) {
    return db.ingredient.findMany({
      where: { id: { in: [...ingredientIds] } },
      select: supplierOrderIngredientValidationSelect,
    });
  },

  findIngredientEntriesForSchool(db, schoolId, ingredientIds) {
    return db.ingredientEntry.findMany({
      where: {
        schoolId,
        ingredientId: { in: [...ingredientIds] },
        status: "ACTIVE",
      },
      select: { id: true, ingredientId: true },
    });
  },

  listManagementDeliveries(db, command) {
    const filters: Prisma.DeliveryWhereInput[] = [command.scope];
    if (command.sourceType === "REQUEST") {
      filters.push({
        OR: [
          { creationMode: "REQUEST" },
          { creationMode: null, supplyRequestId: { not: null } },
        ],
      });
    } else if (command.sourceType === "STANDALONE") {
      filters.push({ creationMode: "STANDALONE" });
    }
    if (command.status) {
      filters.push({ status: command.status });
    }

    return db.delivery.findMany({
      where: { AND: filters },
      select: supplierOrderSummarySelect,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: command.skip,
      take: command.take,
    });
  },

  findManagementDeliveryById(db, scope, id) {
    return db.delivery.findFirst({
      where: { AND: [scope, { id }] },
      select: supplierOrderDetailSelect,
    });
  },
};
