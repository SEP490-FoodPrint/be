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
    select: {
      ingredientLotId: true,
      quantityUsed: true,
      unit: true,
      IngredientLot: {
        select: {
          lotCode: true,
          expiryDate: true,
          DeliveryItem: {
            select: {
              SupplyRequestItem: {
                select: {
                  IngredientEntry: {
                    select: { Ingredient: { select: { name: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
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

interface KitchenFilterValues {
  page: number;
  limit: number;
  date?: Date;
  startDate?: Date;
  endDate?: Date;
  mealType?: "LUNCH" | "AFTERNOON";
  status?: "UNCONFIRMED" | "CONFIRMED" | "COMPLETED";
  menuDayId?: string;
  dishId?: string;
  cookingModeApplied?: "COMBINE_LOTS" | "SEPARATE_BY_LOT";
  search?: string;
  hasSample?: boolean;
}

function kitchenFilterWhere(
  query: KitchenFilterValues,
  scope: Prisma.CookingBatchWhereInput,
): Prisma.CookingBatchWhereInput {
  const search = query.search;
  const searchPortions =
    search && /^[0-9]+$/.test(search) ? Number(search) : undefined;
  return {
    AND: [
      scope,
      {
        status: query.status,
        mealType: query.mealType,
        menuDayId: query.menuDayId,
        dishId: query.dishId,
        cookingModeApplied: query.cookingModeApplied,
        ...(query.hasSample === undefined
          ? {}
          : { RetainedFoodSample: query.hasSample ? { isNot: null } : null }),
        ...(query.startDate && query.endDate
          ? {
              MenuDay: {
                menuDate: {
                  gte: query.startDate,
                  lte: query.endDate,
                },
              },
            }
          : query.startDate
            ? { MenuDay: { menuDate: { gte: query.startDate } } }
            : query.endDate
              ? { MenuDay: { menuDate: { lte: query.endDate } } }
              : query.date
                ? { MenuDay: { menuDate: query.date } }
                : {}),
        ...(search
          ? {
              OR: [
                {
                  batchCode: {
                    contains: search,
                    mode: "insensitive" as const,
                  },
                },
                {
                  Dish: {
                    name: { contains: search, mode: "insensitive" as const },
                  },
                },
                ...(searchPortions !== undefined &&
                Number.isSafeInteger(searchPortions) &&
                searchPortions <= 2147483647
                  ? [{ plannedPortions: searchPortions }]
                  : []),
              ],
            }
          : {}),
      },
    ],
  };
}

export const kitchenRepository = {
  findSchoolContext(client: Tx, schoolId: string) {
    return client.school.findFirst({
      where: { id: schoolId, status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        cookingMode: true,
        lunchTime: true,
        afternoonMealTime: true,
        academicYears: {
          select: {
            id: true,
            academicYear: true,
            startDate: true,
            endDate: true,
            holidays: true,
          },
          orderBy: [{ startDate: "desc" }, { id: "asc" }],
        },
      },
    });
  },
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
    query: KitchenFilterValues,
    scope: Prisma.CookingBatchWhereInput,
  ) {
    return client.cookingBatch.findMany({
      where: kitchenFilterWhere(query, scope),
      select: kitchenListSelect,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
  },

  countBatches(
    client: Tx,
    query: KitchenFilterValues,
    scope: Prisma.CookingBatchWhereInput,
  ) {
    const where = kitchenFilterWhere(query, scope);
    return client.cookingBatch.count({ where });
  },

  groupBatchStatus(
    client: Tx,
    query: KitchenFilterValues,
    scope: Prisma.CookingBatchWhereInput,
  ) {
    const where = kitchenFilterWhere(query, scope);
    return client.cookingBatch.groupBy({
      by: ["status"],
      where,
      _count: true,
    });
  },

  groupSampleStatus(
    client: Tx,
    query: KitchenFilterValues,
    scope: Prisma.CookingBatchWhereInput,
  ) {
    const where = kitchenFilterWhere(query, scope);
    return client.retainedFoodSample.groupBy({
      by: ["status"],
      where: { CookingBatch: where },
      _count: true,
    });
  },

  countPendingSamples(
    client: Tx,
    query: KitchenFilterValues,
    scope: Prisma.CookingBatchWhereInput,
  ) {
    const where = kitchenFilterWhere(query, scope);
    return client.cookingBatch.count({
      where: {
        AND: [where, { status: "COMPLETED", RetainedFoodSample: null }],
      },
    });
  },
};
