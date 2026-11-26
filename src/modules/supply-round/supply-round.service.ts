import { Prisma } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import { ROLES } from "../../constants/roles";
import {
  assertPermission,
  withSchoolTransaction,
} from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import {
  checkMealSeasoningStock,
  checkReservedStock,
  readPlanningStock,
  reservedQuantities,
} from "../kitchen/kitchen.service";
import { HttpError } from "../../utils/http-error";
import { evaluateBatch2Skip } from "../supply-order/fresh-demand.service";
import {
  applyBatchSample,
  applyMealSeasoningSample,
  planRoundDish,
  refreshCompensations,
  type RoundPhase,
} from "./round-dish-planning";
import {
  roundSampleRepository as samples,
  supplyRoundRepository as repository,
  type RoundKey,
  type RoundMeal,
  type RoundOccurrence,
  type RoundRequest,
} from "./supply-round.repository";
import { convertQuantity } from "../../utils/quantity-conversion";
import type {
  RoundApprovalDTO,
  RoundDishParamsDTO,
  RoundQueryDTO,
} from "./supply-round.request.dto";
import type {
  RoundSampleGroupDTO,
  RoundSampleLineDTO,
  SupplyRoundResponseDTO,
} from "./supply-round.response.dto";

type Tx = Prisma.TransactionClient;
type Round = NonNullable<Awaited<ReturnType<typeof repository.findByKey>>>;
const VIEW = "cooking_plan.view";
const APPROVE = "cooking_plan.approve";
const transactionOptions = { timeout: 30000 };

function schoolScope(principal: AuthPrincipal, permission: string) {
  assertPermission(principal, permission);
  if (
    principal.orgType !== "SCHOOL" ||
    !principal.schoolId ||
    (permission === APPROVE && principal.role !== ROLES.INGREDIENT_MANAGEMENT)
  )
    throw new HttpError(
      403,
      "Không có quyền thao tác với kế hoạch mẻ của trường",
    );
  return principal.schoolId;
}

function groupOccurrences(occurrences: RoundOccurrence[]) {
  const groups = new Map<string, RoundOccurrence[]>();
  for (const row of occurrences) {
    const list = groups.get(row.dishId) ?? [];
    list.push(row);
    groups.set(row.dishId, list);
  }
  return groups;
}

function usesRequest(occurrence: RoundOccurrence, request: RoundRequest) {
  const entries = new Set(
    occurrence.Dish.dishIngredientEntries.map(
      ({ ingredientEntryId }) => ingredientEntryId,
    ),
  );
  return request.supplyRequestItems.some(
    ({ ingredientEntryId, IngredientEntry }) =>
      IngredientEntry.handlingType === "DIRECT_USE" &&
      entries.has(ingredientEntryId),
  );
}

function isDeclared(request: RoundRequest) {
  return (
    ["ACCEPTED", "IN_PROGRESS", "COMPLETED"].includes(request.status) &&
    request.deliveries.length === 1 &&
    request.deliveries[0].preparationStage !== null
  );
}

function waitingRequests(
  occurrence: RoundOccurrence,
  requests: RoundRequest[],
) {
  return requests.filter(
    (request) => usesRequest(occurrence, request) && !isDeclared(request),
  );
}

async function refreshRoundStatus(tx: Tx, round: Round) {
  const plans = await repository.plans(tx, round.id);
  const status =
    plans.length && plans.every((plan) => plan.status === "APPROVED")
      ? "READY"
      : plans.some((plan) => plan.status !== "WAITING_SUPPLIERS")
        ? "IN_REVIEW"
        : "COLLECTING";
  if (status !== round.status)
    await repository.updateRoundStatus(tx, round.id, status);
  return status;
}

/** Chỉ Đợt 2 nấu riêng có giai đoạn chuẩn bị của chuyến (bước NCC xác nhận bổ sung lưu mẫu). */
async function refreshStages(
  tx: Tx,
  round: Round,
  requests: RoundRequest[],
  dishes: Map<string, RoundOccurrence[]>,
) {
  if (round.batchNo === 2) {
    const plans = await repository.plans(tx, round.id);
    const statusFor = new Map(plans.map((plan) => [plan.dishId, plan.status]));
    const roundSamples = await repository.batchSamples(tx, round.id);
    const topUpDeliveries = new Set(
      roundSamples.map(
        (sample) => sample.IngredientLot.DeliveryItem.Delivery.id,
      ),
    );
    for (const request of requests) {
      const delivery = request.deliveries[0];
      if (
        !delivery?.preparationStage ||
        delivery.status !== "PREPARING" ||
        delivery.preparationStage === "READY_TO_DISPATCH"
      )
        continue;
      const states = [...dishes.values()]
        .filter(([dish]) => usesRequest(dish, request))
        .map(([dish]) => statusFor.get(dish.dishId));
      if (
        (states.length || dishes.size) &&
        states.every((state) => state === "APPROVED")
      ) {
        await repository.setStage(
          tx,
          delivery.id,
          topUpDeliveries.has(delivery.id)
            ? "TOP_UP_PENDING"
            : "READY_TO_DISPATCH",
        );
      } else if (
        states.some(
          (state) => state === "PENDING_WAREHOUSE" || state === "APPROVED",
        )
      ) {
        await repository.setStage(tx, delivery.id, "PENDING_WAREHOUSE");
      }
    }
  }
  await refreshRoundStatus(tx, round);
}

async function phaseFor(tx: Tx, round: Round): Promise<RoundPhase> {
  const mode = await samples.cookingMode(tx, round.schoolId);
  if (round.batchNo === 2)
    return mode === "COMBINE_LOTS" ? "ROUND2_COMBINE" : "ROUND2_SEPARATE";
  const requests = await repository.requests(tx, round);
  return requests.length ? "ROUND1" : "ROUND1_NO_FRESH";
}

async function planOne(
  tx: Tx,
  round: Round,
  dishId: string,
  actorId: string,
  requested: boolean,
  phase: RoundPhase,
) {
  const requests = await repository.requests(tx, round);
  const occurrences = groupOccurrences(await repository.occurrences(tx, round));
  const matching = occurrences.get(dishId);
  const state = (await repository.plans(tx, round.id)).find(
    (plan) => plan.dishId === dishId,
  );
  if (!matching || !state) {
    if (requested)
      throw new HttpError(404, "Không tìm thấy món trong đợt giao");
    return;
  }
  if (
    state.status !== "WAITING_SUPPLIERS" &&
    state.status !== "REPLAN_REQUIRED" &&
    !(requested && state.status === "PLAN_FAILED")
  ) {
    if (requested)
      throw new HttpError(
        409,
        "Trạng thái món không cho phép lập lại kế hoạch",
      );
    return;
  }
  if (
    phase === "ROUND2_SEPARATE" &&
    waitingRequests(matching[0], requests).length
  ) {
    if (requested)
      throw new HttpError(409, "Chưa đủ nhà cung cấp khai báo lô cho món");
    return;
  }
  await repository.beginDish(tx);
  try {
    if (phase === "ROUND2_SEPARATE") {
      const round1 = await repository.findByKey(tx, { ...round, batchNo: 1 });
      await samples.resetRound2Dish(tx, round.id, round1?.id ?? null, dishId);
    }
    const planVersion = await planRoundDish(
      tx,
      round,
      matching,
      actorId,
      phase,
    );
    // Đợt 1 và Đợt 2 nấu chung tự động, kho không duyệt (V12, V14).
    await repository.updatePlan(
      tx,
      round.id,
      dishId,
      phase === "ROUND2_SEPARATE"
        ? { status: "PENDING_WAREHOUSE", planVersion, failureMessage: null }
        : {
            status: "APPROVED",
            planVersion,
            failureMessage: null,
            approvedAt: new Date(),
            approvedByUserId: actorId,
          },
    );
  } catch (error) {
    await repository.rollbackDish(tx);
    if (!(error instanceof HttpError))
      console.warn("Supply round planning failed", {
        dishId,
        name: error instanceof Error ? error.name : "unknown",
      });
    await repository.updatePlan(tx, round.id, dishId, {
      status: "PLAN_FAILED",
      planVersion: null,
      failureMessage:
        error instanceof HttpError
          ? error.message
          : "Không thể lập mẻ cho món. Vui lòng thử lại.",
      approvedAt: null,
      approvedByUserId: null,
    });
  }
  await repository.releaseDish(tx);
  await refreshStages(tx, round, requests, occurrences);
}

/** Đợt 1 xong lập mẻ: ghi phần bù (chỉ khi Đợt 2 chưa có đơn, V7 khóa phần bù đã đặt). */
async function afterRound1Planned(tx: Tx, round: Round, phase: RoundPhase) {
  const second = { ...round, batchNo: 2 };
  if (phase === "ROUND1_NO_FRESH") {
    // V34: ngày không đồ tươi không có Đợt 2.
    if (!(await repository.findByKey(tx, second)))
      await repository.markNotNeeded(tx, second, new Date());
    return;
  }
  if (!(await repository.requests(tx, second)).length)
    await refreshCompensations(tx, round);
}

async function reconcile(key: RoundKey, actorId: string, forced?: RoundPhase) {
  const database = await getPrisma();
  const queue = await database.$transaction(async (tx) => {
    await repository.lock(tx, key);
    const round =
      (await repository.findByKey(tx, key)) ??
      (await repository.create(tx, key));
    if (round.status === "CLOSED" || round.status === "NOT_NEEDED") return null;
    const dishes = groupOccurrences(await repository.occurrences(tx, key));
    const ids = [...dishes.keys()];
    await repository.ensurePlans(tx, round.id, ids);
    return {
      roundId: round.id,
      ids,
      phase: forced ?? (await phaseFor(tx, round)),
    };
  }, transactionOptions);
  if (!queue) return;
  for (const dishId of queue.ids) {
    await database.$transaction(async (tx) => {
      await repository.lock(tx, key);
      const round = await repository.findById(tx, key.schoolId, queue.roundId);
      if (!round || round.status === "CLOSED" || round.status === "NOT_NEEDED")
        return;
      await planOne(tx, round, dishId, actorId, false, queue.phase);
    }, transactionOptions);
  }
  if (key.batchNo === 1)
    await database.$transaction(async (tx) => {
      await repository.lock(tx, key);
      const round = await repository.findById(tx, key.schoolId, queue.roundId);
      if (round) await afterRound1Planned(tx, round, queue.phase);
    }, transactionOptions);
}

/** Mọi chuyến của các đơn đồ tươi trong đợt đã nhận (có ít nhất một đơn). */
function allReceived(requests: RoundRequest[]) {
  return (
    requests.length > 0 &&
    requests.every(
      ({ deliveries }) =>
        deliveries.length > 0 &&
        deliveries.every(({ status }) => status === "RECEIVED"),
    )
  );
}

/**
 * Đợt 2 đã có hàng: trả lại phần đồ khô và gia vị đã cắt ở Đợt 1 bằng tồn kho (V9, V16).
 * Phần đồ tươi đã nằm trong lượng đặt Đợt 2 (V5, V18).
 */
async function restoreStockCompensations(tx: Tx, round1: Round) {
  const compensations = (await samples.compensations(tx, round1.id)).filter(
    (row) => row.kind === "STOCK",
  );
  if (!compensations.length) return;
  const rows = await samples.cutSampleRows(tx, round1.id);
  const occurrences = await repository.occurrences(tx, round1);
  const meals = [
    ...new Map(
      occurrences.map((row) => [
        `${row.menuDayId}|${row.mealType}`,
        { menuDayId: row.menuDayId, mealType: row.mealType },
      ]),
    ).values(),
  ];
  const EPS = new Prisma.Decimal("0.0005");
  const freeOf = async (lotId: string) => {
    const lot = await tx.ingredientLot.findUniqueOrThrow({
      where: { id: lotId },
      select: { id: true, unit: true, availableQuantity: true },
    });
    return {
      unit: lot.unit,
      free: lot.availableQuantity
        .sub(await reservedQuantitiesFor(tx, lot))
        .toDecimalPlaces(3, Prisma.Decimal.ROUND_DOWN),
    };
  };
  /**
   * Trả `want` (đơn vị `unit`) vào nơi đã cắt: ưu tiên đúng lô cũ, hết chỗ thì lô khác cùng nguyên liệu.
   * Trả về lượng đã trả được (đơn vị `unit`).
   */
  const restore = async (
    entryId: string,
    unit: string,
    want: Prisma.Decimal,
    lotId: string,
    addSame: (quantity: Prisma.Decimal) => Promise<unknown>,
    addOther: (
      lot: { id: string; unit: string },
      quantity: Prisma.Decimal,
    ) => Promise<unknown>,
  ) => {
    let rest = want;
    const same = await freeOf(lotId);
    const sameTake = Prisma.Decimal.min(
      convertQuantity(same.free, same.unit, unit).toDecimalPlaces(
        3,
        Prisma.Decimal.ROUND_DOWN,
      ),
      rest,
    );
    if (sameTake.gt(0)) {
      await addSame(sameTake);
      rest = rest.sub(sameTake);
    }
    if (rest.gt(EPS))
      for (const lot of await readPlanningStock(
        tx,
        round1.schoolId,
        round1.deliveryDate,
        [entryId],
        true,
      )) {
        if (!rest.gt(EPS)) break;
        if (lot.id === lotId) continue;
        const free = new Prisma.Decimal(lot.availableQuantity)
          .sub(lot.reservedQuantity)
          .toDecimalPlaces(3, Prisma.Decimal.ROUND_DOWN);
        const amount = Prisma.Decimal.min(
          free,
          convertQuantity(rest, unit, lot.unit).toDecimalPlaces(
            3,
            Prisma.Decimal.ROUND_UP,
          ),
        );
        if (!amount.gt(0)) continue;
        await addOther(lot, amount);
        rest = rest.sub(convertQuantity(amount, lot.unit, unit));
      }
    return want.sub(Prisma.Decimal.max(rest, 0));
  };
  for (const compensation of compensations) {
    const entryId = compensation.ingredientEntryId;
    let remaining = compensation.sampleQuantity;
    // 1) Mỗi mẻ đã cắt được bù đúng phần của mình.
    for (const row of rows) {
      if (!remaining.gt(EPS)) break;
      const rowEntry =
        row.IngredientLot.DeliveryItem.ingredientEntryId ??
        row.IngredientLot.DeliveryItem.SupplyRequestItem?.ingredientEntryId;
      if (rowEntry !== entryId) continue;
      const want = Prisma.Decimal.min(
        row.sampleQuantity,
        convertQuantity(remaining, compensation.unit, row.unit),
      );
      const batchKey = {
        cookingBatchId: row.cookingBatchId,
        dishId: row.dishId,
      };
      const restored = await restore(
        entryId,
        row.unit,
        want,
        row.ingredientLotId,
        (quantity) =>
          tx.cookingBatchLot.update({
            where: {
              cookingBatchId_dishId_ingredientLotId: {
                ...batchKey,
                ingredientLotId: row.ingredientLotId,
              },
            },
            data: { quantityUsed: { increment: quantity } },
          }),
        (lot, quantity) =>
          tx.cookingBatchLot.upsert({
            where: {
              cookingBatchId_dishId_ingredientLotId: {
                ...batchKey,
                ingredientLotId: lot.id,
              },
            },
            create: {
              ...batchKey,
              ingredientLotId: lot.id,
              quantityUsed: quantity,
              unit: lot.unit,
            },
            update: { quantityUsed: { increment: quantity } },
          }),
      );
      remaining = remaining.sub(
        convertQuantity(restored, row.unit, compensation.unit),
      );
    }
    // 2) Phần còn lại là gia vị dùng chung đã cắt ở các bữa.
    for (const meal of meals)
      for (const row of await repository.seasoningLots(tx, meal)) {
        if (!remaining.gt(EPS)) break;
        if (row.ingredientEntryId !== entryId || !row.sampleQuantity.gt(0))
          continue;
        const want = Prisma.Decimal.min(
          row.sampleQuantity,
          convertQuantity(remaining, compensation.unit, row.unit),
        );
        const restored = await restore(
          entryId,
          row.unit,
          want,
          row.ingredientLotId,
          (quantity) =>
            tx.menuMealSeasoningLot.update({
              where: { id: row.id },
              data: { quantityUsed: { increment: quantity } },
            }),
          (lot, quantity) =>
            tx.menuMealSeasoningLot.upsert({
              where: {
                menuDayId_mealType_ingredientEntryId_ingredientLotId: {
                  ...meal,
                  ingredientEntryId: entryId,
                  ingredientLotId: lot.id,
                },
              },
              create: {
                ...meal,
                ingredientEntryId: entryId,
                ingredientLotId: lot.id,
                quantityUsed: quantity,
                unit: lot.unit,
                plannedPortions: row.plannedPortions,
              },
              update: { quantityUsed: { increment: quantity } },
            }),
        );
        remaining = remaining.sub(
          convertQuantity(restored, row.unit, compensation.unit),
        );
      }
    if (remaining.gt(EPS)) {
      const entry = await tx.ingredientEntry.findUnique({
        where: { id: entryId },
        select: { Ingredient: { select: { name: true } } },
      });
      throw new HttpError(
        409,
        `Kho không đủ ${entry?.Ingredient.name ?? "đồ khô/gia vị"} để bù phần lưu mẫu của Đợt 1 (thiếu ${remaining.toDecimalPlaces(3).toString()} ${compensation.unit}); cần nhập thêm trước khi nấu`,
      );
    }
  }
}

async function reservedQuantitiesFor(
  tx: Tx,
  lot: { id: string; unit: string },
) {
  return (await reservedQuantities(tx, [lot])).get(lot.id)!;
}

async function view(tx: Tx, key: RoundKey): Promise<SupplyRoundResponseDTO> {
  const round = await repository.findByKey(tx, key);
  const requests = await repository.requests(tx, key);
  const occurrences = await repository.occurrences(tx, key);
  const matching = groupOccurrences(occurrences);
  const plans = round ? await repository.plans(tx, round.id) : [];
  const first = new Map(plans.map((plan) => [plan.dishId, plan]));
  const topUps = new Map<string, RoundSampleGroupDTO>();
  const fromStock = new Map<string, RoundSampleGroupDTO>();
  const activeDeliveries = new Set(
    requests.flatMap((request) => request.deliveries.map(({ id }) => id)),
  );
  const add = (
    lot: Awaited<
      ReturnType<typeof repository.batchSamples>
    >[number]["IngredientLot"],
    detail: Omit<RoundSampleLineDTO, "lotId" | "lotCode" | "source">,
  ) => {
    const item = lot.DeliveryItem;
    const incoming = activeDeliveries.has(item.Delivery.id);
    const supplier = incoming ? item.Delivery.Supplier : null;
    const bucket = incoming ? topUps : fromStock;
    const ingredientName =
      item.IngredientEntry?.Ingredient.name ??
      item.ingredientNameSnapshot ??
      "Nguyên liệu";
    const groupKey = JSON.stringify([
      item.ingredientEntryId ?? ingredientName,
      supplier?.id,
      detail.unit,
    ]);
    const group = bucket.get(groupKey) ?? {
      ingredientName,
      supplierName: supplier?.name ?? null,
      totalQuantity: "0",
      unit: detail.unit,
      lines: [],
    };
    group.totalQuantity = new Prisma.Decimal(group.totalQuantity)
      .add(detail.quantity)
      .toString();
    group.lines.push({
      ...detail,
      lotId: lot.id,
      lotCode: lot.lotCode,
      source: item.sourceFacilityNameSnapshot,
    });
    bucket.set(groupKey, group);
  };
  if (round) {
    for (const row of await repository.batchSamples(tx, round.id)) {
      const [dish] = row.CookingBatch.dishes;
      add(row.IngredientLot, {
        quantity: row.sampleQuantity.toString(),
        unit: row.unit,
        batchCode: row.CookingBatch.batchCode,
        dishName: dish?.Dish.name ?? null,
        sampleQuantity: dish?.sampleQuantity?.toString() ?? null,
        sampleUnit: dish?.sampleUnit ?? null,
        mealType: row.CookingBatch.mealType,
      });
    }
    if (occurrences.length)
      for (const row of await repository.seasoningSamples(
        tx,
        occurrences.map(({ menuDayId, mealType }) => ({
          menuDayId,
          mealType,
        })),
      )) {
        add(row.ingredientLot, {
          quantity: row.sampleQuantity.toString(),
          unit: row.unit,
          batchCode: null,
          dishName: null,
          sampleQuantity: null,
          sampleUnit: null,
          mealType: row.mealType,
        });
      }
  }
  return {
    id: round?.id ?? null,
    date: key.deliveryDate.toISOString().slice(0, 10),
    batchNo: key.batchNo,
    status: round?.status ?? null,
    dishes: [...matching].map(([id, [dish]]) => ({
      id,
      name: dish.Dish.name,
      status: first.get(id)?.status ?? "WAITING_SUPPLIERS",
      planVersion: first.get(id)?.planVersion ?? null,
      failureMessage: first.get(id)?.failureMessage ?? null,
      // Đợt 1 (TASK-10 v8): chờ NCC giao và trường kiểm nhận đủ; Đợt 2: chờ NCC khai báo lô.
      waitingSuppliers: [
        ...new Set(
          (key.batchNo === 1
            ? requests.filter(
                (request) =>
                  usesRequest(dish, request) && !allReceived([request]),
              )
            : waitingRequests(dish, requests)
          ).map((request) => request.Supplier.name),
        ),
      ],
    })),
    deliveries: requests.flatMap((request) =>
      request.deliveries.map(({ id, preparationStage }) => ({
        id,
        preparationStage,
        supplierName: request.Supplier.name,
      })),
    ),
    topUps: [...topUps.values()],
    fromStock: [...fromStock.values()],
    cookingMode: await samples.cookingMode(tx, key.schoolId),
    ...(await roundExtras(tx, key, round)),
  };
}

/** Phần bù của Đợt 1 và phần dư/thừa (TASK-10 v8) cho màn kế hoạch mẻ. */
async function roundExtras(
  tx: Tx,
  key: RoundKey,
  round: Round | null,
): Promise<
  Pick<
    SupplyRoundResponseDTO,
    "compensations" | "leftovers" | "round1Ready" | "batch2NotNeeded"
  >
> {
  const round1 =
    key.batchNo === 1
      ? round
      : await repository.findByKey(tx, { ...key, batchNo: 1 });
  const round2 = await repository.findByKey(tx, { ...key, batchNo: 2 });
  const compensations = round1
    ? await samples.compensations(tx, round1.id)
    : [];
  const names = new Map(
    (
      await tx.ingredientEntry.findMany({
        where: {
          id: { in: compensations.map((row) => row.ingredientEntryId) },
        },
        select: { id: true, Ingredient: { select: { name: true } } },
      })
    ).map((row) => [row.id, row.Ingredient.name]),
  );
  const leftovers = round1 ? await samples.leftoversOfRound(tx, round1.id) : [];
  return {
    round1Ready: Boolean(
      round1 && (round1.status === "READY" || round1.status === "CLOSED"),
    ),
    batch2NotNeeded: round2?.status === "NOT_NEEDED",
    compensations: compensations.map((row) => ({
      ingredientEntryId: row.ingredientEntryId,
      ingredientName: names.get(row.ingredientEntryId) ?? "Nguyên liệu",
      kind: row.kind,
      quantity: row.sampleQuantity.toString(),
      unit: row.unit,
    })),
    leftovers: leftovers.map((row) => ({
      ingredientName:
        row.ingredientLot.DeliveryItem.ingredientNameSnapshot ?? "Nguyên liệu",
      source: row.ingredientLot.DeliveryItem.sourceFacilityNameSnapshot,
      lotCode: row.ingredientLot.lotCode,
      dishName: row.dish.name,
      mealType: row.mealType,
      quantity: row.quantity.toString(),
      unit: row.unit,
      surplus: round2?.status === "NOT_NEEDED",
    })),
  };
}

export const supplyRoundService = {
  /** Bước 3 của NCC (Đợt 2 nấu riêng): trạng thái theo nguyên liệu của chuyến (V22, V24, V31). */
  async deliveryTopUpStatus(db: Tx, deliveryId: string) {
    const delivery = await db.delivery.findUnique({
      where: { id: deliveryId },
      select: {
        schoolId: true,
        deliveryItems: {
          select: {
            ingredientEntryId: true,
            ingredientNameSnapshot: true,
            Ingredient: { select: { name: true } },
          },
        },
        SupplyRequest: {
          select: { id: true, batchNo: true, requestedDeliveryDate: true },
        },
      },
    });
    const request = delivery?.SupplyRequest;
    if (!delivery || !request?.requestedDeliveryDate || request.batchNo !== 2)
      return [];
    const key = {
      schoolId: delivery.schoolId,
      deliveryDate: request.requestedDeliveryDate,
      batchNo: 2,
    };
    const round = await repository.findByKey(db, key);
    const plans = round ? await repository.plans(db, round.id) : [];
    const statusFor = new Map(plans.map((plan) => [plan.dishId, plan]));
    const requests = await repository.requests(db, key);
    const occurrences = groupOccurrences(await repository.occurrences(db, key));
    const entries = new Map<string, string>();
    for (const item of delivery.deliveryItems)
      if (item.ingredientEntryId && !entries.has(item.ingredientEntryId))
        entries.set(
          item.ingredientEntryId,
          item.ingredientNameSnapshot ?? item.Ingredient.name,
        );
    return [...entries].map(([ingredientEntryId, ingredientName]) => {
      const dishes = [...occurrences.values()].filter(([dish]) =>
        dish.Dish.dishIngredientEntries.some(
          (line) => line.ingredientEntryId === ingredientEntryId,
        ),
      );
      const waitingFor = new Set<string>();
      let ready = true;
      let approved = true;
      for (const [dish] of dishes) {
        const plan = statusFor.get(dish.dishId);
        const status = plan?.status ?? "WAITING_SUPPLIERS";
        if (status !== "APPROVED") approved = false;
        if (status === "APPROVED" || status === "PENDING_WAREHOUSE") {
          if (status === "PENDING_WAREHOUSE")
            waitingFor.add(`Kho trường duyệt món ${dish.Dish.name}`);
          continue;
        }
        ready = false;
        const pending = waitingRequests(dish, requests).map(
          (row) => row.Supplier.name,
        );
        if (pending.length)
          for (const name of pending)
            waitingFor.add(`${name} khai báo lô cho món ${dish.Dish.name}`);
        else waitingFor.add(`Trường xử lý kế hoạch món ${dish.Dish.name}`);
      }
      return {
        ingredientEntryId,
        ingredientName,
        ready,
        approved: ready && approved,
        waitingFor: [...waitingFor],
      };
    });
  },
  /**
   * Gọi sau khi commit nhận hàng hoặc chốt điểm danh lớp cuối (V11, V14, V20, V34):
   * tạo mẻ Đợt 1 khi đủ điều kiện, lập Đợt 2 nấu chung khi đã nhận đủ, xét "Đợt 2 không cần",
   * rồi chuyển mẻ sang chính thức nếu xong cả ngày.
   */
  async afterDayProgress(input: {
    schoolId: string;
    deliveryDate: Date;
    actorId: string;
  }) {
    const { schoolId, deliveryDate, actorId } = input;
    const first = { schoolId, deliveryDate, batchNo: 1 };
    const second = { schoolId, deliveryDate, batchNo: 2 };
    const database = await getPrisma();
    const state = await database.$transaction(async (tx) => {
      const round1 = await repository.findByKey(tx, first);
      const requests1 = await repository.requests(tx, first);
      const pending = await samples.attendancePending(
        tx,
        schoolId,
        deliveryDate,
      );
      const occurrences = await repository.occurrences(tx, first);
      // Ngày không đồ tươi (V34) là ngày mà thực đơn không có nguyên liệu DIRECT_USE nào,
      // không phải ngày kho chưa kịp tạo đơn Đợt 1.
      const entryIds = [
        ...new Set(
          occurrences.flatMap((row) =>
            row.Dish.dishIngredientEntries.map(
              ({ ingredientEntryId }) => ingredientEntryId,
            ),
          ),
        ),
      ];
      const hasFresh = (await samples.entryKinds(tx, entryIds)).some(
        (row) => row.handlingType === "DIRECT_USE",
      );
      return {
        round1Ready: round1?.status === "READY" || round1?.status === "CLOSED",
        // Có đơn đồ tươi Đợt 1: chờ nhận đủ hàng (V11). Không có: chờ chốt điểm danh (V34).
        canPlanRound1:
          occurrences.length > 0 &&
          (requests1.length
            ? allReceived(requests1)
            : pending === 0 && !hasFresh),
        attendanceDone: pending === 0,
        mode: await samples.cookingMode(tx, schoolId),
        requests2: await repository.requests(tx, second),
      };
    }, transactionOptions);
    if (!state.round1Ready && state.canPlanRound1)
      await reconcile(first, actorId);
    if (state.mode === "COMBINE_LOTS" && allReceived(state.requests2))
      await reconcile(second, actorId, "ROUND2_COMBINE");
    await database.$transaction(async (tx) => {
      const now = new Date();
      const round1 = await repository.findByKey(tx, first);
      if (
        round1 &&
        (round1.status === "READY" || round1.status === "CLOSED") &&
        (await samples.attendancePending(tx, schoolId, deliveryDate)) === 0 &&
        !(await repository.requests(tx, second)).length
      )
        await supplyRoundService.evaluateAndSkipBatch2IfReady(
          tx,
          schoolId,
          deliveryDate,
          now,
        );
      await repository.lock(tx, first);
      await repository.lock(tx, second);
      await supplyRoundService.finalizeReceivedDay(
        tx,
        schoolId,
        deliveryDate,
        now,
        actorId,
      );
    }, transactionOptions);
  },
  async evaluateAndSkipBatch2IfReady(
    tx: Tx,
    schoolId: string,
    deliveryDate: Date,
    at: Date,
  ) {
    const firstKey = { schoolId, deliveryDate, batchNo: 1 };
    const secondKey = { schoolId, deliveryDate, batchNo: 2 };
    await repository.lock(tx, firstKey);
    await repository.lock(tx, secondKey);
    const round1 = await repository.findByKey(tx, firstKey);
    // V20: chỉ kết luận khi mẻ Đợt 1 đã tạo (đã biết phần cắt mẫu).
    if (!round1 || !["READY", "CLOSED"].includes(round1.status)) return;
    const existing = await repository.findByKey(tx, secondKey);
    if (existing && existing.status !== "NOT_NEEDED") return;
    if (!existing) {
      const decision = await evaluateBatch2Skip(
        tx,
        schoolId,
        deliveryDate.toISOString().slice(0, 10),
      );
      if (!decision?.notNeeded) return;
      await repository.markNotNeeded(tx, secondKey, at);
    }
    // V37: phần dư Đợt 1 không vào mẻ, hiển thị thừa.
    await samples.releaseRoundLeftovers(tx, round1.id, at);
  },
  async finalizeReceivedDay(
    tx: Tx,
    schoolId: string,
    deliveryDate: Date,
    at: Date,
    actorId?: string,
  ) {
    const firstKey = { schoolId, deliveryDate, batchNo: 1 };
    const secondKey = { ...firstKey, batchNo: 2 };
    const first = await repository.findByKey(tx, firstKey);
    const second = await repository.findByKey(tx, secondKey);
    if (
      !first ||
      !["READY", "CLOSED"].includes(first.status) ||
      !second ||
      !["READY", "CLOSED", "NOT_NEEDED"].includes(second.status)
    )
      return;
    const keys =
      second.status === "NOT_NEEDED" ? [firstKey] : [firstKey, secondKey];
    for (const key of keys) {
      const requests = await repository.requests(tx, key);
      // Ngày không đồ tươi: Đợt 1 không có đơn nào (V34).
      if (!requests.length && key.batchNo === 1) continue;
      if (!allReceived(requests)) return;
    }
    const ids =
      second.status === "NOT_NEEDED" ? [first.id] : [first.id, second.id];
    const batches = await repository.readyBatches(tx, ids);
    if (
      !batches.length ||
      batches.some(
        ({ status }) =>
          status !== "ROUND1_APPROVED" && status !== "ROUND2_APPROVED",
      )
    )
      return;
    const batchIds = batches.map(({ id }) => id);
    const parts = await repository.parts(tx, batchIds);
    if (
      parts.some(
        ({ status, supplyRoundId }) =>
          status !== "APPROVED" ||
          second.status === "NOT_NEEDED" ||
          supplyRoundId !== second.id,
      )
    )
      return;
    for (const part of parts) await repository.mergePart(tx, part, at);
    // Nấu chung: phần mẫu lấy khi gộp (Đợt 2 đã đặt sẵn) hoặc cắt từ mẻ Đợt 1 khi Đợt 2 không cần (V14, V19).
    const pendingSamples = (
      await tx.cookingBatch.findMany({
        where: { id: { in: batchIds }, sampleStrategy: "ROUND2_ORDER" },
        select: {
          id: true,
          menuDayId: true,
          mealType: true,
          sampleStrategy: true,
        },
      })
    ).filter((batch) => batch.sampleStrategy === "ROUND2_ORDER");
    for (const batch of pendingSamples) {
      await applyBatchSample(tx, batch.id, schoolId, {
        fresh: "CUT",
        stock: "STOCK",
      });
      await tx.cookingBatch.update({
        where: { id: batch.id },
        data: { sampleStrategy: "CUT" },
      });
    }
    const byMeal = new Map<string, { meal: RoundMeal; ids: string[] }>();
    for (const batch of pendingSamples) {
      if (batch.mealType !== "LUNCH" && batch.mealType !== "AFTERNOON")
        continue;
      const key = `${batch.menuDayId}|${batch.mealType}`;
      const entry = byMeal.get(key) ?? {
        meal: { menuDayId: batch.menuDayId, mealType: batch.mealType },
        ids: [],
      };
      entry.ids.push(batch.id);
      byMeal.set(key, entry);
    }
    for (const { meal, ids: mealBatchIds } of byMeal.values())
      await applyMealSeasoningSample(tx, meal, mealBatchIds, "STOCK");
    if (second.status !== "NOT_NEEDED")
      await restoreStockCompensations(tx, first);
    for (const batch of await repository.readyBatches(tx, ids)) {
      await checkReservedStock(tx, batch, schoolId);
      await checkMealSeasoningStock(tx, batch, schoolId);
    }
    await repository.confirmBatches(tx, batchIds, at);
    void actorId;
  },
  async onLotsDeclared(id: string) {
    const database = await getPrisma();
    const declared = await repository.declaration(database, id);
    const request = declared?.SupplyRequest;
    if (
      !declared?.createdByUserId ||
      !request?.requestedDeliveryDate ||
      request.orderType !== "DIRECT_USE" ||
      request.batchNo !== 2
    )
      return;
    await reconcile(
      {
        schoolId: request.schoolId,
        deliveryDate: request.requestedDeliveryDate,
        batchNo: 2,
      },
      declared.createdByUserId,
      "ROUND2_SEPARATE",
    );
  },
  async onDeliveryRejected(
    tx: Tx,
    deliveryId: string,
    cancelWaitingBatches: boolean,
  ) {
    await repository.cleanupRejectedDelivery(
      tx,
      deliveryId,
      cancelWaitingBatches,
    );
  },
  async get(query: RoundQueryDTO, principal: AuthPrincipal) {
    const key = {
      schoolId: schoolScope(principal, VIEW),
      deliveryDate: query.date,
      batchNo: query.batchNo,
    };
    const db = await getPrisma();
    return db.$transaction((tx) => view(tx, key));
  },
  async retry(params: RoundDishParamsDTO, principal: AuthPrincipal) {
    schoolScope(principal, APPROVE);
    return withSchoolTransaction(
      await getPrisma(),
      principal,
      APPROVE,
      async (tx, actor, schoolId) => {
        schoolScope(actor, APPROVE);
        const round = await repository.findById(tx, schoolId, params.id);
        if (!round) throw new HttpError(404, "Không tìm thấy đợt giao");
        await repository.lock(tx, round);
        const current = await repository.findById(tx, schoolId, params.id);
        if (
          !current ||
          ![1, 2].includes(current.batchNo) ||
          current.status === "CLOSED" ||
          current.status === "NOT_NEEDED"
        )
          throw new HttpError(409, "Đợt giao không còn lập được mẻ");
        const phase = await phaseFor(tx, current);
        if (
          phase === "ROUND1" &&
          !allReceived(await repository.requests(tx, current))
        )
          throw new HttpError(
            409,
            "Đợt 1 chưa nhận đủ hàng; mẻ chỉ lập sau khi nhận đủ",
          );
        await planOne(tx, current, params.dishId, actor.id, true, phase);
        if (current.batchNo === 1) await afterRound1Planned(tx, current, phase);
        return view(tx, current);
      },
    );
  },
  async approve(
    params: RoundDishParamsDTO,
    input: RoundApprovalDTO,
    principal: AuthPrincipal,
  ) {
    schoolScope(principal, APPROVE);
    return withSchoolTransaction(
      await getPrisma(),
      principal,
      APPROVE,
      async (tx, actor, schoolId) => {
        schoolScope(actor, APPROVE);
        const round = await repository.findById(tx, schoolId, params.id);
        if (!round) throw new HttpError(404, "Không tìm thấy đợt giao");
        await repository.lock(tx, round);
        const current = await repository.findById(tx, schoolId, params.id);
        if (
          !current ||
          ![1, 2].includes(current.batchNo) ||
          current.status === "CLOSED" ||
          current.status === "NOT_NEEDED"
        )
          throw new HttpError(409, "Đợt giao không còn duyệt được");
        const plan = (await repository.plans(tx, current.id)).find(
          ({ dishId }) => dishId === params.dishId,
        );
        if (!plan)
          throw new HttpError(404, "Không tìm thấy món trong đợt giao");
        if (
          plan.status !== "PENDING_WAREHOUSE" ||
          plan.planVersion !== input.planVersion
        )
          throw new HttpError(409, "Kế hoạch đã thay đổi");
        if (current.batchNo === 2) {
          await repository.approveParts(
            tx,
            current.id,
            params.dishId,
            actor.id,
          );
          await repository.approveBatches(
            tx,
            current.id,
            params.dishId,
            "ROUND2_APPROVED",
          );
        } else {
          await repository.approveBatches(
            tx,
            current.id,
            params.dishId,
            "ROUND1_APPROVED",
          );
        }
        await repository.updatePlan(tx, current.id, params.dishId, {
          status: "APPROVED",
          approvedAt: new Date(),
          approvedByUserId: actor.id,
        });
        await refreshStages(
          tx,
          current,
          await repository.requests(tx, current),
          groupOccurrences(await repository.occurrences(tx, current)),
        );
        return view(tx, current);
      },
    );
  },
};
