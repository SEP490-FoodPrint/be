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
} from "../kitchen/kitchen.service";
import { HttpError } from "../../utils/http-error";
import { evaluateBatch2Skip } from "../supply-order/fresh-demand.service";
import { planRoundOneDish } from "./round-dish-planning";
import {
  supplyRoundRepository as repository,
  type RoundKey,
  type RoundOccurrence,
  type RoundRequest,
} from "./supply-round.repository";
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

async function refreshStages(
  tx: Tx,
  round: Round,
  requests: RoundRequest[],
  dishes: Map<string, RoundOccurrence[]>,
) {
  const plans = await repository.plans(tx, round.id);
  const statusFor = new Map(plans.map((plan) => [plan.dishId, plan.status]));
  const samples = await repository.batchSamples(tx, round.id);
  const topUpDeliveries = new Set(
    samples.map((sample) => sample.IngredientLot.DeliveryItem.Delivery.id),
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
  const status =
    plans.length && plans.every((plan) => plan.status === "APPROVED")
      ? "READY"
      : plans.some((plan) => plan.status !== "WAITING_SUPPLIERS")
        ? "IN_REVIEW"
        : "COLLECTING";
  if (status !== round.status)
    await repository.updateRoundStatus(tx, round.id, status);
}

async function planOne(
  tx: Tx,
  round: Round,
  dishId: string,
  actorId: string,
  requested: boolean,
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
  if (waitingRequests(matching[0], requests).length) {
    if (requested)
      throw new HttpError(409, "Chưa đủ nhà cung cấp khai báo lô cho món");
    return;
  }
  await repository.beginDish(tx);
  try {
    const planVersion = await planRoundOneDish(tx, round, matching, actorId);
    await repository.updatePlan(tx, round.id, dishId, {
      status: "PENDING_WAREHOUSE",
      planVersion,
      failureMessage: null,
    });
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
    });
  }
  await repository.releaseDish(tx);
  await refreshStages(tx, round, requests, occurrences);
}

async function reconcile(key: RoundKey, actorId: string) {
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
    return { roundId: round.id, ids };
  }, transactionOptions);
  if (!queue) return;
  for (const dishId of queue.ids) {
    await database.$transaction(async (tx) => {
      await repository.lock(tx, key);
      const round = await repository.findById(tx, key.schoolId, queue.roundId);
      if (!round || round.status === "CLOSED" || round.status === "NOT_NEEDED")
        return;
      await planOne(tx, round, dishId, actorId, false);
    }, transactionOptions);
  }
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
    if (key.batchNo === 1)
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
      waitingSuppliers: [
        ...new Set(
          waitingRequests(dish, requests).map(
            (request) => request.Supplier.name,
          ),
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
  };
}

export const supplyRoundService = {
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
    const existing = await repository.findByKey(tx, secondKey);
    if (existing && existing.status !== "NOT_NEEDED") return;
    const decision = await evaluateBatch2Skip(
      tx,
      schoolId,
      deliveryDate.toISOString().slice(0, 10),
    );
    if (!decision?.notNeeded) return;
    if (!existing) await repository.markNotNeeded(tx, secondKey, at);
    await supplyRoundService.finalizeReceivedDay(
      tx,
      schoolId,
      deliveryDate,
      at,
    );
  },
  async finalizeReceivedDay(
    tx: Tx,
    schoolId: string,
    deliveryDate: Date,
    at: Date,
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
      if (
        !requests.length ||
        requests.some(
          ({ deliveries }) =>
            !deliveries.length ||
            deliveries.some(({ status }) => status !== "RECEIVED"),
        )
      )
        return;
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
    for (const batch of parts.length
      ? await repository.readyBatches(tx, ids)
      : batches) {
      await checkReservedStock(tx, batch, schoolId);
      await checkMealSeasoningStock(tx, batch, schoolId);
    }
    await repository.confirmBatches(tx, batchIds, at);
  },
  async onLotsDeclared(id: string) {
    const database = await getPrisma();
    const declared = await repository.declaration(database, id);
    const request = declared?.SupplyRequest;
    if (
      !declared?.createdByUserId ||
      !request?.requestedDeliveryDate ||
      request.orderType !== "DIRECT_USE" ||
      (request.batchNo !== 1 && request.batchNo !== 2)
    )
      return;
    await reconcile(
      {
        schoolId: request.schoolId,
        deliveryDate: request.requestedDeliveryDate,
        batchNo: request.batchNo,
      },
      declared.createdByUserId,
    );
    if (
      request.batchNo === 1 &&
      (await repository.hasReplanRequiredRound2(
        database,
        request.schoolId,
        request.requestedDeliveryDate,
      ))
    ) {
      await reconcile(
        {
          schoolId: request.schoolId,
          deliveryDate: request.requestedDeliveryDate,
          batchNo: 2,
        },
        declared.createdByUserId,
      );
    }
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
        await planOne(tx, current, params.dishId, actor.id, true);
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
