import { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";

export type Tx = Prisma.TransactionClient;

export const kitchenDetailSelect = {
  id: true,
  batchCode: true,
  menuDayId: true,
  dishId: true,
  mealType: true,
  cookingModeApplied: true,
  status: true,
  plannedPortions: true,
  note: true,
  confirmedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  Dish: { select: { name: true } },
  MenuDay: { select: { menuDate: true } },
  cookingBatchLots: {
    select: { ingredientLotId: true, quantityUsed: true, unit: true },
    orderBy: { ingredientLotId: "asc" },
  },
} as const satisfies Prisma.CookingBatchSelect;

export const kitchenListSelect = {
  ...kitchenDetailSelect,
  RetainedFoodSample: {
    select: {
      id: true,
      status: true,
      sampledAt: true,
      disposedAt: true,
    },
  },
} as const satisfies Prisma.CookingBatchSelect;

export const kitchenSummarySelect = {
  id: true,
  batchCode: true,
  menuDayId: true,
  dishId: true,
  mealType: true,
  cookingModeApplied: true,
  status: true,
  plannedPortions: true,
  confirmedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.CookingBatchSelect;

export type KitchenDetailRow = Prisma.CookingBatchGetPayload<{
  select: typeof kitchenDetailSelect;
}>;

export type KitchenListRow = Prisma.CookingBatchGetPayload<{
  select: typeof kitchenListSelect;
}>;

export type KitchenSummaryRow = Prisma.CookingBatchGetPayload<{
  select: typeof kitchenSummarySelect;
}>;

export type ListArguments = Pick<
  Prisma.CookingBatchFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof kitchenSummarySelect;
};

export type KitchenListReader = (
  args: ListArguments,
) => Promise<KitchenSummaryRow[]>;

export const readFromDatabase: KitchenListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.cookingBatch.findMany(args);
};

export const kitchenRepository = {
  findBatch(
    client: Tx,
    id: string,
    whereScope?: Prisma.CookingBatchWhereInput,
  ) {
    return client.cookingBatch.findFirst({
      where: whereScope ? { AND: [whereScope, { id }] } : { id },
      select: kitchenDetailSelect,
    });
  },

  findBatchesPaged(
    client: Tx,
    where: Prisma.CookingBatchWhereInput,
    skip: number,
    take: number,
  ) {
    return client.cookingBatch.findMany({
      where,
      select: kitchenListSelect,
      skip,
      take,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
  },

  countBatches(client: Tx, where: Prisma.CookingBatchWhereInput) {
    return client.cookingBatch.count({ where });
  },

  groupBatchStatus(client: Tx, where: Prisma.CookingBatchWhereInput) {
    return client.cookingBatch.groupBy({
      by: ["status"],
      where,
      _count: true,
    });
  },

  groupSampleStatus(client: Tx, where: Prisma.CookingBatchWhereInput) {
    return client.retainedFoodSample.groupBy({
      by: ["status"],
      where: { CookingBatch: where },
      _count: true,
    });
  },

  countPendingSamples(client: Tx, where: Prisma.CookingBatchWhereInput) {
    return client.cookingBatch.count({
      where: {
        AND: [where, { status: "COMPLETED", RetainedFoodSample: null }],
      },
    });
  },
};
