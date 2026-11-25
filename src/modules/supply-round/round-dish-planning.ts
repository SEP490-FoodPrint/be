import { randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma/client";
import { reserveFpCodes } from "../../utils/fp-code";
import { HttpError } from "../../utils/http-error";
import { convertQuantity } from "../../utils/quantity-conversion";
import { grossFromNet } from "../../utils/waste-rate";
import { kitchenRepository } from "../kitchen/kitchen.repository";
import {
  planMealDishes,
  readPlanningStock,
  reserveMealSeasonings,
  type PlanningLot,
} from "../kitchen/kitchen.service";
import {
  assignSampleLots,
  sampleAmountFor,
  sampleLines,
  sampleRatio,
  seasoningSampleNeeds,
  sourceKey,
  splitRound2,
  type SampleLine,
} from "../kitchen/sample-planner";
import { organizationRepository } from "../organization/organization.repository";
import {
  supplyRoundRepository as repository,
  type RoundKey,
  type RoundMeal,
  type RoundOccurrence,
} from "./supply-round.repository";

type Tx = Prisma.TransactionClient;
const Decimal = Prisma.Decimal;

function mealKey(occurrence: RoundOccurrence): RoundMeal {
  if (occurrence.mealType !== "LUNCH" && occurrence.mealType !== "AFTERNOON")
    throw new HttpError(409, "Bữa ăn không thuộc kế hoạch theo đợt");
  return { menuDayId: occurrence.menuDayId, mealType: occurrence.mealType };
}

function toSampleStock(lot: PlanningLot) {
  return {
    ...lot,
    incoming: lot.incoming ?? false,
    sourceFacilityId: lot.sourceFacilityId ?? null,
    free: new Decimal(lot.availableQuantity).sub(lot.reservedQuantity),
  };
}

async function reserveSeasoningSamples(
  tx: Tx,
  meal: RoundMeal,
  stock: readonly PlanningLot[],
  shared: ReadonlySet<string>,
  samples: readonly { lines: readonly SampleLine[] }[],
) {
  const reserved = await repository.seasoningLots(tx, meal);
  const rows = stock.flatMap((lot) => {
    const row = reserved.find((entry) => entry.ingredientLotId === lot.id);
    return row ? [{ row, lot }] : [];
  });
  const unitFor = (id: string) => {
    const row = rows.find(({ row }) => row.ingredientEntryId === id)?.row;
    if (!row)
      throw new HttpError(409, "Thiếu lô gia vị dùng chung cho phần lưu mẫu");
    return row.unit;
  };
  const needs = seasoningSampleNeeds(samples, shared, unitFor);
  for (const [entryId, need] of needs) {
    const unit = unitFor(entryId);
    let remaining = need;
    for (const { row, lot } of rows) {
      if (row.ingredientEntryId !== entryId || remaining.eq(0)) continue;
      const free = convertQuantity(toSampleStock(lot).free, lot.unit, row.unit);
      const available = Decimal.max(0, free).toDecimalPlaces(
        3,
        Decimal.ROUND_DOWN,
      );
      const requested = convertQuantity(remaining, unit, row.unit);
      const allocated = lot.incoming
        ? requested
        : Decimal.min(requested, available);
      if (allocated.eq(0)) continue;
      await repository.addSeasoningSample(tx, row.id, allocated);
      remaining = remaining.sub(convertQuantity(allocated, row.unit, unit));
    }
    if (remaining.gt(0))
      throw new HttpError(409, "Không đủ gia vị dùng chung để lưu mẫu");
  }
}

/** The caller holds the round advisory lock. Lock all menu days, then all candidate lots. */
export async function planRoundOneDish(
  tx: Tx,
  round: RoundKey & { id: string },
  occurrences: readonly RoundOccurrence[],
  actorId: string,
) {
  const { schoolId, deliveryDate } = round;
  const school = await kitchenRepository.findSchoolContext(tx, schoolId);
  if (!school?.cookingMode)
    throw new HttpError(409, "Chưa có chế độ nấu. Liên hệ BGH.");
  const mode = school.cookingMode;
  const meals = occurrences.map(mealKey);
  await repository.lockMenus(
    tx,
    meals.map(({ menuDayId }) => menuDayId),
  );
  const gradePortions = await repository.gradePortions(tx, round);
  const actualByGrade =
    round.batchNo === 2
      ? await repository.actualGradePortions(tx, schoolId, deliveryDate)
      : null;
  const policy = await organizationRepository.findSamplePolicy(schoolId, tx);
  const entries = new Set<string>();
  const mealPlans = [];
  for (const [index, meal] of meals.entries()) {
    const occurrence = occurrences[index];
    if (
      !(meal.mealType === "LUNCH" ? school.lunchTime : school.afternoonMealTime)
    )
      throw new HttpError(409, "Chưa có giờ phục vụ. Liên hệ BGH.");
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
    const gradeIds = new Set(
      menu.WeeklyMenu?.grades.map(({ gradeId }) => gradeId),
    );
    const applicableGrades = gradePortions.filter(
      ({ gradeId }) => menu.WeeklyMenu?.isSchoolWide || gradeIds.has(gradeId),
    );
    const firstRoundPortions = applicableGrades.reduce(
      (sum, row) => sum + row.portions,
      0,
    );
    const portions = actualByGrade
      ? applicableGrades.reduce(
          (sum, row) =>
            sum +
            Math.max(0, (actualByGrade.get(row.gradeId) ?? 0) - row.portions),
          0,
        )
      : firstRoundPortions;
    if (!portions) continue;
    const previous = await kitchenRepository.listMealBatches(tx, meal);
    if (
      round.batchNo === 1 &&
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
    const shared = new Set(
      menu.mealSeasonings.map(({ ingredientEntryId }) => ingredientEntryId),
    );
    const allLines = dish.ingredients.map((line) => {
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
        ).toString(),
      };
    });
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
        "Món có chất gây dị ứng. Cần thay món hoặc lập suất riêng.",
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
      throw new HttpError(409, "Món chưa có công thức.");
    const standard = occurrence.Dish.standardQuantity;
    const { amount, unit } = sampleAmountFor(
      occurrence.Dish.standardUnit,
      policy,
    );
    const ratio = sampleRatio(standard, amount, standardLines);
    const lines = sampleLines(standardLines, ratio.ratio);
    for (const id of [
      ...shared,
      ...allLines.map((line) => line.ingredientEntryId),
      ...lines.map((line) => line.ingredientEntryId),
    ])
      entries.add(id);
    mealPlans.push({
      meal,
      menu,
      dish,
      occurrence,
      portions,
      mealSeasoningPortions: actualByGrade
        ? firstRoundPortions + portions
        : portions,
      shared,
      recipe: recipe.length ? recipe : allLines,
      lines,
      standard,
      unit,
      ratio,
    });
  }
  if (!mealPlans.length)
    throw new HttpError(409, "Chưa có số suất Đợt 1 cho món trong thực đơn");
  const entryIds = [...entries];
  await readPlanningStock(tx, schoolId, deliveryDate, entryIds, true, round);
  for (const plan of mealPlans) {
    const {
      meal,
      portions,
      shared,
      recipe,
      lines,
      dish,
      occurrence,
      ratio,
      unit,
      standard,
    } = plan;
    const survivingPortions = await repository.survivingPortionsForMealDish(
      tx,
      round.id,
      meal,
      dish.dishId,
    );
    const remainingPortions = Math.max(0, portions - survivingPortions);
    if (remainingPortions <= 0) continue;
    await reserveMealSeasonings(
      tx,
      meal,
      schoolId,
      deliveryDate,
      plan.mealSeasoningPortions,
      mode,
      { extend: round.batchNo === 2 },
    );
    const stock = await readPlanningStock(
      tx,
      schoolId,
      deliveryDate,
      entryIds,
      false,
      round,
    );
    const children = planMealDishes(
      [{ dishId: dish.dishId, portions: remainingPortions, recipe }],
      mode,
      stock,
    );
    const byLot = new Map(stock.map((lot) => [lot.id, lot]));
    let batchesToCreate = children;

    if (round.batchNo === 2) {
      const r1Rows = await repository.round1BatchesForMealDish(
        tx,
        meal,
        dish.dishId,
      );
      const sourceOf = (lotId: string) =>
        byLot.get(lotId)?.sourceFacilityId ?? null;
      const round1Batches = r1Rows.map((b) => ({
        cookingBatchId: b.id,
        dishId: dish.dishId,
        status: b.status,
        key:
          mode === "COMBINE_LOTS"
            ? dish.dishId
            : sourceKey(
                dish.dishId,
                b.cookingBatchLots
                  .map((l) => ({
                    ingredientEntryId:
                      l.IngredientLot.DeliveryItem.ingredientEntryId ?? "",
                    ingredientLotId: l.ingredientLotId,
                  }))
                  .filter((l) => l.ingredientEntryId),
                (lotId) =>
                  b.cookingBatchLots.find((l) => l.ingredientLotId === lotId)
                    ?.IngredientLot.sourceFacilityId ?? sourceOf(lotId),
              ),
      }));
      const plans = children.map((child) => {
        const lots = child.dishes[0].lots;
        return {
          dishId: dish.dishId,
          plannedPortions: child.plannedPortions,
          lots,
          key:
            mode === "COMBINE_LOTS"
              ? dish.dishId
              : sourceKey(
                  dish.dishId,
                  lots.map((l) => ({
                    ingredientEntryId: byLot.get(l.ingredientLotId)!
                      .ingredientEntryId,
                    ingredientLotId: l.ingredientLotId,
                  })),
                  sourceOf,
                ),
        };
      });
      const split = splitRound2(plans, round1Batches);
      for (const part of split.parts) {
        await repository.createRoundPart(
          tx,
          {
            supplyRoundId: round.id,
            cookingBatchId: part.cookingBatchId,
            dishId: part.dishId,
            plannedPortions: part.plannedPortions,
          },
          part.lots.map((l) => ({
            ingredientLotId: l.ingredientLotId,
            quantityUsed: l.quantityUsed,
            unit: l.unit,
          })),
        );
      }
      batchesToCreate = split.newBatches.map((b) => ({
        plannedPortions: b.plannedPortions,
        dishes: [
          {
            dishId: b.dishId,
            plannedPortions: b.plannedPortions,
            lots: [...b.lots],
          },
        ],
      }));
      if (!batchesToCreate.length) continue;
    }

    const usedForCooking = new Map<string, Prisma.Decimal>();
    for (const child of batchesToCreate) {
      for (const dish of child.dishes) {
        for (const lot of dish.lots) {
          const alreadyUsed =
            usedForCooking.get(lot.ingredientLotId) ?? new Decimal(0);
          usedForCooking.set(
            lot.ingredientLotId,
            alreadyUsed.add(lot.quantityUsed),
          );
        }
      }
    }
    const samples = batchesToCreate.map((child, index) => ({
      batchKey: String(index),
      dishId: dish.dishId,
      label: `${occurrence.Dish.name} (${index + 1})`,
      lines: lines.filter((line) => !shared.has(line.ingredientEntryId)),
      usedLots: child.dishes.flatMap((entry) =>
        entry.lots.map((lot) => ({
          ingredientEntryId: byLot.get(lot.ingredientLotId)!.ingredientEntryId,
          ingredientLotId: lot.ingredientLotId,
        })),
      ),
    }));
    const { allocations } = assignSampleLots(
      samples,
      stock.map((lot) => {
        const sampleStock = toSampleStock(lot);
        return {
          ...sampleStock,
          free: sampleStock.free.sub(usedForCooking.get(lot.id) ?? 0),
        };
      }),
      mode,
    );
    await reserveSeasoningSamples(
      tx,
      meal,
      stock,
      shared,
      batchesToCreate.map(() => ({ lines })),
    );
    const [groupCode] = await reserveFpCodes(tx, "BG", 1);
    const codes = await reserveFpCodes(tx, "CB", batchesToCreate.length);
    const group = await kitchenRepository.createPlanGroup(tx, {
      ...meal,
      supplyRoundId: round.id,
      createdByUserId: actorId,
      batchCode: groupCode,
    });
    const recipeEntries = new Set(recipe.map((line) => line.ingredientEntryId));
    const fallback = dish.ingredients
      .filter((line) =>
        line.ingredient.ingredientEntries.some(({ id }) =>
          recipeEntries.has(id),
        ),
      )
      .map((line) => ({
        ingredientId: line.ingredientId,
        quantityPerPortion: line.quantityPerPortion.toString(),
        unit: line.unit,
      }));
    for (const [index, child] of batchesToCreate.entries()) {
      const lots = new Map(
        child.dishes[0].lots.map((lot) => [
          lot.ingredientLotId,
          { ...lot, dishId: dish.dishId, sampleQuantity: "0" },
        ]),
      );
      for (const allocation of allocations.filter(
        (row) => row.batchKey === String(index),
      )) {
        const previous = lots.get(allocation.ingredientLotId);
        lots.set(allocation.ingredientLotId, {
          dishId: dish.dishId,
          ingredientLotId: allocation.ingredientLotId,
          unit: allocation.unit,
          quantityUsed: previous?.quantityUsed ?? "0",
          sampleQuantity: allocation.sampleQuantity.toString(),
        });
      }
      await kitchenRepository.createPlannedChild(
        tx,
        {
          ...meal,
          batchGroupId: group.id,
          batchCode: codes[index],
          batchNumber: index + 1,
          dishId: dish.dishId,
          cookingModeApplied: mode,
          createdByUserId: actorId,
          status: "PENDING_APPROVAL",
          supplyBatchNo: round.batchNo,
          plannedPortions: child.plannedPortions,
          dishes: {
            create: {
              dishId: dish.dishId,
              plannedPortions: child.plannedPortions,
              sampleQuantity: ratio.sampleQuantity,
              sampleRatio: ratio.ratio,
              sampleUnit: unit,
              standardQuantitySnapshot: standard,
              allocationRecipeSnapshot: {
                version: 1,
                profiles: (plan.menu.WeeklyMenu?.grades ?? []).map(
                  ({ gradeId }) => ({ gradeId, lines: fallback }),
                ),
                fallback,
              },
            },
          },
        },
        [...lots.values()],
      );
    }
  }
  return randomUUID().replaceAll("-", "");
}
