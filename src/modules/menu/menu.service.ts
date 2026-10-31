import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import { assertPermission, loadPrincipal } from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import { listScopes } from "../../utils/resource-access";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";
import { convertQuantity, readPlanningStock } from "../kitchen/kitchen.service";
import type { MenuMeal, MenuStandardsInput } from "./menu.validation";

type Tx = Prisma.TransactionClient;
function schoolScope(principal: AuthPrincipal) {
  assertPermission(principal, "menu.view");
  if (principal.orgType !== "SCHOOL" || !principal.schoolId)
    throw new HttpError(403, "Định mức thực đơn yêu cầu phạm vi trường");
  return principal.schoolId;
}
async function mealDay(tx: Tx, meal: MenuMeal, schoolId: string) {
  const day = await tx.menuDay.findFirst({
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
  if (!day || !day.menuDayDishes.length)
    throw new HttpError(404, "Không có bữa này trong thực đơn của trường");
  if (day.menuDayDishes.some((row) => row.Dish.schoolId !== schoolId))
    throw new HttpError(409, "Món không thuộc trường của thực đơn");
  return day;
}

function createIngredientOperations(
  connect: () => Promise<PrismaClient> = getPrisma,
) {
  return {
    async getIngredients(meal: MenuMeal, principal: AuthPrincipal) {
      const schoolId = schoolScope(principal),
        db = await connect();
      return db.$transaction(
        async (tx) => {
          const day = await mealDay(tx, meal, schoolId);
          const ingredients = await tx.menuDayDishIngredient.findMany({
            where: meal,
            orderBy: [{ dishId: "asc" }, { ingredientId: "asc" }],
          });
          const seasonings = await tx.menuMealSeasoning.findMany({
            where: meal,
            orderBy: { ingredientEntryId: "asc" },
          });
          const allocations = await tx.menuMealSeasoningLot.findMany({
            where: meal,
            orderBy: { id: "asc" },
          });
          return {
            ...meal,
            approvalStatus: day.approvalStatus,
            missingDishIds: day.menuDayDishes
              .filter(
                (dish) =>
                  !ingredients.some((row) => row.dishId === dish.dishId),
              )
              .map((dish) => dish.dishId),
            ingredients: ingredients.map((row) => ({
              ...row,
              quantityPerPortion: row.quantityPerPortion.toString(),
            })),
            seasonings: seasonings.map((row) => ({
              ...row,
              quantityPerPortion: row.quantityPerPortion.toString(),
            })),
            seasoningLots: allocations.map((row) => ({
              ...row,
              quantityUsed: row.quantityUsed.toString(),
            })),
          };
        },
        { isolationLevel: "RepeatableRead" },
      );
    },

    async saveIngredients(
      meal: MenuMeal,
      input: MenuStandardsInput,
      principal: AuthPrincipal,
    ) {
      const db = await connect();
      return schoolTransaction(
        db,
        principal,
        "menu.update",
        async (tx, _actor, schoolId) => {
          const day = await mealDay(tx, meal, schoolId);
          const editable =
            day.approvalStatus === "DRAFT" ||
            day.approvalStatus === "REVISION_REQUIRED" ||
            (day.WeeklyMenu.status === "DRAFT" &&
              day.approvalStatus !== "APPROVED");
          if (
            !editable ||
            (await tx.cookingBatch.count({ where: meal })) ||
            (await tx.menuMealSeasoningLot.count({ where: meal }))
          )
            throw new HttpError(
              409,
              "Định mức đã gửi duyệt, đã duyệt hoặc đã dùng để lập mẻ; không được thay đổi",
            );
          const expected = new Set(
            day.menuDayDishes.map((dish) => dish.dishId),
          );
          if (
            expected.size !== input.dishes.length ||
            input.dishes.some((dish) => !expected.has(dish.dishId)) ||
            day.menuDayDishes.some((dish) => dish.Dish.status !== "ACTIVE")
          )
            throw new HttpError(
              400,
              "Phải khai báo đúng các món đang hoạt động trong bữa",
            );
          const ingredientIds = [
            ...new Set(
              input.dishes.flatMap((dish) =>
                dish.ingredients.map((row) => row.ingredientId),
              ),
            ),
          ];
          const catalog = await tx.ingredient.findMany({
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
          if (catalog.length !== ingredientIds.length)
            throw new HttpError(
              400,
              "Nguyên liệu chính phải từ Supplier đang liên kết với trường",
            );
          const entries = await tx.ingredientEntry.findMany({
            where: {
              id: { in: input.seasonings.map((s) => s.ingredientEntryId) },
              schoolId,
              status: "ACTIVE",
              handlingType: "DRY_STOCK",
              Ingredient: { status: "ACTIVE" },
            },
            select: { id: true, Ingredient: { select: { defaultUnit: true } } },
          });
          if (entries.length !== input.seasonings.length)
            throw new HttpError(
              400,
              "Gia vị phải thuộc danh mục kho khô của trường",
            );
          for (const dish of input.dishes)
            for (const row of dish.ingredients)
              convertQuantity(
                new Prisma.Decimal(row.quantityPerPortion),
                row.unit,
                catalog.find((i) => i.id === row.ingredientId)!.defaultUnit,
              );
          for (const row of input.seasonings)
            convertQuantity(
              new Prisma.Decimal(row.quantityPerPortion),
              row.unit,
              entries.find((e) => e.id === row.ingredientEntryId)!.Ingredient
                .defaultUnit,
            );
          await tx.menuDayDishIngredient.deleteMany({ where: meal });
          await tx.menuMealSeasoning.deleteMany({ where: meal });
          await tx.menuDayDishIngredient.createMany({
            data: input.dishes.flatMap((dish) =>
              dish.ingredients.map((row) => ({
                ...meal,
                dishId: dish.dishId,
                ...row,
              })),
            ),
          });
          if (input.seasonings.length)
            await tx.menuMealSeasoning.createMany({
              data: input.seasonings.map((row) => ({ ...meal, ...row })),
            });
          await tx.menuDay.update({
            where: { id: meal.menuDayId },
            data: { updatedAt: new Date() },
          });
          return {
            ...meal,
            dishes: input.dishes,
            seasonings: input.seasonings,
          };
        },
      );
    },

    async getIngredientOptions(
      kind: "main" | "seasoning",
      query: ListQuery,
      principal: AuthPrincipal,
    ) {
      const schoolId = schoolScope(principal),
        db = await connect();
      if (kind === "main")
        return readListPage(
          () =>
            db.ingredient.findMany({
              where: {
                status: "ACTIVE",
                Supplier: {
                  status: "ACTIVE",
                  schoolSupplierRelationships: {
                    some: { schoolId, status: "ACTIVE" },
                  },
                },
              },
              select: {
                id: true,
                supplierId: true,
                name: true,
                category: true,
                defaultUnit: true,
              },
              orderBy: { id: "asc" },
              ...listWindow(query),
            }),
          query,
        );
      return readListPage(
        () =>
          db.ingredientEntry.findMany({
            where: {
              schoolId,
              status: "ACTIVE",
              handlingType: "DRY_STOCK",
              Ingredient: { status: "ACTIVE" },
            },
            select: {
              id: true,
              ingredientId: true,
              Ingredient: {
                select: { name: true, category: true, defaultUnit: true },
              },
            },
            orderBy: { id: "asc" },
            ...listWindow(query),
          }),
        query,
      );
    },

    async getRequirements(meal: MenuMeal, principal: AuthPrincipal) {
      const schoolId = schoolScope(principal),
        db = await connect();
      return db.$transaction(
        async (tx) => {
          const day = await mealDay(tx, meal, schoolId);
          const demand = await tx.dailyMealPortion.aggregate({
            where: {
              mealDate: day.menuDate,
              mealType: meal.mealType,
              status: "FINALIZED",
              Class: { schoolId },
            },
            _sum: { totalPortions: true },
          });
          const portions = demand._sum.totalPortions ?? 0;
          const main = await tx.menuDayDishIngredient.findMany({
            where: meal,
            include: { ingredient: true },
          });
          const spices = await tx.menuMealSeasoning.findMany({
            where: meal,
            include: { ingredientEntry: { include: { Ingredient: true } } },
          });
          if (spices.some((s) => s.ingredientEntry.schoolId !== schoolId))
            throw new HttpError(409, "Gia vị nằm ngoài phạm vi trường");
          const groups = new Map<
            string,
            {
              ingredientId: string;
              name: string;
              unit: string;
              required: Prisma.Decimal;
            }
          >();
          const lines = [
            ...main.map((row) => ({
              ingredient: row.ingredient,
              quantity: row.quantityPerPortion,
              unit: row.unit,
            })),
            ...spices.map((row) => ({
              ingredient: row.ingredientEntry.Ingredient,
              quantity: row.quantityPerPortion,
              unit: row.unit,
            })),
          ];
          for (const line of lines) {
            const i = line.ingredient;
            const group = groups.get(i.id) ?? {
              ingredientId: i.id,
              name: i.name,
              unit: i.defaultUnit,
              required: new Prisma.Decimal(0),
            };
            group.required = group.required.add(
              convertQuantity(
                line.quantity.mul(portions),
                line.unit,
                group.unit,
              ),
            );
            groups.set(i.id, group);
          }
          const entries = await tx.ingredientEntry.findMany({
            where: { schoolId, ingredientId: { in: [...groups.keys()] } },
            select: { id: true, ingredientId: true },
          });
          const stock = await readPlanningStock(
            tx,
            schoolId,
            day.menuDate,
            entries.map((e) => e.id),
          );
          const ownDish = await tx.cookingBatchLot.findMany({
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
          const ownSpice = await tx.menuMealSeasoningLot.findMany({
            where: meal,
          });
          const items = [...groups.values()].map((group) => {
            const ids = new Set(
              entries
                .filter((e) => e.ingredientId === group.ingredientId)
                .map((e) => e.id),
            );
            const lots = stock.filter((lot) => ids.has(lot.ingredientEntryId));
            const onHand = lots.reduce(
              (sum, lot) =>
                sum.add(
                  convertQuantity(
                    new Prisma.Decimal(lot.availableQuantity),
                    lot.unit,
                    group.unit,
                  ),
                ),
              new Prisma.Decimal(0),
            );
            const reserved = lots.reduce(
              (sum, lot) =>
                sum.add(
                  convertQuantity(
                    new Prisma.Decimal(lot.reservedQuantity),
                    lot.unit,
                    group.unit,
                  ),
                ),
              new Prisma.Decimal(0),
            );
            const eligible = new Set(lots.map((lot) => lot.id));
            let held = new Prisma.Decimal(0),
              used = new Prisma.Decimal(0);
            for (const row of ownDish)
              if (
                ids.has(
                  row.IngredientLot.DeliveryItem.SupplyRequestItem
                    .ingredientEntryId,
                )
              ) {
                const amount = convertQuantity(
                  row.quantityUsed,
                  row.unit,
                  group.unit,
                );
                if (row.CookingBatch.status === "COMPLETED")
                  used = used.add(amount);
                else if (eligible.has(row.ingredientLotId))
                  held = held.add(amount);
              }
            for (const row of ownSpice)
              if (ids.has(row.ingredientEntryId)) {
                const amount = convertQuantity(
                  row.quantityUsed,
                  row.unit,
                  group.unit,
                );
                if (row.usedAt) used = used.add(amount);
                else if (eligible.has(row.ingredientLotId))
                  held = held.add(amount);
              }
            const free = Prisma.Decimal.max(0, onHand.sub(reserved));
            const remaining = Prisma.Decimal.max(
              0,
              group.required.sub(held).sub(used),
            );
            return {
              ingredientId: group.ingredientId,
              name: group.name,
              unit: group.unit,
              requiredQuantity: group.required.toString(),
              onHandQuantity: onHand.toString(),
              reservedQuantity: reserved.toString(),
              availableQuantity: free.toString(),
              assignedToMealQuantity: held.toString(),
              consumedForMealQuantity: used.toString(),
              shortageQuantity: Prisma.Decimal.max(
                0,
                remaining.sub(free),
              ).toString(),
              stockInconsistent: reserved.gt(onHand),
            };
          });
          return {
            ...meal,
            portions,
            portionsFinalized: portions > 0,
            missingDishIds: day.menuDayDishes
              .filter((d) => !main.some((i) => i.dishId === d.dishId))
              .map((d) => d.dishId),
            items,
          };
        },
        { isolationLevel: "RepeatableRead", timeout: 20000 },
      );
    },
  };
}

async function schoolTransaction<T>(
  db: PrismaClient,
  principal: AuthPrincipal,
  permission: string,
  operation: (
    tx: Prisma.TransactionClient,
    actor: AuthPrincipal,
    schoolId: string,
  ) => Promise<T>,
) {
  assertPermission(principal, permission);
  if (principal.orgType !== "SCHOOL" || !principal.schoolId)
    throw new HttpError(403, "Thao tác yêu cầu phạm vi trường đã xác thực");
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(
        async (tx) => {
          const actor = await loadPrincipal(principal.id, tx);
          assertPermission(actor, permission);
          if (
            actor.orgType !== "SCHOOL" ||
            !actor.schoolId ||
            actor.schoolId !== principal.schoolId
          )
            throw new HttpError(403, "Phạm vi tài khoản đã thay đổi");
          await tx.$queryRawUnsafe(
            "SELECT id FROM foodprint.schools WHERE id = $1::uuid FOR UPDATE",
            actor.schoolId,
          );
          const school = await tx.school.findUnique({
            where: { id: actor.schoolId },
            select: { status: true },
          });
          if (school?.status !== "ACTIVE")
            throw new HttpError(409, "Trường không còn hoạt động");
          return operation(tx, actor, actor.schoolId);
        },
        { isolationLevel: "Serializable", maxWait: 10000, timeout: 20000 },
      );
    } catch (error) {
      const retry =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" ||
          (error.code === "P2010" &&
            ["40001", "40P01"].includes(String(error.meta?.code))));
      if (retry && attempt < 2) continue;
      throw error;
    }
  }
}

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
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.weeklyMenu.findMany(args);
};

export function createMenuService(
  read: ListReader = readFromDatabase,
  connect: () => Promise<PrismaClient> = getPrisma,
) {
  return {
    ...createIngredientOperations(connect),
    getAll(query: ListQuery, principal: AuthPrincipal) {
      const where = listScopes["menu"](principal);
      return readListPage(
        () =>
          read({
            ...listWindow(query),
            where,
            select,
            orderBy: [{ id: "asc" }],
          }),
        query,
      );
    },
  };
}

export const menuService = createMenuService();
export type MenuService = ReturnType<typeof createMenuService>;
