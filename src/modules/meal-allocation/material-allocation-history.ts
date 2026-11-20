import { createHash } from "node:crypto";
import { Prisma } from "../../generated/prisma/client";
import type { AllocationDay } from "./meal-allocation.repository";
import type { AllocationDayResponse } from "./meal-allocation.response.dto";
import { verifyStoredMaterialAllocations } from "./material-allocation";

const D = Prisma.Decimal;
export function materialDishDemand(
  menu: AllocationDay["menus"][number],
  demand: AllocationDay["demands"][number],
  dishId: string,
): number {
  const groups = menu.portionGroups.filter(
    (group) => group.mealType === demand.mealType,
  );
  if (!groups.length) return demand.totalPortions;
  return groups
    .filter((group) => group.dishes?.some((dish) => dish.dishId === dishId))
    .reduce(
      (sum, group) =>
        sum +
        (demand.portionGroups.find((row) => row.portionGroupId === group.id)
          ?.portionCount ?? 0),
      0,
    );
}

/** New material allocations use dish-specific demand, including allergy alternatives. */
export function projectMaterialHistory(
  data: AllocationDay,
  date: string,
  mealType?: "LUNCH" | "AFTERNOON",
): AllocationDayResponse {
  const response: AllocationDayResponse = {
    supportsMaterialAllocation: true,
    date,
    mealType: mealType ?? null,
    status: "READY",
    message: "",
    action: null,
    totals: { finalized: 0, planned: 0, cooked: 0, sampled: 0 },
    meals: [],
    missingSampleBatches: 0,
    revision: createHash("sha256")
      .update(JSON.stringify({ date, mealType: mealType ?? null, data }))
      .digest("hex"),
    demands: [],
    batches: [],
    grades: [],
    distribution: {
      status: "READY",
      canConfirmDistribution: false,
      message: "",
      meals: [],
      demands: [],
    },
  };
  const issues: string[] = [];
  if (!verifyStoredMaterialAllocations(data))
    issues.push("Lượng nguyên liệu đã phân bổ cần đối soát");
  for (const demand of data.demands) {
    const menus = data.menus.filter(
      (menu) =>
        menu.menuDayDishes.some((d) => d.mealType === demand.mealType) &&
        (menu.WeeklyMenu?.isSchoolWide !== false ||
          menu.WeeklyMenu.grades.some(
            (g) => g.gradeId === demand.Class.gradeId,
          )),
    );
    if (menus.length !== 1) {
      issues.push("Phạm vi thực đơn của lớp không hợp lệ");
      continue;
    }
    const menu = menus[0];
    const rows =
      demand.MealAllocation?.status === "CANCELLED"
        ? []
        : (demand.MealAllocation?.mealAllocationBatches ?? []);
    const expected = menu.menuDayDishes
      .filter((d) => d.mealType === demand.mealType)
      .map((d) => ({
        dish: d,
        required: materialDishDemand(menu, demand, d.dishId),
      }));
    let fulfilled = true;
    for (const { dish, required } of expected) {
      const matching = rows.filter((row) => row.dishId === dish.dishId);
      const sum = matching.reduce(
        (total, row) => total.add(row.allocatedPortions),
        new D(0),
      );
      if (!sum.eq(required)) fulfilled = false;
      if (sum.gt(required))
        issues.push("Số suất đã phân bổ vượt nhu cầu món của lớp");
      let grade = response.grades!.find(
        (g) => g.gradeId === (demand.Class.gradeId ?? "UNASSIGNED"),
      );
      if (!grade) {
        grade = {
          gradeId: demand.Class.gradeId ?? "UNASSIGNED",
          gradeName: demand.Class.grade?.name ?? "Khối",
          demands: [],
          dishes: [],
        };
        response.grades!.push(grade);
      }
      if (!grade.demands.some((d) => d.id === demand.id))
        grade.demands.push({
          id: demand.id,
          classId: demand.Class.id,
          className: demand.Class.name,
          totalPortions: demand.totalPortions,
          locked: demand.MealAllocation?.status !== "ALLOCATED",
        });
      let group = grade.dishes.find(
        (d) => d.dishId === dish.dishId && d.mealType === demand.mealType,
      );
      if (!group) {
        group = {
          dishId: dish.dishId,
          dishName: dish.Dish?.name ?? "Món",
          mealType: demand.mealType,
          totalRequiredPortions: 0,
          autoAssigned: false,
          batches: [],
        };
        grade.dishes.push(group);
      }
      group.totalRequiredPortions += required;
      for (const row of matching) {
        const batch = data.batches.find(
          (b) =>
            b.id === row.cookingBatchId &&
            b.menuDayId === menu.id &&
            b.mealType === demand.mealType &&
            b.dishes.some((d) => d.dishId === row.dishId),
        );
        if (!batch) {
          issues.push("Lô đã phân bổ sai phạm vi");
          continue;
        }
        let slot = group.batches.find((b) => b.cookingBatchId === batch.id);
        if (!slot) {
          slot = {
            cookingBatchId: batch.id,
            batchCode: batch.batchCode,
            batchNumber: batch.batchNumber,
            plannedPortions: 0,
            availablePortions: 0,
            autoAssigned: false,
            allocationVersion: 2,
            entries: [],
          };
          group.batches.push(slot);
        }
        slot.plannedPortions = new D(slot.plannedPortions)
          .add(row.allocatedPortions)
          .toNumber();
        slot.entries.push({
          dailyMealPortionId: demand.id,
          className: demand.Class.name,
          allocatedPortions: row.allocatedPortions,
          locked: true,
        });
      }
    }
    if (rows.some((row) => !expected.some((d) => d.dish.dishId === row.dishId)))
      issues.push("Món đã phân bổ ngoài thực đơn");
    const allocated = fulfilled ? demand.totalPortions : 0;
    response.demands.push({
      id: demand.id,
      name: demand.Class.name,
      mealType: demand.mealType,
      totalPortions: demand.totalPortions,
      locked: demand.MealAllocation?.status !== "ALLOCATED",
    });
    response.distribution.demands.push({
      id: demand.id,
      classId: demand.Class.id,
      className: demand.Class.name,
      mealType: demand.mealType,
      requiredPortions: demand.totalPortions,
      allocatedPortions: allocated,
      allocationStatus: demand.MealAllocation?.status ?? null,
      demandFinalized: demand.status === "FINALIZED",
      batches: rows
        .filter(
          (row, index) =>
            rows.findIndex(
              (other) => other.cookingBatchId === row.cookingBatchId,
            ) === index,
        )
        .map((row) => ({
          batchId: row.cookingBatchId,
          allocatedPortions: Math.max(
            ...rows
              .filter((other) => other.cookingBatchId === row.cookingBatchId)
              .map((other) => other.allocatedPortions),
          ),
          batchNumber: data.batches.find((b) => b.id === row.cookingBatchId)
            ?.batchNumber,
        })),
    });
    if (!fulfilled || demand.status !== "FINALIZED")
      response.distribution.status = "PENDING";
  }
  for (const type of ["LUNCH", "AFTERNOON"] as const) {
    const rows = response.distribution.demands.filter(
      (d) => d.mealType === type,
    );
    if (!rows.length) continue;
    const required = rows.reduce((sum, row) => sum + row.requiredPortions, 0);
    const allocated = rows.reduce((sum, row) => sum + row.allocatedPortions, 0);
    const mealBatches = data.batches.filter((batch) => batch.mealType === type);
    const cooked =
      mealBatches.length > 0 &&
      mealBatches.every((batch) => batch.status === "COMPLETED")
        ? required
        : 0;
    const sampled =
      cooked > 0 &&
      mealBatches.every((batch) =>
        batch.dishes.every((dish) => dish.retainedFoodSamples.length > 0),
      )
        ? required
        : 0;
    response.meals.push({
      mealType: type,
      finalized: required,
      planned: required,
      cooked,
      sampled,
    });
    response.distribution.meals.push({
      mealType: type,
      allocatedPortions: allocated,
    });
    response.totals.finalized += required;
    response.totals.planned += required;
    response.totals.cooked += cooked;
    response.totals.sampled += sampled;
  }
  for (const batch of data.batches) {
    for (const dish of batch.dishes) {
      const legacy = data.demands
        .flatMap((d) =>
          d.MealAllocation?.status === "CANCELLED"
            ? []
            : (d.MealAllocation?.mealAllocationBatches ?? []),
        )
        .filter(
          (row) =>
            row.cookingBatchId === batch.id &&
            row.dishId === dish.dishId &&
            row.allocationVersion !== 2,
        );
      if (
        legacy
          .reduce((sum, row) => sum.add(row.allocatedPortions), new D(0))
          .gt(dish.plannedPortions ?? batch.plannedPortions ?? 0)
      )
        issues.push("Phân bổ lịch sử vượt dung lượng lô");
    }
  }
  response.missingSampleBatches = data.batches.filter((b) =>
    b.dishes.some((d) => !d.retainedFoodSamples.length),
  ).length;
  if (
    data.batches.some((b) => b.status !== "COMPLETED") ||
    response.missingSampleBatches
  )
    issues.push("Bữa ăn chưa hoàn tất nấu và lưu mẫu");
  if (issues.length) {
    response.status = "RECONCILE";
    response.message = issues[0];
    response.distribution.status = "PENDING";
  }
  response.distribution.canConfirmDistribution =
    response.distribution.status === "READY" &&
    response.distribution.demands.some(
      (d) => d.allocationStatus === "ALLOCATED",
    );
  if (
    response.distribution.status === "READY" &&
    !response.distribution.canConfirmDistribution
  )
    response.distribution.status = "DISTRIBUTED";
  response.distribution.message =
    response.message ||
    (response.distribution.status === "PENDING"
      ? "Cần phân bổ đủ suất cho tất cả lớp và bữa trong ngày"
      : "");
  return response;
}
