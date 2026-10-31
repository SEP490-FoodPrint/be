import { randomUUID } from "node:crypto";
import {
  Prisma,
  type PrismaClient,
  type CookingMode,
  type MealType,
} from "../../generated/prisma/client";
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
import type { validateKitchenPlan } from "./kitchen.validation";

const Decimal = Prisma.Decimal;
export interface RecipeLine {
  ingredientEntryId: string;
  quantityPerPortion: string;
  unit: string;
}
export interface PlanningLot {
  id: string;
  ingredientEntryId: string;
  availableQuantity: string;
  reservedQuantity: string;
  unit: string;
}
export interface BatchPlan {
  plannedPortions: number;
  lots: { ingredientLotId: string; quantityUsed: string; unit: string }[];
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

const units: Record<string, { dimension: string; factor: string }> = {
  kg: { dimension: "mass", factor: "1000" },
  g: { dimension: "mass", factor: "1" },
  mg: { dimension: "mass", factor: "0.001" },
  l: { dimension: "volume", factor: "1000" },
  ml: { dimension: "volume", factor: "1" },
};
export function convertQuantity(
  quantity: Prisma.Decimal,
  from: string,
  to: string,
): Prisma.Decimal {
  const source = from.trim().toLowerCase();
  const target = to.trim().toLowerCase();
  if (source && source === target) return quantity;
  const left = units[source];
  const right = units[target];
  if (!left || !right || left.dimension !== right.dimension)
    throw new HttpError(
      409,
      "Đơn vị recipe và lô nguyên liệu chưa thể quy đổi",
    );
  return quantity.mul(left.factor).div(right.factor);
}

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
  const take = (lot: (typeof lots)[number], amount: Prisma.Decimal) => {
    const quantityUsed = storedQuantity(amount);
    if (amount.gt(lot.free))
      throw new HttpError(409, "Không đủ nguyên liệu khả dụng");
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
          "Không đủ nguyên liệu khả dụng cho nhu cầu đã chốt",
        );
    }
    return [plan];
  }
  if (mode !== "SEPARATE_BY_LOT")
    throw new HttpError(409, "Chưa cấu hình chế độ chế biến hợp lệ");
  const plans: BatchPlan[] = [];
  let remaining = portions;
  while (remaining > 0) {
    const selected = ingredients.map((ingredient) => {
      for (const lot of lots.filter(
        (row) =>
          row.ingredientEntryId === ingredient.ingredientEntryId &&
          row.free.gt(0),
      )) {
        const perPortion = convertQuantity(
          ingredient.perPortion,
          ingredient.unit,
          lot.unit,
        );
        if (lot.free.gte(perPortion)) return { lot, perPortion };
      }
      throw new HttpError(
        409,
        "Không đủ nguyên liệu để nấu riêng từng lô theo số suất nguyên",
      );
    });
    const count = Math.min(
      remaining,
      ...selected.map(({ lot, perPortion }) =>
        lot.free.div(perPortion).floor().toNumber(),
      ),
    );
    plans.push({
      plannedPortions: count,
      lots: selected.map(({ lot, perPortion }) =>
        take(lot, perPortion.mul(count)),
      ),
    });
    remaining -= count;
  }
  return plans;
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
    unit: true,
  } as const;
  const rows = [
    ...(await tx.cookingBatchLot.findMany({
      where: {
        ...where,
        CookingBatch: { status: { in: ["UNCONFIRMED", "CONFIRMED"] } },
      },
      select,
    })),
    ...(await tx.menuMealSeasoningLot.findMany({
      where: { ...where, usedAt: null },
      select,
    })),
  ];
  const byId = new Map(lots.map((lot) => [lot.id, lot]));
  for (const row of rows) {
    const lot = byId.get(row.ingredientLotId);
    if (!lot || !row.quantityUsed.gt(0))
      throw new HttpError(409, "Lượng nguyên liệu đã giữ không hợp lệ");
    totals.set(
      lot.id,
      totals
        .get(lot.id)!
        .add(convertQuantity(row.quantityUsed, row.unit, lot.unit)),
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
): Promise<PlanningLot[]> {
  if (!entryIds.length) return [];
  const where: Prisma.IngredientLotWhereInput = {
    status: "AVAILABLE",
    availableQuantity: { gt: 0 },
    OR: [{ expiryDate: null }, { expiryDate: { gte: menuDate } }],
    DeliveryItem: {
      Delivery: { status: "RECEIVED", SupplyRequest: { schoolId } },
      SupplyRequestItem: { ingredientEntryId: { in: [...entryIds] } },
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
      DeliveryItem: {
        select: { SupplyRequestItem: { select: { ingredientEntryId: true } } },
      },
    },
    orderBy: [
      { expiryDate: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
      { id: "asc" },
    ],
  });
  const reserved = await reservedQuantities(tx, lots);
  return lots.map((lot) => ({
    id: lot.id,
    unit: lot.unit,
    ingredientEntryId: lot.DeliveryItem.SupplyRequestItem.ingredientEntryId,
    availableQuantity: lot.availableQuantity.toString(),
    reservedQuantity: reserved.get(lot.id)!.toString(),
  }));
}

type Meal = { menuDayId: string; mealType: MealType };
function mealKey(meal: Meal) {
  return { menuDayId: meal.menuDayId, mealType: meal.mealType };
}

/** Legacy batches keep their recorded plan; new standards may not drift from finalized demand. */
export async function assertMealPortions(
  tx: StockTx,
  meal: Meal,
  schoolId: string,
) {
  if (!(await tx.menuDayDishIngredient.count({ where: mealKey(meal) }))) return;
  const day = await tx.menuDay.findUniqueOrThrow({
    where: { id: meal.menuDayId },
    select: { menuDate: true },
  });
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
  const batches = await tx.cookingBatch.findMany({
    where: mealKey(meal),
    select: { dishId: true, plannedPortions: true },
  });
  if (
    portions <= 0 ||
    batches.some((batch) => !batch.plannedPortions) ||
    [...new Set(batches.map((batch) => batch.dishId))].some(
      (dishId) =>
        batches
          .filter((batch) => batch.dishId === dishId)
          .reduce((sum, batch) => sum + (batch.plannedPortions ?? 0), 0) !==
        portions,
    )
  )
    throw new HttpError(
      409,
      "Số suất đã thay đổi sau khi lập mẻ; cần đối chiếu, không tự đổi kế hoạch",
    );
}

export async function reserveMealSeasonings(
  tx: StockTx,
  meal: Meal,
  schoolId: string,
  menuDate: Date,
  portions: number,
  mode: CookingMode,
) {
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
    throw new HttpError(409, "Gia vị không thuộc kho khô của trường");
  const entryIds = standards.map((s) => s.ingredientEntryId);
  if (
    await tx.dailyAllergyPortion.findFirst({
      where: {
        DailyMealPortion: {
          mealDate: menuDate,
          mealType: meal.mealType,
          status: "FINALIZED",
          Class: { schoolId },
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
  if (existing.length) {
    if (
      existing.some(
        (row) => row.plannedPortions !== portions || row.usedAt !== null,
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
      if (!sum.eq(standard.quantityPerPortion.mul(portions)))
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
    return;
  }
  let stock = await readPlanningStock(tx, schoolId, menuDate, entryIds, true);
  // A shared meal pool cannot assign split spice lots to individual dishes.
  // Preserve SEPARATE_BY_LOT by choosing one sufficient lot per seasoning.
  if (mode === "SEPARATE_BY_LOT") {
    stock = stock.filter((lot) => {
      const s = standards.find(
        (row) => row.ingredientEntryId === lot.ingredientEntryId,
      )!;
      return convertQuantity(
        new Prisma.Decimal(lot.availableQuantity).sub(lot.reservedQuantity),
        lot.unit,
        s.unit,
      ).gte(s.quantityPerPortion.mul(portions));
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
    portions,
    mode,
    standards.map((s) => ({
      ingredientEntryId: s.ingredientEntryId,
      quantityPerPortion: s.quantityPerPortion.toString(),
      unit: s.unit,
    })),
    stock,
  );
  const byLot = new Map(stock.map((lot) => [lot.id, lot]));
  for (const plan of plans)
    for (const lot of plan.lots)
      await tx.menuMealSeasoningLot.create({
        data: {
          ...mealKey(meal),
          ...lot,
          plannedPortions: portions,
          ingredientEntryId: byLot.get(lot.ingredientLotId)!.ingredientEntryId,
        },
      });
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
        Delivery: { status: "RECEIVED", SupplyRequest: { schoolId } },
      },
    },
    select: { id: true, unit: true, availableQuantity: true },
  });
  if (lots.length !== new Set(allocations.map((a) => a.ingredientLotId)).size)
    throw new HttpError(409, "Lô gia vị không còn hợp lệ trong kho trường");
  const reserved = await reservedQuantities(tx, lots);
  if (lots.some((lot) => lot.availableQuantity.lt(reserved.get(lot.id)!)))
    throw new HttpError(409, "Tồn kho không đủ cho gia vị đã giữ");
  return allocations;
}

/** Called AFTER updating the last batch, inside the same serializable transaction. */
export async function consumeMealSeasonings(
  tx: StockTx,
  meal: Meal,
  schoolId: string,
  actorId: string,
) {
  const allocations = await tx.menuMealSeasoningLot.findMany({
    where: mealKey(meal),
  });
  if (!allocations.length || allocations.every((a) => a.usedAt !== null))
    return;
  const portions = allocations[0].plannedPortions;
  const dishes = await tx.menuDayDish.findMany({
    where: mealKey(meal),
    select: { dishId: true },
  });
  const batches = await tx.cookingBatch.findMany({
    where: mealKey(meal),
    select: { dishId: true, status: true, plannedPortions: true },
  });
  if (
    !dishes.length ||
    dishes.some((dish) => {
      const rows = batches.filter((batch) => batch.dishId === dish.dishId);
      return (
        !rows.length ||
        rows.some(
          (batch) => batch.status !== "COMPLETED" || !batch.plannedPortions,
        ) ||
        rows.reduce(
          (total, batch) => total + (batch.plannedPortions ?? 0),
          0,
        ) !== portions
      );
    })
  )
    return;
  await checkMealSeasoningStock(tx, meal, schoolId);
  if (
    allocations.some(
      (a) => a.plannedPortions !== portions || a.usedAt !== null,
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
      allocation.quantityUsed,
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

const detailSelect = {
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
  cookingBatchLots: {
    select: { ingredientLotId: true, quantityUsed: true, unit: true },
    orderBy: { ingredientLotId: "asc" },
  },
} as const satisfies Prisma.CookingBatchSelect;
type Detail = Prisma.CookingBatchGetPayload<{ select: typeof detailSelect }>;
type Tx = Prisma.TransactionClient;
type PlanInput = ReturnType<typeof validateKitchenPlan>;

function dto(batch: Detail) {
  return {
    ...batch,
    cookingBatchLots: batch.cookingBatchLots.map((lot) => ({
      ingredientLotId: lot.ingredientLotId,
      quantityUsed: lot.quantityUsed.toString(),
      unit: lot.unit,
    })),
  };
}

function retryable(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  if (error.code === "P2034") return true;
  if (error.code !== "P2010" || !("meta" in error)) return false;
  const meta = error.meta;
  return (
    !!meta &&
    typeof meta === "object" &&
    "code" in meta &&
    (meta.code === "40001" || meta.code === "40P01")
  );
}

/** All kitchen writes lock the trusted school first, then batch/lots by UUID. */
export function createKitchenLifecycle(
  connect: () => Promise<PrismaClient> = getPrisma,
) {
  async function write<T>(
    principal: AuthPrincipal,
    permission: string,
    operation: (tx: Tx, actor: AuthPrincipal, schoolId: string) => Promise<T>,
  ): Promise<T> {
    assertPermission(principal, permission);
    if (principal.orgType !== "SCHOOL" || !principal.schoolId)
      throw new HttpError(
        403,
        "Thao tác chế biến yêu cầu phạm vi trường đã xác thực",
      );
    const db = await connect();
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
              throw new HttpError(
                403,
                "Phạm vi tài khoản đã thay đổi; vui lòng tải lại",
              );
            await tx.$queryRaw`SELECT id FROM foodprint.schools WHERE id = ${actor.schoolId}::uuid FOR UPDATE`;
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
        if (attempt < 2 && retryable(error)) continue;
        if (error instanceof HttpError) throw error;
        throw new HttpError(
          503,
          "Chưa thể xử lý mẻ chế biến; vui lòng thử lại",
        );
      }
    }
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

  async function reservations(tx: Tx, lots: { id: string; unit: string }[]) {
    return reservedQuantities(tx, lots);
  }

  async function lockLots(tx: Tx, ids: string[]) {
    for (const id of [...new Set(ids)].sort())
      await tx.$queryRaw`SELECT id FROM foodprint.ingredient_lots WHERE id = ${id}::uuid FOR UPDATE`;
  }

  async function checkReservedStock(tx: Tx, batch: Detail, schoolId: string) {
    if (
      !batch.plannedPortions ||
      batch.plannedPortions <= 0 ||
      !batch.cookingBatchLots.length
    )
      throw new HttpError(
        409,
        "Mẻ chưa có kế hoạch số suất/nguyên liệu hợp lệ",
      );
    await lockLots(
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
          Delivery: { status: "RECEIVED", SupplyRequest: { schoolId } },
        },
      },
      select: { id: true, unit: true, availableQuantity: true, status: true },
    });
    if (lots.length !== batch.cookingBatchLots.length)
      throw new HttpError(
        409,
        "Thiếu lô nguyên liệu hợp lệ trong phạm vi trường",
      );
    const reserved = await reservations(tx, lots);
    for (const lot of lots) {
      if (
        lot.status !== "AVAILABLE" ||
        lot.availableQuantity.lt(reserved.get(lot.id)!)
      )
        throw new HttpError(
          409,
          "Tồn kho không đủ cho các mẻ đang giữ nguyên liệu; cần đối chiếu",
        );
    }
    return new Map(lots.map((lot) => [lot.id, lot]));
  }

  return {
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

    plan(input: PlanInput, principal: AuthPrincipal) {
      return write(
        principal,
        "cooking_batch.create",
        async (tx, actor, schoolId) => {
          const school = await tx.school.findUniqueOrThrow({
            where: { id: schoolId },
            select: {
              cookingMode: true,
              lunchTime: true,
              afternoonMealTime: true,
            },
          });
          if (
            !school.cookingMode ||
            !(input.mealType === "LUNCH"
              ? school.lunchTime
              : school.afternoonMealTime)
          )
            throw new HttpError(
              409,
              "BGH cần cấu hình chế độ nấu và giờ phục vụ trước",
            );
          const menu = await tx.menuDayDish.findUnique({
            where: { menuDayId_dishId_mealType: input },
            select: {
              MenuDay: {
                select: {
                  menuDate: true,
                  approvalStatus: true,
                  WeeklyMenu: { select: { schoolId: true, status: true } },
                },
              },
              Dish: { select: { schoolId: true, status: true } },
            },
          });
          if (
            !menu ||
            menu.MenuDay.WeeklyMenu.schoolId !== schoolId ||
            menu.Dish.schoolId !== schoolId
          )
            throw new HttpError(
              404,
              "Không tìm thấy món trong thực đơn của trường",
            );
          if (
            menu.MenuDay.approvalStatus !== "APPROVED" ||
            menu.Dish.status !== "ACTIVE"
          )
            throw new HttpError(
              409,
              "Chỉ lập mẻ cho thực đơn đã duyệt và món đang hoạt động",
            );
          const demandWhere = {
            mealDate: menu.MenuDay.menuDate,
            mealType: input.mealType,
            status: "FINALIZED" as const,
            Class: { schoolId },
          };
          const demand = await tx.dailyMealPortion.aggregate({
            where: demandWhere,
            _sum: { totalPortions: true },
          });
          const portions = demand._sum.totalPortions ?? 0;
          if (
            !Number.isSafeInteger(portions) ||
            portions <= 0 ||
            portions > 2147483647
          )
            throw new HttpError(
              409,
              "Chưa có nhu cầu suất ăn hợp lệ đã chốt cho bữa này",
            );
          const existing = await tx.cookingBatch.findMany({
            where: input,
            select: detailSelect,
            orderBy: { id: "asc" },
          });
          if (
            existing.some(
              (batch) => !batch.plannedPortions || batch.plannedPortions <= 0,
            )
          )
            throw new HttpError(
              409,
              "Mẻ cũ thiếu số suất kế hoạch; cần đối chiếu trước",
            );
          const planned = existing.reduce(
            (sum, batch) => sum + batch.plannedPortions!,
            0,
          );
          if (planned > portions)
            throw new HttpError(
              409,
              "Kế hoạch cũ vượt nhu cầu hiện tại; không tự thay đổi lịch sử",
            );
          if (planned === portions)
            return { created: false, batches: existing.map(dto) };

          const mealBatches = await tx.cookingBatch.findMany({
            where: { menuDayId: input.menuDayId, mealType: input.mealType },
            select: { dishId: true, plannedPortions: true },
          });
          for (const dishId of new Set(
            mealBatches.map((batch) => batch.dishId),
          )) {
            const total = mealBatches
              .filter((batch) => batch.dishId === dishId)
              .reduce((sum, batch) => sum + (batch.plannedPortions ?? 0), 0);
            if (total !== portions)
              throw new HttpError(
                409,
                "Số suất bữa đã được lập mẻ; không tự thay đổi nhu cầu đã chốt",
              );
          }
          const standards = await tx.menuDayDishIngredient.findMany({
            where: input,
            include: {
              ingredient: {
                select: {
                  ingredientEntries: {
                    where: { schoolId },
                    select: { id: true, schoolId: true },
                  },
                },
              },
            },
            orderBy: { ingredientId: "asc" },
          });
          const recipe = standards.map((row) => {
            const entry = row.ingredient.ingredientEntries[0];
            if (!entry)
              throw new HttpError(
                409,
                "Nguyên liệu thực đơn chưa có trong danh mục kho trường; cần cung ứng trước khi lập mẻ",
              );
            return {
              ingredientEntryId: entry.id,
              requiredQuantity: row.quantityPerPortion,
              unit: row.unit,
              IngredientEntry: { schoolId: entry.schoolId },
            };
          });
          if (
            !recipe.length ||
            recipe.some((row) => row.IngredientEntry.schoolId !== schoolId)
          )
            throw new HttpError(
              409,
              "Chưa có định mức chính thức cho món trong thực đơn; không lấy công thức mẫu thay thế",
            );
          const entryIds = recipe.map((row) => row.ingredientEntryId);
          if (
            await tx.dailyAllergyPortion.findFirst({
              where: {
                DailyMealPortion: demandWhere,
                ingredientEntryId: { in: entryIds },
                portionCount: { gt: 0 },
              },
              select: { dailyMealPortionId: true },
            })
          )
            throw new HttpError(
              409,
              "Nhu cầu có dị ứng liên quan recipe; cần phương án món phù hợp trước khi lập mẻ",
            );
          const lotWhere: Prisma.IngredientLotWhereInput = {
            status: "AVAILABLE",
            availableQuantity: { gt: 0 },
            OR: [
              { expiryDate: null },
              { expiryDate: { gte: menu.MenuDay.menuDate } },
            ],
            DeliveryItem: {
              Delivery: { status: "RECEIVED", SupplyRequest: { schoolId } },
              SupplyRequestItem: { ingredientEntryId: { in: entryIds } },
            },
          };
          const candidates = await tx.ingredientLot.findMany({
            where: lotWhere,
            select: { id: true },
            orderBy: { id: "asc" },
          });
          await lockLots(
            tx,
            candidates.map((lot) => lot.id),
          );
          const stock = await tx.ingredientLot.findMany({
            where: {
              AND: [lotWhere, { id: { in: candidates.map((lot) => lot.id) } }],
            },
            select: {
              id: true,
              unit: true,
              availableQuantity: true,
              DeliveryItem: {
                select: {
                  SupplyRequestItem: { select: { ingredientEntryId: true } },
                },
              },
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          });
          const held = await reservations(tx, stock);
          const planningStock: PlanningLot[] = stock.map((lot) => ({
            id: lot.id,
            unit: lot.unit,
            ingredientEntryId:
              lot.DeliveryItem.SupplyRequestItem.ingredientEntryId,
            availableQuantity: lot.availableQuantity.toString(),
            reservedQuantity: held.get(lot.id)!.toString(),
          }));
          const plans = planCookingBatches(
            portions - planned,
            school.cookingMode,
            recipe.map((row) => ({
              ingredientEntryId: row.ingredientEntryId,
              quantityPerPortion: row.requiredQuantity.toString(),
              unit: row.unit,
            })),
            planningStock,
          );
          const created: Detail[] = [];
          for (const plan of plans) {
            created.push(
              await tx.cookingBatch.create({
                data: {
                  ...input,
                  batchCode: `CB-${randomUUID()}`,
                  cookingModeApplied: school.cookingMode,
                  createdByUserId: actor.id,
                  plannedPortions: plan.plannedPortions,
                  cookingBatchLots: { create: plan.lots },
                },
                select: detailSelect,
              }),
            );
          }
          await reserveMealSeasonings(
            tx,
            { menuDayId: input.menuDayId, mealType: input.mealType },
            schoolId,
            menu.MenuDay.menuDate,
            portions,
            school.cookingMode,
          );
          return { created: true, batches: [...existing, ...created].map(dto) };
        },
      );
    },

    confirm(id: string, principal: AuthPrincipal) {
      return write(
        principal,
        "cooking_batch.confirm",
        async (tx, actor, schoolId) => {
          const batch = await lockedBatch(tx, id, schoolId);
          if (batch.status !== "UNCONFIRMED") return dto(batch);
          await assertMealPortions(tx, batch, schoolId);
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

    complete(id: string, principal: AuthPrincipal) {
      return write(
        principal,
        "cooking_batch.complete",
        async (tx, actor, schoolId) => {
          const batch = await lockedBatch(tx, id, schoolId);
          if (batch.status === "COMPLETED") return dto(batch);
          if (batch.status !== "CONFIRMED")
            throw new HttpError(
              409,
              "Phải xác nhận kế hoạch trước khi hoàn thành",
            );
          await assertMealPortions(tx, batch, schoolId);
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
          for (const allocation of batch.cookingBatchLots) {
            const lot = stock.get(allocation.ingredientLotId)!;
            const used = convertQuantity(
              allocation.quantityUsed,
              allocation.unit,
              lot.unit,
            );
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
            },
            select: detailSelect,
          });
          await consumeMealSeasonings(tx, batch, schoolId, actor.id);
          return dto(completed);
        },
      );
    },
  };
}

const select = {
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

type ListRow = Prisma.CookingBatchGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.CookingBatchFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.cookingBatch.findMany(args);
};

export function createKitchenService(
  read: ListReader = readFromDatabase,
  connect: () => Promise<PrismaClient> = getPrisma,
) {
  return {
    ...createKitchenLifecycle(connect),
    getAll(query: ListQuery, principal: AuthPrincipal) {
      const where = listScopes["kitchen"](principal);
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

export const kitchenService = createKitchenService();
export type KitchenService = ReturnType<typeof createKitchenService>;
