import { classScopeForMenuDay } from "../menu/menu.repository";
import { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";

export type Tx = Prisma.TransactionClient;

export const kitchenDetailSelect = {
  id: true,
  batchGroupId: true,
  BatchGroup: { select: { id: true, batchCode: true } },
  dishes: {
    select: {
      dishId: true,
      plannedPortions: true,
      Dish: { select: { name: true } },
    },
    orderBy: { dishId: "asc" },
  },
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
      dishId: true,
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
      dishId: true,
      status: true,
      sampledAt: true,
      disposedAt: true,
    },
  },
} as const satisfies Prisma.CookingBatchSelect;

export const kitchenSummarySelect = {
  id: true,
  batchGroupId: true,
  BatchGroup: { select: { id: true, batchCode: true } },
  dishes: {
    select: {
      dishId: true,
      plannedPortions: true,
      Dish: { select: { name: true } },
    },
    orderBy: { dishId: "asc" },
  },
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
      ...(query.dishId ? [{ dishes: { some: { dishId: query.dishId } } }] : []),
      {
        status: query.status,
        mealType: query.mealType,
        menuDayId: query.menuDayId,

        cookingModeApplied: query.cookingModeApplied,
        ...(query.hasSample === undefined
          ? {}
          : query.hasSample
            ? { dishes: { every: { retainedFoodSamples: { some: {} } } } }
            : { dishes: { some: { retainedFoodSamples: { none: {} } } } }),
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
                  dishes: {
                    some: {
                      Dish: {
                        name: {
                          contains: search,
                          mode: "insensitive" as const,
                        },
                      },
                    },
                  },
                },
                {
                  BatchGroup: {
                    batchCode: {
                      contains: search,
                      mode: "insensitive" as const,
                    },
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
  async unfinalizedClasses(
    client: Tx,
    meal: { menuDayId: string; mealType: "LUNCH" | "AFTERNOON" },
    schoolId: string,
    menuDate: Date,
  ) {
    const year = await client.schoolAcademicYear.findFirst({
      where: {
        schoolId,
        startDate: { lte: menuDate },
        endDate: { gte: menuDate },
      },
      select: { academicYear: true },
      orderBy: { startDate: "desc" },
    });
    return client.class.findMany({
      where: {
        AND: [
          classScopeForMenuDay(schoolId, meal.menuDayId),
          ...(year
            ? [
                {
                  OR: [
                    { academicYear: year.academicYear },
                    { academicYear: null },
                  ],
                },
              ]
            : []),
          {
            status: "ACTIVE",
            dailyMealPortions: {
              none: {
                mealDate: menuDate,
                mealType: meal.mealType,
                status: "FINALIZED",
              },
            },
          },
        ],
      },
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
  },
  findMealDishPlans(
    client: Tx,
    meal: { menuDayId: string; mealType: "LUNCH" | "AFTERNOON" },
  ) {
    return client.cookingBatchDish.findMany({
      where: { CookingBatch: meal },
      select: {
        dishId: true,
        plannedPortions: true,
        CookingBatch: { select: { status: true } },
      },
    });
  },
  findPlanMeal(
    client: Tx,
    menuDayId: string,
    mealType: "LUNCH" | "AFTERNOON",
    schoolId: string,
  ) {
    return client.menuDay.findFirst({
      where: { id: menuDayId, WeeklyMenu: { schoolId } },
      select: {
        menuDate: true,
        approvalStatus: true,
        menuDayDishes: {
          where: { mealType },
          orderBy: { dishId: "asc" },
          select: {
            dishId: true,
            Dish: { select: { schoolId: true, status: true, name: true } },
            ingredients: {
              orderBy: { ingredientId: "asc" },
              include: {
                ingredient: {
                  select: {
                    ingredientEntries: {
                      where: { schoolId },
                      select: { id: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  },
  listMealBatches(
    client: Tx,
    meal: { menuDayId: string; mealType: "LUNCH" | "AFTERNOON" },
  ) {
    return client.cookingBatch.findMany({
      where: meal,
      select: kitchenDetailSelect,
      orderBy: { id: "asc" },
    });
  },
  hasRecipeAllergy(
    client: Tx,
    menuDate: Date,
    mealType: "LUNCH" | "AFTERNOON",
    schoolId: string,
    entryIds: string[],
    menuDayId?: string,
  ) {
    return client.dailyAllergyPortion.findFirst({
      where: {
        DailyMealPortion: {
          mealDate: menuDate,
          mealType,
          status: "FINALIZED",
          Class: menuDayId
            ? classScopeForMenuDay(schoolId, menuDayId)
            : { schoolId },
        },
        ingredientEntryId: { in: entryIds },
        portionCount: { gt: 0 },
      },
      select: { dailyMealPortionId: true },
    });
  },
  createPlanGroup(
    client: Tx,
    input: {
      menuDayId: string;
      mealType: "LUNCH" | "AFTERNOON";
      createdByUserId: string;
      batchCode: string;
    },
  ) {
    return client.cookingBatchGroup.create({
      data: input,
      select: { id: true, batchCode: true },
    });
  },
  async createPlannedChild(
    client: Tx,
    input: Prisma.CookingBatchUncheckedCreateInput,
    lots: {
      dishId: string;
      ingredientLotId: string;
      quantityUsed: string;
      unit: string;
    }[],
  ) {
    const child = await client.cookingBatch.create({
      data: input,
      select: { id: true },
    });
    // Dish rows must exist before the new composite lot FK can be satisfied.
    await client.cookingBatchLot.createMany({
      data: lots.map((lot) => ({ ...lot, cookingBatchId: child.id })),
    });
    return client.cookingBatch.findUniqueOrThrow({
      where: { id: child.id },
      select: kitchenDetailSelect,
    });
  },
  findGroup(client: Tx, id: string, schoolId: string) {
    return client.cookingBatchGroup.findFirst({
      where: { id, MenuDay: { WeeklyMenu: { schoolId } } },
      select: {
        id: true,
        batchCode: true,
        menuDayId: true,
        mealType: true,
        createdAt: true,
        cookingBatches: {
          select: kitchenDetailSelect,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
      },
    });
  },
  removeEmptyGroup(client: Tx, id: string) {
    return client.cookingBatchGroup.deleteMany({
      where: { id, cookingBatches: { none: {} } },
    });
  },
  findSchoolContext(client: Tx, schoolId: string) {
    return client.school.findFirst({
      where: { id: schoolId, status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        cookingMode: true,
        grades: {
          select: { id: true, name: true },
          orderBy: [{ name: "asc" }, { id: "asc" }],
        },
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
        AND: [
          where,
          {
            status: "COMPLETED",
            dishes: { some: { retainedFoodSamples: { none: {} } } },
          },
        ],
      },
    });
  },
};
