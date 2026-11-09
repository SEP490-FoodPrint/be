import { Prisma, type PrismaClient } from "../../generated/prisma/client";

import {
  menuRepository as repository,
  createMenuSummaryRepository,
  type MenuListReader,
  type MenuDetailRow,
  type MenuSummaryRow,
} from "./menu.repository";
import type {
  MenuSummaryPageResponseDTO,
  MenuSummaryDTO,
  MenuAcademicCalendarDTO,
  MenuAcademicYearDTO,
  AcademicWeekDTO,
  MenuWeekScheduleDTO,
} from "./menu.response.dto";
import type { AuthPrincipal } from "../../types/auth";

import {
  assertPermission,
  withSchoolTransaction as schoolTransaction,
} from "../../utils/authorization";

import { getPrisma } from "../../utils/database";

import { HttpError } from "../../utils/http-error";

import { listScopes } from "../../utils/resource-access";

import { readListPage } from "../../utils/list-query";

import {
  convertQuantity,
  readPlanningStock,
  readMealPortionDemand,
  assertPortionGroupSafety,
  readSchoolContext,
} from "../kitchen/kitchen.service";

import type {
  MenuMeal,
  MenuStandardsInput,
  MenuWrite,
  MenuReviewInput,
  MenuFilters,
  MenuPortionGroupsInput,
  MenuListQuery,
  MenuAllergyCheckInput,
  MenuIngredientKind,
  MenuAcademicCalendarQuery,
} from "./menu.request.dto";

type Tx = Prisma.TransactionClient;

function schoolScope(principal: AuthPrincipal) {
  assertPermission(principal, "menu.view");

  if (principal.orgType !== "SCHOOL" || !principal.schoolId)
    throw new HttpError(403, "Định mức thực đơn yêu cầu phạm vi trường");

  return principal.schoolId;
}

async function mealDay(tx: Tx, meal: MenuMeal, schoolId: string) {
  const day = await repository.mealDay(tx, meal, schoolId);

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

  const catalog = await repository.linkedIngredients(
    tx,
    ingredientIds,
    schoolId,
  );

  if (catalog.length !== ingredientIds.length)
    throw new HttpError(
      422,

      "Nguyên liệu chính phải từ Supplier đang liên kết với trường",
    );

  const entries = await repository.activeSeasoningEntries(
    tx,
    input.seasonings.map((row) => row.ingredientEntryId),
    schoolId,
  );

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

        groups: await repository.portionGroups(db, meal),
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
            (await repository.mealBatchCount(tx, meal)) ||
            (await repository.mealSeasoningLotCount(tx, meal)) ||
            (await repository.dailyGroupCount(tx, meal))
          )
            throw new HttpError(
              409,

              "Nhóm suất đã gửi duyệt, đã được chốt hoặc lập mẻ; không được thay đổi",
            );

          const old = await repository.portionGroupIds(tx, meal);

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
            (await repository.activeAvoidanceCount(tx, avoided, schoolId)) !==
            avoided.length
          )
            throw new HttpError(
              422,

              "Nguyên liệu cần tránh phải thuộc danh mục trường",
            );

          await repository.clearDefaultGroups(tx, meal);

          await repository.removeObsoleteGroups(tx, meal, input.groups);

          for (const group of input.groups) {
            const data = {
              ...meal,

              name: group.name,

              isDefault: group.isDefault,
            };

            const saved = group.id
              ? await repository.updateGroup(tx, group.id, data)
              : await repository.createGroup(tx, data);

            await repository.clearGroupDishes(tx, saved.id);

            await repository.clearGroupAvoidances(tx, saved.id);

            await repository.insertGroupDishes(
              tx,
              meal,
              saved.id,
              group.dishIds,
            );

            if (group.avoidedIngredientEntryIds.length)
              await repository.insertGroupAvoidances(
                tx,
                saved.id,
                group.avoidedIngredientEntryIds,
              );
          }

          await assertPortionGroupSafety(tx, meal, schoolId);

          return {
            ...meal,

            groups: await repository.savedPortionGroups(tx, meal),
          };
        },
      );
    },

    async allergyCheck(
      ingredientIds: MenuAllergyCheckInput,
      principal: AuthPrincipal,
    ) {
      const schoolId = schoolScope(principal);

      assertPermission(principal, "class_allergy.view");

      const db = await connect();

      return db.$transaction(
        async (tx) => {
          const ingredients = await repository.allergyIngredients(
            tx,
            ingredientIds,
            schoolId,
          );

          if (ingredients.length !== ingredientIds.length)
            throw new HttpError(
              422,

              "Nguyên liệu phải thuộc Supplier đang liên kết với trường",
            );

          const allergies = await repository.classAllergies(
            tx,
            ingredientIds,
            schoolId,
          );

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

          const ingredients = await repository.mealIngredients(tx, meal);

          const seasonings = await repository.mealSeasonings(tx, meal);

          const allocations = await repository.mealSeasoningLots(tx, meal);

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
            (await repository.mealBatchCount(tx, meal)) ||
            (await repository.mealSeasoningLotCount(tx, meal))
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

          await repository.deleteMealIngredients(tx, meal);

          await repository.deleteMealSeasonings(tx, meal);

          await repository.insertMealIngredients(tx, meal, input);

          if (input.seasonings.length)
            await repository.insertMealSeasonings(tx, meal, input.seasonings);

          await assertPortionGroupSafety(tx, meal, schoolId);

          const updated = await repository.touchMenuDay(tx, meal.menuDayId);

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
      kind: MenuIngredientKind,

      query: MenuListQuery,

      principal: AuthPrincipal,
    ) {
      const schoolId = schoolScope(principal),
        db = await connect();

      return db.$transaction(
        async (tx) => {
          if (kind === "main") {
            const rows = await repository.mainIngredientOptions(
              tx,
              schoolId,
              query,
            );

            return {
              items: rows.map(({ Supplier, ingredientCategory, ...i }) => ({
                category: ingredientCategory?.categoryName ?? null,

                ...i,

                supplierName: Supplier.name,

                allergen: null,

                allergenDataAvailable: false,
              })),

              pagination: {
                ...query,

                totalItems: await repository.mainIngredientCount(tx, schoolId),
              },
            };
          }

          const rows = await repository.seasoningOptions(tx, schoolId, query);

          return {
            items: rows.map(
              ({
                Ingredient: { ingredientCategory, ...ingredient },

                ...i
              }) => ({
                ...i,

                ...ingredient,

                category: ingredientCategory?.categoryName ?? null,
              }),
            ),

            pagination: {
              ...query,

              totalItems: await repository.seasoningOptionCount(tx, schoolId),
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

          const main = await repository.recipeRequirements(tx, meal);

          const spices = await repository.seasoningRequirements(tx, meal);

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

          const entries = await repository.ingredientStockEntries(
            tx,
            schoolId,
            [...groups.keys()],
          );

          const stock = await readPlanningStock(
            tx,

            schoolId,

            day.menuDate,

            entries.map((e) => e.id),
          );

          const ownDish = await repository.batchAssignments(tx, meal);

          const ownSpice = await repository.seasoningAssignments(tx, meal);

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

            dishPortions: Object.fromEntries(demand.dishPortions),

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

/* ========================================================

   CÁC HÀM TIỆN ÍCH XỬ LÝ TUẦN & THỨ BÁN TRÚ (T2 - T6)

   ======================================================== */

export const SCHOOL_DAY_LABELS = [
  "Chủ Nhật",

  "Thứ Hai",

  "Thứ Ba",

  "Thứ Tư",

  "Thứ Năm",

  "Thứ Sáu",

  "Thứ Bảy",
] as const;

export function getSchoolMonday(d: Date): Date {
  const date = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );

  const day = date.getUTCDay() || 7;

  date.setUTCDate(date.getUTCDate() - day + 1);

  return date;
}

export function getSchoolWeekSchedule(targetDate: Date) {
  const monday = getSchoolMonday(targetDate);

  const schoolDays: {
    date: string;

    dayOfWeek: number;

    dayLabel: string;

    isSchoolDay: boolean;
  }[] = [];

  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);

    d.setUTCDate(monday.getUTCDate() + i);

    const dateStr = d.toISOString().slice(0, 10);

    schoolDays.push({
      date: dateStr,

      dayOfWeek: i + 1, // 1: T2, 2: T3, 3: T4, 4: T5, 5: T6

      dayLabel: SCHOOL_DAY_LABELS[i + 1],

      isSchoolDay: true,
    });
  }

  const friday = new Date(monday);

  friday.setUTCDate(monday.getUTCDate() + 4);

  return {
    weekStartDate: monday.toISOString().slice(0, 10),

    weekEndDate: friday.toISOString().slice(0, 10),

    schoolDays,
  };
}

// School weeks are elapsed Monday-based weeks from the configured start date.
// Holidays do not renumber weeks, and the number is never persisted.
function mapAcademicYear(
  row: Awaited<ReturnType<typeof repository.academicYears>>[number],
  today: string,
): MenuAcademicYearDTO {
  const startDate = row.startDate.toISOString().slice(0, 10);
  const endDate = row.endDate.toISOString().slice(0, 10);
  const monday = getSchoolMonday(row.startDate);
  const todayMonday = getSchoolMonday(new Date(today))
    .toISOString()
    .slice(0, 10);
  const weeks: AcademicWeekDTO[] = [];
  const dayLabel = (date: string) =>
    `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
  while (monday <= row.endDate) {
    const schedule = getSchoolWeekSchedule(monday);
    const weekNumber = weeks.length + 1;
    const weekLabel = `Tuần ${weekNumber}`;
    weeks.push({
      weekNumber,
      weekLabel,
      label: `${weekLabel} (${dayLabel(schedule.weekStartDate)} – ${dayLabel(schedule.weekEndDate)})`,
      weekStartDate: schedule.weekStartDate,
      weekEndDate: schedule.weekEndDate,
      isCurrentWeek: schedule.weekStartDate === todayMonday,
    });
    monday.setUTCDate(monday.getUTCDate() + 7);
  }
  const holidays: MenuAcademicYearDTO["holidays"] = [];
  if (Array.isArray(row.holidays)) {
    for (const item of row.holidays) {
      if (
        item &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        typeof item.date === "string"
      ) {
        holidays.push({
          date: item.date,
          reason: typeof item.reason === "string" ? item.reason : null,
        });
      }
    }
  }
  return {
    id: row.id,
    academicYear: row.academicYear,
    label: `Năm học ${row.academicYear}`,
    startDate,
    endDate,
    isCurrent: startDate <= today && today <= endDate,
    holidays,
    weeks,
  };
}

function schoolToday() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function menuCategoryDto(menu: MenuDetailRow) {
  return {
    ...menu,

    menuDays: menu.menuDays.map((day) => ({
      ...day,

      menuDayDishes: day.menuDayDishes.map((dish) => ({
        ...dish,

        ingredients: dish.ingredients.map((row) => {
          const { ingredientCategory, ...ingredient } = row.ingredient;

          return {
            ...row,

            ingredient: {
              ...ingredient,

              category: ingredientCategory?.categoryName ?? null,
            },
          };
        }),
      })),
    })),
  };
}

function createMenuOperations(connect: () => Promise<PrismaClient>) {
  async function owned(tx: Tx, id: string, schoolId: string) {
    const menu = await repository.ownedMenu(tx, id, schoolId);

    if (!menu) throw new HttpError(404, "Không tìm thấy thực đơn của trường");

    return menuCategoryDto(menu);
  }

  async function assertUnused(tx: Tx, menuDayId: string) {
    if (
      (await repository.dayBatchCount(tx, menuDayId)) ||
      (await repository.daySeasoningLotCount(tx, menuDayId))
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
    const parent = await repository.menuEditHeader(tx, id);

    const editable = (day: { approvalStatus: string }) =>
      ["DRAFT", "REVISION_REQUIRED"].includes(day.approvalStatus) ||
      (parent.status === "DRAFT" &&
        !parent.submittedAt &&
        day.approvalStatus !== "APPROVED");

    const current = await repository.menuDayHeaders(tx, id);

    for (const old of current.filter(
      (d) => !input.days.some((v) => +v.menuDate === +d.menuDate),
    )) {
      if (
        !editable(old) ||
        parent.submittedAt ||
        (await repository.dayReviewCount(tx, old.id))
      )
        throw new HttpError(
          409,

          "Không xóa ngày đã gửi duyệt hoặc có lịch sử duyệt",
        );

      await assertUnused(tx, old.id);

      await repository.deleteDay(tx, old.id);
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
        ? await repository.updateDayNote(tx, old.id, day.note)
        : await repository.createDay(tx, id, day.menuDate, day.note);

      await repository.deleteDayIngredients(tx, saved.id);

      await repository.deleteDaySeasonings(tx, saved.id);

      const desired: { dishId: string; mealType: "LUNCH" | "AFTERNOON" }[] = [];

      for (const meal of day.meals) {
        const dishes: MenuStandardsInput["dishes"] = [];

        for (const [displayOrder, item] of meal.dishes.entries()) {
          let dish = item.dishId
            ? await repository.activeSchoolDish(tx, schoolId, item.dishId)
            : await repository.namedSchoolDish(tx, schoolId, item.name!);

          if (!dish && item.name)
            dish = await repository.createSchoolDish(tx, schoolId, item.name);

          if (!dish || dish.status !== "ACTIVE")
            throw new HttpError(
              422,

              "Món ăn phải đang hoạt động và thuộc trường",
            );

          if (dishes.some((d) => d.dishId === dish.id))
            throw new HttpError(400, "Trùng món trong cùng bữa");

          dishes.push({ dishId: dish.id, ingredients: item.ingredients });

          desired.push({ dishId: dish.id, mealType: meal.mealType });

          await repository.saveMealDish(
            tx,
            saved.id,
            dish.id,
            meal.mealType,
            displayOrder + 1,
          );
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
          await repository.insertDayIngredients(tx, ingredients);

        if (meal.seasonings.length)
          await repository.insertDaySeasonings(
            tx,
            saved.id,
            meal.mealType,
            meal.seasonings,
          );
      }

      const oldDishes = await repository.removedMealDishes(
        tx,
        saved.id,
        desired,
      );

      if (
        oldDishes.length &&
        (await repository.referencedMealDishCount(tx, saved.id, oldDishes))
      )
        throw new HttpError(
          409,

          "Cần điều chỉnh nhóm suất trước khi bỏ món đang được nhóm sử dụng",
        );

      await repository.deleteRemovedMealDishes(tx, saved.id, desired);

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

      const [items, totalItems] = await Promise.all([
        repository.listMenus(db, scope, query),

        repository.countMenus(db, scope, query),
      ]);

      return {
        items,

        pagination: {
          ...query,

          totalItems,
        },
      };
    },

    async getOne(id: string, principal: AuthPrincipal) {
      const db = await connect(),
        scope = listScopes.menu(principal);

      const menu = await repository.scopedMenu(db, id, scope);

      if (!menu) throw new HttpError(404, "Không tìm thấy thực đơn");

      return menuCategoryDto(menu);
    },

    async create(input: MenuWrite, principal: AuthPrincipal) {
      return schoolTransaction(
        await connect(),

        principal,

        "menu.create",

        async (tx, actor, schoolId) => {
          const existingWeekly = await repository.menuForWeek(
            tx,
            schoolId,
            input.weekStartDate,
          );

          if (existingWeekly) {
            if (
              !["DRAFT", "REVISION_REQUIRED"].includes(existingWeekly.status)
            ) {
              throw new HttpError(
                409,

                `Thực đơn tuần này (${input.weekStartDate.toISOString().slice(0, 10)}) đã ở trạng thái ${existingWeekly.status}, không thể thêm ngày mới.`,
              );
            }

            const incomingDates = new Set(input.days.map((d) => +d.menuDate));

            const retainedDays: typeof input.days = existingWeekly.menuDays

              .filter((d) => !incomingDates.has(+d.menuDate))

              .map((d) => ({
                menuDate: d.menuDate,

                note: d.note,

                meals: [
                  ...new Set(d.menuDayDishes.map((mdd) => mdd.mealType)),
                ].map((mealType) => ({
                  mealType,

                  dishes: d.menuDayDishes

                    .filter((mdd) => mdd.mealType === mealType)

                    .map((mdd) => ({
                      dishId: mdd.dishId,

                      name: undefined,

                      ingredients: mdd.ingredients.map((i) => ({
                        ingredientId: i.ingredientId,

                        quantityPerPortion: i.quantityPerPortion.toString(),

                        unit: i.unit,
                      })),
                    })),

                  seasonings: d.mealSeasonings

                    .filter((s) => s.mealType === mealType)

                    .map((s) => ({
                      ingredientEntryId: s.ingredientEntryId,

                      quantityPerPortion: s.quantityPerPortion.toString(),

                      unit: s.unit,
                    })),
                })),
              }));

            // A create request from the day editor writes only one meal. Merge it

            // with other meals already stored on that date before writeDays,

            // which replaces all meal rows for each supplied day.

            const mergedIncomingDays = input.days.map((incomingDay) => {
              const oldDay = existingWeekly.menuDays.find(
                (day) => +day.menuDate === +incomingDay.menuDate,
              );

              if (!oldDay) return incomingDay;

              const incomingMealTypes = new Set(
                incomingDay.meals.map((meal) => meal.mealType),
              );

              const retainedMeals = [
                ...new Set(oldDay.menuDayDishes.map((row) => row.mealType)),
              ]

                .filter((mealType) => !incomingMealTypes.has(mealType))

                .map((mealType) => ({
                  mealType,

                  dishes: oldDay.menuDayDishes

                    .filter((row) => row.mealType === mealType)

                    .map((row) => ({
                      dishId: row.dishId,

                      name: undefined,

                      ingredients: row.ingredients.map((ingredient) => ({
                        ingredientId: ingredient.ingredientId,

                        quantityPerPortion:
                          ingredient.quantityPerPortion.toString(),

                        unit: ingredient.unit,
                      })),
                    })),

                  seasonings: oldDay.mealSeasonings

                    .filter((row) => row.mealType === mealType)

                    .map((row) => ({
                      ingredientEntryId: row.ingredientEntryId,

                      quantityPerPortion: row.quantityPerPortion.toString(),

                      unit: row.unit,
                    })),
                }));

              return {
                ...incomingDay,

                note: incomingDay.note ?? oldDay.note,

                meals: [...retainedMeals, ...incomingDay.meals],
              };
            });

            const mergedInput: MenuWrite = {
              weekStartDate: input.weekStartDate,

              title: input.title || existingWeekly.title,

              days: [...retainedDays, ...mergedIncomingDays],
            };

            await writeDays(tx, existingWeekly.id, mergedInput, schoolId);

            if (input.title) {
              await repository.updateMenuTitle(
                tx,
                existingWeekly.id,
                input.title,
              );
            }

            return owned(tx, existingWeekly.id, schoolId);
          }

          const menu = await repository.createWeeklyMenu(
            tx,
            schoolId,
            actor.id,
            input.weekStartDate,
            input.title,
          );

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

          await repository.updateMenuTitle(tx, id, input.title);

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
            (await repository.weeklyReviewCount(tx, id))
          )
            throw new HttpError(409, "Chỉ xóa bản nháp chưa gửi duyệt");

          for (const day of menu.menuDays) await assertUnused(tx, day.id);

          await repository.deleteWeeklyMenu(tx, id);

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

          // Kiểm tra xem tuần này đã có đủ 5 ngày T2 - T6 chưa

          const weekSchedule = getSchoolWeekSchedule(menu.weekStartDate);

          const existingDateStrs = new Set(
            menu.menuDays.map((d) => d.menuDate.toISOString().slice(0, 10)),
          );

          const missingSchoolDays = weekSchedule.schoolDays.filter(
            (sd) => !existingDateStrs.has(sd.date),
          );

          if (missingSchoolDays.length > 0) {
            const missingNames = missingSchoolDays

              .map(
                (d) =>
                  `${d.dayLabel} (${d.date.slice(8, 10)}/${d.date.slice(5, 7)})`,
              )

              .join(", ");

            throw new HttpError(
              422,

              `Thực đơn từ ${weekSchedule.weekStartDate} đến ${weekSchedule.weekEndDate} chưa đầy đủ các ngày trong tuần (T2 - T6). Còn thiếu: ${missingNames}. Vui lòng tạo đủ 5 ngày trước khi gửi Ban Giám Hiệu duyệt.`,
            );
          }

          await repository.submitDraftDays(tx, id);

          await repository.submitWeeklyMenu(tx, id, new Date());

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

          const record = await repository.insertReview(tx, id, input, actor.id);

          await repository.setDayApproval(
            tx,
            days.map((day) => day.id),
            status,
          );

          const states = await repository.dayApprovalStates(tx, id);

          const weeklyStatus = states.every(
            (d) => d.approvalStatus === "APPROVED",
          )
            ? "APPROVED"
            : states.some((d) => d.approvalStatus === "REVISION_REQUIRED")
              ? "REVISION_REQUIRED"
              : "PENDING_APPROVAL";

          await repository.setWeeklyApproval(
            tx,
            id,
            weeklyStatus,
            record.reviewedAt,
          );

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

    async getContext(principal: AuthPrincipal) {
      schoolScope(principal);
      return readSchoolContext(await connect(), principal, "menu.view");
    },

    async getAcademicCalendar(
      _query: MenuAcademicCalendarQuery,
      principal: AuthPrincipal,
    ): Promise<MenuAcademicCalendarDTO> {
      const schoolId = schoolScope(principal);
      const rows = await repository.academicYears(await connect(), schoolId);
      const today = schoolToday();
      return { academicYears: rows.map((row) => mapAcademicYear(row, today)) };
    },

    async getWeekSchedule(
      inputDate: string | Date,
      principal: AuthPrincipal,
    ): Promise<MenuWeekScheduleDTO> {
      const schoolId = schoolScope(principal);
      const scope = listScopes.menu(principal);

      const db = await connect();

      const date =
        typeof inputDate === "string"
          ? new Date(
              inputDate.includes("T")
                ? inputDate
                : inputDate + "T00:00:00.000Z",
            )
          : inputDate;

      const weekInfo = getSchoolWeekSchedule(date);

      const academicYears = await repository.academicYears(db, schoolId);
      const academicYear = academicYears.find(
        (year) =>
          getSchoolMonday(year.startDate) <= date &&
          date.getTime() <
            getSchoolMonday(year.endDate).getTime() + 7 * 86400000,
      );
      const weekNumber = academicYear
        ? Math.floor(
            (getSchoolMonday(date).getTime() -
              getSchoolMonday(academicYear.startDate).getTime()) /
              (7 * 86400000),
          ) + 1
        : null;

      const weeklyMenu = await repository.weekScheduleMenu(
        db,
        scope,
        new Date(weekInfo.weekStartDate + "T00:00:00.000Z"),
      );

      const existingDays = weeklyMenu?.menuDays ?? [];

      const days = weekInfo.schoolDays.map((sd) => {
        const found = existingDays.find(
          (ed) => ed.menuDate.toISOString().slice(0, 10) === sd.date,
        );

        return {
          ...sd,

          hasMenu: !!found,

          menuDayId: found?.id ?? null,

          status: found?.approvalStatus ?? "MISSING",

          dishCount: found?.menuDayDishes?.length ?? 0,
        };
      });

      const completedDays = days.filter((d) => d.hasMenu).length;

      const missingDays = days.filter((d) => !d.hasMenu).map((d) => d.date);

      const targetDayNum = date.getUTCDay();

      return {
        targetDate: date.toISOString().slice(0, 10),

        targetDayOfWeek: targetDayNum === 0 ? 7 : targetDayNum,

        targetDayLabel: SCHOOL_DAY_LABELS[targetDayNum],

        isTargetSchoolDay: targetDayNum >= 1 && targetDayNum <= 5,

        weekNumber,

        weekLabel: weekNumber === null ? null : `Tuần ${weekNumber}`,

        academicYear: academicYear?.academicYear ?? null,

        weekStartDate: weekInfo.weekStartDate,

        weekEndDate: weekInfo.weekEndDate,

        weeklyMenuId: weeklyMenu?.id ?? null,

        weeklyMenuStatus: weeklyMenu?.status ?? null,

        weeklyMenuTitle: weeklyMenu?.title ?? null,

        days,

        totalSchoolDays: 5,

        completedDays,

        missingDays,

        isWeekComplete: completedDays === 5,
      };
    },

    async getReviews(
      id: string,
      principal: AuthPrincipal,
      query: MenuListQuery,
    ) {
      const scope = listScopes.menu(principal),
        db = await connect();

      if (!(await repository.menuExists(db, id, scope)))
        throw new HttpError(404, "Không tìm thấy thực đơn");

      const page = await readListPage(
        () => repository.reviews(db, id, query),

        query,
      );

      return {
        ...page,

        items: page.items.map(({ User, ...r }) => ({ ...r, reviewer: User })),
      };
    },
  };
}

function mapMenuSummary(row: MenuSummaryRow): MenuSummaryDTO {
  return {
    id: row.id,
    schoolId: row.schoolId,
    weekStartDate: row.weekStartDate.toISOString().slice(0, 10),
    title: row.title,
    status: row.status,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createMenuService(
  read?: MenuListReader,
  connect: () => Promise<PrismaClient> = getPrisma,
) {
  const summaryRepository = createMenuSummaryRepository(read);
  return {
    ...createIngredientOperations(connect),

    ...createMenuOperations(connect),

    async getAll(
      query: MenuListQuery,
      principal: AuthPrincipal,
    ): Promise<MenuSummaryPageResponseDTO> {
      const scope = listScopes["menu"](principal);
      const page = await readListPage(
        () => summaryRepository.list(query, scope),
        query,
      );
      return {
        items: page.items.map(mapMenuSummary),
        pagination: page.pagination,
      };
    },
  };
}

export const menuService = createMenuService();

export type MenuService = ReturnType<typeof createMenuService>;
