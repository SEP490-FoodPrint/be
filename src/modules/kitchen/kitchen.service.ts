import {
  allergyCountsFromGroups,
  expectedSpecialGroupCounts,
} from "../../utils/allergy-match";
import { reserveFpCodes } from "../../utils/fp-code";
import { classScopeForMenuDay } from "../menu/menu.repository";
import { createHash } from "node:crypto";
import {
  Prisma,
  type PrismaClient,
  type CookingMode,
  type MealType,
} from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import {
  assertPermission,
  withSchoolTransaction,
} from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import {
  blockchainProofService,
  type ProofRef,
} from "../blockchain-proof/blockchain-proof.service";
import { HttpError } from "../../utils/http-error";
import { listScopes } from "../../utils/resource-access";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";
import type {
  KitchenFilters,
  KitchenInspection,
  KitchenPlanInput,
} from "./kitchen.request.dto";
import type {
  CookingBatchDetailDTO,
  CookingBatchGroupResponseDTO,
  CookingBatchPlanResponseDTO,
  CookingBatchPreviewDTO,
  CookingBatchListResponseDTO,
  CookingBatchStatsResponseDTO,
  KitchenDayProgressMealDTO,
  KitchenDayProgressResponseDTO,
  KitchenProgressStatus,
  SchoolContextResponseDTO,
} from "./kitchen.response.dto";
import {
  kitchenRepository as repository,
  readFromDatabase,
  type KitchenListReader,
  type KitchenDayProgressRow,
  type KitchenDetailRow,
  kitchenDetailSelect as detailSelect,
  kitchenSummarySelect as select,
} from "./kitchen.repository";
import { recordPhotoUrl } from "../../utils/record-photo";
import { grossFromNet, netFromGross } from "../../utils/waste-rate";
import { gradeDishLines } from "../../utils/dish-portion";
import { convertQuantity } from "../../utils/quantity-conversion";
import { addPortion, portionsOrNull } from "../../utils/portions";

const Decimal = Prisma.Decimal;
export interface RecipeLine {
  ingredientEntryId: string;
  ingredientName?: string;
  quantityPerPortion: string;
  unit: string;
}
export interface PlanningLot {
  incoming?: boolean;
  lotCode?: string;
  ingredientName?: string;
  id: string;
  ingredientEntryId: string;
  availableQuantity: string;
  reservedQuantity: string;
  unit: string;
  /** Cơ sở nguồn của lô; nấu riêng gộp các lô cùng nguyên liệu + cùng cơ sở nguồn vào một mẻ. */
  sourceFacilityId?: string | null;
}
export interface BatchPlan {
  plannedPortions: number;
  lots: { ingredientLotId: string; quantityUsed: string; unit: string }[];
}

export function planMealDishes(
  recipes: readonly {
    dishId: string;
    portions: number;
    recipe: RecipeLine[];
  }[],
  mode: CookingMode,
  stock: PlanningLot[],
) {
  const byId = new Map(stock.map((lot) => [lot.id, lot]));
  const dishPlans = recipes.map(({ dishId, portions, recipe }) => {
    const plans = planCookingBatches(portions, mode, recipe, stock);
    for (const plan of plans) {
      for (const allocation of plan.lots) {
        const lot = byId.get(allocation.ingredientLotId)!;
        lot.reservedQuantity = new Decimal(lot.reservedQuantity)
          .add(
            convertQuantity(
              new Decimal(allocation.quantityUsed),
              allocation.unit,
              lot.unit,
            ),
          )
          .toString();
      }
    }
    return { dishId, plans };
  });
  return groupDishPlans(dishPlans, mode);
}

function positive(value: string): Prisma.Decimal {
  let decimal: Prisma.Decimal;
  try {
    decimal = new Decimal(value);
  } catch {
    throw new HttpError(409, "Định lượng nguyên liệu không hợp lệ");
  }
  if (!decimal.isFinite() || !decimal.gt(0))
    throw new HttpError(409, "Định lượng nguyên liệu phải lớn hơn 0");
  return decimal;
}

// Giữ export cũ để các module/test đang import từ kitchen.service không đổi.
export { convertQuantity };

function storedQuantity(quantity: Prisma.Decimal): string {
  if (
    !quantity.gt(0) ||
    quantity.decimalPlaces() > 3 ||
    quantity.gte("100000000000")
  )
    throw new HttpError(409, "Lượng phân bổ vượt độ chính xác numeric(14,3)");
  return quantity.toFixed(3);
}

/** Input lot order is deterministic; never round a shortage into a valid plan. */
export function planCookingBatches(
  portions: number,
  mode: CookingMode,
  recipe: readonly RecipeLine[],
  stock: readonly PlanningLot[],
): BatchPlan[] {
  if (!Number.isSafeInteger(portions) || portions <= 0 || portions > 2147483647)
    throw new HttpError(409, "Nhu cầu suất ăn không hợp lệ");
  if (
    !recipe.length ||
    new Set(recipe.map((row) => row.ingredientEntryId)).size !== recipe.length
  )
    throw new HttpError(409, "Recipe trống hoặc trùng nguyên liệu");
  if (new Set(stock.map((row) => row.id)).size !== stock.length)
    throw new HttpError(409, "Lô nguyên liệu bị trùng");
  const ingredients = recipe.map((row) => ({
    ...row,
    perPortion: positive(row.quantityPerPortion),
  }));
  const lots = stock.map((lot) => {
    const available = new Decimal(lot.availableQuantity);
    const reserved = new Decimal(lot.reservedQuantity);
    if (
      !available.isFinite() ||
      !reserved.isFinite() ||
      available.lt(0) ||
      reserved.lt(0) ||
      reserved.gt(available)
    )
      throw new HttpError(
        409,
        "Tồn kho hoặc lượng giữ cho mẻ khác không nhất quán",
      );
    return { ...lot, free: available.sub(reserved) };
  });
  const take = (lot: (typeof lots)[number], exact: Prisma.Decimal) => {
    if (exact.gt(lot.free))
      throw new HttpError(409, "Không đủ nguyên liệu khả dụng");
    // Lượng sống sau quy đổi hao hụt có thể lẻ hơn numeric(14,3): làm tròn lên để không thiếu hàng.
    // Tồn kho lưu 3 chữ số thập phân nên phần làm tròn lên không vượt lượng còn trống.
    const amount = Decimal.min(
      exact.toDecimalPlaces(3, Decimal.ROUND_UP),
      lot.free,
    );
    const quantityUsed = storedQuantity(amount);
    lot.free = lot.free.sub(amount);
    return { ingredientLotId: lot.id, quantityUsed, unit: lot.unit };
  };

  if (mode === "COMBINE_LOTS") {
    const plan: BatchPlan = { plannedPortions: portions, lots: [] };
    for (const ingredient of ingredients) {
      let needed = ingredient.perPortion.mul(portions);
      for (const lot of lots.filter(
        (row) =>
          row.ingredientEntryId === ingredient.ingredientEntryId &&
          row.free.gt(0),
      )) {
        if (needed.isZero()) break;
        const free = convertQuantity(lot.free, lot.unit, ingredient.unit);
        const allocated = Decimal.min(free, needed);
        plan.lots.push(
          take(lot, convertQuantity(allocated, ingredient.unit, lot.unit)),
        );
        needed = needed.sub(allocated);
      }
      if (!needed.isZero())
        throw new HttpError(
          409,
          `Không đủ nguyên liệu khả dụng cho nhu cầu đã chốt${ingredient.ingredientName ? `: ${ingredient.ingredientName} thiếu ${needed.toString()} ${ingredient.unit}` : ""}`,
        );
    }
    return [plan];
  }
  if (mode !== "SEPARATE_BY_LOT")
    throw new HttpError(409, "Chưa cấu hình chế độ chế biến hợp lệ");
  // Nấu riêng theo nguồn: các lô cùng nguyên liệu và cùng cơ sở nguồn (vd. hai đợt giao của
  // cùng một nông trại) gộp chung một mẻ; lô không rõ cơ sở nguồn vẫn tách riêng từng lô.
  const sourceGroup = (
    lot: (typeof lots)[number],
    ingredientEntryId: string,
  ) =>
    lot.sourceFacilityId
      ? lots.filter(
          (row) =>
            row.ingredientEntryId === ingredientEntryId &&
            row.sourceFacilityId === lot.sourceFacilityId &&
            row.free.gt(0),
        )
      : [lot];
  const plans: BatchPlan[] = [];
  let remaining = portions;
  while (remaining > 0) {
    const selected = ingredients.map((ingredient) => {
      for (const lot of lots.filter(
        (row) =>
          row.ingredientEntryId === ingredient.ingredientEntryId &&
          row.free.gt(0),
      )) {
        const group = sourceGroup(lot, ingredient.ingredientEntryId);
        const free = group.reduce(
          (sum, row) =>
            sum.add(convertQuantity(row.free, row.unit, ingredient.unit)),
          new Decimal(0),
        );
        if (free.gte(ingredient.perPortion)) return { ingredient, group, free };
      }
      throw new HttpError(
        409,
        `Không đủ nguyên liệu để nấu riêng từng lô theo số suất nguyên${ingredient.ingredientName ? `: ${ingredient.ingredientName}` : ""}`,
      );
    });
    const count = Math.min(
      remaining,
      ...selected.map(({ ingredient, free }) =>
        free.div(ingredient.perPortion).floor().toNumber(),
      ),
    );
    plans.push({
      plannedPortions: count,
      lots: selected.flatMap(({ ingredient, group }) => {
        let needed = ingredient.perPortion.mul(count);
        const taken: BatchPlan["lots"] = [];
        for (const lot of group) {
          if (needed.isZero()) break;
          const allocated = Decimal.min(
            convertQuantity(lot.free, lot.unit, ingredient.unit),
            needed,
          );
          if (allocated.isZero()) continue;
          taken.push(
            take(lot, convertQuantity(allocated, ingredient.unit, lot.unit)),
          );
          needed = needed.sub(allocated);
        }
        return taken;
      }),
    });
    remaining -= count;
  }
  return plans;
}

export interface DishPlans {
  dishId: string;
  plans: BatchPlan[];
}
/** Each child is one dish and one of that dish's lot allocation plans. */
export function groupDishPlans(input: DishPlans[], mode: CookingMode) {
  if (
    !input.length ||
    new Set(input.map((dish) => dish.dishId)).size !== input.length
  )
    throw new HttpError(
      409,
      "Danh s\u00e1ch m\u00f3n l\u1eadp m\u1ebb tr\u1ed1ng ho\u1eb7c b\u1ecb tr\u00f9ng",
    );
  if (mode !== "COMBINE_LOTS" && mode !== "SEPARATE_BY_LOT")
    throw new HttpError(
      409,
      "Ch\u1ebf \u0111\u1ed9 ch\u1ebf bi\u1ebfn kh\u00f4ng h\u1ee3p l\u1ec7",
    );
  return input.flatMap((dish) => {
    if (
      !dish.plans.length ||
      (mode === "COMBINE_LOTS" && dish.plans.length !== 1)
    )
      throw new HttpError(
        409,
        "Ph\u01b0\u01a1ng \u00e1n m\u00f3n kh\u00f4ng h\u1ee3p l\u1ec7",
      );
    return dish.plans.map((plan) => {
      if (
        !Number.isSafeInteger(plan.plannedPortions) ||
        plan.plannedPortions <= 0
      )
        throw new HttpError(
          409,
          "S\u1ed1 su\u1ea5t m\u1ebb kh\u00f4ng h\u1ee3p l\u1ec7",
        );
      return {
        plannedPortions: plan.plannedPortions,
        dishes: [{ dishId: dish.dishId, ...plan }],
      };
    });
  });
}

export type StockTx = Prisma.TransactionClient;

export async function lockIngredientLots(tx: StockTx, ids: readonly string[]) {
  for (const id of [...new Set(ids)].sort())
    await tx.$queryRawUnsafe(
      "SELECT id FROM foodprint.ingredient_lots WHERE id = $1::uuid FOR UPDATE",
      id,
    );
}

/** Both dish allocations and shared meal seasonings reserve the SAME stock. */
export async function reservedQuantities(
  tx: StockTx,
  lots: readonly { id: string; unit: string }[],
) {
  const totals = new Map(lots.map((lot) => [lot.id, new Prisma.Decimal(0)]));
  if (!lots.length) return totals;
  const where = { ingredientLotId: { in: lots.map((lot) => lot.id) } };
  const select = {
    ingredientLotId: true,
    quantityUsed: true,
    sampleQuantity: true,
    unit: true,
  } as const;
  const rows = [
    ...(await tx.cookingBatchLot.findMany({
      where: {
        ...where,
        CookingBatch: {
          status: {
            in: [
              "UNCONFIRMED",
              "CONFIRMED",
              "PENDING_APPROVAL",
              "ROUND1_APPROVED",
              "ROUND2_APPROVED",
            ],
          },
        },
      },
      select,
    })),
    ...(await tx.menuMealSeasoningLot.findMany({
      where: { ...where, usedAt: null },
      select,
    })),
    // Phần dư Đợt 1 giữ cho Đợt 2 của cùng món/bữa (TASK-10 v8, V35).
    ...(tx.supplyRoundLeftover?.findMany
      ? (
          await tx.supplyRoundLeftover.findMany({
            where: { ...where, releasedAt: null },
            select: { ingredientLotId: true, quantity: true, unit: true },
          })
        ).map((row) => ({
          ingredientLotId: row.ingredientLotId,
          quantityUsed: row.quantity,
          sampleQuantity: new Prisma.Decimal(0),
          unit: row.unit,
        }))
      : []),
  ];
  const byId = new Map(lots.map((lot) => [lot.id, lot]));
  for (const row of rows) {
    const lot = byId.get(row.ingredientLotId);
    const quantity = row.quantityUsed.add(row.sampleQuantity ?? 0);
    if (!lot || !quantity.gt(0))
      throw new HttpError(409, "Lượng nguyên liệu đã giữ không hợp lệ");
    totals.set(
      lot.id,
      totals.get(lot.id)!.add(convertQuantity(quantity, row.unit, lot.unit)),
    );
  }
  return totals;
}

export async function readPlanningStock(
  tx: StockTx,
  schoolId: string,
  menuDate: Date,
  entryIds: readonly string[],
  lock = false,
  round?: { batchNo: number },
): Promise<PlanningLot[]> {
  if (!entryIds.length) return [];
  const where: Prisma.IngredientLotWhereInput = {
    OR: [{ expiryDate: null }, { expiryDate: { gte: menuDate } }],
    ...(round
      ? ({
          AND: [
            {
              OR: [
                {
                  status: "AVAILABLE",
                  availableQuantity: { gt: 0 },
                  DeliveryItem: { Delivery: { status: "RECEIVED" } },
                },
                {
                  status: "BLOCKED",
                  receivedQuantity: { gt: 0 },
                  DeliveryItem: {
                    Delivery: {
                      status: { notIn: ["RECEIVED", "REJECTED", "CANCELLED"] },
                      preparationStage: { not: null },
                      SupplyRequest: {
                        orderType: "DIRECT_USE",
                        requestedDeliveryDate: menuDate,
                        batchNo: round.batchNo,
                      },
                    },
                  },
                },
              ],
            },
          ],
        } satisfies Prisma.IngredientLotWhereInput)
      : ({
          status: "AVAILABLE",
          availableQuantity: { gt: 0 },
        } satisfies Prisma.IngredientLotWhereInput)),
    DeliveryItem: {
      Delivery: round ? { schoolId } : { status: "RECEIVED", schoolId },
      OR: [
        { ingredientEntryId: { in: [...entryIds] } },
        { SupplyRequestItem: { ingredientEntryId: { in: [...entryIds] } } },
      ],
    },
  };
  if (lock) {
    const candidates = await tx.ingredientLot.findMany({
      where,
      select: { id: true },
    });
    await lockIngredientLots(
      tx,
      candidates.map((lot) => lot.id),
    );
  }
  const lots = await tx.ingredientLot.findMany({
    where,
    select: {
      id: true,
      unit: true,
      availableQuantity: true,
      receivedQuantity: true,
      status: true,
      lotCode: true,
      sourceFacilityId: true,
      DeliveryItem: {
        select: {
          ingredientEntryId: true,
          sourceFacilityId: true,
          Ingredient: { select: { name: true } },
          IngredientEntry: {
            select: { Ingredient: { select: { name: true } } },
          },
          SupplyRequestItem: {
            select: {
              ingredientEntryId: true,
              IngredientEntry: {
                select: { Ingredient: { select: { name: true } } },
              },
            },
          },
        },
      },
    },
    orderBy: [
      { expiryDate: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
      { id: "asc" },
    ],
  });
  const reserved = await reservedQuantities(tx, lots);
  return lots.map((lot) => {
    const ingredientEntryId =
      lot.DeliveryItem.ingredientEntryId ??
      lot.DeliveryItem.SupplyRequestItem?.ingredientEntryId ??
      null;
    if (!ingredientEntryId) {
      throw new HttpError(
        409,
        "Lô nguyên liệu thiếu liên kết danh mục của trường",
      );
    }
    return {
      id: lot.id,
      lotCode: lot.lotCode,
      ingredientName:
        lot.DeliveryItem.Ingredient?.name ??
        lot.DeliveryItem.IngredientEntry?.Ingredient?.name ??
        lot.DeliveryItem.SupplyRequestItem?.IngredientEntry?.Ingredient?.name ??
        "",
      unit: lot.unit,
      ingredientEntryId,
      ...(round ? { incoming: lot.status === "BLOCKED" } : {}),
      availableQuantity: (round && lot.status === "BLOCKED"
        ? lot.receivedQuantity
        : lot.availableQuantity
      ).toString(),
      reservedQuantity: reserved.get(lot.id)!.toString(),
      sourceFacilityId:
        lot.sourceFacilityId ?? lot.DeliveryItem.sourceFacilityId ?? null,
    };
  });
}

type Meal = { menuDayId: string; mealType: MealType };
function mealKey(meal: Meal) {
  return { menuDayId: meal.menuDayId, mealType: meal.mealType };
}

/** Manually selected menus for disjoint portion groups; never infer substitute dishes. */
export async function assertPortionGroupSafety(
  tx: StockTx,
  meal: Meal,
  schoolId: string,
) {
  const groups = await tx.menuMealPortionGroup.findMany({
    where: mealKey(meal),
    include: {
      dishes: {
        include: {
          menuDayDish: {
            include: {
              ingredients: true,
              Dish: { select: { schoolId: true } },
            },
          },
        },
      },
      avoidances: {
        include: {
          ingredientEntry: {
            select: {
              schoolId: true,
              ingredientId: true,
              Ingredient: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: { id: "asc" },
  });
  if (!groups.length) return groups;
  const dishes = await tx.menuDayDish.findMany({
    where: mealKey(meal),
    select: { dishId: true },
  });
  if (
    groups.filter((g) => g.isDefault).length !== 1 ||
    groups.some(
      (g) =>
        !g.dishes.length ||
        (g.isDefault ? g.avoidances.length > 0 : g.avoidances.length === 0),
    ) ||
    dishes.some(
      (d) => !groups.some((g) => g.dishes.some((i) => i.dishId === d.dishId)),
    )
  )
    throw new HttpError(
      422,
      "Nhóm suất cần một nhóm thường, các món đã chọn và nguyên liệu cần tránh cho từng nhóm riêng",
    );
  const spices = await tx.menuMealSeasoning.findMany({
    where: mealKey(meal),
    select: {
      ingredientEntry: { select: { ingredientId: true, schoolId: true } },
    },
  });
  for (const group of groups) {
    if (
      group.avoidances.some((a) => a.ingredientEntry.schoolId !== schoolId) ||
      group.dishes.some((d) => d.menuDayDish.Dish.schoolId !== schoolId)
    )
      throw new HttpError(422, "Nhóm suất có tài nguyên ngoài trường");
    const avoided = new Set(
      group.avoidances.map((a) => a.ingredientEntry.ingredientId),
    );
    if (
      group.dishes.some((d) =>
        d.menuDayDish.ingredients.some((i) => avoided.has(i.ingredientId)),
      ) ||
      spices.some((s) => avoided.has(s.ingredientEntry.ingredientId))
    )
      throw new HttpError(
        422,
        "Món hoặc gia vị chung chứa nguyên liệu cần tránh của nhóm suất; y tế cần điều chỉnh thực đơn",
      );
  }
  return groups;
}

/** Dish demand is summed over teacher-confirmed groups; shared dishes count each group once. */
export async function readMealPortionDemand(
  tx: StockTx,
  meal: Meal,
  schoolId: string,
  menuDate: Date,
) {
  const groups = await assertPortionGroupSafety(tx, meal, schoolId);
  const daily = await tx.dailyMealPortion.findMany({
    where: {
      mealDate: menuDate,
      mealType: meal.mealType,
      status: "FINALIZED",
      Class: classScopeForMenuDay(schoolId, meal.menuDayId),
    },
    include: {
      portionGroups: true,
      dailyAllergyPortions: {
        include: {
          IngredientEntry: {
            select: { Ingredient: { select: { name: true } } },
          },
        },
      },
    },
  });
  const totalPortions = daily.reduce((n, d) => n + d.totalPortions, 0);
  if (!Number.isSafeInteger(totalPortions) || totalPortions > 2147483647)
    throw new HttpError(409, "Tổng suất ăn vượt giới hạn");
  const dishes = await tx.menuDayDish.findMany({
    where: mealKey(meal),
    select: { dishId: true },
  });
  const dishPortions = new Map(
    dishes.map((d) => [d.dishId, groups.length ? 0 : totalPortions]),
  );
  const groupTotals = new Map(groups.map((g) => [g.id, 0]));
  for (const demand of daily) {
    if (!groups.length) {
      if (demand.portionGroups.length)
        throw new HttpError(
          409,
          "Nhu cầu đã chốt theo nhóm khác; cần đối chiếu thực đơn",
        );
      continue;
    }
    if (
      demand.portionGroups.length !== groups.length ||
      groups.some(
        (g) => !demand.portionGroups.some((p) => p.portionGroupId === g.id),
      ) ||
      demand.portionGroups.reduce((n, p) => n + p.portionCount, 0) !==
        demand.totalPortions
    )
      throw new HttpError(
        409,
        "GVCN chưa chốt đủ nhóm suất không trùng cho từng lớp trong bữa ăn",
      );
    const countOf = (groupId: string) =>
      demand.portionGroups.find((p) => p.portionGroupId === groupId)!
        .portionCount;
    for (const group of groups) {
      const count = countOf(group.id);
      groupTotals.set(group.id, groupTotals.get(group.id)! + count);
      for (const dish of group.dishes)
        dishPortions.set(dish.dishId, dishPortions.get(dish.dishId)! + count);
    }
    // Nhóm suất riêng quy về dị ứng khai báo của lớp theo mã hoặc tên (vd. tránh "Tôm nõn tươi" = dị ứng "Tôm nõn").
    const declared = demand.dailyAllergyPortions.map((a) => ({
      groupNo: a.groupNo,
      ingredientEntryId: a.ingredientEntryId,
      allergenName: a.IngredientEntry.Ingredient.name,
      portionCount: a.portionCount,
    }));
    const { uncovered } = allergyCountsFromGroups(groups, countOf, declared);
    // Mỗi nhóm riêng phải bằng tổng suất của các nhóm dị ứng khai vào nhóm đó (mỗi nhóm dị ứng tính một lần).
    const expected = expectedSpecialGroupCounts(groups, declared);
    if (
      !uncovered &&
      [...expected].some(([groupId, count]) => countOf(groupId) !== count)
    )
      throw new HttpError(
        409,
        "Nhóm suất không khớp số suất dị ứng đã chốt của lớp",
      );
    if (uncovered)
      throw new HttpError(
        409,
        "Thiếu xác nhận suất dị ứng tương ứng với nhóm suất",
      );
  }
  return { totalPortions, dishPortions, groups, groupTotals, daily };
}

/**
 * Legacy batches keep their recorded plan; new standards may not drift from finalized demand.
 * Lô chạy song song: khi `batchId` được truyền (xác nhận / nấu xong một lô), chỉ đối chiếu các món
 * của chính lô đó; món khác của bữa chưa lập lô không chặn. Với mỗi món được đối chiếu, tổng suất
 * của mọi lô của món đó phải bằng số suất các lớp đã chốt.
 */
export async function assertMealPortions(
  tx: StockTx,
  meal: Meal,
  schoolId: string,
  batchId?: string,
  allowSurplus = false,
) {
  if (!(await tx.menuDayDishIngredient.count({ where: mealKey(meal) }))) return;
  const day = await tx.menuDay.findUniqueOrThrow({
    where: { id: meal.menuDayId },
    select: { menuDate: true },
  });
  const demand = await readMealPortionDemand(tx, meal, schoolId, day.menuDate);
  const portions = demand.totalPortions;
  const batches = await repository.findMealDishPlans(tx, mealKey(meal));
  const scopeDishIds = batchId
    ? (
        await tx.cookingBatchDish.findMany({
          where: { cookingBatchId: batchId },
          select: { dishId: true },
        })
      ).map((row) => row.dishId)
    : [
        ...new Set([
          ...batches.map((batch) => batch.dishId),
          ...demand.dishPortions.keys(),
        ]),
      ];
  const scoped = batches.filter((batch) => scopeDishIds.includes(batch.dishId));
  if (
    (!allowSurplus && portions <= 0) ||
    scoped.some((batch) => !batch.plannedPortions)
  )
    throw new HttpError(
      409,
      "Số suất đã thay đổi sau khi lập mẻ; cần đối chiếu, không tự đổi kế hoạch",
    );
  for (const dishId of scopeDishIds) {
    const planned = scoped
      .filter((batch) => batch.dishId === dishId)
      .reduce((sum, batch) => addPortion(sum, batch.plannedPortions), 0);
    const finalized = demand.dishPortions.get(dishId) ?? 0;
    if (allowSurplus ? planned < finalized : planned !== finalized) {
      const dish = await tx.dish.findUnique({
        where: { id: dishId },
        select: { name: true },
      });
      throw new HttpError(
        409,
        `Số suất món "${dish?.name ?? "món ăn"}" trong lô (${planned}) khác số suất các lớp đã chốt (${finalized}); cần đối chiếu, không tự đổi kế hoạch`,
      );
    }
  }
}

export async function reserveMealSeasonings(
  tx: StockTx,
  meal: Meal,
  schoolId: string,
  menuDate: Date,
  portions: number,
  mode: CookingMode,
  options: {
    preview?: boolean;
    additional?: readonly PlanningLot[];
    extend?: boolean;
  } = {},
) {
  const { preview = false, additional = [], extend = false } = options;
  const standards = await tx.menuMealSeasoning.findMany({
    where: mealKey(meal),
    include: { ingredientEntry: true },
    orderBy: { ingredientEntryId: "asc" },
  });
  const existing = await tx.menuMealSeasoningLot.findMany({
    where: mealKey(meal),
  });
  if (!standards.length) {
    if (existing.length)
      throw new HttpError(409, "Thiếu định mức gia vị đã được phân bổ");
    return;
  }
  if (
    standards.some(
      (s) =>
        s.ingredientEntry.schoolId !== schoolId ||
        s.ingredientEntry.handlingType !== "DRY_STOCK",
    )
  )
    throw new HttpError(409, "Gia vị không thuộc đồ lưu kho của trường");
  const entryIds = standards.map((s) => s.ingredientEntryId);
  if (
    await tx.dailyAllergyPortion.findFirst({
      where: {
        DailyMealPortion: {
          mealDate: menuDate,
          mealType: meal.mealType,
          status: "FINALIZED",
          Class: classScopeForMenuDay(schoolId, meal.menuDayId),
        },
        ingredientEntryId: { in: entryIds },
        portionCount: { gt: 0 },
      },
      select: { dailyMealPortionId: true },
    })
  )
    throw new HttpError(
      409,
      "Gia vị có liên quan dị ứng; cần phương án thực đơn phù hợp trước",
    );
  const previousPortions = existing[0]?.plannedPortions ?? 0;
  if (existing.length) {
    if (
      (previousPortions !== portions &&
        !(extend && portions > previousPortions)) ||
      existing.some(
        (row) =>
          row.plannedPortions !== previousPortions || row.usedAt !== null,
      )
    )
      throw new HttpError(
        409,
        "Số suất hoặc tiêu hao gia vị của bữa đã chốt; không tự thay đổi",
      );
    for (const standard of standards) {
      const allocated = existing.filter(
        (row) => row.ingredientEntryId === standard.ingredientEntryId,
      );
      const sum = allocated.reduce(
        (total, row) =>
          total.add(convertQuantity(row.quantityUsed, row.unit, standard.unit)),
        new Prisma.Decimal(0),
      );
      if (!sum.eq(standard.quantityPerPortion.mul(previousPortions)))
        throw new HttpError(
          409,
          "Phân bổ gia vị khác định mức đã chốt; cần đối chiếu",
        );
    }
    if (
      existing.some(
        (row) =>
          !standards.some((s) => s.ingredientEntryId === row.ingredientEntryId),
      )
    )
      throw new HttpError(409, "Phân bổ gia vị không khớp thực đơn");
    await checkMealSeasoningStock(tx, meal, schoolId);
    if (previousPortions === portions) return;
  }
  const additionalPortions = portions - previousPortions;
  let stock = await readPlanningStock(
    tx,
    schoolId,
    menuDate,
    entryIds,
    !preview,
  );
  if (preview)
    stock = stock.map((lot) => {
      const simulated = additional.find((row) => row.id === lot.id);
      return simulated
        ? { ...lot, reservedQuantity: simulated.reservedQuantity }
        : lot;
    });
  // A shared meal pool cannot assign split spice lots to individual dishes.
  // Preserve SEPARATE_BY_LOT by choosing one sufficient lot per seasoning.
  if (mode === "SEPARATE_BY_LOT") {
    const existingLotIds = new Set(
      existing.map(({ ingredientLotId }) => ingredientLotId),
    );
    stock = stock.filter((lot) => {
      if (existingLotIds.size && !existingLotIds.has(lot.id)) return false;
      const s = standards.find(
        (row) => row.ingredientEntryId === lot.ingredientEntryId,
      )!;
      return convertQuantity(
        new Prisma.Decimal(lot.availableQuantity).sub(lot.reservedQuantity),
        lot.unit,
        s.unit,
      ).gte(s.quantityPerPortion.mul(additionalPortions));
    });
    if (
      standards.some(
        (s) =>
          !stock.some((lot) => lot.ingredientEntryId === s.ingredientEntryId),
      )
    )
      throw new HttpError(
        409,
        "Chế độ nấu riêng từng lô yêu cầu mỗi gia vị có một lô đủ lượng cho cả bữa",
      );
  }
  const plans = planCookingBatches(
    additionalPortions,
    mode,
    standards.map((s) => ({
      ingredientEntryId: s.ingredientEntryId,
      quantityPerPortion: s.quantityPerPortion.toString(),
      unit: s.unit,
    })),
    stock,
  );
  if (preview)
    return plans.flatMap((plan) =>
      plan.lots.map((lot) => ({
        ...lot,
        lotCode:
          stock.find((row) => row.id === lot.ingredientLotId)?.lotCode ?? null,
        ingredientName:
          stock.find((row) => row.id === lot.ingredientLotId)?.ingredientName ??
          null,
      })),
    );
  const byLot = new Map(stock.map((lot) => [lot.id, lot]));
  const existingByLot = new Map(
    existing.map((row) => [row.ingredientLotId, row]),
  );
  if (existing.length)
    await tx.menuMealSeasoningLot.updateMany({
      where: mealKey(meal),
      data: { plannedPortions: portions },
    });
  for (const plan of plans) {
    for (const lot of plan.lots) {
      const prior = existingByLot.get(lot.ingredientLotId);
      if (prior) {
        await tx.menuMealSeasoningLot.update({
          where: { id: prior.id },
          data: {
            quantityUsed: {
              increment: convertQuantity(
                new Prisma.Decimal(lot.quantityUsed),
                lot.unit,
                prior.unit,
              ),
            },
          },
        });
      } else {
        await tx.menuMealSeasoningLot.create({
          data: {
            ...mealKey(meal),
            ...lot,
            plannedPortions: portions,
            ingredientEntryId: byLot.get(lot.ingredientLotId)!
              .ingredientEntryId,
          },
        });
      }
    }
  }
}

export async function checkMealSeasoningStock(
  tx: StockTx,
  meal: Meal,
  schoolId: string,
) {
  const allocations = await tx.menuMealSeasoningLot.findMany({
    where: mealKey(meal),
  });
  if (!allocations.length) return [];
  if (allocations.some((a) => a.usedAt !== null))
    throw new HttpError(
      409,
      "Bữa đã ghi nhận tiêu hao gia vị; cần đối chiếu trạng thái mẻ",
    );
  await lockIngredientLots(
    tx,
    allocations.map((a) => a.ingredientLotId),
  );
  const day = await tx.menuDay.findUniqueOrThrow({
    where: { id: meal.menuDayId },
    select: { menuDate: true },
  });
  const lots = await tx.ingredientLot.findMany({
    where: {
      id: { in: allocations.map((a) => a.ingredientLotId) },
      status: "AVAILABLE",
      OR: [{ expiryDate: null }, { expiryDate: { gte: day.menuDate } }],
      DeliveryItem: {
        Delivery: { status: "RECEIVED", schoolId },
      },
    },
    select: { id: true, unit: true, availableQuantity: true },
  });
  if (lots.length !== new Set(allocations.map((a) => a.ingredientLotId)).size)
    throw new HttpError(409, "Lô gia vị không còn hợp lệ trong kho trường");
  const reserved = await reservedQuantities(tx, lots);
  if (lots.some((lot) => lot.availableQuantity.lt(reserved.get(lot.id)!)))
    throw new HttpError(409, "Tồn đồ lưu khong đủ cho gia vị đã giữ");
  return allocations;
}

/** Called AFTER updating the last batch, inside the same serializable transaction. */
export async function consumeMealSeasonings(
  tx: StockTx,
  meal: Meal,
  schoolId: string,
  actorId: string,
  allowSurplus = false,
) {
  const allocations = await tx.menuMealSeasoningLot.findMany({
    where: mealKey(meal),
  });
  if (!allocations.length || allocations.every((a) => a.usedAt !== null))
    return;
  const day = await tx.menuDay.findUniqueOrThrow({
    where: { id: meal.menuDayId },
    select: { menuDate: true },
  });
  const demand = await readMealPortionDemand(tx, meal, schoolId, day.menuDate);
  const portions = demand.totalPortions;
  const dishes = await tx.menuDayDish.findMany({
    where: mealKey(meal),
    select: { dishId: true },
  });
  const batches = await repository.findMealDishPlans(tx, mealKey(meal));
  if (
    !dishes.length ||
    dishes.some((dish) => {
      const rows = batches.filter((batch) => batch.dishId === dish.dishId);
      const planned = rows.reduce(
        (total, batch) => addPortion(total, batch.plannedPortions),
        0,
      );
      const finalized = demand.dishPortions.get(dish.dishId) ?? 0;
      return (
        ((demand.dishPortions.get(dish.dishId) ?? 0) > 0 && !rows.length) ||
        rows.some(
          (batch) =>
            batch.CookingBatch.status !== "COMPLETED" || !batch.plannedPortions,
        ) ||
        (allowSurplus ? planned < finalized : planned !== finalized)
      );
    })
  )
    return;
  await checkMealSeasoningStock(tx, meal, schoolId);
  if (
    allocations.some(
      (a) =>
        (allowSurplus
          ? a.plannedPortions < portions
          : a.plannedPortions !== portions) || a.usedAt !== null,
    ) ||
    (await tx.inventoryTransaction.count({
      where: {
        movementType: "COOKING_USAGE",
        referenceType: "MENU_MEAL_SEASONING",
        referenceId: { in: allocations.map((a) => a.id) },
      },
    }))
  )
    throw new HttpError(
      409,
      "Lịch sử tiêu hao gia vị cần đối chiếu; không ghi đè",
    );
  const now = new Date();
  for (const allocation of allocations) {
    const lot = await tx.ingredientLot.findUniqueOrThrow({
      where: { id: allocation.ingredientLotId },
    });
    const used = convertQuantity(
      allocation.quantityUsed.add(allocation.sampleQuantity ?? 0),
      allocation.unit,
      lot.unit,
    );
    if (!used.gt(0) || used.decimalPlaces() > 3)
      throw new HttpError(409, "Lượng gia vị không hợp lệ");
    const changed = await tx.ingredientLot.updateMany({
      where: {
        id: lot.id,
        status: "AVAILABLE",
        availableQuantity: { gte: used },
      },
      data: {
        availableQuantity: { decrement: used },
        status: lot.availableQuantity.eq(used) ? "DEPLETED" : "AVAILABLE",
      },
    });
    if (changed.count !== 1)
      throw new HttpError(409, "Tồn gia vị đã thay đổi; chưa hoàn thành bữa");
    await tx.inventoryTransaction.create({
      data: {
        ingredientLotId: lot.id,
        movementType: "COOKING_USAGE",
        quantity: used,
        unit: lot.unit,
        referenceType: "MENU_MEAL_SEASONING",
        referenceId: allocation.id,
        createdByUserId: actorId,
      },
    });
    await tx.menuMealSeasoningLot.update({
      where: { id: allocation.id },
      data: { usedAt: now },
    });
  }
}

export async function checkReservedStock(
  tx: Tx,
  batch: Detail,
  schoolId: string,
) {
  if (
    !batch.plannedPortions ||
    !new Decimal(batch.plannedPortions).gt(0) ||
    !batch.cookingBatchLots.length
  )
    throw new HttpError(409, "Mẻ chưa có kế hoạch số suất/nguyên liệu hợp lệ");
  await lockIngredientLots(
    tx,
    batch.cookingBatchLots.map((lot) => lot.ingredientLotId),
  );
  const day = await tx.menuDay.findUniqueOrThrow({
    where: { id: batch.menuDayId },
    select: { menuDate: true },
  });
  const lots = await tx.ingredientLot.findMany({
    where: {
      id: { in: batch.cookingBatchLots.map((lot) => lot.ingredientLotId) },
      OR: [{ expiryDate: null }, { expiryDate: { gte: day.menuDate } }],
      DeliveryItem: {
        Delivery: { status: "RECEIVED", schoolId },
      },
    },
    select: { id: true, unit: true, availableQuantity: true, status: true },
  });
  if (
    lots.length !==
    new Set(batch.cookingBatchLots.map((l) => l.ingredientLotId)).size
  )
    throw new HttpError(
      409,
      "Thiếu lô nguyên liệu hợp lệ trong phạm vi trường",
    );
  const reserved = await reservedQuantities(tx, lots);
  for (const lot of lots) {
    if (
      lot.status !== "AVAILABLE" ||
      lot.availableQuantity.lt(reserved.get(lot.id)!)
    )
      throw new HttpError(
        409,
        "Tồn đồ lưu khong đủ cho các mẻ đang giữ nguyên liệu; cần đối chiếu",
      );
  }
  return new Map(lots.map((lot) => [lot.id, lot]));
}

type Detail = KitchenDetailRow;
type Tx = Prisma.TransactionClient;
type PlanInput = KitchenPlanInput;

function dto(batch: Detail): CookingBatchDetailDTO {
  const lots = batch.cookingBatchLots.map((lot) => ({
    dishId: lot.dishId,
    ingredientLotId: lot.ingredientLotId,
    quantityUsed: lot.quantityUsed.toString(),
    cookedQuantity: netFromGross(
      lot.quantityUsed,
      lot.IngredientLot?.DeliveryItem?.IngredientEntry?.wasteRate ??
        lot.IngredientLot?.DeliveryItem?.SupplyRequestItem?.IngredientEntry
          ?.wasteRate ??
        0,
    )
      .toDecimalPlaces(3)
      .toString(),
    unit: lot.unit,
    lotCode: lot.IngredientLot?.lotCode ?? null,
    ingredientName:
      lot.IngredientLot?.DeliveryItem?.Ingredient?.name ??
      lot.IngredientLot?.DeliveryItem?.IngredientEntry?.Ingredient?.name ??
      lot.IngredientLot?.DeliveryItem?.SupplyRequestItem?.IngredientEntry
        ?.Ingredient?.name ??
      null,
    supplierName:
      lot.IngredientLot?.DeliveryItem?.Ingredient?.Supplier?.name ??
      lot.IngredientLot?.DeliveryItem?.IngredientEntry?.Ingredient?.Supplier
        ?.name ??
      lot.IngredientLot?.DeliveryItem?.SupplyRequestItem?.IngredientEntry
        ?.Ingredient?.Supplier?.name ??
      null,
    expiryDate:
      lot.IngredientLot?.expiryDate?.toISOString().slice(0, 10) ?? null,
  }));
  return {
    id: batch.id,
    batchCode: batch.batchCode,
    batchNumber: batch.batchNumber ?? null,
    batchGroupId: batch.batchGroupId,
    BatchGroup: {
      id: batch.BatchGroup.id,
      batchCode: batch.BatchGroup.batchCode,
      ...(batch.BatchGroup.supplyRoundId
        ? { supplyRoundId: batch.BatchGroup.supplyRoundId }
        : {}),
    },
    menuDayId: batch.menuDayId,
    mealType: batch.mealType,
    dishId: batch.dishId,
    cookingModeApplied: batch.cookingModeApplied,
    status: batch.status,
    plannedPortions: portionsOrNull(batch.plannedPortions),
    note: batch.note,
    confirmedAt: batch.confirmedAt?.toISOString() ?? null,
    completedAt: batch.completedAt?.toISOString() ?? null,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
    Dish: batch.Dish ? { name: batch.Dish.name } : null,
    MenuDay: { menuDate: batch.MenuDay.menuDate.toISOString().slice(0, 10) },
    dishes: batch.dishes.map((d) => ({
      dishId: d.dishId,
      name: d.Dish?.name ?? "",
      plannedPortions: portionsOrNull(d.plannedPortions),
      ...(d.sampleQuantity !== null && d.sampleQuantity !== undefined
        ? {
            sampleQuantity: d.sampleQuantity.toString(),
            sampleUnit: d.sampleUnit ?? null,
            sampleRatio: d.sampleRatio?.toString() ?? null,
            standardQuantitySnapshot:
              d.standardQuantitySnapshot?.toString() ?? null,
          }
        : {}),
      cookingBatchLots: lots.filter((l) => l.dishId === d.dishId),
    })),
    cookingBatchLots: lots,
    retainedFoodSamples:
      batch.RetainedFoodSample?.map((sample) => ({
        id: sample.id,
        dishId: sample.dishId,
        status: sample.status,
        sampledAt: sample.sampledAt.toISOString(),
        disposedAt: sample.disposedAt?.toISOString() ?? null,
        quantity: sample.quantity?.toString() ?? null,
        unit: sample.unit,
        storageLocation: sample.storageLocation,
        photoUrl: recordPhotoUrl(sample.photoPublicId),
      })) ?? [],
  };
}
function groupDtos(batches: Detail[]): CookingBatchGroupResponseDTO[] {
  const ids = [...new Set(batches.map((b) => b.batchGroupId))];
  return ids.map((id): CookingBatchGroupResponseDTO => {
    const children = batches.filter((b) => b.batchGroupId === id);
    const first = children[0];
    return {
      id,
      batchCode: first.BatchGroup.batchCode,
      menuDayId: first.menuDayId,
      mealType: first.mealType,
      status: children.every((b) => b.status === "COMPLETED")
        ? "COMPLETED"
        : children.every((b) => b.status === "UNCONFIRMED")
          ? "UNCONFIRMED"
          : "IN_PROGRESS",
      batches: children.map(dto),
    };
  });
}

export async function readSchoolContext(
  db: PrismaClient,
  principal: AuthPrincipal,
  permission: "menu.view" | "cooking_batch.view",
): Promise<SchoolContextResponseDTO> {
  assertPermission(principal, permission);
  if (principal.orgType !== "SCHOOL" || !principal.schoolId)
    throw new HttpError(403, "Cần phạm vi trường");
  const school = await repository.findSchoolContext(db, principal.schoolId);
  if (!school) throw new HttpError(404, "Không tìm thấy trường hiện hành");
  const dateValid = (value: unknown): value is string =>
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
  return {
    id: school.id,
    name: school.name,
    cookingMode: school.cookingMode,
    grades: (school.grades ?? []).map((grade) => ({
      id: grade.id,
      name: grade.name,
    })),
    lunchTime: school.lunchTime?.toISOString().slice(11, 16) ?? null,
    afternoonMealTime:
      school.afternoonMealTime?.toISOString().slice(11, 16) ?? null,
    academicYears: school.academicYears.map((year) => {
      if (!Array.isArray(year.holidays))
        throw new HttpError(
          409,
          "Lịch nghỉ của trường không hợp lệ; cần Ban Giám hiệu kiểm tra",
        );
      const holidays = year.holidays.map((holiday) => {
        if (
          !holiday ||
          typeof holiday !== "object" ||
          Array.isArray(holiday) ||
          typeof holiday.reason !== "string"
        )
          throw new HttpError(
            409,
            "Lịch nghỉ của trường không hợp lệ; cần Ban Giám hiệu kiểm tra",
          );
        if (dateValid(holiday.date))
          return { date: holiday.date, reason: holiday.reason };
        if (
          dateValid(holiday.startDate) &&
          dateValid(holiday.endDate) &&
          holiday.startDate <= holiday.endDate
        )
          return {
            startDate: holiday.startDate,
            endDate: holiday.endDate,
            reason: holiday.reason,
          };
        throw new HttpError(
          409,
          "Ngày nghỉ của trường không hợp lệ; cần Ban Giám hiệu kiểm tra",
        );
      });
      return {
        id: year.id,
        academicYear: year.academicYear,
        startDate: year.startDate.toISOString().slice(0, 10),
        endDate: year.endDate.toISOString().slice(0, 10),
        holidays,
      };
    }),
  };
}

/**
 * Trạng thái của một món trong ngày: chưa lập lô → đang nấu (còn lô chưa nấu xong) →
 * nấu xong nhưng còn lô chưa lưu mẫu → xong.
 */
function dishProgress(
  batches: {
    CookingBatch: { status: string };
    retainedFoodSamples: unknown[];
  }[],
): KitchenProgressStatus {
  if (!batches.length) return "NOT_STARTED";
  if (batches.some((batch) => batch.CookingBatch.status !== "COMPLETED"))
    return "IN_PROGRESS";
  if (batches.some((batch) => !batch.retainedFoodSamples.length))
    return "COOKED_NO_SAMPLE";
  return "DONE";
}

/** Gom tiến độ chế biến theo thực đơn (khối) và bữa; bữa không có món thì bỏ qua. */
export function summarizeDayProgress(
  rows: KitchenDayProgressRow[],
  date: string,
): KitchenDayProgressResponseDTO {
  return {
    date,
    menus: rows.map((row) => ({
      menuId: row.WeeklyMenu.id,
      menuDayId: row.id,
      isSchoolWide: row.WeeklyMenu.isSchoolWide,
      grades: row.WeeklyMenu.grades.map(({ grade }) => ({
        id: grade.id,
        name: grade.name,
      })),
      meals: (["LUNCH", "AFTERNOON"] as const).flatMap((mealType) => {
        const dishes = row.menuDayDishes.filter(
          (dish) => dish.mealType === mealType,
        );
        if (!dishes.length) return [];
        const statuses = dishes.map((dish) =>
          dishProgress(dish.cookingBatchDishes),
        );
        const count = (status: KitchenProgressStatus) =>
          statuses.filter((item) => item === status).length;
        const meal: KitchenDayProgressMealDTO = {
          mealType,
          status: "DONE",
          dishCount: dishes.length,
          notStarted: count("NOT_STARTED"),
          cooking: count("IN_PROGRESS"),
          cookedNoSample: count("COOKED_NO_SAMPLE"),
          done: count("DONE"),
          pendingDishes: dishes.flatMap((dish, index) =>
            statuses[index] === "DONE"
              ? []
              : [{ name: dish.Dish.name, status: statuses[index] }],
          ),
        };
        meal.status =
          meal.notStarted === meal.dishCount
            ? "NOT_STARTED"
            : meal.notStarted || meal.cooking
              ? "IN_PROGRESS"
              : meal.cookedNoSample
                ? "COOKED_NO_SAMPLE"
                : "DONE";
        return [meal];
      }),
    })),
  };
}

/** All kitchen writes lock the trusted school first, then batch/lots by UUID. */
/** Ngày hôm nay theo giờ Việt Nam (UTC+7), dạng YYYY-MM-DD. */
function vietnamToday() {
  return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
}

export function createKitchenLifecycle(
  connect: () => Promise<PrismaClient> = getPrisma,
  proofs: Pick<
    typeof blockchainProofService,
    "prepareCookingCompleted" | "scheduleAnchor"
  > = blockchainProofService,
  /** Ngày hôm nay (YYYY-MM-DD, giờ VN); tiêm vào để test cố định ngày. */
  today: () => string = vietnamToday,
) {
  async function write<T>(
    principal: AuthPrincipal,
    permission: string,
    operation: (tx: Tx, actor: AuthPrincipal, schoolId: string) => Promise<T>,
  ): Promise<T> {
    return withSchoolTransaction(
      await connect(),
      principal,
      permission,
      operation,
    );
  }

  async function lockedBatch(
    tx: Tx,
    id: string,
    schoolId: string,
  ): Promise<Detail> {
    const where = { id, MenuDay: { WeeklyMenu: { schoolId } } };
    if (!(await tx.cookingBatch.findFirst({ where, select: { id: true } })))
      throw new HttpError(404, "Không tìm thấy mẻ chế biến trong trường");
    await tx.$queryRaw`SELECT id FROM foodprint.cooking_batches WHERE id = ${id}::uuid FOR UPDATE`;
    const batch = await tx.cookingBatch.findFirst({
      where,
      select: detailSelect,
    });
    if (!batch) throw new HttpError(404, "Không tìm thấy mẻ chế biến");
    return batch;
  }

  async function executePlan(
    input: PlanInput,
    principal: AuthPrincipal,
    preview: boolean,
  ): Promise<CookingBatchPlanResponseDTO | CookingBatchPreviewDTO> {
    return write(
      principal,
      "cooking_batch.create",
      async (tx, actor, schoolId) => {
        if (!preview)
          await tx.$queryRaw`SELECT id FROM foodprint.menu_days WHERE id = ${input.menuDayId}::uuid FOR UPDATE`;
        const school = await repository.findSchoolContext(tx, schoolId);
        if (
          !school?.cookingMode ||
          !(input.mealType === "LUNCH"
            ? school.lunchTime
            : school.afternoonMealTime)
        )
          throw new HttpError(
            409,
            "BGH cần cấu hình chế độ nấu và giờ phục vụ trước",
          );
        const meal = mealKey(input);
        const menu = await repository.findPlanMeal(
          tx,
          input.menuDayId,
          input.mealType,
          schoolId,
        );
        if (!menu || !menu.menuDayDishes.length)
          throw new HttpError(
            404,
            "Không tìm thấy bữa ăn trong thực đơn của trường",
          );
        if (
          input.dishId &&
          !menu.menuDayDishes.some((d) => d.dishId === input.dishId)
        )
          throw new HttpError(404, "Món không thuộc bữa ăn trong thực đơn");
        if (
          menu.approvalStatus !== "APPROVED" ||
          menu.menuDayDishes.some(
            (d) => d.Dish.status !== "ACTIVE" || d.Dish.schoolId !== schoolId,
          )
        )
          throw new HttpError(
            409,
            "Chỉ lập mẻ cho thực đơn đã duyệt và món đang hoạt động",
          );
        // Nấu (giữ nguyên liệu, trừ kho khi xong) chỉ cho bữa của hôm nay; xem trước thì không giới hạn.
        if (!preview) {
          const menuDay = menu.menuDate.toISOString().slice(0, 10);
          const current = today();
          const dmy = (iso: string) => iso.split("-").reverse().join("/");
          if (menuDay !== current)
            throw new HttpError(
              422,
              `${menuDay > current ? `Chưa tới ngày ${dmy(menuDay)}` : `Ngày ${dmy(menuDay)} đã qua`}: chỉ được nấu bữa ăn của hôm nay (${dmy(current)})`,
            );
        }
        const missingClasses = await repository.unfinalizedClasses(
          tx,
          meal,
          schoolId,
          menu.menuDate,
        );
        if (missingClasses.length)
          throw new HttpError(
            409,
            `Chưa chốt suất ăn cho các lớp: ${missingClasses.map((row) => row.name).join(", ")}`,
          );
        const demand = await readMealPortionDemand(
          tx,
          meal,
          schoolId,
          menu.menuDate,
        );
        if (demand.totalPortions <= 0)
          throw new HttpError(
            409,
            "Chưa có nhu cầu suất ăn đã chốt cho bữa này",
          );
        const existing = await repository.listMealBatches(tx, meal);
        if (
          existing.some(
            (batch) =>
              batch.BatchGroup?.supplyRoundId && batch.status !== "CANCELLED",
          )
        )
          throw new HttpError(409, "Bữa ăn đã có kế hoạch mẻ theo đợt giao");
        const planned = new Map<string, number>();
        for (const child of existing)
          for (const dish of child.dishes) {
            if (
              !dish.plannedPortions ||
              !new Decimal(dish.plannedPortions).gt(0)
            )
              throw new HttpError(
                409,
                "Mẻ cũ thiếu số suất kế hoạch; cần đối chiếu trước",
              );
            planned.set(
              dish.dishId,
              addPortion(planned.get(dish.dishId) ?? 0, dish.plannedPortions),
            );
          }
        for (const [dishId, portions] of planned)
          if (portions > (demand.dishPortions.get(dishId) ?? 0))
            throw new HttpError(
              409,
              "Kế hoạch cũ vượt nhu cầu; không tự thay đổi lịch sử",
            );
        // A changed school policy applies to a new meal; never mix modes in an already planned meal.
        const mode = existing[0]?.cookingModeApplied ?? school.cookingMode;
        if (existing.some((child) => child.cookingModeApplied !== mode))
          throw new HttpError(
            409,
            "Bữa đã có các chế độ chế biến khác nhau; cần đối chiếu",
          );
        // Gia vị của bữa gộp thành gia vị dùng chung (giữ kho qua reserveMealSeasonings),
        // nên bỏ các gia vị đó khỏi công thức từng món để không giữ kho hai lần.
        const sharedSeasoningIds = new Set(
          (menu.mealSeasonings ?? []).map((row) => row.ingredientEntryId),
        );
        const wasteByEntry = new Map<string, Prisma.Decimal>();
        const recipes = menu.menuDayDishes
          .filter((dish) => !input.dishId || dish.dishId === input.dishId)
          .flatMap((dish) => {
            const portions =
              (demand.dishPortions.get(dish.dishId) ?? 0) -
              (planned.get(dish.dishId) ?? 0);
            if (!portions) return [];
            const fullRecipe = dish.ingredients.map((row) => {
              const entries = row.ingredient.ingredientEntries;
              if (entries.length !== 1)
                throw new HttpError(
                  409,
                  "Nguyên liệu thực đơn chưa xác định được danh mục kho trường",
                );
              // Thực đơn lưu định lượng thành phẩm; bếp lấy hàng theo lượng sống đã tính hao hụt.
              wasteByEntry.set(entries[0].id, entries[0].wasteRate);
              return {
                ingredientEntryId: entries[0].id,
                ingredientName: row.ingredient.name,
                quantityPerPortion: grossFromNet(
                  row.quantityPerPortion,
                  entries[0].wasteRate,
                ).toString(),
                unit: row.unit,
              };
            });
            if (!fullRecipe.length)
              throw new HttpError(
                409,
                "Thiếu định mức chính thức của món trong thực đơn",
              );
            const ownRecipe = fullRecipe.filter(
              (row) => !sharedSeasoningIds.has(row.ingredientEntryId),
            );
            // Món chỉ gồm gia vị chung (hiếm): giữ nguyên công thức để vẫn lập được lô
            const recipe = ownRecipe.length ? ownRecipe : fullRecipe;
            return [{ dishId: dish.dishId, portions, recipe }];
          });
        if (!recipes.length && preview)
          return {
            batches: [],
            seasonings: [],
            planVersion: "",
            cookingModeApplied: mode,
          };
        if (!recipes.length)
          return {
            created: false,
            groups: groupDtos(existing),
            batches: existing.map(dto),
          };
        const entryIds = [
          ...new Set(
            recipes.flatMap((r) => r.recipe.map((i) => i.ingredientEntryId)),
          ),
        ];
        if (
          !demand.groups.length &&
          (await repository.hasRecipeAllergy(
            tx,
            menu.menuDate,
            meal.mealType,
            schoolId,
            entryIds,
            meal.menuDayId,
          ))
        )
          throw new HttpError(
            409,
            "Nhu cầu có dị ứng liên quan recipe; cần phương án món phù hợp trước khi lập mẻ",
          );
        const stock = await readPlanningStock(
          tx,
          schoolId,
          menu.menuDate,
          entryIds,
          !preview,
        );
        const children = planMealDishes(recipes, mode, stock);
        const seasonings =
          (await reserveMealSeasonings(
            tx,
            meal,
            schoolId,
            menu.menuDate,
            demand.totalPortions,
            mode,
            { preview: true, additional: stock },
          )) ?? [];
        const allocationProfiles = menu.WeeklyMenu?.isSchoolWide
          ? await repository.allocationGradeRecipes(
              tx,
              schoolId,
              children.flatMap((child) =>
                child.dishes.map((dish) => dish.dishId),
              ),
            )
          : [];
        const planVersion = createHash("sha256")
          .update(
            JSON.stringify({ mode, children, seasonings, allocationProfiles }),
          )
          .digest("hex");
        if (preview)
          return {
            cookingModeApplied: mode,
            planVersion,
            seasonings,
            batches: children.map((child) => ({
              plannedPortions: child.plannedPortions,
              dishes: child.dishes.map((dish) => ({
                dishId: dish.dishId,
                name: menu.menuDayDishes.find(
                  (row) => row.dishId === dish.dishId,
                )!.Dish.name,
                plannedPortions: dish.plannedPortions,
                lots: dish.lots.map((lot) => ({
                  ...lot,
                  cookedQuantity: netFromGross(
                    lot.quantityUsed,
                    wasteByEntry.get(
                      stock.find((row) => row.id === lot.ingredientLotId)
                        ?.ingredientEntryId ?? "",
                    ) ?? 0,
                  )
                    .toDecimalPlaces(3)
                    .toString(),
                  lotCode:
                    stock.find((row) => row.id === lot.ingredientLotId)
                      ?.lotCode ?? null,
                  ingredientName:
                    stock.find((row) => row.id === lot.ingredientLotId)
                      ?.ingredientName ?? null,
                })),
              })),
            })),
          };
        if (input.planVersion && input.planVersion !== planVersion)
          throw new HttpError(
            409,
            "Phương án đã thay đổi; vui lòng xem lại trước khi tạo lô",
          );
        // Mã thống nhất: nhóm lô FP-BG-xxxxx, lô nấu FP-CB-xxxxx (cấp trong cùng transaction).
        const [groupCode] = await reserveFpCodes(tx, "BG", 1);
        const childCodes = await reserveFpCodes(tx, "CB", children.length);
        const group = await repository.createPlanGroup(tx, {
          ...meal,
          createdByUserId: actor.id,
          batchCode: groupCode,
        });
        const created: Detail[] = [];
        // Lô được đánh số theo từng món trong bữa: Lô 1, Lô 2... tiếp nối các lô đã có.
        const lotCounter = new Map<string, number>();
        for (const child of existing)
          for (const dish of child.dishes)
            lotCounter.set(dish.dishId, (lotCounter.get(dish.dishId) ?? 0) + 1);
        for (let i = 0; i < children.length; i++) {
          const child = children[i];
          const lotKey =
            child.dishes.length === 1 ? child.dishes[0].dishId : `group:${i}`;
          const batchNumber = (lotCounter.get(lotKey) ?? 0) + 1;
          lotCounter.set(lotKey, batchNumber);
          created.push(
            await repository.createPlannedChild(
              tx,
              {
                ...meal,
                batchGroupId: group.id,
                batchCode: childCodes[i],
                batchNumber,
                dishId:
                  child.dishes.length === 1 ? child.dishes[0].dishId : null,
                cookingModeApplied: mode,
                createdByUserId: actor.id,
                status: "CONFIRMED",
                confirmedByUserId: actor.id,
                confirmedAt: new Date(),
                plannedPortions: child.plannedPortions,
                dishes: {
                  create: child.dishes.map((d) => ({
                    dishId: d.dishId,
                    plannedPortions: d.plannedPortions,
                    allocationRecipeSnapshot: {
                      version: 1,
                      profiles: menu.WeeklyMenu?.isSchoolWide
                        ? allocationSnapshotProfiles(
                            allocationProfiles.find(
                              (row) => row.id === d.dishId,
                            ),
                          )
                        : (menu.WeeklyMenu?.grades ?? []).map((profile) => ({
                            gradeId: profile.gradeId,
                            lines: (
                              menu.menuDayDishes.find(
                                (row) => row.dishId === d.dishId,
                              )?.ingredients ?? []
                            ).map((line) => ({
                              ingredientId: line.ingredientId,
                              quantityPerPortion:
                                line.quantityPerPortion.toString(),
                              unit: line.unit,
                            })),
                          })),
                      fallback: (
                        menu.menuDayDishes.find(
                          (row) => row.dishId === d.dishId,
                        )?.ingredients ?? []
                      ).map((line) => ({
                        ingredientId: line.ingredientId,
                        quantityPerPortion: line.quantityPerPortion.toString(),
                        unit: line.unit,
                      })),
                    },
                  })),
                },
              },
              child.dishes.flatMap((d) =>
                d.lots.map((l) => ({ ...l, dishId: d.dishId })),
              ),
            ),
          );
        }
        await reserveMealSeasonings(
          tx,
          meal,
          schoolId,
          menu.menuDate,
          demand.totalPortions,
          mode,
        );
        await tx.menuDay.update({
          where: { id: input.menuDayId },
          data: { updatedAt: new Date() },
        });
        const batches = [...existing, ...created];
        return {
          created: true,
          groups: groupDtos(batches),
          batches: batches.map(dto),
        };
      },
    );
  }

  return {
    async getGroup(
      id: string,
      principal: AuthPrincipal,
    ): Promise<CookingBatchGroupResponseDTO> {
      listScopes.kitchen(principal);
      const group = await repository.findGroup(
        await connect(),
        id,
        principal.schoolId!,
      );
      if (!group)
        throw new HttpError(404, "Không tìm thấy lô chế biến trong trường");
      return (
        groupDtos(group.cookingBatches)[0] ?? {
          id: group.id,
          batchCode: group.batchCode,
          menuDayId: group.menuDayId,
          mealType: group.mealType,
          status: "UNCONFIRMED",
          batches: [],
        }
      );
    },
    async getOne(id: string, principal: AuthPrincipal) {
      const where = listScopes.kitchen(principal);
      const db = await connect();
      const batch = await db.cookingBatch.findFirst({
        where: { AND: [where, { id }] },
        select: detailSelect,
      });
      if (!batch) throw new HttpError(404, "Không tìm thấy mẻ chế biến");
      const shared = await db.menuMealSeasoningLot.findMany({
        where: { menuDayId: batch.menuDayId, mealType: batch.mealType },
        select: {
          id: true,
          ingredientEntryId: true,
          ingredientLotId: true,
          plannedPortions: true,
          quantityUsed: true,
          unit: true,
          usedAt: true,
        },
        orderBy: { id: "asc" },
      });
      return {
        ...dto(batch),
        mealSeasonings: shared.map((row) => ({
          ...row,
          quantityUsed: row.quantityUsed.toString(),
        })),
      };
    },

    preview(input: PlanInput, principal: AuthPrincipal) {
      return executePlan(
        input,
        principal,
        true,
      ) as Promise<CookingBatchPreviewDTO>;
    },
    plan(input: PlanInput, principal: AuthPrincipal) {
      return executePlan(
        input,
        principal,
        false,
      ) as Promise<CookingBatchPlanResponseDTO>;
    },

    confirm(id: string, principal: AuthPrincipal) {
      return write(
        principal,
        "cooking_batch.confirm",
        async (tx, actor, schoolId) => {
          const batch = await lockedBatch(tx, id, schoolId);
          if (batch.status !== "UNCONFIRMED") return dto(batch);
          await assertMealPortions(tx, batch, schoolId, batch.id);
          await checkReservedStock(tx, batch, schoolId);
          await checkMealSeasoningStock(tx, batch, schoolId);
          return dto(
            await tx.cookingBatch.update({
              where: { id },
              data: {
                status: "CONFIRMED",
                confirmedAt: new Date(),
                confirmedByUserId: actor.id,
              },
              select: detailSelect,
            }),
          );
        },
      );
    },

    async complete(
      id: string,
      principal: AuthPrincipal,
      input?: KitchenInspection,
    ) {
      let proof: ProofRef | null = null;
      const result = await write(
        principal,
        "cooking_batch.complete",
        async (tx, actor, schoolId) => {
          const batch = await lockedBatch(tx, id, schoolId);
          if (batch.status === "COMPLETED") {
            return completionResult(tx, batch);
          }
          if (batch.status !== "CONFIRMED")
            throw new HttpError(409, "Phải xác nhận nấu trước khi hoàn thành");
          await assertMealPortions(
            tx,
            batch,
            schoolId,
            batch.id,
            Boolean(batch.BatchGroup.supplyRoundId),
          );
          const stock = await checkReservedStock(tx, batch, schoolId);
          if (
            await tx.inventoryTransaction.count({
              where: {
                movementType: "COOKING_USAGE",
                referenceType: "COOKING_BATCH",
                referenceId: id,
              },
            })
          )
            throw new HttpError(
              409,
              "Mẻ chưa hoàn thành nhưng đã có tiêu hao kho; cần đối chiếu lịch sử",
            );
          const consumption = new Map<string, Prisma.Decimal>();
          for (const allocation of batch.cookingBatchLots) {
            const lot = stock.get(allocation.ingredientLotId)!;
            const used = convertQuantity(
              allocation.quantityUsed.add(allocation.sampleQuantity ?? 0),
              allocation.unit,
              lot.unit,
            );
            consumption.set(
              lot.id,
              (consumption.get(lot.id) ?? new Decimal(0)).add(used),
            );
          }
          for (const [lotId, used] of consumption) {
            const lot = stock.get(lotId)!;
            if (used.decimalPlaces() > 3 || !used.gt(0))
              throw new HttpError(409, "Lượng tiêu hao không hợp lệ");
            const changed = await tx.ingredientLot.updateMany({
              where: {
                id: lot.id,
                status: "AVAILABLE",
                availableQuantity: { gte: used },
              },
              data: {
                availableQuantity: { decrement: used },
                status: lot.availableQuantity.eq(used)
                  ? "DEPLETED"
                  : "AVAILABLE",
              },
            });
            if (changed.count !== 1)
              throw new HttpError(
                409,
                "Tồn kho đã thay đổi; chưa ghi nhận hoàn thành",
              );
            await tx.inventoryTransaction.create({
              data: {
                ingredientLotId: lot.id,
                movementType: "COOKING_USAGE",
                quantity: used,
                unit: lot.unit,
                createdByUserId: actor.id,
                referenceType: "COOKING_BATCH",
                referenceId: id,
              },
            });
          }
          const completed = await tx.cookingBatch.update({
            where: { id },
            data: {
              status: "COMPLETED",
              completedAt: new Date(),
              completedByUserId: actor.id,
              ...(input?.note !== undefined ? { note: input.note } : {}),
            },
            select: detailSelect,
          });
          await consumeMealSeasonings(
            tx,
            batch,
            schoolId,
            actor.id,
            Boolean(batch.BatchGroup.supplyRoundId),
          );
          proof = await proofs.prepareCookingCompleted(tx, id, actor.id);
          return completionResult(tx, completed);
        },
      );
      proofs.scheduleAnchor(proof);
      return result;
    },
  };
}

const KITCHEN_READ_TIMEOUT_MS = 20_000;

export function createKitchenService(
  read: KitchenListReader = readFromDatabase,
  connect: () => Promise<PrismaClient> = getPrisma,
  today: () => string = vietnamToday,
) {
  return {
    ...createKitchenLifecycle(connect, undefined, today),
    async getContext(principal: AuthPrincipal) {
      return readSchoolContext(
        await connect(),
        principal,
        "cooking_batch.view",
      );
    },
    /** Tiến độ chế biến hôm nay của mọi khối (thực đơn) để cảnh báo khối/bữa chưa xong. */
    async dayProgress(
      principal: AuthPrincipal,
    ): Promise<KitchenDayProgressResponseDTO> {
      assertPermission(principal, "cooking_batch.view");
      if (principal.orgType !== "SCHOOL" || !principal.schoolId)
        throw new HttpError(403, "Cần phạm vi trường");
      const date = today();
      const rows = await repository.findDayProgress(
        await connect(),
        principal.schoolId,
        new Date(date + "T00:00:00.000Z"),
      );
      return summarizeDayProgress(rows, date);
    },
    async list(
      query: KitchenFilters,
      principal: AuthPrincipal,
    ): Promise<CookingBatchListResponseDTO> {
      const scope = listScopes.kitchen(principal);
      const db = await connect();
      return db.$transaction(
        async (tx) => {
          const [batches, totalItems] = await Promise.all([
            repository.findBatchesPaged(tx, query, scope),
            repository.countBatches(tx, query, scope),
          ]);
          return {
            items: batches.map((batch) => ({
              ...dto(batch),
              retainedFoodSamples: batch.RetainedFoodSample.map((sample) => ({
                id: sample.id,
                dishId: sample.dishId,
                status: sample.status,
                sampledAt: sample.sampledAt.toISOString(),
                disposedAt: sample.disposedAt?.toISOString() ?? null,
                quantity: sample.quantity?.toString() ?? null,
                unit: sample.unit,
                storageLocation: sample.storageLocation,
                photoUrl: recordPhotoUrl(sample.photoPublicId),
              })),
            })),
            pagination: {
              page: query.page,
              limit: query.limit,
              totalItems,
            },
          };
        },
        {
          isolationLevel: "RepeatableRead",
          timeout: KITCHEN_READ_TIMEOUT_MS,
        },
      );
    },
    async stats(
      query: KitchenFilters,
      principal: AuthPrincipal,
    ): Promise<CookingBatchStatsResponseDTO> {
      const scope = listScopes.kitchen(principal);
      const db = await connect();
      return db.$transaction(
        async (tx) => {
          const [states, samples, pendingSamples] = await Promise.all([
            repository.groupBatchStatus(tx, query, scope),
            repository.groupSampleStatus(tx, query, scope),
            repository.countPendingSamples(tx, query, scope),
          ]);
          const counts = Object.fromEntries(
            states.map((s) => [s.status, s._count]),
          );
          return {
            total: states.reduce((n, s) => n + s._count, 0),
            unconfirmed: counts.UNCONFIRMED ?? 0,
            confirmed: counts.CONFIRMED ?? 0,
            completed: counts.COMPLETED ?? 0,
            storedSamples:
              samples.find((s) => s.status === "STORED")?._count ?? 0,
            disposedSamples:
              samples.find((s) => s.status === "DISPOSED")?._count ?? 0,
            pendingSamples,
          };
        },
        {
          isolationLevel: "RepeatableRead",
          timeout: KITCHEN_READ_TIMEOUT_MS,
        },
      );
    },

    async getAll(query: ListQuery, principal: AuthPrincipal) {
      const where = listScopes["kitchen"](principal);
      const page = await readListPage(
        () =>
          read({
            ...listWindow(query),
            where,
            select,
            orderBy: [{ id: "asc" }],
          }),
        query,
      );
      return {
        pagination: page.pagination,
        items: page.items.map((batch) => ({
          id: batch.id,
          batchCode: batch.batchCode,
          batchNumber: batch.batchNumber ?? null,
          batchGroupId: batch.batchGroupId,
          BatchGroup: {
            id: batch.BatchGroup.id,
            batchCode: batch.BatchGroup.batchCode,
            ...(batch.BatchGroup.supplyRoundId
              ? { supplyRoundId: batch.BatchGroup.supplyRoundId }
              : {}),
          },
          menuDayId: batch.menuDayId,
          dishId: batch.dishId,
          mealType: batch.mealType,
          cookingModeApplied: batch.cookingModeApplied,
          status: batch.status,
          plannedPortions: batch.plannedPortions,
          dishes: batch.dishes.map((d) => ({
            dishId: d.dishId,
            name: d.Dish?.name ?? "",
            plannedPortions: d.plannedPortions,
            ...(d.sampleQuantity !== null && d.sampleQuantity !== undefined
              ? {
                  sampleQuantity: d.sampleQuantity.toString(),
                  sampleUnit: d.sampleUnit ?? null,
                  sampleRatio: d.sampleRatio?.toString() ?? null,
                  standardQuantitySnapshot:
                    d.standardQuantitySnapshot?.toString() ?? null,
                }
              : {}),
          })),
          confirmedAt: batch.confirmedAt?.toISOString() ?? null,
          completedAt: batch.completedAt?.toISOString() ?? null,
          createdAt: batch.createdAt.toISOString(),
          updatedAt: batch.updatedAt.toISOString(),
        })),
      };
    },
  };
}

export const kitchenService = createKitchenService();
export type KitchenService = ReturnType<typeof createKitchenService>;
async function completionResult(tx: Tx, batch: Detail) {
  const usage = await tx.inventoryTransaction.count({
    where: {
      movementType: "COOKING_USAGE",
      referenceType: "COOKING_BATCH",
      referenceId: batch.id,
    },
  });
  const shared = await tx.menuMealSeasoningLot.findMany({
    where: { menuDayId: batch.menuDayId, mealType: batch.mealType },
    select: { usedAt: true },
  });
  return {
    ...dto(batch),
    inventoryDeducted:
      batch.cookingBatchLots.length > 0 &&
      usage ===
        new Set(batch.cookingBatchLots.map((l) => l.ingredientLotId)).size,
    mealSeasoningsConsumed:
      shared.length > 0 && shared.every((s) => s.usedAt !== null),
  };
}

/**
 * Bản chụp định lượng theo khối cho mẻ của thực đơn toàn trường:
 * định lượng 1 suất = công thức mốc chuẩn × khẩu phần khối / mốc chuẩn.
 */
function allocationSnapshotProfiles(
  dish:
    | {
        standardQuantity: Prisma.Decimal;
        gradeRecipes: {
          gradeId: string;
          portionQuantity: Prisma.Decimal;
        }[];
        dishIngredientEntries: {
          requiredQuantity: Prisma.Decimal;
          unit: string;
          IngredientEntry: { ingredientId: string };
        }[];
      }
    | undefined,
) {
  if (!dish) return [];
  return dish.gradeRecipes.flatMap((profile) => {
    const lines = gradeDishLines(
      dish,
      profile.gradeId,
      dish.dishIngredientEntries,
    );
    if (!lines?.length) return [];
    return [
      {
        gradeId: profile.gradeId,
        lines: lines.map((line) => ({
          ingredientId: line.IngredientEntry.ingredientId,
          quantityPerPortion: line.requiredQuantity.toString(),
          unit: line.unit,
        })),
      },
    ];
  });
}
