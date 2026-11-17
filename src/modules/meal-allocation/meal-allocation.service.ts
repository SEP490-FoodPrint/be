import { createHash } from "node:crypto";
import { ROLES } from "../../constants/roles";
import {
  assertPermission,
  withSchoolTransaction,
} from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import { withReadTransaction } from "../../utils/read-transaction";
import type { AuthPrincipal } from "../../types/auth";
import {
  blockchainProofService,
  type BlockchainProofService,
  type ProofRef,
} from "../blockchain-proof/blockchain-proof.service";
import type {
  ApplyAllocationRequest,
  ConfirmDistributionRequest,
} from "./meal-allocation.request.dto";
import type { AllocationDayResponse } from "./meal-allocation.response.dto";
import {
  confirmAllocationDistribution,
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

function menuAcceptsDemand(
  menu: AllocationDay["menus"][number],
  demand: AllocationDay["demands"][number],
) {
  return (
    menu.menuDayDishes.some((dish) => dish.mealType === demand.mealType) &&
    (menu.WeeklyMenu?.isSchoolWide !== false ||
      menu.WeeklyMenu.grades.some(
        (grade) => grade.gradeId === demand.Class.gradeId,
      ))
  );
}
function batchAcceptsDemand(
  data: AllocationDay,
  batchId: string,
  demandId: string,
) {
  const batch = data.batches.find((row) => row.id === batchId);
  const menu = data.menus.find((row) => row.id === batch?.menuDayId);
  const demand = data.demands.find((row) => row.id === demandId);
  return !!(
    menu &&
    batch &&
    demand &&
    batch.mealType === demand.mealType &&
    menuAcceptsDemand(menu, demand)
  );
}

function projectDistribution(
  data: AllocationDay,
): AllocationDayResponse["distribution"] {
  const batchesById = new Map(data.batches.map((batch) => [batch.id, batch]));
  const totalsByBatch = new Map<string, number>();
  let invalid = false;
  const demands = data.demands.map((demand) => {
    const allocation = demand.MealAllocation;
    const byBatch = new Map<
      string,
      NonNullable<typeof allocation>["mealAllocationBatches"]
    >();
    const allocationRows =
      allocation?.status === "CANCELLED"
        ? []
        : (allocation?.mealAllocationBatches ?? []);
    for (const row of allocationRows) {
      const rows = byBatch.get(row.cookingBatchId) ?? [];
      rows.push(row);
      byBatch.set(row.cookingBatchId, rows);
    }

    const allocatedByDish = new Map<string, number>();

    const batches = Array.from(byBatch).flatMap(([batchId, rows]) => {
      const batch = batchesById.get(batchId);
      if (
        !batch ||
        batch.mealType !== demand.mealType ||
        !batchAcceptsDemand(data, batchId, demand.id)
      ) {
        invalid = true;
        return [];
      }

      for (const row of rows) {
        if (
          row.allocatedPortions <= 0 ||
          !batch.dishes.some((d) => d.dishId === row.dishId)
        ) {
          invalid = true;
          return [];
        }
        allocatedByDish.set(
          row.dishId,
          (allocatedByDish.get(row.dishId) ?? 0) + row.allocatedPortions,
        );
      }

      const allocatedPortions = Math.max(
        ...rows.map((r) => r.allocatedPortions),
      );
      totalsByBatch.set(
        batchId,
        (totalsByBatch.get(batchId) ?? 0) + allocatedPortions,
      );
      return [{ batchId, allocatedPortions }];
    });

    const acceptedMenu = data.menus.find((menu) =>
      menuAcceptsDemand(menu, demand),
    );
    const menuDishes =
      acceptedMenu?.menuDayDishes.filter(
        (dish) => dish.mealType === demand.mealType,
      ) ?? [];

    const allocatedPortions =
      menuDishes.length > 0
        ? Math.min(
            ...menuDishes.map((dish) => allocatedByDish.get(dish.dishId) ?? 0),
          )
        : batches.reduce((sum, batch) => sum + batch.allocatedPortions, 0);

    return {
      id: demand.id,
      classId: demand.Class.id,
      className: demand.Class.name,
      mealType: demand.mealType,
      requiredPortions: demand.totalPortions,
      allocatedPortions,
      allocationStatus: allocation?.status ?? null,
      demandFinalized: demand.status === "FINALIZED",
      batches,
    };
  });
  const meals = mealTypes.flatMap((mealType) => {
    const rows = demands.filter((demand) => demand.mealType === mealType);
    return rows.length
      ? [
          {
            mealType,
            allocatedPortions: rows.reduce(
              (sum, row) => sum + row.allocatedPortions,
              0,
            ),
          },
        ]
      : [];
  });
  const required = demands.filter((demand) => demand.requiredPortions > 0);
  const pending = (message: string) => ({
    status: "PENDING" as const,
    canConfirmDistribution: false,
    message,
    demands,
    meals,
  });
  if (
    invalid ||
    data.batches.some(
      (batch) =>
        (totalsByBatch.get(batch.id) ?? 0) > (batch.plannedPortions ?? 0),
    ) ||
    demands.some((demand) => demand.allocatedPortions > demand.requiredPortions)
  )
    return pending(
      "Dữ liệu phân bổ cần được đối soát trước khi xác nhận giao.",
    );
  if (!required.length) return pending("Hôm nay chưa có suất ăn cần giao.");
  if (
    required.some((demand) => !demand.demandFinalized) ||
    data.menus.some((menu) =>
      menu.menuDayDishes.some(
        (dish) => !required.some((demand) => demand.mealType === dish.mealType),
      ),
    )
  )
    return pending("Chưa chốt đủ nhu cầu suất ăn trong ngày.");
  if (
    required.some(
      (demand) => demand.allocatedPortions !== demand.requiredPortions,
    )
  )
    return pending("Cần phân bổ đủ suất cho tất cả lớp và bữa trong ngày.");
  const canConfirmDistribution = required.some(
    (demand) => demand.allocationStatus === "ALLOCATED",
  );
  return {
    status: canConfirmDistribution ? "READY" : "DISTRIBUTED",
    canConfirmDistribution,
    message: "",
    demands,
    meals,
  };
}

export function projectAllocationDay(
  data: AllocationDay,
  date: string,
): AllocationDayResponse {
  const batches: AllocationDayResponse["batches"] = data.batches.map(
    (batch) => ({
      id: batch.id,
      eligibleDemandIds: data.demands
        .filter((demand) => batchAcceptsDemand(data, batch.id, demand.id))
        .map((demand) => demand.id),
      scopeLabel:
        data.menus
          .find((menu) => menu.id === batch.menuDayId)
          ?.WeeklyMenu?.grades.map((grade) => grade.grade.name)
          .join(", ") || "Toàn trường",
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
  for (const demand of data.demands.filter((row) => row.totalPortions > 0)) {
    if (
      data.menus.filter((menu) => menuAcceptsDemand(menu, demand)).length !== 1
    )
      issue ??=
        "Lớp chưa có thực đơn phù hợp hoặc đang thuộc nhiều phạm vi thực đơn trong cùng bữa.";
  }
  if (
    data.batches.some(
      (batch) => !data.menus.some((menu) => menu.id === batch.menuDayId),
    )
  )
    issue ??= "Lô chế biến không thuộc thực đơn đã duyệt trong ngày.";
  const menuStats = mealTypes
    .flatMap((mealType) =>
      data.menus
        .filter((menu) =>
          menu.menuDayDishes.some((dish) => dish.mealType === mealType),
        )
        .map((menu) => ({ mealType, menu })),
    )
    .flatMap(({ mealType, menu }) => {
      const rawBatches = data.batches.filter(
        (batch) => batch.mealType === mealType && batch.menuDayId === menu.id,
      );
      const mealBatches = batches.filter((batch) =>
        rawBatches.some((raw) => raw.id === batch.id),
      );
      const daily = data.demands.filter(
        (demand) =>
          demand.mealType === mealType && menuAcceptsDemand(menu, demand),
      );
      const groups =
        menu?.portionGroups.filter((group) => group.mealType === mealType) ??
        [];
      const common = groups.find((group) => group.isDefault);
      const mealDishes =
        menu?.menuDayDishes.filter((dish) => dish.mealType === mealType) ?? [];
      if (
        !daily.length ||
        daily.some((demand) => demand.status !== "FINALIZED")
      )
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
  const meals = mealTypes.flatMap((mealType) => {
    const stats = menuStats.filter((row) => row.mealType === mealType);
    return stats.length
      ? [
          {
            mealType,
            finalized: stats.reduce((sum, row) => sum + row.finalized, 0),
            planned: stats.reduce((sum, row) => sum + row.planned, 0),
            cooked: stats.reduce((sum, row) => sum + row.cooked, 0),
            sampled: stats.reduce((sum, row) => sum + row.sampled, 0),
          },
        ]
      : [];
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
    distribution: projectDistribution(data),
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
  ): AllocationDayResponse {
    return {
      ...response,
      status,
      message,
      action,
      distribution:
        response.distribution.status === "READY"
          ? {
              ...response.distribution,
              status: "PENDING",
              canConfirmDistribution: false,
              message,
            }
          : response.distribution,
    };
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
  if (menuStats.some((meal) => meal.planned > meal.finalized))
    return locked(
      "RECONCILE",
      "Số suất của lô vượt số suất giáo viên đã chốt.",
      "COOKING",
    );
  if (
    menuStats.some((meal) => meal.planned < meal.finalized) ||
    batches.some((batch) => batch.status !== "COMPLETED")
  )
    return locked(
      "COOKING_PENDING",
      "Hoàn tất lập và nấu các lô hôm nay trước khi phân bổ.",
      "COOKING",
    );
  if (
    missingSampleBatches ||
    menuStats.some((meal) => meal.sampled !== meal.finalized)
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
        !batchAcceptsDemand(data, batchId, demand.id) ||
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

  const gradeGroups = buildGradeAllocationGroups(data, batches, demands);
  return { ...response, demands, grades: gradeGroups };
}

function buildGradeAllocationGroups(
  data: AllocationDay,
  _batches: AllocationDayResponse["batches"],
  _demands: AllocationDayResponse["demands"],
): import("./meal-allocation.response.dto").GradeAllocationGroup[] {
  const demandsByGrade = new Map<string, typeof data.demands>();

  for (const demand of data.demands) {
    if (demand.totalPortions <= 0) continue;
    const gradeId = demand.Class.gradeId || "UNASSIGNED";
    const list = demandsByGrade.get(gradeId) ?? [];
    list.push(demand);
    demandsByGrade.set(gradeId, list);
  }

  const groups: import("./meal-allocation.response.dto").GradeAllocationGroup[] =
    [];

  for (const [gradeId, gradeDemands] of demandsByGrade) {
    if (!gradeDemands.length) continue;
    const sampleClass = gradeDemands[0].Class;
    const gradeName =
      sampleClass.grade?.name ||
      data.menus
        .flatMap((m) => m.WeeklyMenu?.grades ?? [])
        .find((g) => g.gradeId === gradeId)?.grade?.name ||
      (gradeId === "UNASSIGNED" ? "Khối chưa gán" : "Khối chung");

    const acceptedMenus = data.menus.filter((m) =>
      gradeDemands.some((d) => menuAcceptsDemand(m, d)),
    );

    const dishMap = new Map<
      string,
      { dishId: string; dishName: string; mealType: (typeof mealTypes)[number] }
    >();
    for (const menu of acceptedMenus) {
      for (const mdd of menu.menuDayDishes) {
        if (!dishMap.has(mdd.dishId)) {
          const dishRecord = mdd as {
            dishId: string;
            mealType: (typeof mealTypes)[number];
            Dish?: { name: string } | null;
          };
          const dishName =
            dishRecord.Dish?.name || `Món ăn ${mdd.dishId.slice(0, 6)}`;
          dishMap.set(mdd.dishId, {
            dishId: mdd.dishId,
            dishName,
            mealType: mdd.mealType,
          });
        }
      }
    }

    const dishes: import("./meal-allocation.response.dto").DishAllocationGroup[] =
      [];

    for (const [dishId, dishInfo] of dishMap) {
      const relevantDemands = gradeDemands.filter(
        (d) => d.mealType === dishInfo.mealType,
      );
      const totalRequiredPortions = relevantDemands.reduce(
        (sum, d) => sum + d.totalPortions,
        0,
      );

      const dishBatches: import("./meal-allocation.response.dto").DishBatchSlot[] =
        [];

      for (const rawBatch of data.batches) {
        if (rawBatch.mealType !== dishInfo.mealType) continue;
        const dishInBatch = rawBatch.dishes.find((d) => d.dishId === dishId);
        if (!dishInBatch) continue;

        const canServeGrade = relevantDemands.some((d) =>
          batchAcceptsDemand(data, rawBatch.id, d.id),
        );
        if (!canServeGrade) continue;

        const entries: import("./meal-allocation.response.dto").DishBatchSlot["entries"] =
          [];
        let allocatedCount = 0;

        for (const demand of relevantDemands) {
          const allocBatch = demand.MealAllocation?.mealAllocationBatches.find(
            (b) => b.cookingBatchId === rawBatch.id && b.dishId === dishId,
          );
          if (allocBatch && allocBatch.allocatedPortions > 0) {
            entries.push({
              dailyMealPortionId: demand.id,
              className: demand.Class.name,
              allocatedPortions: allocBatch.allocatedPortions,
              locked: demand.MealAllocation?.status !== "ALLOCATED",
            });
            allocatedCount += allocBatch.allocatedPortions;
          }
        }

        const batchCapacity =
          dishInBatch.plannedPortions ?? rawBatch.plannedPortions ?? 0;
        const availablePortions = Math.max(0, batchCapacity - allocatedCount);
        const batchRecord = rawBatch as {
          id: string;
          batchCode?: string | null;
        };

        dishBatches.push({
          cookingBatchId: rawBatch.id,
          batchCode: batchRecord.batchCode || rawBatch.id,
          plannedPortions: batchCapacity,
          availablePortions,
          autoAssigned: false,
          entries,
        });
      }

      const isSingleBatch = dishBatches.length === 1;
      const canCoverAll =
        isSingleBatch &&
        dishBatches[0].plannedPortions >= totalRequiredPortions;

      const autoAssigned = isSingleBatch && canCoverAll;

      if (autoAssigned && dishBatches.length === 1) {
        dishBatches[0].autoAssigned = true;
        if (dishBatches[0].entries.length === 0 && totalRequiredPortions > 0) {
          dishBatches[0].entries = relevantDemands.map((d) => ({
            dailyMealPortionId: d.id,
            className: d.Class.name,
            allocatedPortions: d.totalPortions,
            locked: false,
          }));
          dishBatches[0].availablePortions = Math.max(
            0,
            dishBatches[0].plannedPortions - totalRequiredPortions,
          );
        }
      }

      dishes.push({
        dishId,
        dishName: dishInfo.dishName,
        mealType: dishInfo.mealType,
        totalRequiredPortions,
        autoAssigned,
        batches: dishBatches,
      });
    }

    groups.push({
      gradeId,
      gradeName,
      demands: gradeDemands.map((d) => ({
        id: d.id,
        classId: d.Class.id,
        className: d.Class.name,
        totalPortions: d.totalPortions,
        locked: !!d.MealAllocation && d.MealAllocation.status !== "ALLOCATED",
      })),
      dishes,
    });
  }

  return groups;
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

  const isPerDishMode = input.batches.some((b) => b.dishId);
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
  const rawBatchById = new Map(data.batches.map((b) => [b.id, b]));

  if (!isPerDishMode) {
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
          !batchAcceptsDemand(data, batch.id, demand.id) ||
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
  } else {
    // Per-dish mode
    const totalsByBatchDish = new Map<string, number>();
    const totalsByDemandDish = new Map<string, number>();

    for (const item of input.batches) {
      const rawBatch = rawBatchById.get(item.cookingBatchId);
      if (!rawBatch)
        throw new HttpError(400, `Lô không tồn tại: ${item.cookingBatchId}`);

      const targetDishIds = item.dishId
        ? [item.dishId]
        : (dishIdsByBatch.get(item.cookingBatchId) ?? []);

      for (const dishId of targetDishIds) {
        const dishInBatch = rawBatch.dishes.find((d) => d.dishId === dishId);
        if (!dishInBatch)
          throw new HttpError(400, "Món ăn không thuộc lô chế biến");

        const batchDishKey = `${item.cookingBatchId}:${dishId}`;
        let used = totalsByBatchDish.get(batchDishKey) ?? 0;
        const seen = new Set<string>();

        for (const entry of item.entries) {
          const demand = demandById.get(entry.dailyMealPortionId);
          if (
            !demand ||
            demand.locked ||
            demand.mealType !== rawBatch.mealType ||
            !batchAcceptsDemand(data, item.cookingBatchId, demand.id) ||
            seen.has(demand.id)
          )
            throw new HttpError(400, "Lớp không hợp lệ hoặc bị trùng trong lô");

          seen.add(demand.id);
          used += entry.allocatedPortions;
          const demandDishKey = `${demand.id}:${dishId}`;
          const currentDemandTotal =
            (totalsByDemandDish.get(demandDishKey) ?? 0) +
            entry.allocatedPortions;

          const maxCapacity =
            dishInBatch.plannedPortions ?? rawBatch.plannedPortions ?? 0;
          if (used > maxCapacity || currentDemandTotal > demand.totalPortions)
            throw new HttpError(
              409,
              "Số suất vượt dung lượng lô hoặc nhu cầu của lớp",
            );

          totalsByBatchDish.set(batchDishKey, used);
          totalsByDemandDish.set(demandDishKey, currentDemandTotal);

          const rows = rowsByDemand.get(demand.id) ?? [];
          rows.push({
            cookingBatchId: item.cookingBatchId,
            dishId,
            allocatedPortions: entry.allocatedPortions,
          });
          rowsByDemand.set(demand.id, rows);
        }
      }
    }

    // Tự động bảo lưu các món autoAssigned nếu người dùng không gửi trong request
    if (view.grades) {
      for (const grade of view.grades) {
        for (const dish of grade.dishes) {
          if (dish.autoAssigned && dish.batches.length === 1) {
            const autoSlot = dish.batches[0];
            const hasInputForPair = input.batches.some(
              (b) =>
                b.cookingBatchId === autoSlot.cookingBatchId &&
                (!b.dishId || b.dishId === dish.dishId),
            );
            if (!hasInputForPair) {
              for (const entry of autoSlot.entries) {
                const rows = rowsByDemand.get(entry.dailyMealPortionId) ?? [];
                if (
                  !rows.some(
                    (r) =>
                      r.cookingBatchId === autoSlot.cookingBatchId &&
                      r.dishId === dish.dishId,
                  )
                ) {
                  rows.push({
                    cookingBatchId: autoSlot.cookingBatchId,
                    dishId: dish.dishId,
                    allocatedPortions: entry.allocatedPortions,
                  });
                  rowsByDemand.set(entry.dailyMealPortionId, rows);
                }
              }
            }
          }
        }
      }
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
  /** Anchors each confirmed distribution day (UC-23) after commit. */
  proofs: Pick<
    BlockchainProofService,
    "prepareMealDistributed" | "scheduleAnchor"
  > = blockchainProofService,
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
    async confirmDistribution(
      input: ConfirmDistributionRequest,
      principal: AuthPrincipal,
    ) {
      const requireKitchenStaff = (actor: AuthPrincipal) => {
        if (actor.role !== ROLES.SCHOOL_KITCHEN_STAFF)
          throw new HttpError(
            403,
            "Chỉ nhân viên bếp được xác nhận giao suất ăn",
          );
      };
      requireKitchenStaff(principal);
      assertPermission(principal, "meal_allocation.update");
      schoolIdFor(principal);
      let proof: ProofRef | null = null;
      const result = await withSchoolTransaction(
        await connect(),
        principal,
        "meal_allocation.update",
        async (tx, actor, schoolId) => {
          proof = null;
          requireKitchenStaff(actor);
          const timestamp = now();
          const date = dateFormatter.format(timestamp);
          const day = new Date(date);
          const data = await readAllocationDay(tx, schoolId, day);
          const view = projectAllocationDay(data, date);
          if (view.distribution.status === "DISTRIBUTED") return view;
          if (view.revision !== input.revision)
            throw new HttpError(
              409,
              "Dữ liệu phân bổ đã thay đổi. Vui lòng tải lại.",
              "ALLOCATION_STALE",
            );
          if (view.distribution.status !== "READY")
            throw new HttpError(409, view.distribution.message);
          const ids = data.demands.flatMap((demand) =>
            demand.totalPortions > 0 &&
            demand.MealAllocation?.status === "ALLOCATED"
              ? [demand.MealAllocation.id]
              : [],
          );
          const { count } = await confirmAllocationDistribution(
            tx,
            schoolId,
            day,
            ids,
            actor.id,
            timestamp,
          );
          if (count !== ids.length)
            throw new HttpError(
              409,
              "Dữ liệu phân bổ đã thay đổi. Vui lòng tải lại.",
            );
          proof = await proofs.prepareMealDistributed(
            tx,
            schoolId,
            date,
            actor.id,
          );
          return projectAllocationDay(
            await readAllocationDay(tx, schoolId, day),
            date,
          );
        },
      );
      proofs.scheduleAnchor(proof);
      return result;
    },
  };
}

export const mealAllocationService = createMealAllocationService();
export type MealAllocationService = ReturnType<
  typeof createMealAllocationService
>;
