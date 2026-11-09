import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import { listWindow } from "../../utils/list-query";
type Tx = Prisma.TransactionClient;
type MealType = "LUNCH" | "AFTERNOON";
type MenuStatus =
  "DRAFT" | "PENDING_APPROVAL" | "REVISION_REQUIRED" | "APPROVED";
interface MealReference {
  menuDayId: string;
  mealType: MealType;
}
interface Pagination {
  page: number;
  limit: number;
}
interface GroupWrite extends MealReference {
  name: string;
  isDefault: boolean;
}
interface IngredientWrite {
  ingredientId: string;
  quantityPerPortion: string;
  unit: string;
}
interface SeasoningWrite {
  ingredientEntryId: string;
  quantityPerPortion: string;
  unit: string;
}
interface StandardsWrite {
  dishes: { dishId: string; ingredients: IngredientWrite[] }[];
  seasonings: SeasoningWrite[];
}
interface DayIngredientWrite extends IngredientWrite, MealReference {
  dishId: string;
}
interface MealDishKey {
  dishId: string;
  mealType: MealType;
}
interface MenuFilterValues extends Pagination {
  date?: Date;
  weekStartDate?: Date;
  status?: MenuStatus;
  search?: string;
}
interface ReviewWrite {
  menuDayId: string | null;
  decision: "APPROVED" | "REVISION_REQUESTED";
  feedback: string | null;
}
const menuDetail = {
  menuDays: {
    orderBy: { menuDate: "asc" },

    include: {
      menuDayDishes: {
        orderBy: [
          { mealType: "asc" },

          { displayOrder: "asc" },

          { dishId: "asc" },
        ],

        include: {
          Dish: {
            select: { id: true, name: true, description: true, status: true },
          },

          ingredients: {
            orderBy: { ingredientId: "asc" },

            include: {
              ingredient: {
                select: {
                  id: true,

                  name: true,

                  ingredientCategory: { select: { categoryName: true } },

                  defaultUnit: true,
                },
              },
            },
          },
        },
      },

      portionGroups: {
        include: {
          dishes: { select: { dishId: true } },

          avoidances: { select: { ingredientEntryId: true } },
        },
      },

      mealSeasonings: {
        orderBy: [{ mealType: "asc" }, { ingredientEntryId: "asc" }],

        include: {
          ingredientEntry: {
            select: {
              ingredientId: true,

              Ingredient: { select: { name: true, defaultUnit: true } },
            },
          },
        },
      },
    },
  },
} as const satisfies Prisma.WeeklyMenuInclude;

const menuListInclude = {
  menuDays: {
    orderBy: { menuDate: "asc" },

    include: {
      menuDayDishes: {
        orderBy: [
          { mealType: "asc" },

          { displayOrder: "asc" },

          { dishId: "asc" },
        ],

        include: {
          Dish: {
            select: { id: true, name: true, description: true, status: true },
          },

          ingredients: {
            orderBy: { ingredientId: "asc" },

            take: 3,

            include: {
              ingredient: {
                select: {
                  id: true,

                  name: true,
                },
              },
            },
          },
        },
      },

      portionGroups: {
        select: {
          id: true,

          name: true,

          isDefault: true,

          mealType: true,
        },
      },

      mealSeasonings: {
        orderBy: [{ mealType: "asc" }, { ingredientEntryId: "asc" }],

        include: {
          ingredientEntry: {
            select: {
              ingredientId: true,

              Ingredient: { select: { name: true, defaultUnit: true } },
            },
          },
        },
      },
    },
  },
} as const satisfies Prisma.WeeklyMenuInclude;

function mainIngredientWhere(schoolId: string): Prisma.IngredientWhereInput {
  return {
    status: "ACTIVE",

    Supplier: {
      status: "ACTIVE",

      schoolSupplierRelationships: {
        some: { schoolId, status: "ACTIVE" },
      },
    },
  };
}
function seasoningWhere(schoolId: string): Prisma.IngredientEntryWhereInput {
  return {
    schoolId,

    status: "ACTIVE",

    handlingType: "DRY_STOCK",

    Ingredient: { status: "ACTIVE" },
  };
}
function removedDishWhere(
  menuDayId: string,
  desired: MealDishKey[],
): Prisma.MenuDayDishWhereInput {
  return {
    menuDayId: menuDayId,

    NOT: { OR: desired },
  };
}
function menuFilterWhere(
  scope: Prisma.WeeklyMenuWhereInput,
  query: MenuFilterValues,
): Prisma.WeeklyMenuWhereInput {
  return {
    AND: [
      scope,

      {
        status: query.status,

        weekStartDate: query.weekStartDate,

        ...(query.date ? { menuDays: { some: { menuDate: query.date } } } : {}),
        ...(query.search
          ? {
              OR: [
                {
                  title: {
                    contains: query.search,
                    mode: "insensitive" as const,
                  },
                },
                {
                  menuDays: {
                    some: {
                      menuDayDishes: {
                        some: {
                          Dish: {
                            name: {
                              contains: query.search,
                              mode: "insensitive" as const,
                            },
                          },
                        },
                      },
                    },
                  },
                },
              ],
            }
          : {}),
      },
    ],
  };
}
export const menuRepository = {
  mealDay(client: Tx, meal: MealReference, schoolId: string) {
    return client.menuDay.findFirst({
      where: { id: meal.menuDayId, WeeklyMenu: { schoolId } },

      select: {
        menuDate: true,

        approvalStatus: true,

        WeeklyMenu: { select: { status: true } },

        menuDayDishes: {
          where: { mealType: meal.mealType },

          select: {
            dishId: true,

            Dish: { select: { schoolId: true, status: true } },
          },
        },
      },
    });
  },
  linkedIngredients(client: Tx, ingredientIds: string[], schoolId: string) {
    return client.ingredient.findMany({
      where: {
        id: { in: ingredientIds },

        status: "ACTIVE",

        Supplier: {
          status: "ACTIVE",

          schoolSupplierRelationships: {
            some: { schoolId, status: "ACTIVE" },
          },
        },
      },

      select: { id: true, defaultUnit: true },
    });
  },
  activeSeasoningEntries(
    client: Tx,
    ingredientEntryIds: string[],
    schoolId: string,
  ) {
    return client.ingredientEntry.findMany({
      where: {
        id: { in: ingredientEntryIds },

        schoolId,

        status: "ACTIVE",

        handlingType: "DRY_STOCK",

        Ingredient: { status: "ACTIVE" },
      },

      select: { id: true, Ingredient: { select: { defaultUnit: true } } },
    });
  },
  portionGroups(client: Tx, meal: MealReference) {
    return client.menuMealPortionGroup.findMany({
      where: meal,

      include: {
        dishes: { select: { dishId: true } },

        avoidances: { select: { ingredientEntryId: true } },
      },

      orderBy: [{ isDefault: "desc" }, { id: "asc" }],
    });
  },
  mealBatchCount(client: Tx, meal: MealReference) {
    return client.cookingBatch.count({ where: meal });
  },
  mealSeasoningLotCount(client: Tx, meal: MealReference) {
    return client.menuMealSeasoningLot.count({ where: meal });
  },
  dailyGroupCount(client: Tx, meal: MealReference) {
    return client.dailyMealPortionGroup.count({
      where: { portionGroup: meal },
    });
  },
  portionGroupIds(client: Tx, meal: MealReference) {
    return client.menuMealPortionGroup.findMany({
      where: meal,

      select: { id: true },
    });
  },
  activeAvoidanceCount(client: Tx, avoided: string[], schoolId: string) {
    return client.ingredientEntry.count({
      where: { id: { in: avoided }, schoolId, status: "ACTIVE" },
    });
  },
  clearDefaultGroups(client: Tx, meal: MealReference) {
    return client.menuMealPortionGroup.updateMany({
      where: meal,

      data: { isDefault: false },
    });
  },
  removeObsoleteGroups(
    client: Tx,
    meal: MealReference,
    groups: { id?: string }[],
  ) {
    return client.menuMealPortionGroup.deleteMany({
      where: {
        ...meal,

        id: { notIn: groups.flatMap((g) => (g.id ? [g.id] : [])) },
      },
    });
  },
  updateGroup(client: Tx, id: string, data: GroupWrite) {
    return client.menuMealPortionGroup.update({
      where: { id: id },

      data,
    });
  },
  createGroup(client: Tx, data: GroupWrite) {
    return client.menuMealPortionGroup.create({ data });
  },
  clearGroupDishes(client: Tx, id: string) {
    return client.menuMealPortionGroupDish.deleteMany({
      where: { portionGroupId: id },
    });
  },
  clearGroupAvoidances(client: Tx, id: string) {
    return client.menuMealPortionGroupAvoidance.deleteMany({
      where: { portionGroupId: id },
    });
  },
  insertGroupDishes(
    client: Tx,
    meal: MealReference,
    portionGroupId: string,
    dishIds: string[],
  ) {
    return client.menuMealPortionGroupDish.createMany({
      data: dishIds.map((dishId) => ({
        ...meal,

        portionGroupId: portionGroupId,

        dishId,
      })),
    });
  },
  insertGroupAvoidances(
    client: Tx,
    portionGroupId: string,
    ingredientEntryIds: string[],
  ) {
    return client.menuMealPortionGroupAvoidance.createMany({
      data: ingredientEntryIds.map((ingredientEntryId) => ({
        portionGroupId: portionGroupId,

        ingredientEntryId,
      })),
    });
  },
  savedPortionGroups(client: Tx, meal: MealReference) {
    return client.menuMealPortionGroup.findMany({
      where: meal,

      include: {
        dishes: { select: { dishId: true } },

        avoidances: { select: { ingredientEntryId: true } },
      },

      orderBy: { id: "asc" },
    });
  },
  allergyIngredients(client: Tx, ingredientIds: string[], schoolId: string) {
    return client.ingredient.findMany({
      where: {
        id: { in: ingredientIds },

        status: "ACTIVE",

        Supplier: {
          status: "ACTIVE",

          schoolSupplierRelationships: {
            some: { schoolId, status: "ACTIVE" },
          },
        },
      },

      select: { id: true, name: true },
    });
  },
  classAllergies(client: Tx, ingredientIds: string[], schoolId: string) {
    return client.classAllergy.findMany({
      where: {
        Class: { schoolId, status: "ACTIVE" },

        IngredientEntry: {
          schoolId,

          ingredientId: { in: ingredientIds },
        },

        affectedCount: { gt: 0 },
      },

      select: {
        classId: true,

        affectedCount: true,

        Class: { select: { name: true } },

        IngredientEntry: { select: { ingredientId: true } },
      },
    });
  },
  mealIngredients(client: Tx, meal: MealReference) {
    return client.menuDayDishIngredient.findMany({
      where: meal,

      orderBy: [{ dishId: "asc" }, { ingredientId: "asc" }],
    });
  },
  mealSeasonings(client: Tx, meal: MealReference) {
    return client.menuMealSeasoning.findMany({
      where: meal,

      orderBy: { ingredientEntryId: "asc" },
    });
  },
  mealSeasoningLots(client: Tx, meal: MealReference) {
    return client.menuMealSeasoningLot.findMany({
      where: meal,

      orderBy: { id: "asc" },
    });
  },
  deleteMealIngredients(client: Tx, meal: MealReference) {
    return client.menuDayDishIngredient.deleteMany({ where: meal });
  },
  deleteMealSeasonings(client: Tx, meal: MealReference) {
    return client.menuMealSeasoning.deleteMany({ where: meal });
  },
  insertMealIngredients(
    client: Tx,
    meal: MealReference,
    input: StandardsWrite,
  ) {
    return client.menuDayDishIngredient.createMany({
      data: input.dishes.flatMap((dish) =>
        dish.ingredients.map((row) => ({
          ...meal,

          dishId: dish.dishId,

          ...row,
        })),
      ),
    });
  },
  insertMealSeasonings(
    client: Tx,
    meal: MealReference,
    seasonings: SeasoningWrite[],
  ) {
    return client.menuMealSeasoning.createMany({
      data: seasonings.map((row) => ({ ...meal, ...row })),
    });
  },
  touchMenuDay(client: Tx, menuDayId: string) {
    return client.menuDay.update({
      where: { id: menuDayId },

      data: { updatedAt: new Date() },
    });
  },
  mainIngredientOptions(client: Tx, schoolId: string, query: Pagination) {
    return client.ingredient.findMany({
      where: mainIngredientWhere(schoolId),

      select: {
        id: true,

        supplierId: true,

        name: true,

        ingredientCategory: { select: { categoryName: true } },

        defaultUnit: true,

        Supplier: { select: { name: true } },
      },

      orderBy: { id: "asc" },

      skip: (query.page - 1) * query.limit,

      take: query.limit,
    });
  },
  mainIngredientCount(client: Tx, schoolId: string) {
    return client.ingredient.count({ where: mainIngredientWhere(schoolId) });
  },
  seasoningOptions(client: Tx, schoolId: string, query: Pagination) {
    return client.ingredientEntry.findMany({
      where: seasoningWhere(schoolId),

      select: {
        id: true,

        ingredientId: true,

        handlingType: true,

        Ingredient: {
          select: {
            name: true,

            ingredientCategory: { select: { categoryName: true } },

            defaultUnit: true,
          },
        },
      },

      orderBy: { id: "asc" },

      skip: (query.page - 1) * query.limit,

      take: query.limit,
    });
  },
  seasoningOptionCount(client: Tx, schoolId: string) {
    return client.ingredientEntry.count({ where: seasoningWhere(schoolId) });
  },
  recipeRequirements(client: Tx, meal: MealReference) {
    return client.menuDayDishIngredient.findMany({
      where: meal,

      include: { ingredient: true },
    });
  },
  seasoningRequirements(client: Tx, meal: MealReference) {
    return client.menuMealSeasoning.findMany({
      where: meal,

      include: { ingredientEntry: { include: { Ingredient: true } } },
    });
  },
  ingredientStockEntries(
    client: Tx,
    schoolId: string,
    ingredientIds: string[],
  ) {
    return client.ingredientEntry.findMany({
      where: { schoolId, ingredientId: { in: ingredientIds } },

      select: { id: true, ingredientId: true },
    });
  },
  batchAssignments(client: Tx, meal: MealReference) {
    return client.cookingBatchLot.findMany({
      where: { CookingBatch: meal },

      select: {
        ingredientLotId: true,

        quantityUsed: true,

        unit: true,

        CookingBatch: { select: { status: true } },

        IngredientLot: {
          select: {
            DeliveryItem: {
              select: {
                SupplyRequestItem: {
                  select: { ingredientEntryId: true },
                },
              },
            },
          },
        },
      },
    });
  },
  seasoningAssignments(client: Tx, meal: MealReference) {
    return client.menuMealSeasoningLot.findMany({
      where: meal,
    });
  },
  ownedMenu(client: Tx, id: string, schoolId: string) {
    return client.weeklyMenu.findFirst({
      where: { id, schoolId },

      include: menuDetail,
    });
  },
  dayBatchCount(client: Tx, menuDayId: string) {
    return client.cookingBatch.count({ where: { menuDayId } });
  },
  daySeasoningLotCount(client: Tx, menuDayId: string) {
    return client.menuMealSeasoningLot.count({ where: { menuDayId } });
  },
  menuEditHeader(client: Tx, id: string) {
    return client.weeklyMenu.findUniqueOrThrow({
      where: { id },

      select: { status: true, submittedAt: true },
    });
  },
  menuDayHeaders(client: Tx, id: string) {
    return client.menuDay.findMany({
      where: { weeklyMenuId: id },

      select: { id: true, menuDate: true, approvalStatus: true },
    });
  },
  dayReviewCount(client: Tx, id: string) {
    return client.menuReviewRecord.count({ where: { menuDayId: id } });
  },
  deleteDay(client: Tx, id: string) {
    return client.menuDay.delete({ where: { id: id } });
  },
  updateDayNote(client: Tx, id: string, note: string | null) {
    return client.menuDay.update({
      where: { id: id },

      data: { note: note },
    });
  },
  createDay(
    client: Tx,
    weeklyMenuId: string,
    menuDate: Date,
    note: string | null,
  ) {
    return client.menuDay.create({
      data: {
        weeklyMenuId,

        menuDate: menuDate,

        note: note,

        approvalStatus: "DRAFT",
      },
    });
  },
  deleteDayIngredients(client: Tx, menuDayId: string) {
    return client.menuDayDishIngredient.deleteMany({
      where: { menuDayId: menuDayId },
    });
  },
  deleteDaySeasonings(client: Tx, menuDayId: string) {
    return client.menuMealSeasoning.deleteMany({
      where: { menuDayId: menuDayId },
    });
  },
  activeSchoolDish(client: Tx, schoolId: string, dishId: string) {
    return client.dish.findFirst({
      where: { id: dishId, schoolId, status: "ACTIVE" },
    });
  },
  namedSchoolDish(client: Tx, schoolId: string, name: string) {
    return client.dish.findFirst({
      where: { schoolId, name: name },
    });
  },
  createSchoolDish(client: Tx, schoolId: string, name: string) {
    return client.dish.create({
      data: { schoolId, name: name },
    });
  },
  saveMealDish(
    client: Tx,
    menuDayId: string,
    dishId: string,
    mealType: MealType,
    displayOrder: number,
  ) {
    return client.menuDayDish.upsert({
      where: {
        menuDayId_dishId_mealType: {
          menuDayId: menuDayId,

          dishId: dishId,

          mealType: mealType,
        },
      },

      create: {
        menuDayId: menuDayId,

        dishId: dishId,

        mealType: mealType,

        displayOrder: displayOrder,
      },

      update: { displayOrder: displayOrder },
    });
  },
  insertDayIngredients(client: Tx, ingredients: DayIngredientWrite[]) {
    return client.menuDayDishIngredient.createMany({ data: ingredients });
  },
  insertDaySeasonings(
    client: Tx,
    menuDayId: string,
    mealType: MealType,
    seasonings: SeasoningWrite[],
  ) {
    return client.menuMealSeasoning.createMany({
      data: seasonings.map((s) => ({
        menuDayId: menuDayId,

        mealType: mealType,

        ...s,
      })),
    });
  },
  removedMealDishes(client: Tx, menuDayId: string, desired: MealDishKey[]) {
    return client.menuDayDish.findMany({
      where: removedDishWhere(menuDayId, desired),

      select: { dishId: true, mealType: true },
    });
  },
  referencedMealDishCount(
    client: Tx,
    menuDayId: string,
    oldDishes: MealDishKey[],
  ) {
    return client.menuMealPortionGroupDish.count({
      where: { menuDayId: menuDayId, OR: oldDishes },
    });
  },
  deleteRemovedMealDishes(
    client: Tx,
    menuDayId: string,
    desired: MealDishKey[],
  ) {
    return client.menuDayDish.deleteMany({
      where: removedDishWhere(menuDayId, desired),
    });
  },
  listMenus(
    client: Tx,
    scope: Prisma.WeeklyMenuWhereInput,
    query: MenuFilterValues,
  ) {
    return client.weeklyMenu.findMany({
      where: menuFilterWhere(scope, query),

      include: menuListInclude,

      skip: (query.page - 1) * query.limit,

      take: query.limit,

      orderBy: [{ weekStartDate: "desc" }, { id: "asc" }],
    });
  },
  countMenus(
    client: Tx,
    scope: Prisma.WeeklyMenuWhereInput,
    query: MenuFilterValues,
  ) {
    return client.weeklyMenu.count({ where: menuFilterWhere(scope, query) });
  },
  scopedMenu(client: Tx, id: string, scope: Prisma.WeeklyMenuWhereInput) {
    return client.weeklyMenu.findFirst({
      where: { AND: [scope, { id }] },

      include: menuDetail,
    });
  },
  menuForWeek(client: Tx, schoolId: string, weekStartDate: Date) {
    return client.weeklyMenu.findFirst({
      where: { schoolId, weekStartDate: weekStartDate },

      include: menuDetail,
    });
  },
  updateMenuTitle(client: Tx, id: string, title: string | null) {
    return client.weeklyMenu.update({
      where: { id: id },

      data: { title: title },
    });
  },
  createWeeklyMenu(
    client: Tx,
    schoolId: string,
    createdByUserId: string,
    weekStartDate: Date,
    title: string | null,
  ) {
    return client.weeklyMenu.create({
      data: {
        schoolId,

        createdByUserId,

        weekStartDate: weekStartDate,

        title: title,

        status: "DRAFT",
      },
    });
  },
  weeklyReviewCount(client: Tx, id: string) {
    return client.menuReviewRecord.count({ where: { weeklyMenuId: id } });
  },
  deleteWeeklyMenu(client: Tx, id: string) {
    return client.weeklyMenu.delete({ where: { id } });
  },
  submitDraftDays(client: Tx, id: string) {
    return client.menuDay.updateMany({
      where: {
        weeklyMenuId: id,

        approvalStatus: { in: ["DRAFT", "REVISION_REQUIRED"] },
      },

      data: { approvalStatus: "PENDING_APPROVAL" },
    });
  },
  submitWeeklyMenu(client: Tx, id: string, submittedAt: Date) {
    return client.weeklyMenu.update({
      where: { id },

      data: {
        status: "PENDING_APPROVAL",

        submittedAt,

        approvedAt: null,
      },
    });
  },
  insertReview(
    client: Tx,
    id: string,
    input: ReviewWrite,
    reviewerUserId: string,
  ) {
    return client.menuReviewRecord.create({
      data: { weeklyMenuId: id, ...input, reviewerUserId },

      include: { User: { select: { id: true, fullName: true } } },
    });
  },
  setDayApproval(
    client: Tx,
    dayIds: string[],
    status: "APPROVED" | "REVISION_REQUIRED",
  ) {
    return client.menuDay.updateMany({
      where: { id: { in: dayIds } },

      data: { approvalStatus: status },
    });
  },
  dayApprovalStates(client: Tx, id: string) {
    return client.menuDay.findMany({
      where: { weeklyMenuId: id },

      select: { approvalStatus: true },
    });
  },
  setWeeklyApproval(
    client: Tx,
    id: string,
    weeklyStatus: MenuStatus,
    reviewedAt: Date,
  ) {
    return client.weeklyMenu.update({
      where: { id },

      data: {
        status: weeklyStatus,

        approvedAt: weeklyStatus === "APPROVED" ? reviewedAt : null,
      },
    });
  },
  weekScheduleMenu(
    client: Tx,
    scope: Prisma.WeeklyMenuWhereInput,
    weekStartDate: Date,
  ) {
    return client.weeklyMenu.findFirst({
      where: {
        AND: [
          scope,
          {
            weekStartDate,
          },
        ],
      },

      select: {
        id: true,

        status: true,

        title: true,

        menuDays: {
          select: {
            id: true,

            menuDate: true,

            approvalStatus: true,

            note: true,

            menuDayDishes: {
              select: { dishId: true, mealType: true },
            },
          },

          orderBy: { menuDate: "asc" },
        },
      },
    });
  },
  menuExists(client: Tx, id: string, scope: Prisma.WeeklyMenuWhereInput) {
    return client.weeklyMenu.findFirst({
      where: { AND: [scope, { id }] },

      select: { id: true },
    });
  },
  reviews(client: Tx, id: string, query: Pagination) {
    return client.menuReviewRecord.findMany({
      where: { weeklyMenuId: id },

      ...listWindow(query),

      orderBy: [{ reviewedAt: "desc" }, { id: "asc" }],

      select: {
        id: true,

        weeklyMenuId: true,

        menuDayId: true,

        decision: true,

        feedback: true,

        reviewedAt: true,

        User: { select: { id: true, fullName: true } },
      },
    });
  },
};
const select = {
  id: true,

  schoolId: true,

  weekStartDate: true,

  title: true,

  status: true,

  submittedAt: true,

  approvedAt: true,

  createdAt: true,

  updatedAt: true,
} as const satisfies Prisma.WeeklyMenuSelect;

type ListRow = Prisma.WeeklyMenuGetPayload<{ select: typeof select }>;

type ListArguments = Pick<
  Prisma.WeeklyMenuFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof select;
};

export type MenuListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: MenuListReader = async (args) => {
  const prisma = await getPrisma();

  return prisma.weeklyMenu.findMany(args);
};

export type MenuDetailRow = Prisma.WeeklyMenuGetPayload<{
  include: typeof menuDetail;
}>;
export type MenuListRow = Prisma.WeeklyMenuGetPayload<{
  include: typeof menuListInclude;
}>;
export type PortionGroupRow = Awaited<
  ReturnType<typeof menuRepository.portionGroups>
>[number];
export type MenuSummaryRow = ListRow;
export function createMenuSummaryRepository(
  read: MenuListReader = readFromDatabase,
) {
  return {
    list(query: Pagination, scope: Prisma.WeeklyMenuWhereInput) {
      return read({
        ...listWindow(query),
        where: scope,
        select,
        orderBy: [{ id: "asc" }],
      });
    },
  };
}
