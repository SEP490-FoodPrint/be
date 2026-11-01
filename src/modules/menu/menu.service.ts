import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import {
  assertPermission,
  withSchoolTransaction as schoolTransaction,
} from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import { listScopes } from "../../utils/resource-access";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";
import {
  convertQuantity,
  readPlanningStock,
  readMealPortionDemand,
  assertPortionGroupSafety,
} from "../kitchen/kitchen.service";
import type {
  MenuMeal,
  MenuStandardsInput,
  MenuWrite,
  MenuReviewInput,
  MenuFilters,
  MenuPortionGroupsInput,
} from "./menu.validation";

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

async function validateIngredientSources(
  tx: Tx,
  input: Pick<MenuStandardsInput, "dishes" | "seasonings">,
  schoolId: string,
) {
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
      422,
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
    throw new HttpError(422, "Gia vị phải thuộc danh mục kho khô của trường");
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
}

function createIngredientOperations(
  connect: () => Promise<PrismaClient> = getPrisma,
) {
  return {
    async getPortionGroups(meal: MenuMeal, principal: AuthPrincipal) {
      const schoolId = schoolScope(principal),
        db = await connect();
      await mealDay(db, meal, schoolId);
      return {
        ...meal,
        groups: await db.menuMealPortionGroup.findMany({
          where: meal,
          include: {
            dishes: { select: { dishId: true } },
            avoidances: { select: { ingredientEntryId: true } },
          },
          orderBy: [{ isDefault: "desc" }, { id: "asc" }],
        }),
      };
    },
    async savePortionGroups(
      meal: MenuMeal,
      input: MenuPortionGroupsInput,
      principal: AuthPrincipal,
    ) {
      return schoolTransaction(
        await connect(),
        principal,
        "menu.update",
        async (tx, _actor, schoolId) => {
          const day = await mealDay(tx, meal, schoolId);
          const editable =
            ["DRAFT", "REVISION_REQUIRED"].includes(day.approvalStatus) ||
            (day.WeeklyMenu.status === "DRAFT" &&
              day.approvalStatus !== "APPROVED");
          if (
            !editable ||
            (await tx.cookingBatch.count({ where: meal })) ||
            (await tx.menuMealSeasoningLot.count({ where: meal })) ||
            (await tx.dailyMealPortionGroup.count({
              where: { portionGroup: meal },
            }))
          )
            throw new HttpError(
              409,
              "Nhóm suất đã gửi duyệt, đã được chốt hoặc lập mẻ; không được thay đổi",
            );
          const old = await tx.menuMealPortionGroup.findMany({
            where: meal,
            select: { id: true },
          });
          if (input.groups.some((g) => g.id && !old.some((o) => o.id === g.id)))
            throw new HttpError(404, "Nhóm suất không thuộc bữa của trường");
          const expected = new Set(day.menuDayDishes.map((d) => d.dishId));
          if (
            input.groups.length &&
            (input.groups.some((g) =>
              g.dishIds.some((id) => !expected.has(id)),
            ) ||
              [...expected].some(
                (id) => !input.groups.some((g) => g.dishIds.includes(id)),
              ))
          )
            throw new HttpError(
              422,
              "Các nhóm phải chọn đúng và bao phủ các món trong bữa",
            );
          const avoided = [
            ...new Set(
              input.groups.flatMap((g) => g.avoidedIngredientEntryIds),
            ),
          ];
          if (
            (await tx.ingredientEntry.count({
              where: { id: { in: avoided }, schoolId, status: "ACTIVE" },
            })) !== avoided.length
          )
            throw new HttpError(
              422,
              "Nguyên liệu cần tránh phải thuộc danh mục trường",
            );
          await tx.menuMealPortionGroup.updateMany({
            where: meal,
            data: { isDefault: false },
          });
          await tx.menuMealPortionGroup.deleteMany({
            where: {
              ...meal,
              id: { notIn: input.groups.flatMap((g) => (g.id ? [g.id] : [])) },
            },
          });
          for (const group of input.groups) {
            const data = {
              ...meal,
              name: group.name,
              isDefault: group.isDefault,
            };
            const saved = group.id
              ? await tx.menuMealPortionGroup.update({
                  where: { id: group.id },
                  data,
                })
              : await tx.menuMealPortionGroup.create({ data });
            await tx.menuMealPortionGroupDish.deleteMany({
              where: { portionGroupId: saved.id },
            });
            await tx.menuMealPortionGroupAvoidance.deleteMany({
              where: { portionGroupId: saved.id },
            });
            await tx.menuMealPortionGroupDish.createMany({
              data: group.dishIds.map((dishId) => ({
                ...meal,
                portionGroupId: saved.id,
                dishId,
              })),
            });
            if (group.avoidedIngredientEntryIds.length)
              await tx.menuMealPortionGroupAvoidance.createMany({
                data: group.avoidedIngredientEntryIds.map(
                  (ingredientEntryId) => ({
                    portionGroupId: saved.id,
                    ingredientEntryId,
                  }),
                ),
              });
          }
          await assertPortionGroupSafety(tx, meal, schoolId);
          return {
            ...meal,
            groups: await tx.menuMealPortionGroup.findMany({
              where: meal,
              include: {
                dishes: { select: { dishId: true } },
                avoidances: { select: { ingredientEntryId: true } },
              },
              orderBy: { id: "asc" },
            }),
          };
        },
      );
    },
    async allergyCheck(ingredientIds: string[], principal: AuthPrincipal) {
      const schoolId = schoolScope(principal);
      assertPermission(principal, "class_allergy.view");
      const db = await connect();
      return db.$transaction(
        async (tx) => {
          const ingredients = await tx.ingredient.findMany({
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
          if (ingredients.length !== ingredientIds.length)
            throw new HttpError(
              422,
              "Nguyên liệu phải thuộc Supplier đang liên kết với trường",
            );
          const allergies = await tx.classAllergy.findMany({
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
          const conflicts = ingredients
            .map((i) => {
              const rows = allergies.filter(
                (a) => a.IngredientEntry.ingredientId === i.id,
              );
              return {
                ingredientId: i.id,
                ingredientName: i.name,
                allergen: null,
                allergenDataAvailable: false,
                affectedStudentsCount: rows.reduce(
                  (n, r) => n + r.affectedCount,
                  0,
                ),
                affectedClasses: rows.map((a) => ({
                  classId: a.classId,
                  className: a.Class.name,
                  count: a.affectedCount,
                })),
              };
            })
            .filter((i) => i.affectedStudentsCount > 0);
          const perClass = [...new Set(allergies.map((a) => a.classId))].map(
            (id) =>
              allergies
                .filter((a) => a.classId === id)
                .map((a) => a.affectedCount),
          );
          const minimum = perClass.reduce(
              (n, counts) => n + Math.max(...counts),
              0,
            ),
            maximum = perClass.reduce(
              (n, counts) => n + counts.reduce((s, c) => s + c, 0),
              0,
            );
          return {
            hasConflict: conflicts.length > 0,
            totalAffectedStudents: minimum === maximum ? minimum : null,
            totalAffectedStudentsBounds: { minimum, maximum },
            countingMethod: "CLASS_INGREDIENT_AGGREGATE",
            requiresIndividualDeduplication: minimum !== maximum,
            conflicts,
            requiresMenuAdjustment: conflicts.length > 0,
          };
        },
        { isolationLevel: "RepeatableRead" },
      );
    },
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
          await validateIngredientSources(tx, input, schoolId);
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
          await assertPortionGroupSafety(tx, meal, schoolId);
          const updated = await tx.menuDay.update({
            where: { id: meal.menuDayId },
            data: { updatedAt: new Date() },
          });
          return {
            ...meal,
            message:
              "Đã lưu định mức nguyên liệu món và gia vị bữa ăn thành công",
            updatedAt: updated.updatedAt,
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
      return db.$transaction(
        async (tx) => {
          if (kind === "main") {
            const where: Prisma.IngredientWhereInput = {
              status: "ACTIVE",
              Supplier: {
                status: "ACTIVE",
                schoolSupplierRelationships: {
                  some: { schoolId, status: "ACTIVE" },
                },
              },
            };
            const rows = await tx.ingredient.findMany({
              where,
              select: {
                id: true,
                supplierId: true,
                name: true,
                category: true,
                defaultUnit: true,
                Supplier: { select: { name: true } },
              },
              orderBy: { id: "asc" },
              skip: (query.page - 1) * query.limit,
              take: query.limit,
            });
            return {
              items: rows.map(({ Supplier, ...i }) => ({
                ...i,
                supplierName: Supplier.name,
                allergen: null,
                allergenDataAvailable: false,
              })),
              pagination: {
                ...query,
                totalItems: await tx.ingredient.count({ where }),
              },
            };
          }
          const where: Prisma.IngredientEntryWhereInput = {
            schoolId,
            status: "ACTIVE",
            handlingType: "DRY_STOCK",
            Ingredient: { status: "ACTIVE" },
          };
          const rows = await tx.ingredientEntry.findMany({
            where,
            select: {
              id: true,
              ingredientId: true,
              handlingType: true,
              Ingredient: {
                select: { name: true, category: true, defaultUnit: true },
              },
            },
            orderBy: { id: "asc" },
            skip: (query.page - 1) * query.limit,
            take: query.limit,
          });
          return {
            items: rows.map(({ Ingredient, ...i }) => ({
              ...i,
              ...Ingredient,
            })),
            pagination: {
              ...query,
              totalItems: await tx.ingredientEntry.count({ where }),
            },
          };
        },
        { isolationLevel: "RepeatableRead" },
      );
    },

    async getRequirements(meal: MenuMeal, principal: AuthPrincipal) {
      const schoolId = schoolScope(principal),
        db = await connect();
      return db.$transaction(
        async (tx) => {
          const day = await mealDay(tx, meal, schoolId);
          const demand = await readMealPortionDemand(
            tx,
            meal,
            schoolId,
            day.menuDate,
          );
          const portions = demand.totalPortions;
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
              portions: demand.dishPortions.get(row.dishId) ?? 0,
              unit: row.unit,
            })),
            ...spices.map((row) => ({
              ingredient: row.ingredientEntry.Ingredient,
              quantity: row.quantityPerPortion,
              portions,
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
                line.quantity.mul(line.portions),
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
                  category: true,
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

function createMenuOperations(connect: () => Promise<PrismaClient>) {
  async function owned(tx: Tx, id: string, schoolId: string) {
    const menu = await tx.weeklyMenu.findFirst({
      where: { id, schoolId },
      include: menuDetail,
    });
    if (!menu) throw new HttpError(404, "Không tìm thấy thực đơn của trường");
    return menu;
  }
  async function assertUnused(tx: Tx, menuDayId: string) {
    if (
      (await tx.cookingBatch.count({ where: { menuDayId } })) ||
      (await tx.menuMealSeasoningLot.count({ where: { menuDayId } }))
    )
      throw new HttpError(
        409,
        "Ngày thực đơn đã được dùng lập mẻ; không được sửa hoặc xóa",
      );
  }
  async function writeDays(
    tx: Tx,
    id: string,
    input: MenuWrite,
    schoolId: string,
  ) {
    const parent = await tx.weeklyMenu.findUniqueOrThrow({
      where: { id },
      select: { status: true, submittedAt: true },
    });
    const editable = (day: { approvalStatus: string }) =>
      ["DRAFT", "REVISION_REQUIRED"].includes(day.approvalStatus) ||
      (parent.status === "DRAFT" &&
        !parent.submittedAt &&
        day.approvalStatus !== "APPROVED");
    const current = await tx.menuDay.findMany({
      where: { weeklyMenuId: id },
      select: { id: true, menuDate: true, approvalStatus: true },
    });
    for (const old of current.filter(
      (d) => !input.days.some((v) => +v.menuDate === +d.menuDate),
    )) {
      if (
        !editable(old) ||
        parent.submittedAt ||
        (await tx.menuReviewRecord.count({ where: { menuDayId: old.id } }))
      )
        throw new HttpError(
          409,
          "Không xóa ngày đã gửi duyệt hoặc có lịch sử duyệt",
        );
      await assertUnused(tx, old.id);
      await tx.menuDay.delete({ where: { id: old.id } });
    }
    for (const day of input.days) {
      const old = current.find((d) => +d.menuDate === +day.menuDate);
      if (old && !editable(old)) {
        // Full updates must not rewrite independently approved or pending days.
        const stored = (await owned(tx, id, schoolId)).menuDays.find(
          (d) => d.id === old.id,
        )!;
        const canonical = (value: unknown) => JSON.stringify(value);
        const supplied = {
          note: day.note,
          meals: day.meals
            .map((m) => ({
              mealType: m.mealType,
              dishes: m.dishes
                .map((d) => ({
                  dishId: d.dishId,
                  ingredients: [...d.ingredients]
                    .sort((a, b) =>
                      a.ingredientId.localeCompare(b.ingredientId),
                    )
                    .map((i) => ({
                      ...i,
                      quantityPerPortion: new Prisma.Decimal(
                        i.quantityPerPortion,
                      ).toString(),
                    })),
                }))
                .sort((a, b) =>
                  String(a.dishId).localeCompare(String(b.dishId)),
                ),
              seasonings: [...m.seasonings]
                .sort((a, b) =>
                  a.ingredientEntryId.localeCompare(b.ingredientEntryId),
                )
                .map((i) => ({
                  ...i,
                  quantityPerPortion: new Prisma.Decimal(
                    i.quantityPerPortion,
                  ).toString(),
                })),
            }))
            .sort((a, b) => a.mealType.localeCompare(b.mealType)),
        };
        const expected = {
          note: stored.note,
          meals: [...new Set(stored.menuDayDishes.map((d) => d.mealType))]
            .map((mealType) => ({
              mealType,
              dishes: stored.menuDayDishes
                .filter((d) => d.mealType === mealType)
                .map((d) => ({
                  dishId: d.dishId,
                  ingredients: d.ingredients.map((i) => ({
                    ingredientId: i.ingredientId,
                    quantityPerPortion: i.quantityPerPortion.toString(),
                    unit: i.unit,
                  })),
                }))
                .sort((a, b) => a.dishId.localeCompare(b.dishId)),
              seasonings: stored.mealSeasonings
                .filter((s) => s.mealType === mealType)
                .map((s) => ({
                  ingredientEntryId: s.ingredientEntryId,
                  quantityPerPortion: s.quantityPerPortion.toString(),
                  unit: s.unit,
                })),
            }))
            .sort((a, b) => a.mealType.localeCompare(b.mealType)),
        };
        if (canonical(supplied) !== canonical(expected))
          throw new HttpError(409, "Không sửa ngày đã gửi duyệt hoặc đã duyệt");
        continue;
      }
      if (old) await assertUnused(tx, old.id);
      const saved = old
        ? await tx.menuDay.update({
            where: { id: old.id },
            data: { note: day.note },
          })
        : await tx.menuDay.create({
            data: {
              weeklyMenuId: id,
              menuDate: day.menuDate,
              note: day.note,
              approvalStatus: "DRAFT",
            },
          });
      await tx.menuDayDishIngredient.deleteMany({
        where: { menuDayId: saved.id },
      });
      await tx.menuMealSeasoning.deleteMany({ where: { menuDayId: saved.id } });
      const desired: { dishId: string; mealType: "LUNCH" | "AFTERNOON" }[] = [];
      for (const meal of day.meals) {
        const dishes: MenuStandardsInput["dishes"] = [];
        for (const [displayOrder, item] of meal.dishes.entries()) {
          let dish = item.dishId
            ? await tx.dish.findFirst({
                where: { id: item.dishId, schoolId, status: "ACTIVE" },
              })
            : await tx.dish.findFirst({
                where: { schoolId, name: item.name! },
              });
          if (!dish && item.name)
            dish = await tx.dish.create({
              data: { schoolId, name: item.name },
            });
          if (!dish || dish.status !== "ACTIVE")
            throw new HttpError(
              422,
              "Món ăn phải đang hoạt động và thuộc trường",
            );
          if (dishes.some((d) => d.dishId === dish.id))
            throw new HttpError(400, "Trùng món trong cùng bữa");
          dishes.push({ dishId: dish.id, ingredients: item.ingredients });
          desired.push({ dishId: dish.id, mealType: meal.mealType });
          await tx.menuDayDish.upsert({
            where: {
              menuDayId_dishId_mealType: {
                menuDayId: saved.id,
                dishId: dish.id,
                mealType: meal.mealType,
              },
            },
            create: {
              menuDayId: saved.id,
              dishId: dish.id,
              mealType: meal.mealType,
              displayOrder: displayOrder + 1,
            },
            update: { displayOrder: displayOrder + 1 },
          });
        }
        const norms = { dishes, seasonings: meal.seasonings };
        await validateIngredientSources(tx, norms, schoolId);
        const ingredients = dishes.flatMap((d) =>
          d.ingredients.map((i) => ({
            menuDayId: saved.id,
            mealType: meal.mealType,
            dishId: d.dishId,
            ...i,
          })),
        );
        if (ingredients.length)
          await tx.menuDayDishIngredient.createMany({ data: ingredients });
        if (meal.seasonings.length)
          await tx.menuMealSeasoning.createMany({
            data: meal.seasonings.map((s) => ({
              menuDayId: saved.id,
              mealType: meal.mealType,
              ...s,
            })),
          });
      }
      const removed: Prisma.MenuDayDishWhereInput = {
        menuDayId: saved.id,
        NOT: { OR: desired },
      };
      const oldDishes = await tx.menuDayDish.findMany({
        where: removed,
        select: { dishId: true, mealType: true },
      });
      if (
        oldDishes.length &&
        (await tx.menuMealPortionGroupDish.count({
          where: { menuDayId: saved.id, OR: oldDishes },
        }))
      )
        throw new HttpError(
          409,
          "Cần điều chỉnh nhóm suất trước khi bỏ món đang được nhóm sử dụng",
        );
      await tx.menuDayDish.deleteMany({ where: removed });
      for (const meal of day.meals)
        await assertPortionGroupSafety(
          tx,
          { menuDayId: saved.id, mealType: meal.mealType },
          schoolId,
        );
    }
  }
  async function ready(
    tx: Tx,
    menu: Awaited<ReturnType<typeof owned>>,
    schoolId: string,
  ) {
    if (!menu.menuDays.length)
      throw new HttpError(422, "Thực đơn chưa có ngày ăn");
    for (const day of menu.menuDays) {
      if (day.approvalStatus === "APPROVED") continue;
      if (
        !day.menuDayDishes.length ||
        day.menuDayDishes.some(
          (d) => !d.ingredients.length || d.Dish.status !== "ACTIVE",
        )
      )
        throw new HttpError(
          422,
          "Mỗi món cần đầy đủ định mức trước khi gửi duyệt",
        );
      for (const mealType of new Set(day.menuDayDishes.map((d) => d.mealType)))
        await validateIngredientSources(
          tx,
          {
            dishes: day.menuDayDishes
              .filter((d) => d.mealType === mealType)
              .map((d) => ({
                dishId: d.dishId,
                ingredients: d.ingredients.map((i) => ({
                  ingredientId: i.ingredientId,
                  quantityPerPortion: i.quantityPerPortion.toString(),
                  unit: i.unit,
                })),
              })),
            seasonings: day.mealSeasonings
              .filter((s) => s.mealType === mealType)
              .map((s) => ({
                ingredientEntryId: s.ingredientEntryId,
                quantityPerPortion: s.quantityPerPortion.toString(),
                unit: s.unit,
              })),
          },
          schoolId,
        );
      for (const mealType of new Set(day.menuDayDishes.map((d) => d.mealType)))
        await assertPortionGroupSafety(
          tx,
          { menuDayId: day.id, mealType },
          schoolId,
        );
    }
  }
  return {
    async list(query: MenuFilters, principal: AuthPrincipal) {
      const scope = listScopes.menu(principal),
        db = await connect();
      const where: Prisma.WeeklyMenuWhereInput = {
        AND: [
          scope,
          {
            status: query.status,
            weekStartDate: query.weekStartDate,
            ...(query.date
              ? { menuDays: { some: { menuDate: query.date } } }
              : {}),
          },
        ],
      };
      return db.$transaction(
        async (tx) => ({
          items: await tx.weeklyMenu.findMany({
            where,
            include: menuDetail,
            skip: (query.page - 1) * query.limit,
            take: query.limit,
            orderBy: [{ weekStartDate: "desc" }, { id: "asc" }],
          }),
          pagination: {
            ...query,
            totalItems: await tx.weeklyMenu.count({ where }),
          },
        }),
        { isolationLevel: "RepeatableRead" },
      );
    },
    async getOne(id: string, principal: AuthPrincipal) {
      const db = await connect(),
        scope = listScopes.menu(principal);
      const menu = await db.weeklyMenu.findFirst({
        where: { AND: [scope, { id }] },
        include: menuDetail,
      });
      if (!menu) throw new HttpError(404, "Không tìm thấy thực đơn");
      return menu;
    },
    async create(input: MenuWrite, principal: AuthPrincipal) {
      return schoolTransaction(
        await connect(),
        principal,
        "menu.create",
        async (tx, actor, schoolId) => {
          if (
            await tx.weeklyMenu.count({
              where: { schoolId, weekStartDate: input.weekStartDate },
            })
          )
            throw new HttpError(409, "Tuần này đã có thực đơn");
          const menu = await tx.weeklyMenu.create({
            data: {
              schoolId,
              createdByUserId: actor.id,
              weekStartDate: input.weekStartDate,
              title: input.title,
              status: "DRAFT",
            },
          });
          await writeDays(tx, menu.id, input, schoolId);
          return owned(tx, menu.id, schoolId);
        },
      );
    },
    async update(id: string, input: MenuWrite, principal: AuthPrincipal) {
      return schoolTransaction(
        await connect(),
        principal,
        "menu.update",
        async (tx, _actor, schoolId) => {
          const menu = await owned(tx, id, schoolId);
          if (!["DRAFT", "REVISION_REQUIRED"].includes(menu.status))
            throw new HttpError(409, "Thực đơn không còn được chỉnh sửa");
          if (+input.weekStartDate !== +menu.weekStartDate)
            throw new HttpError(409, "Không đổi tuần của thực đơn đã tạo");
          await writeDays(tx, id, input, schoolId);
          await tx.weeklyMenu.update({
            where: { id },
            data: { title: input.title },
          });
          return owned(tx, id, schoolId);
        },
      );
    },
    async remove(id: string, principal: AuthPrincipal) {
      return schoolTransaction(
        await connect(),
        principal,
        "menu.update",
        async (tx, _actor, schoolId) => {
          const menu = await owned(tx, id, schoolId);
          if (
            menu.status !== "DRAFT" ||
            menu.submittedAt ||
            (await tx.menuReviewRecord.count({ where: { weeklyMenuId: id } }))
          )
            throw new HttpError(409, "Chỉ xóa bản nháp chưa gửi duyệt");
          for (const day of menu.menuDays) await assertUnused(tx, day.id);
          await tx.weeklyMenu.delete({ where: { id } });
          return { id, deleted: true };
        },
      );
    },
    async submit(id: string, principal: AuthPrincipal) {
      return schoolTransaction(
        await connect(),
        principal,
        "menu.update",
        async (tx, _actor, schoolId) => {
          const menu = await owned(tx, id, schoolId);
          if (menu.status === "PENDING_APPROVAL") return menu;
          if (!["DRAFT", "REVISION_REQUIRED"].includes(menu.status))
            throw new HttpError(
              409,
              "Thực đơn không thể gửi duyệt ở trạng thái này",
            );
          await ready(tx, menu, schoolId);
          await tx.menuDay.updateMany({
            where: {
              weeklyMenuId: id,
              approvalStatus: { in: ["DRAFT", "REVISION_REQUIRED"] },
            },
            data: { approvalStatus: "PENDING_APPROVAL" },
          });
          await tx.weeklyMenu.update({
            where: { id },
            data: {
              status: "PENDING_APPROVAL",
              submittedAt: new Date(),
              approvedAt: null,
            },
          });
          return owned(tx, id, schoolId);
        },
      );
    },
    async review(id: string, input: MenuReviewInput, principal: AuthPrincipal) {
      const permission =
        input.decision === "APPROVED" ? "menu.approve" : "menu.review";
      return schoolTransaction(
        await connect(),
        principal,
        permission,
        async (tx, actor, schoolId) => {
          const menu = await owned(tx, id, schoolId);
          if (!["PENDING_APPROVAL", "REVISION_REQUIRED"].includes(menu.status))
            throw new HttpError(409, "Thực đơn chưa chờ duyệt");
          const days = input.menuDayId
            ? menu.menuDays.filter((d) => d.id === input.menuDayId)
            : menu.menuDays.filter(
                (d) => d.approvalStatus === "PENDING_APPROVAL",
              );
          if (!days.length)
            throw new HttpError(
              404,
              "Không có ngày cần duyệt trong thực đơn này",
            );
          if (days.some((d) => d.approvalStatus !== "PENDING_APPROVAL"))
            throw new HttpError(409, "Ngày không chờ duyệt");
          if (input.decision === "APPROVED")
            await ready(tx, { ...menu, menuDays: days }, schoolId);
          const status =
            input.decision === "APPROVED" ? "APPROVED" : "REVISION_REQUIRED";
          const record = await tx.menuReviewRecord.create({
            data: { weeklyMenuId: id, ...input, reviewerUserId: actor.id },
            include: { User: { select: { id: true, fullName: true } } },
          });
          await tx.menuDay.updateMany({
            where: { id: { in: days.map((d) => d.id) } },
            data: { approvalStatus: status },
          });
          const states = await tx.menuDay.findMany({
            where: { weeklyMenuId: id },
            select: { approvalStatus: true },
          });
          const weeklyStatus = states.every(
            (d) => d.approvalStatus === "APPROVED",
          )
            ? "APPROVED"
            : states.some((d) => d.approvalStatus === "REVISION_REQUIRED")
              ? "REVISION_REQUIRED"
              : "PENDING_APPROVAL";
          await tx.weeklyMenu.update({
            where: { id },
            data: {
              status: weeklyStatus,
              approvedAt:
                weeklyStatus === "APPROVED" ? record.reviewedAt : null,
            },
          });
          return {
            weeklyMenuId: id,
            menuDayId: input.menuDayId,
            approvalStatus: status,
            weeklyStatus,
            reviewedAt: record.reviewedAt,
            reviewer: record.User,
          };
        },
      );
    },
    async getReviews(id: string, principal: AuthPrincipal, query: ListQuery) {
      const scope = listScopes.menu(principal),
        db = await connect();
      if (
        !(await db.weeklyMenu.findFirst({
          where: { AND: [scope, { id }] },
          select: { id: true },
        }))
      )
        throw new HttpError(404, "Không tìm thấy thực đơn");
      const page = await readListPage(
        () =>
          db.menuReviewRecord.findMany({
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
          }),
        query,
      );
      return {
        ...page,
        items: page.items.map(({ User, ...r }) => ({ ...r, reviewer: User })),
      };
    },
  };
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
    ...createMenuOperations(connect),
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
