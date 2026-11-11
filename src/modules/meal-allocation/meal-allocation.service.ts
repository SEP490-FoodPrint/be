import { createHash } from "node:crypto";
import {
  assertPermission,
  withSchoolTransaction,
} from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import { withReadTransaction } from "../../utils/read-transaction";
import type { AuthPrincipal } from "../../types/auth";
import type { ApplyAllocationRequest } from "./meal-allocation.request.dto";
import type { AllocationDayResponse } from "./meal-allocation.response.dto";
import {
  readAllocationDay,
  writeAllocationDay,
  type AllocationDay,
} from "./meal-allocation.repository";

const mealTypes = ["LUNCH", "AFTERNOON"] as const;
const dateFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Ho_Chi_Minh",
});

function schoolIdFor(principal: AuthPrincipal) {
  if (principal.orgType !== "SCHOOL" || !principal.schoolId)
    throw new HttpError(403, "Phân bổ yêu cầu tài khoản thuộc trường");
  return principal.schoolId;
}

export function projectAllocationDay(
  data: AllocationDay,
  date: string,
): AllocationDayResponse {
  const batches: AllocationDayResponse["batches"] = data.batches.map(
    (batch) => ({
      id: batch.id,
      mealType: batch.mealType,
      plannedPortions: batch.plannedPortions,
      note: batch.note,
      status: batch.status,
      hasSample:
        batch.dishes.length > 0 &&
        batch.dishes.every((dish) => dish.retainedFoodSamples.length > 0),
      entries: [],
    }),
  );
  const demands: AllocationDayResponse["demands"] = [];
  let issue: string | undefined;
  let demandPending = false;
  const meals = mealTypes.flatMap((mealType) => {
    const menus = data.menus.filter((menu) =>
      menu.menuDayDishes.some((dish) => dish.mealType === mealType),
    );
    const rawBatches = data.batches.filter(
      (batch) => batch.mealType === mealType,
    );
    const mealBatches = batches.filter((batch) => batch.mealType === mealType);
    const daily = data.demands.filter((demand) => demand.mealType === mealType);
    if (!menus.length && !rawBatches.length && !daily.length) return [];
    const menu = menus[0];
    if (
      menus.length !== 1 ||
      rawBatches.some((batch) => batch.menuDayId !== menu?.id)
    )
      issue ??= "Thực đơn của bữa và các lô cần được đối soát.";
    const groups =
      menu?.portionGroups.filter((group) => group.mealType === mealType) ?? [];
    const common = groups.find((group) => group.isDefault);
    const mealDishes =
      menu?.menuDayDishes.filter((dish) => dish.mealType === mealType) ?? [];
    if (!daily.length || daily.some((demand) => demand.status !== "FINALIZED"))
      demandPending = true;
    let finalized = 0;
    for (const demand of daily.filter(
      (entry) => entry.status === "FINALIZED",
    )) {
      const commonCount = demand.portionGroups.find(
        (group) => group.portionGroupId === common?.id,
      )?.portionCount;
      if (
        demand.dailyAllergyPortions.length ||
        (groups.length
          ? commonCount !== demand.totalPortions ||
            demand.portionGroups.some(
              (group) =>
                group.portionGroupId !== common?.id && group.portionCount > 0,
            )
          : demand.portionGroups.length > 0)
      )
        issue ??= "Chưa xác định được số suất nhóm chung riêng cho từng lô.";
      finalized += commonCount ?? demand.totalPortions;
      demands.push({
        id: demand.id,
        name: demand.Class.name,
        mealType,
        totalPortions: commonCount ?? demand.totalPortions,
        locked:
          !!demand.MealAllocation &&
          demand.MealAllocation.status !== "ALLOCATED",
      });
    }
    for (const batch of rawBatches) {
      if (
        !batch.plannedPortions ||
        batch.plannedPortions < 0 ||
        (batch.status === "COMPLETED" && !batch.completedAt) ||
        batch.dishes.length !== mealDishes.length ||
        !batch.dishes.length ||
        batch.dishes.some(
          (dish) =>
            dish.plannedPortions !== batch.plannedPortions ||
            !mealDishes.some((required) => required.dishId === dish.dishId),
        )
      )
        issue ??=
          "Có lô thiếu dữ liệu hoặc số suất các món trong lô không khớp.";
    }
    const planned = mealBatches.reduce(
      (sum, batch) => sum + (batch.plannedPortions ?? 0),
      0,
    );
    const cooked = mealBatches
      .filter((batch) => batch.status === "COMPLETED")
      .reduce((sum, batch) => sum + (batch.plannedPortions ?? 0), 0);
    const sampled = mealBatches
      .filter((batch) => batch.status === "COMPLETED" && batch.hasSample)
      .reduce((sum, batch) => sum + (batch.plannedPortions ?? 0), 0);
    if (!finalized) demandPending = true;
    return [{ mealType, finalized, planned, cooked, sampled }];
  });
  const totals = meals.reduce(
    (sum, meal) => ({
      finalized: sum.finalized + meal.finalized,
      planned: sum.planned + meal.planned,
      cooked: sum.cooked + meal.cooked,
      sampled: sum.sampled + meal.sampled,
    }),
    { finalized: 0, planned: 0, cooked: 0, sampled: 0 },
  );
  const missingSampleBatches = batches.filter(
    (batch) => batch.status === "COMPLETED" && !batch.hasSample,
  ).length;
  const revision = createHash("sha256")
    .update(JSON.stringify({ date, data }))
    .digest("hex");
  const response: AllocationDayResponse = {
    date,
    totals,
    meals,
    missingSampleBatches,
    revision,
    batches,
    demands: [],
    status: "READY",
    message: "",
    action: null,
  };

  function locked(
    status: AllocationDayResponse["status"],
    message: string,
    action: AllocationDayResponse["action"],
  ) {
    return { ...response, status, message, action };
  }

  if ((!data.menus.length && !data.batches.length) || !meals.length)
    return locked("EMPTY", "Hôm nay không có lô cần phân bổ.", null);
  if (issue) return locked("RECONCILE", issue, "COOKING");
  if (demandPending)
    return locked(
      "DEMAND_PENDING",
      "Chưa có đủ số suất giáo viên đã chốt.",
      "RETRY",
    );
  if (meals.some((meal) => meal.planned > meal.finalized))
    return locked(
      "RECONCILE",
      "Số suất của lô vượt số suất giáo viên đã chốt.",
      "COOKING",
    );
  if (
    meals.some((meal) => meal.planned < meal.finalized) ||
    batches.some((batch) => batch.status !== "COMPLETED")
  )
    return locked(
      "COOKING_PENDING",
      "Hoàn tất lập và nấu các lô hôm nay trước khi phân bổ.",
      "COOKING",
    );
  if (
    missingSampleBatches ||
    meals.some((meal) => meal.sampled !== meal.finalized)
  )
    return locked(
      "SAMPLES_PENDING",
      "Hoàn tất lưu mẫu cho các lô hôm nay trước khi phân bổ.",
      "SAMPLES",
    );

  const demandById = new Map(demands.map((demand) => [demand.id, demand]));
  const batchById = new Map(batches.map((batch) => [batch.id, batch]));
  const rawById = new Map(data.batches.map((batch) => [batch.id, batch]));
  const allocatedByDemand = new Map<string, number>();
  const historyError = () =>
    locked("RECONCILE", "Phân bổ cũ cần đối soát trước khi tiếp tục.", null);
  for (const raw of data.batches)
    if (
      raw.dishes.some((dish) =>
        dish.mealAllocationBatches.some(
          (entry) => !demandById.has(entry.MealAllocation.dailyMealPortionId),
        ),
      )
    )
      return historyError();

  for (const row of data.demands) {
    const demand = demandById.get(row.id);
    if (!demand) continue;
    const rowsByBatch = new Map<
      string,
      NonNullable<typeof row.MealAllocation>["mealAllocationBatches"]
    >();
    for (const item of row.MealAllocation?.mealAllocationBatches ?? []) {
      const rows = rowsByBatch.get(item.cookingBatchId) ?? [];
      rows.push(item);
      rowsByBatch.set(item.cookingBatchId, rows);
    }
    for (const [batchId, rows] of rowsByBatch) {
      const batch = batchById.get(batchId);
      const raw = rawById.get(batchId);
      const count = rows[0].allocatedPortions;
      if (
        !batch ||
        !raw ||
        batch.mealType !== demand.mealType ||
        count <= 0 ||
        rows.length !== raw.dishes.length ||
        raw.dishes.some(
          (dish) =>
            !rows.some(
              (item) =>
                item.dishId === dish.dishId && item.allocatedPortions === count,
            ),
        )
      )
        return historyError();
      batch.entries.push({
        dailyMealPortionId: demand.id,
        allocatedPortions: count,
        locked: demand.locked,
      });
      allocatedByDemand.set(
        demand.id,
        (allocatedByDemand.get(demand.id) ?? 0) + count,
      );
    }
  }
  if (
    batches.some(
      (batch) =>
        batch.entries.reduce((sum, row) => sum + row.allocatedPortions, 0) >
        batch.plannedPortions!,
    ) ||
    demands.some(
      (demand) =>
        (allocatedByDemand.get(demand.id) ?? 0) > demand.totalPortions,
    )
  )
    return historyError();
  return { ...response, demands };
}

function prepareChanges(
  data: AllocationDay,
  view: AllocationDayResponse,
  input: ApplyAllocationRequest,
) {
  const editable = view.batches.filter(
    (batch) =>
      batch.entries
        .filter((entry) => entry.locked)
        .reduce((sum, entry) => sum + entry.allocatedPortions, 0) <
      batch.plannedPortions!,
  );
  const inputByBatch = new Map(
    input.batches.map((batch) => [batch.cookingBatchId, batch.entries]),
  );
  if (
    input.batches.length !== editable.length ||
    inputByBatch.size !== editable.length ||
    editable.some((batch) => !inputByBatch.has(batch.id))
  )
    throw new HttpError(
      400,
      "Danh sách lô có thể chỉnh không hợp lệ hoặc bị trùng",
    );

  const demandById = new Map(view.demands.map((demand) => [demand.id, demand]));
  const rowsByDemand = new Map<
    string,
    { cookingBatchId: string; dishId: string; allocatedPortions: number }[]
  >();
  const dishIdsByBatch = new Map(
    data.batches.map((batch) => [
      batch.id,
      batch.dishes.map((dish) => dish.dishId),
    ]),
  );
  const totalsByDemand = new Map<string, number>();
  for (const batch of editable) {
    let used = batch.entries
      .filter((entry) => entry.locked)
      .reduce((sum, entry) => sum + entry.allocatedPortions, 0);
    const seen = new Set<string>();
    for (const entry of inputByBatch.get(batch.id)!) {
      const demand = demandById.get(entry.dailyMealPortionId);
      if (
        !demand ||
        demand.locked ||
        demand.mealType !== batch.mealType ||
        seen.has(demand.id)
      )
        throw new HttpError(400, "Lớp không hợp lệ hoặc bị trùng trong lô");
      seen.add(demand.id);
      used += entry.allocatedPortions;
      const total =
        (totalsByDemand.get(demand.id) ?? 0) + entry.allocatedPortions;
      if (used > batch.plannedPortions! || total > demand.totalPortions)
        throw new HttpError(
          409,
          "Số suất vượt dung lượng lô hoặc nhu cầu của lớp",
        );
      totalsByDemand.set(demand.id, total);
      const rows = rowsByDemand.get(demand.id) ?? [];
      for (const dishId of dishIdsByBatch.get(batch.id)!)
        rows.push({
          cookingBatchId: batch.id,
          dishId,
          allocatedPortions: entry.allocatedPortions,
        });
      rowsByDemand.set(demand.id, rows);
    }
  }
  return data.demands.flatMap((demand) => {
    const allocation = demand.MealAllocation;
    if (allocation && allocation.status !== "ALLOCATED") return [];
    const rows = rowsByDemand.get(demand.id) ?? [];
    const previous = allocation?.mealAllocationBatches ?? [];
    if (
      rows.length === previous.length &&
      rows.every((row) =>
        previous.some(
          (item) =>
            item.cookingBatchId === row.cookingBatchId &&
            item.dishId === row.dishId &&
            item.allocatedPortions === row.allocatedPortions,
        ),
      )
    )
      return [];
    return [{ demandId: demand.id, allocationId: allocation?.id, rows }];
  });
}

export function createMealAllocationService(
  connect = getPrisma,
  now = () => new Date(),
) {
  return {
    getToday(principal: AuthPrincipal) {
      assertPermission(principal, "meal_allocation.view");
      const schoolId = schoolIdFor(principal);
      const date = dateFormatter.format(now());
      return withReadTransaction(
        async (tx) =>
          projectAllocationDay(
            await readAllocationDay(tx, schoolId, new Date(date)),
            date,
          ),
        connect,
      );
    },
    async apply(input: ApplyAllocationRequest, principal: AuthPrincipal) {
      assertPermission(principal, "meal_allocation.update");
      schoolIdFor(principal);
      return withSchoolTransaction(
        await connect(),
        principal,
        "meal_allocation.update",
        async (tx, actor, schoolId) => {
          const date = dateFormatter.format(now());
          const day = new Date(date);
          const data = await readAllocationDay(tx, schoolId, day);
          const view = projectAllocationDay(data, date);
          if (view.status !== "READY")
            throw new HttpError(409, view.message, view.status);
          if (view.revision !== input.revision)
            throw new HttpError(
              409,
              "Dữ liệu phân bổ đã thay đổi. Vui lòng tải lại.",
              "ALLOCATION_STALE",
            );
          const changes = prepareChanges(data, view, input);
          if (changes.some((change) => !change.allocationId))
            assertPermission(actor, "meal_allocation.create");
          if (!changes.length) return view;
          await writeAllocationDay(tx, actor.id, schoolId, day, changes);
          return projectAllocationDay(
            await readAllocationDay(tx, schoolId, day),
            date,
          );
        },
      );
    },
  };
}

export const mealAllocationService = createMealAllocationService();
export type MealAllocationService = ReturnType<
  typeof createMealAllocationService
>;
