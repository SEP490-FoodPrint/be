import { randomUUID } from "node:crypto";
import { Prisma, type CookingMode } from "../../generated/prisma/client";
import { reserveFpCodes } from "../../utils/fp-code";
import { HttpError } from "../../utils/http-error";
import { convertQuantity } from "../../utils/quantity-conversion";
import { grossFromNet } from "../../utils/waste-rate";
import { kitchenRepository } from "../kitchen/kitchen.repository";
import {
  readPlanningStock,
  reservedQuantities,
  reserveMealSeasonings,
} from "../kitchen/kitchen.service";
import {
  planBatchesByLots,
  splitLotByDemand,
  type FreshLine,
  type PlannedLot,
  type StockLine,
  type SupplyLot,
} from "../kitchen/lot-batch-planner";
import {
  ceilToThree,
  sampleAmountFor,
  sampleLines,
  sampleRatio,
  sourceKey,
  splitRound2,
  type SampleLine,
} from "../kitchen/sample-planner";
import { organizationRepository } from "../organization/organization.repository";
import {
  roundSampleRepository as samples,
  supplyRoundRepository as repository,
  type RoundKey,
  type RoundMeal,
  type RoundOccurrence,
} from "./supply-round.repository";

/**
 * Lập mẻ theo đợt giao (TASK-10 v8, `.task_specs/TASK-10-v8-sample-cut-batch2-compensation.plan.md`).
 *
 * - ROUND1: sau khi mọi chuyến Đợt 1 đã nhận; nấu riêng cắt mẫu trong mẻ, nấu chung chưa lấy mẫu.
 * - ROUND1_NO_FRESH: ngày không có đồ tươi; mỗi món mỗi bữa một mẻ, mẫu giữ thẳng từ kho (V34).
 * - ROUND2_SEPARATE: khi đủ NCC của món khai báo lô; trùng mẻ Đợt 1 thì gộp, khác thì mẻ mới + lấy thêm.
 * - ROUND2_COMBINE: sau khi mọi chuyến Đợt 2 đã nhận; gộp vào mẻ Đợt 1, mẫu cắt khi gộp (V14).
 */
export type RoundPhase =
  "ROUND1" | "ROUND1_NO_FRESH" | "ROUND2_SEPARATE" | "ROUND2_COMBINE";

type Tx = Prisma.TransactionClient;
type D = Prisma.Decimal;
const Decimal = Prisma.Decimal;

export type SamplePolicy = "CUT" | "TOP_UP" | "STOCK";

function mealKey(occurrence: RoundOccurrence): RoundMeal {
  if (occurrence.mealType !== "LUNCH" && occurrence.mealType !== "AFTERNOON")
    throw new HttpError(409, "Bữa ăn không thuộc kế hoạch theo đợt");
  return { menuDayId: occurrence.menuDayId, mealType: occurrence.mealType };
}

const consumerKey = (meal: RoundMeal, dishId: string) =>
  `${meal.menuDayId}|${meal.mealType}|${dishId}`;

interface DemandContext {
  gradePortions: { gradeId: string; portions: number }[];
  actualByGrade: Map<string, number> | null;
  /**
   * Trọng số chia lô (V27) theo nguyên liệu → người dùng (món × bữa): suất × định lượng sống.
   * Đợt 2 cộng thêm phần còn thiếu thực tế sau Đợt 1 (bù làm tròn + bù mẫu đã cắt) của từng người dùng.
   */
  demands: Map<string, Map<string, D>>;
}

/**
 * Phần còn thiếu sau Đợt 1 của từng người dùng × nguyên liệu (đơn vị dòng công thức).
 * Lô Đợt 2 chứa phần bù chung (V2, V4); nếu chia theo nhu cầu Đợt 2 thì người dùng nhu cầu nhỏ
 * nhận thiếu phần bù của mình và bước phân bổ báo "không đáp ứng đủ nhu cầu".
 */
export function round1Deficit(
  need: D,
  supplied: readonly { quantity: D; unit: string }[],
  unit: string,
): D {
  if (!supplied.length) return new Decimal(0);
  let received = new Decimal(0);
  for (const row of supplied) {
    try {
      received = received.add(convertQuantity(row.quantity, row.unit, unit));
    } catch {
      return new Decimal(0);
    }
  }
  return Decimal.max(0, need.sub(received));
}

type PlanMenu = NonNullable<
  Awaited<ReturnType<typeof kitchenRepository.findPlanMeal>>
>;

function mealPortions(
  batchNo: number,
  menu: PlanMenu,
  context: Pick<DemandContext, "gradePortions" | "actualByGrade">,
) {
  const gradeIds = new Set(
    menu.WeeklyMenu?.grades.map(({ gradeId }) => gradeId),
  );
  return context.gradePortions.reduce((sum, row) => {
    if (!(menu.WeeklyMenu?.isSchoolWide || gradeIds.has(row.gradeId)))
      return sum;
    if (batchNo === 2 && context.actualByGrade) {
      const actual = context.actualByGrade.get(row.gradeId) ?? 0;
      return sum + Math.max(0, actual - row.portions);
    }
    return sum + row.portions;
  }, 0);
}

function menuLines(dish: PlanMenu["menuDayDishes"][number]): {
  ingredientEntryId: string;
  ingredientName: string;
  unit: string;
  quantityPerPortion: D;
}[] {
  return dish.ingredients.map((line) => {
    const [entry] = line.ingredient.ingredientEntries;
    if (!entry || line.ingredient.ingredientEntries.length !== 1)
      throw new HttpError(
        409,
        "Nguyên liệu thực đơn chưa xác định được danh mục kho trường",
      );
    return {
      ingredientEntryId: entry.id,
      ingredientName: line.ingredient.name,
      unit: line.unit,
      quantityPerPortion: grossFromNet(
        line.quantityPerPortion,
        entry.wasteRate,
      ),
    };
  });
}

async function demandContext(
  tx: Tx,
  round: RoundKey,
  schoolId: string,
  useActual = false,
): Promise<DemandContext> {
  const actual =
    round.batchNo === 2 || useActual
      ? await repository.actualGradePortions(tx, schoolId, round.deliveryDate)
      : null;
  // Ngày không đồ tươi (V34): một đợt duy nhất theo sĩ số thực tế.
  const gradePortions = useActual
    ? [...(actual ?? new Map<string, number>())].map(([gradeId, portions]) => ({
        gradeId,
        portions,
      }))
    : await repository.gradePortions(tx, round);
  const actualByGrade = round.batchNo === 2 ? actual : null;
  const context = { gradePortions, actualByGrade };
  const occurrences = await repository.occurrences(tx, round);
  const round1 =
    round.batchNo === 2
      ? await repository.findByKey(tx, { ...round, batchNo: 1 })
      : null;
  const round1Supply = new Map<string, { quantity: D; unit: string }[]>();
  for (const row of round1 ? await samples.round1Supply(tx, round1.id) : []) {
    const id = `${row.menuDayId}|${row.mealType}|${row.dishId}|${row.ingredientEntryId}`;
    round1Supply.set(id, [...(round1Supply.get(id) ?? []), row]);
  }
  const demands = new Map<string, Map<string, D>>();
  const meals = new Map<string, RoundMeal>();
  for (const occurrence of occurrences) {
    const meal = mealKey(occurrence);
    meals.set(`${meal.menuDayId}|${meal.mealType}`, meal);
  }
  const roundDishes = new Set(occurrences.map(({ dishId }) => dishId));
  for (const meal of meals.values()) {
    const menu = await kitchenRepository.findPlanMeal(
      tx,
      meal.menuDayId,
      meal.mealType,
      schoolId,
    );
    if (!menu) continue;
    const portions = mealPortions(round.batchNo, menu, context);
    const round1Portions = round1
      ? mealPortions(1, menu, { gradePortions, actualByGrade: null })
      : 0;
    const shared = new Set(
      menu.mealSeasonings.map(({ ingredientEntryId }) => ingredientEntryId),
    );
    for (const dish of menu.menuDayDishes) {
      if (!roundDishes.has(dish.dishId)) continue;
      for (const line of menuLines(dish)) {
        if (shared.has(line.ingredientEntryId)) continue;
        const consumers =
          demands.get(line.ingredientEntryId) ?? new Map<string, D>();
        const key = consumerKey(meal, dish.dishId);
        const deficit = round1
          ? round1Deficit(
              line.quantityPerPortion.mul(round1Portions),
              round1Supply.get(`${key}|${line.ingredientEntryId}`) ?? [],
              line.unit,
            )
          : new Decimal(0);
        consumers.set(
          key,
          (consumers.get(key) ?? new Decimal(0)).add(
            line.quantityPerPortion.mul(portions).add(deficit),
          ),
        );
        demands.set(line.ingredientEntryId, consumers);
      }
    }
  }
  return { ...context, demands };
}

/** Lượng sống của dòng mẫu, đổi về đơn vị `unit`, làm tròn lên 3 chữ số (D12). */
function needIn(line: SampleLine, unit: string) {
  return ceilToThree(convertQuantity(line.gross, line.unit, unit));
}

/** Phần mẫu theo nguyên liệu đã cắt khỏi phần ăn (để ghi phần bù). */
export type CutTotals = Map<string, { quantity: D; unit: string }>;

function addCut(totals: CutTotals, entryId: string, quantity: D, unit: string) {
  const current = totals.get(entryId);
  if (!current) totals.set(entryId, { quantity, unit });
  else
    current.quantity = current.quantity.add(
      convertQuantity(quantity, unit, current.unit),
    );
}

async function freeStockLots(
  tx: Tx,
  schoolId: string,
  menuDate: Date,
  entryId: string,
) {
  const lots = await readPlanningStock(tx, schoolId, menuDate, [entryId]);
  return lots
    .map((lot) => ({
      id: lot.id,
      unit: lot.unit,
      free: new Decimal(lot.availableQuantity).sub(lot.reservedQuantity),
    }))
    .filter((lot) => lot.free.gt(0));
}

/**
 * Lấy phần lưu mẫu cho một mẻ đã ghi vào DB (spec 7.3, V1, V14, V36):
 * - CUT: trừ khỏi phần ăn trên lô mẻ đang dùng nhiều nhất của nguyên liệu (lô không tăng).
 * - TOP_UP: cộng phần mẫu trên lô đang chờ giao của mẻ (NCC lấy thêm).
 * - STOCK: giữ thêm từ tồn kho còn trống.
 * Nguyên liệu tồn kho không đủ để cắt/không có lô chờ giao thì giữ từ tồn kho.
 */
export async function applyBatchSample(
  tx: Tx,
  batchId: string,
  schoolId: string,
  policy: { fresh: SamplePolicy; stock: SamplePolicy },
): Promise<CutTotals> {
  const batch = await tx.cookingBatch.findUniqueOrThrow({
    where: { id: batchId },
    select: {
      batchCode: true,
      menuDayId: true,
      mealType: true,
      MenuDay: { select: { menuDate: true } },
      dishes: {
        select: {
          dishId: true,
          sampleRatio: true,
          Dish: {
            select: {
              dishIngredientEntries: {
                orderBy: { ingredientEntryId: "asc" },
                select: {
                  ingredientEntryId: true,
                  ingredientRole: true,
                  requiredQuantity: true,
                  unit: true,
                  IngredientEntry: {
                    select: {
                      wasteRate: true,
                      handlingType: true,
                      Ingredient: { select: { name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      cookingBatchLots: {
        select: {
          dishId: true,
          ingredientLotId: true,
          quantityUsed: true,
          sampleQuantity: true,
          unit: true,
          IngredientLot: {
            select: {
              status: true,
              DeliveryItem: {
                select: {
                  ingredientEntryId: true,
                  SupplyRequestItem: { select: { ingredientEntryId: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  const shared = new Set(
    (
      await tx.menuMealSeasoning.findMany({
        where: { menuDayId: batch.menuDayId, mealType: batch.mealType },
        select: { ingredientEntryId: true },
      })
    ).map(({ ingredientEntryId }) => ingredientEntryId),
  );
  const cut: CutTotals = new Map();
  for (const dish of batch.dishes) {
    if (!dish.sampleRatio) continue;
    const standard = dish.Dish.dishIngredientEntries.filter(
      (line) => !shared.has(line.ingredientEntryId),
    );
    const lines = sampleLines(
      standard.map((line) => ({
        ingredientEntryId: line.ingredientEntryId,
        ingredientName: line.IngredientEntry.Ingredient.name,
        ingredientRole: line.ingredientRole,
        requiredQuantity: line.requiredQuantity,
        unit: line.unit,
        wasteRate: line.IngredientEntry.wasteRate,
      })),
      dish.sampleRatio,
    );
    const rows = batch.cookingBatchLots
      .filter((row) => row.dishId === dish.dishId)
      .map((row) => ({
        ...row,
        entryId:
          row.IngredientLot.DeliveryItem.ingredientEntryId ??
          row.IngredientLot.DeliveryItem.SupplyRequestItem?.ingredientEntryId ??
          null,
      }));
    for (const line of lines) {
      if (!line.gross.gt(0)) continue;
      const kind = standard.find(
        (row) => row.ingredientEntryId === line.ingredientEntryId,
      )!.IngredientEntry.handlingType;
      const wanted = kind === "DIRECT_USE" ? policy.fresh : policy.stock;
      const candidates = rows
        .filter((row) => row.entryId === line.ingredientEntryId)
        .sort((a, b) =>
          convertQuantity(b.quantityUsed, b.unit, line.unit).comparedTo(
            convertQuantity(a.quantityUsed, a.unit, line.unit),
          ),
        );
      const where = (lotId: string) => ({
        cookingBatchId_dishId_ingredientLotId: {
          cookingBatchId: batchId,
          dishId: dish.dishId,
          ingredientLotId: lotId,
        },
      });
      if (wanted === "CUT") {
        const row = candidates.find((candidate) =>
          candidate.quantityUsed.gt(needIn(line, candidate.unit)),
        );
        if (row) {
          const need = needIn(line, row.unit);
          await tx.cookingBatchLot.update({
            where: where(row.ingredientLotId),
            data: {
              quantityUsed: { decrement: need },
              sampleQuantity: { increment: need },
            },
          });
          row.quantityUsed = row.quantityUsed.sub(need);
          addCut(cut, line.ingredientEntryId, need, row.unit);
          continue;
        }
        if (kind === "DIRECT_USE")
          throw new HttpError(
            409,
            `Mẻ ${batch.batchCode ?? ""} không đủ ${line.ingredientName ?? "nguyên liệu"} để cắt lưu mẫu`,
          );
      }
      if (wanted === "TOP_UP") {
        const row = candidates.find(
          (candidate) => candidate.IngredientLot.status === "BLOCKED",
        );
        if (row) {
          await tx.cookingBatchLot.update({
            where: where(row.ingredientLotId),
            data: { sampleQuantity: { increment: needIn(line, row.unit) } },
          });
          continue;
        }
      }
      // STOCK hoặc phương án dự phòng: giữ thêm từ tồn kho còn trống.
      let remaining = line.gross;
      for (const lot of await freeStockLots(
        tx,
        schoolId,
        batch.MenuDay.menuDate,
        line.ingredientEntryId,
      )) {
        if (!remaining.gt(0)) break;
        const available = convertQuantity(lot.free, lot.unit, line.unit);
        const part = Decimal.min(available, remaining);
        const amount = Decimal.min(
          ceilToThree(convertQuantity(part, line.unit, lot.unit)),
          lot.free,
        );
        if (!amount.gt(0)) continue;
        await tx.cookingBatchLot.upsert({
          where: where(lot.id),
          create: {
            cookingBatchId: batchId,
            dishId: dish.dishId,
            ingredientLotId: lot.id,
            quantityUsed: 0,
            sampleQuantity: amount,
            unit: lot.unit,
          },
          update: { sampleQuantity: { increment: amount } },
        });
        remaining = remaining.sub(part);
      }
      if (remaining.gt(new Decimal("0.0005")))
        throw new HttpError(
          409,
          `Không đủ ${line.ingredientName ?? "nguyên liệu"} trong kho để lưu mẫu`,
        );
    }
  }
  return cut;
}

/**
 * Phần mẫu của gia vị dùng chung của bữa (D13): Σ nhu cầu của các mẻ trong bữa.
 * CUT: trừ khỏi lượng giữ cho bữa (bù ở Đợt 2); STOCK: giữ thêm từ kho.
 */
export async function applyMealSeasoningSample(
  tx: Tx,
  meal: RoundMeal,
  batchIds: readonly string[],
  policy: "CUT" | "STOCK",
): Promise<CutTotals> {
  const cut: CutTotals = new Map();
  if (!batchIds.length) return cut;
  const seasonings = await tx.menuMealSeasoning.findMany({
    where: meal,
    select: { ingredientEntryId: true },
  });
  if (!seasonings.length) return cut;
  const shared = new Set(seasonings.map((row) => row.ingredientEntryId));
  const needs = new Map<string, { quantity: D; unit: string }>();
  const batches = await tx.cookingBatchDish.findMany({
    where: { cookingBatchId: { in: [...batchIds] } },
    select: {
      sampleRatio: true,
      Dish: {
        select: {
          dishIngredientEntries: {
            select: {
              ingredientEntryId: true,
              ingredientRole: true,
              requiredQuantity: true,
              unit: true,
              IngredientEntry: { select: { wasteRate: true } },
            },
          },
        },
      },
    },
  });
  for (const batch of batches) {
    if (!batch.sampleRatio) continue;
    const lines = sampleLines(
      batch.Dish.dishIngredientEntries
        .filter((line) => shared.has(line.ingredientEntryId))
        .map((line) => ({
          ingredientEntryId: line.ingredientEntryId,
          ingredientRole: line.ingredientRole,
          requiredQuantity: line.requiredQuantity,
          unit: line.unit,
          wasteRate: line.IngredientEntry.wasteRate,
        })),
      batch.sampleRatio,
    );
    for (const line of lines) {
      const current = needs.get(line.ingredientEntryId);
      if (!current)
        needs.set(line.ingredientEntryId, {
          quantity: line.gross,
          unit: line.unit,
        });
      else
        current.quantity = current.quantity.add(
          convertQuantity(line.gross, line.unit, current.unit),
        );
    }
  }
  const rows = await repository.seasoningLots(tx, meal);
  const lots = await tx.ingredientLot.findMany({
    where: { id: { in: rows.map((row) => row.ingredientLotId) } },
    select: { id: true, unit: true, availableQuantity: true },
  });
  const reserved = await reservedQuantities(tx, lots);
  for (const [entryId, need] of needs) {
    let remaining = need.quantity;
    const entryRows = rows
      .filter((row) => row.ingredientEntryId === entryId)
      .sort((a, b) => b.quantityUsed.comparedTo(a.quantityUsed));
    for (const row of entryRows) {
      if (!remaining.gt(0)) break;
      const wanted = ceilToThree(
        convertQuantity(remaining, need.unit, row.unit),
      );
      if (policy === "CUT" && row.quantityUsed.gt(wanted)) {
        await tx.menuMealSeasoningLot.update({
          where: { id: row.id },
          data: {
            quantityUsed: { decrement: wanted },
            sampleQuantity: { increment: wanted },
          },
        });
        addCut(cut, entryId, wanted, row.unit);
        remaining = new Decimal(0);
        break;
      }
      const lot = lots.find((item) => item.id === row.ingredientLotId);
      if (!lot) continue;
      const free = convertQuantity(
        lot.availableQuantity.sub(reserved.get(lot.id) ?? 0),
        lot.unit,
        row.unit,
      ).toDecimalPlaces(3, Decimal.ROUND_DOWN);
      const amount = Decimal.min(free, wanted);
      if (!amount.gt(0)) continue;
      await repository.addSeasoningSample(tx, row.id, amount);
      reserved.set(
        lot.id,
        (reserved.get(lot.id) ?? new Decimal(0)).add(
          convertQuantity(amount, row.unit, lot.unit),
        ),
      );
      remaining = remaining.sub(convertQuantity(amount, row.unit, need.unit));
    }
    if (remaining.gt(new Decimal("0.0005")))
      throw new HttpError(409, "Không đủ gia vị dùng chung để lưu mẫu");
  }
  return cut;
}

/** Đợt 2 thêm suất cho bữa: nới lượng gia vị đã giữ theo tổng suất (V9). */
async function extendMealSeasonings(
  tx: Tx,
  meal: RoundMeal,
  schoolId: string,
  menuDate: Date,
  totalPortions: number,
  mode: CookingMode,
) {
  const rows = await repository.seasoningLots(tx, meal);
  if (!rows.length) {
    await reserveMealSeasonings(
      tx,
      meal,
      schoolId,
      menuDate,
      totalPortions,
      mode,
    );
    return;
  }
  if (rows.every((row) => row.plannedPortions >= totalPortions)) return;
  const standards = await tx.menuMealSeasoning.findMany({ where: meal });
  const lots = await tx.ingredientLot.findMany({
    where: { id: { in: rows.map((row) => row.ingredientLotId) } },
    select: { id: true, unit: true, availableQuantity: true },
  });
  const reserved = await reservedQuantities(tx, lots);
  for (const standard of standards) {
    const entryRows = rows.filter(
      (row) => row.ingredientEntryId === standard.ingredientEntryId,
    );
    if (!entryRows.length) continue;
    const added = totalPortions - entryRows[0].plannedPortions;
    if (added <= 0) continue;
    let remaining = standard.quantityPerPortion.mul(added);
    for (const row of entryRows) {
      const lot = lots.find((item) => item.id === row.ingredientLotId)!;
      const free = convertQuantity(
        lot.availableQuantity.sub(reserved.get(lot.id) ?? 0),
        lot.unit,
        standard.unit,
      );
      const part = Decimal.min(free, remaining);
      const amount = ceilToThree(
        convertQuantity(part, standard.unit, row.unit),
      );
      if (amount.gt(0))
        await tx.menuMealSeasoningLot.update({
          where: { id: row.id },
          data: { quantityUsed: { increment: amount } },
        });
      remaining = remaining.sub(part);
    }
    // Lô đã giữ ở Đợt 1 không đủ: lấy tiếp từ lô khác còn trống của cùng gia vị.
    if (remaining.gt(new Decimal("0.0005")))
      for (const lot of await readPlanningStock(
        tx,
        schoolId,
        menuDate,
        [standard.ingredientEntryId],
        true,
      )) {
        if (!remaining.gt(new Decimal("0.0005"))) break;
        if (entryRows.some((row) => row.ingredientLotId === lot.id)) continue;
        const free = new Decimal(lot.availableQuantity)
          .sub(lot.reservedQuantity)
          .toDecimalPlaces(3, Decimal.ROUND_DOWN);
        if (!free.gt(0)) continue;
        const part = Decimal.min(
          convertQuantity(free, lot.unit, standard.unit),
          remaining,
        );
        const amount = Decimal.min(
          ceilToThree(convertQuantity(part, standard.unit, lot.unit)),
          free,
        );
        if (!amount.gt(0)) continue;
        await tx.menuMealSeasoningLot.create({
          data: {
            ...meal,
            ingredientEntryId: standard.ingredientEntryId,
            ingredientLotId: lot.id,
            quantityUsed: amount,
            unit: lot.unit,
            plannedPortions: totalPortions,
          },
        });
        remaining = remaining.sub(part);
      }
    if (remaining.gt(new Decimal("0.0005")))
      throw new HttpError(
        409,
        "Không đủ gia vị dùng chung trong kho cho suất Đợt 2",
      );
  }
  await tx.menuMealSeasoningLot.updateMany({
    where: { ...meal, usedAt: null },
    data: { plannedPortions: totalPortions },
  });
}

interface MealPlan {
  meal: RoundMeal;
  dishId: string;
  dishName: string;
  portions: number;
  menu: PlanMenu;
  recipe: ReturnType<typeof menuLines>;
  lines: SampleLine[];
  standard: D;
  unit: string;
  ratio: ReturnType<typeof sampleRatio>;
  fallback: {
    ingredientId: string;
    quantityPerPortion: string;
    unit: string;
  }[];
}

/** The caller holds the round advisory lock. */
export async function planRoundDish(
  tx: Tx,
  round: RoundKey & { id: string },
  occurrences: readonly RoundOccurrence[],
  actorId: string,
  phase: RoundPhase,
) {
  const { schoolId, deliveryDate } = round;
  const school = await kitchenRepository.findSchoolContext(tx, schoolId);
  if (!school?.cookingMode)
    throw new HttpError(409, "BGH cần cấu hình chế độ nấu trước");
  const mode: CookingMode =
    phase === "ROUND1_NO_FRESH" ? "COMBINE_LOTS" : school.cookingMode;
  const meals = occurrences.map(mealKey);
  await repository.lockMenus(
    tx,
    meals.map(({ menuDayId }) => menuDayId),
  );
  const context = await demandContext(
    tx,
    round,
    schoolId,
    phase === "ROUND1_NO_FRESH",
  );
  const policy = await organizationRepository.findSamplePolicy(schoolId, tx);
  const plans: MealPlan[] = [];
  for (const [index, meal] of meals.entries()) {
    const occurrence = occurrences[index];
    if (
      !(meal.mealType === "LUNCH" ? school.lunchTime : school.afternoonMealTime)
    )
      throw new HttpError(409, "BGH cần cấu hình giờ phục vụ bữa ăn trước");
    const menu = await kitchenRepository.findPlanMeal(
      tx,
      meal.menuDayId,
      meal.mealType,
      schoolId,
    );
    const dish = menu?.menuDayDishes.find(
      ({ dishId }) => dishId === occurrence.dishId,
    );
    if (
      !menu ||
      !dish ||
      menu.approvalStatus !== "APPROVED" ||
      dish.Dish.status !== "ACTIVE"
    )
      throw new HttpError(409, "Món không còn trong thực đơn đã duyệt");
    const portions = mealPortions(round.batchNo, menu, context);
    if (!portions) continue;
    if (round.batchNo === 1) {
      const previous = await kitchenRepository.listMealBatches(tx, meal);
      if (
        previous.some(
          (batch) =>
            batch.status !== "CANCELLED" &&
            batch.dishes.some(({ dishId }) => dishId === occurrence.dishId),
        )
      )
        throw new HttpError(
          409,
          "Món đã có mẻ trong bữa ăn; cần đối chiếu trước khi lập mẻ theo đợt",
        );
    }
    const shared = new Set(
      menu.mealSeasonings.map(({ ingredientEntryId }) => ingredientEntryId),
    );
    const allLines = menuLines(dish);
    if (!allLines.length)
      throw new HttpError(
        409,
        "Thiếu định mức chính thức của món trong thực đơn",
      );
    if (
      await kitchenRepository.hasRecipeAllergy(
        tx,
        deliveryDate,
        meal.mealType,
        schoolId,
        allLines.map((line) => line.ingredientEntryId),
        meal.menuDayId,
      )
    )
      throw new HttpError(
        409,
        "Nhu cầu có dị ứng liên quan công thức; cần phương án món phù hợp trước khi lập mẻ",
      );
    const recipe = allLines.filter(
      (line) => !shared.has(line.ingredientEntryId),
    );
    const standardLines = occurrence.Dish.dishIngredientEntries.map((line) => {
      if (line.IngredientEntry.schoolId !== schoolId)
        throw new HttpError(409, "Nguyên liệu món không thuộc trường");
      return {
        ingredientEntryId: line.ingredientEntryId,
        ingredientName: line.IngredientEntry.Ingredient.name,
        ingredientRole: line.ingredientRole,
        requiredQuantity: line.requiredQuantity,
        unit: line.unit,
        wasteRate: line.IngredientEntry.wasteRate,
      };
    });
    if (!standardLines.length)
      throw new HttpError(409, "Thiếu công thức mốc chuẩn của món");
    const standard = occurrence.Dish.standardQuantity;
    const { amount, unit } = sampleAmountFor(
      occurrence.Dish.standardUnit,
      policy,
    );
    const ratio = sampleRatio(standard, amount, standardLines);
    plans.push({
      meal,
      dishId: dish.dishId,
      dishName: occurrence.Dish.name,
      portions,
      menu,
      recipe: recipe.length ? recipe : allLines,
      lines: sampleLines(standardLines, ratio.ratio).filter(
        (line) => !shared.has(line.ingredientEntryId),
      ),
      standard,
      unit,
      ratio,
      fallback: dish.ingredients.map((line) => ({
        ingredientId: line.ingredientId,
        quantityPerPortion: line.quantityPerPortion.toString(),
        unit: line.unit,
      })),
    });
  }
  if (!plans.length)
    throw new HttpError(409, "Chưa có số suất của đợt cho món trong thực đơn");

  const entryIds = [
    ...new Set(
      plans.flatMap((plan) =>
        plan.recipe.map((line) => line.ingredientEntryId),
      ),
    ),
  ];
  const kinds = new Map(
    (await samples.entryKinds(tx, entryIds)).map((row) => [
      row.id,
      row.handlingType,
    ]),
  );
  const roundLots =
    phase === "ROUND1_NO_FRESH"
      ? []
      : await samples.roundLots(tx, round, entryIds);
  const round1 =
    round.batchNo === 2
      ? await repository.findByKey(tx, { ...round, batchNo: 1 })
      : null;
  const cutting =
    (phase === "ROUND1" && mode === "SEPARATE_BY_LOT") ||
    phase === "ROUND2_SEPARATE";

  const round1Context =
    round.batchNo === 2
      ? { gradePortions: context.gradePortions, actualByGrade: null }
      : null;
  for (const plan of plans) {
    const key = consumerKey(plan.meal, plan.dishId);
    // Gia vị dùng chung giữ theo tổng suất của bữa.
    // Các món cùng bữa dùng chung lượng gia vị đã giữ (có thể đã cắt mẫu): chỉ giữ lần đầu.
    if (round.batchNo === 1) {
      if (!(await repository.seasoningLots(tx, plan.meal)).length)
        await reserveMealSeasonings(
          tx,
          plan.meal,
          schoolId,
          deliveryDate,
          plan.portions,
          mode,
        );
    } else
      await extendMealSeasonings(
        tx,
        plan.meal,
        schoolId,
        deliveryDate,
        mealPortions(1, plan.menu, round1Context!) + plan.portions,
        mode,
      );

    const leftovers =
      round1 && round.batchNo === 2
        ? await samples.activeLeftovers(tx, round1.id, plan.meal, plan.dishId)
        : [];
    const leftoverLots = leftovers.map((row) => ({
      rowId: row.id,
      lot: {
        id: row.ingredientLotId,
        ingredientEntryId:
          row.ingredientLot.DeliveryItem.ingredientEntryId ??
          row.ingredientLot.DeliveryItem.SupplyRequestItem?.ingredientEntryId ??
          "",
        quantity: row.quantity,
        unit: row.unit,
        sourceFacilityId:
          row.ingredientLot.sourceFacilityId ??
          row.ingredientLot.DeliveryItem.sourceFacilityId ??
          null,
      } satisfies SupplyLot,
    }));
    const fresh: FreshLine[] = [];
    const stockLines: typeof plan.recipe = [];
    for (const line of plan.recipe) {
      const ownLots = roundLots.filter(
        (lot) => lot.ingredientEntryId === line.ingredientEntryId,
      );
      const extra = leftoverLots
        .filter(({ lot }) => lot.ingredientEntryId === line.ingredientEntryId)
        .map(({ lot }) => lot);
      if (
        kinds.get(line.ingredientEntryId) !== "DIRECT_USE" ||
        (!ownLots.length && !extra.length)
      ) {
        stockLines.push(line);
        continue;
      }
      const consumers =
        context.demands.get(line.ingredientEntryId) ?? new Map<string, D>();
      const keys = [...consumers.keys()];
      const position = keys.indexOf(key);
      const lots: SupplyLot[] = ownLots.flatMap((lot) => {
        const share =
          position < 0
            ? lot.quantity
            : splitLotByDemand(lot.quantity, [...consumers.values()], lot.unit)[
                position
              ];
        return share.gt(0)
          ? [
              {
                id: lot.id,
                ingredientEntryId: lot.ingredientEntryId,
                quantity: share,
                unit: lot.unit,
                sourceFacilityId: lot.sourceFacilityId,
              },
            ]
          : [];
      });
      fresh.push({
        ingredientEntryId: line.ingredientEntryId,
        ingredientName: line.ingredientName,
        perPortion: line.quantityPerPortion,
        unit: line.unit,
        lots: [...lots, ...extra],
      });
    }
    const stockLots = await readPlanningStock(
      tx,
      schoolId,
      deliveryDate,
      stockLines.map((line) => line.ingredientEntryId),
      true,
    );
    const stock: StockLine[] = stockLines.map((line) => ({
      ingredientEntryId: line.ingredientEntryId,
      ingredientName: line.ingredientName,
      perPortion: line.quantityPerPortion,
      unit: line.unit,
      lots: stockLots
        .filter((lot) => lot.ingredientEntryId === line.ingredientEntryId)
        .map((lot) => ({
          id: lot.id,
          ingredientEntryId: lot.ingredientEntryId,
          quantity: new Decimal(lot.availableQuantity).sub(
            lot.reservedQuantity,
          ),
          unit: lot.unit,
          sourceFacilityId: lot.sourceFacilityId ?? null,
        }))
        .filter((lot) => lot.quantity.gt(0)),
    }));
    const minimum = cutting
      ? new Map(
          fresh.flatMap((line) => {
            const sample = plan.lines.find(
              (row) => row.ingredientEntryId === line.ingredientEntryId,
            );
            return sample
              ? [[line.ingredientEntryId, needIn(sample, line.unit)] as const]
              : [];
          }),
        )
      : undefined;
    const result = planBatchesByLots({
      portions: new Decimal(plan.portions),
      mode,
      fresh,
      stock,
      minimumPerBatch: minimum,
      absorbLeftovers: round.batchNo === 2,
    });
    if (phase === "ROUND1" && result.leftovers.length)
      await samples.createLeftovers(
        tx,
        result.leftovers.map((lot) => ({
          supplyRoundId: round.id,
          ...plan.meal,
          dishId: plan.dishId,
          ingredientLotId: lot.ingredientLotId,
          quantity: lot.quantity,
          unit: lot.unit,
        })),
      );
    const usedLeftovers = new Set(
      result.batches.flatMap((batch) =>
        batch.lots.map((lot) => lot.ingredientLotId),
      ),
    );
    const consumed = leftoverLots
      .filter(({ lot }) => usedLeftovers.has(lot.id))
      .map(({ rowId }) => rowId);
    await samples.releaseLeftovers(tx, consumed, new Date());
    const leftoverIds = new Set(leftoverLots.map(({ lot }) => lot.id));
    const freshEntries = new Set(fresh.map((line) => line.ingredientEntryId));
    const toRows = (lots: readonly PlannedLot[]) =>
      lots.map((lot) => ({
        ingredientLotId: lot.ingredientLotId,
        quantityUsed: lot.quantity.toFixed(3),
        unit: lot.unit,
      }));

    let batchesToCreate = result.batches;
    if (round.batchNo === 2) {
      const r1Rows = await repository.round1BatchesForMealDish(
        tx,
        plan.meal,
        plan.dishId,
      );
      const keyOf = (
        lots: readonly {
          ingredientEntryId: string;
          ingredientLotId: string;
          sourceFacilityId: string | null;
        }[],
      ) =>
        mode === "COMBINE_LOTS"
          ? plan.dishId
          : sourceKey(
              plan.dishId,
              lots.filter((lot) => freshEntries.has(lot.ingredientEntryId)),
              (lotId) =>
                lots.find((lot) => lot.ingredientLotId === lotId)
                  ?.sourceFacilityId ?? null,
            );
      const sourceOf = (lotId: string) =>
        [...roundLots, ...leftoverLots.map(({ lot }) => lot)].find(
          (lot) => lot.id === lotId,
        )?.sourceFacilityId ??
        stockLots.find((lot) => lot.id === lotId)?.sourceFacilityId ??
        null;
      const split = splitRound2(
        result.batches.map((batch) => ({
          dishId: plan.dishId,
          plannedPortions: 0,
          key: keyOf(
            batch.lots.map((lot) => ({
              ...lot,
              sourceFacilityId: sourceOf(lot.ingredientLotId),
            })),
          ),
          lots: [batch],
        })),
        r1Rows.map((batch) => ({
          cookingBatchId: batch.id,
          dishId: plan.dishId,
          status: batch.status,
          key: keyOf(
            batch.cookingBatchLots.map((lot) => ({
              ingredientEntryId:
                lot.IngredientLot.DeliveryItem.ingredientEntryId ?? "",
              ingredientLotId: lot.ingredientLotId,
              sourceFacilityId: lot.IngredientLot.sourceFacilityId,
            })),
          ),
        })),
      );
      for (const part of split.parts) {
        const lots: PlannedLot[] = [];
        let portions = new Decimal(0);
        for (const batch of part.lots) {
          portions = portions.add(batch.plannedPortions);
          for (const lot of batch.lots) {
            const existing = lots.find(
              (row) => row.ingredientLotId === lot.ingredientLotId,
            );
            if (existing)
              existing.quantity = existing.quantity.add(lot.quantity);
            else lots.push({ ...lot });
          }
        }
        await repository.createRoundPart(
          tx,
          {
            supplyRoundId: round.id,
            cookingBatchId: part.cookingBatchId,
            dishId: plan.dishId,
            plannedPortions: portions,
          },
          toRows(lots),
          phase === "ROUND2_COMBINE" ? actorId : null,
        );
      }
      batchesToCreate = split.newBatches.flatMap((batch) => batch.lots);
    }
    if (!batchesToCreate.length) continue;

    const [groupCode] = await reserveFpCodes(tx, "BG", 1);
    const codes = await reserveFpCodes(tx, "CB", batchesToCreate.length);
    const group = await kitchenRepository.createPlanGroup(tx, {
      ...plan.meal,
      supplyRoundId: round.id,
      createdByUserId: actorId,
      batchCode: groupCode,
    });
    const created: {
      id: string;
      policy: { fresh: SamplePolicy; stock: SamplePolicy } | null;
    }[] = [];
    for (const [index, batch] of batchesToCreate.entries()) {
      const usesLeftover = batch.lots.some((lot) =>
        leftoverIds.has(lot.ingredientLotId),
      );
      const strategy =
        phase === "ROUND1_NO_FRESH"
          ? "STOCK"
          : phase === "ROUND1"
            ? mode === "SEPARATE_BY_LOT"
              ? "CUT"
              : "ROUND2_ORDER"
            : phase === "ROUND2_COMBINE" || usesLeftover
              ? "CUT"
              : "TOP_UP";
      const samplePolicy: { fresh: SamplePolicy; stock: SamplePolicy } | null =
        strategy === "ROUND2_ORDER"
          ? null
          : strategy === "STOCK"
            ? { fresh: "STOCK", stock: "STOCK" }
            : strategy === "TOP_UP"
              ? { fresh: "TOP_UP", stock: "STOCK" }
              : phase === "ROUND1"
                ? { fresh: "CUT", stock: "CUT" }
                : { fresh: "CUT", stock: "STOCK" };
      const status =
        phase === "ROUND1" || phase === "ROUND1_NO_FRESH"
          ? "ROUND1_APPROVED"
          : phase === "ROUND2_COMBINE"
            ? "ROUND2_APPROVED"
            : "PENDING_APPROVAL";
      const child = await kitchenRepository.createPlannedChild(
        tx,
        {
          ...plan.meal,
          batchGroupId: group.id,
          batchCode: codes[index],
          batchNumber: index + 1,
          dishId: plan.dishId,
          cookingModeApplied: mode,
          createdByUserId: actorId,
          status,
          supplyBatchNo: round.batchNo,
          sampleStrategy: strategy,
          plannedPortions: batch.plannedPortions,
          dishes: {
            create: {
              dishId: plan.dishId,
              plannedPortions: batch.plannedPortions,
              sampleQuantity: plan.ratio.sampleQuantity,
              sampleRatio: plan.ratio.ratio,
              sampleUnit: plan.unit,
              standardQuantitySnapshot: plan.standard,
              allocationRecipeSnapshot: {
                version: 1,
                profiles: (plan.menu.WeeklyMenu?.grades ?? []).map(
                  ({ gradeId }) => ({ gradeId, lines: plan.fallback }),
                ),
                fallback: plan.fallback,
              },
            },
          },
        },
        toRows(batch.lots).map((row) => ({ ...row, dishId: plan.dishId })),
      );
      created.push({ id: child.id, policy: samplePolicy });
    }
    for (const batch of created)
      if (batch.policy)
        await applyBatchSample(tx, batch.id, schoolId, batch.policy);
    const cutBatches = created
      .filter((batch) => batch.policy?.fresh === "CUT")
      .map(({ id }) => id);
    const stockBatches = created
      .filter((batch) => batch.policy && batch.policy.fresh !== "CUT")
      .map(({ id }) => id);
    await applyMealSeasoningSample(
      tx,
      plan.meal,
      phase === "ROUND1" ? cutBatches : [],
      "CUT",
    );
    await applyMealSeasoningSample(
      tx,
      plan.meal,
      phase === "ROUND1" ? stockBatches : [...stockBatches, ...cutBatches],
      "STOCK",
    );
  }
  return randomUUID().replaceAll("-", "");
}

/**
 * Ghi lại phần bù lưu mẫu của Đợt 1 (V1): Σ phần đã cắt theo nguyên liệu ở mẻ CUT
 * và ở gia vị dùng chung của các bữa trong đợt.
 */
export async function refreshCompensations(
  tx: Tx,
  round1: RoundKey & { id: string },
) {
  const totals: CutTotals = new Map();
  for (const row of await samples.cutSampleRows(tx, round1.id)) {
    const entryId =
      row.IngredientLot.DeliveryItem.ingredientEntryId ??
      row.IngredientLot.DeliveryItem.SupplyRequestItem?.ingredientEntryId;
    if (entryId) addCut(totals, entryId, row.sampleQuantity, row.unit);
  }
  const occurrences = await repository.occurrences(tx, round1);
  const meals = [
    ...new Map(
      occurrences.map((row) => [
        `${row.menuDayId}|${row.mealType}`,
        mealKey(row),
      ]),
    ).values(),
  ];
  const hasCutBatch = await tx.cookingBatch.count({
    where: { BatchGroup: { supplyRoundId: round1.id }, sampleStrategy: "CUT" },
  });
  if (hasCutBatch && meals.length)
    for (const row of await repository.seasoningSamples(tx, meals)) {
      const entryId = row.ingredientLot.DeliveryItem.ingredientEntryId;
      if (entryId) addCut(totals, entryId, row.sampleQuantity, row.unit);
    }
  // Nấu chung (V14): mẻ Đợt 1 chưa lấy mẫu; phần mẫu đồ tươi của mỗi mẻ đặt luôn ở Đợt 2.
  const pending = await tx.cookingBatchDish.findMany({
    where: {
      CookingBatch: {
        BatchGroup: { supplyRoundId: round1.id },
        sampleStrategy: "ROUND2_ORDER",
        status: { notIn: ["CANCELLED", "COMPLETED"] },
      },
    },
    select: {
      sampleRatio: true,
      menuDayId: true,
      mealType: true,
      Dish: {
        select: {
          dishIngredientEntries: {
            select: {
              ingredientEntryId: true,
              ingredientRole: true,
              requiredQuantity: true,
              unit: true,
              IngredientEntry: {
                select: { wasteRate: true, handlingType: true },
              },
            },
          },
        },
      },
    },
  });
  for (const batch of pending) {
    if (!batch.sampleRatio) continue;
    const shared = new Set(
      (
        await tx.menuMealSeasoning.findMany({
          where: { menuDayId: batch.menuDayId, mealType: batch.mealType },
          select: { ingredientEntryId: true },
        })
      ).map(({ ingredientEntryId }) => ingredientEntryId),
    );
    const lines = sampleLines(
      batch.Dish.dishIngredientEntries
        .filter(
          (line) =>
            line.IngredientEntry.handlingType === "DIRECT_USE" &&
            !shared.has(line.ingredientEntryId),
        )
        .map((line) => ({
          ingredientEntryId: line.ingredientEntryId,
          ingredientRole: line.ingredientRole,
          requiredQuantity: line.requiredQuantity,
          unit: line.unit,
          wasteRate: line.IngredientEntry.wasteRate,
        })),
      batch.sampleRatio,
    );
    for (const line of lines)
      addCut(totals, line.ingredientEntryId, line.gross, line.unit);
  }
  const kinds = new Map(
    (await samples.entryKinds(tx, [...totals.keys()])).map((row) => [
      row.id,
      row.handlingType,
    ]),
  );
  await samples.replaceCompensations(
    tx,
    round1.id,
    [...totals].map(([ingredientEntryId, total]) => ({
      ingredientEntryId,
      kind: kinds.get(ingredientEntryId) === "DIRECT_USE" ? "FRESH" : "STOCK",
      sampleQuantity: total.quantity.toDecimalPlaces(3, Decimal.ROUND_UP),
      unit: total.unit,
    })),
  );
}
