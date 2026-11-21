import { verifyStoredMaterialAllocations } from "./material-allocation";
import { allergyDishDemand } from "./allergy-dish-demand";
import {
  materialDishDemand,
  projectMaterialHistory,
} from "./material-allocation-history";
import { Prisma } from "../../generated/prisma/client";
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
  AllocationQueryRequest,
  ConfirmDistributionRequest,
} from "./meal-allocation.request.dto";
import type {
  AllocationDayResponse,
  DecimalPortionFields,
} from "./meal-allocation.response.dto";
import {
  confirmAllocationDistribution,
  readAllocationDay,
  writeAllocationDay,
  type AllocationDay,
} from "./meal-allocation.repository";

const addPortions = (left: number, right: number) =>
  new Prisma.Decimal(left).add(right).toNumber();
const hasMaterials = (data: AllocationDay, batchId: string) =>
  data.demands.some((d) =>
    d.MealAllocation?.mealAllocationBatches.some(
      (row) => row.cookingBatchId === batchId && row.allocationVersion === 2,
    ),
  );
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

function mealDishDetails(
  data: AllocationDay,
  menu: AllocationDay["menus"][number],
  demand: AllocationDay["demands"][number],
  dishId: string,
) {
  if (menu.portionGroups.some((group) => group.mealType === demand.mealType))
    return {
      required: materialDishDemand(menu, demand, dishId, data),
      allergens: [] as string[],
    };
  return allergyDishDemand(data, menu, demand, dishId);
}

function dishRequirement(
  data: AllocationDay,
  demand: AllocationDay["demands"][number],
  dishId: string,
) {
  const menu = data.menus.find((menu) => menuAcceptsDemand(menu, demand));
  if (!menu) return demand.totalPortions;
  try {
    return mealDishDetails(data, menu, demand, dishId).required;
  } catch (error) {
    if (!(error instanceof HttpError) || error.statusCode !== 409) throw error;
    return demand.totalPortions;
  }
}

function projectDistribution(
  data: AllocationDay,
): AllocationDayResponse["distribution"] {
  const batchesById = new Map(data.batches.map((batch) => [batch.id, batch]));
  const totalsByBatch = new Map<string, number>();
  let invalid = !verifyStoredMaterialAllocations(data);
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
          (row.allocatedPortions <= 0 && row.allocationVersion !== 2) ||
          !batch.dishes.some((d) => d.dishId === row.dishId)
        ) {
          invalid = true;
          return [];
        }
        allocatedByDish.set(
          row.dishId,
          addPortions(
            allocatedByDish.get(row.dishId) ?? 0,
            row.allocatedPortions,
          ),
        );
      }

      const allocatedPortions = Math.max(
        ...rows.map((r) => r.allocatedPortions),
      );
      totalsByBatch.set(
        batchId,
        addPortions(totalsByBatch.get(batchId) ?? 0, allocatedPortions),
      );
      return [
        {
          batchId,
          allocatedPortions,
          batchCode: batch.batchCode,
          batchNumber: batch.batchNumber ?? null,
        },
      ];
    });

    const acceptedMenu = data.menus.find((menu) =>
      menuAcceptsDemand(menu, demand),
    );
    const menuDishes =
      acceptedMenu?.menuDayDishes.filter(
        (dish) => dish.mealType === demand.mealType,
      ) ?? [];

    const requirements = menuDishes.map((dish) => ({
      dishId: dish.dishId,
      required: dishRequirement(data, demand, dish.dishId),
    }));
    const adjusted = requirements.some(
      ({ required }) => required !== demand.totalPortions,
    );
    const complete =
      requirements.some(({ required }) => required > 0) &&
      requirements.every(
        ({ dishId, required }) =>
          (allocatedByDish.get(dishId) ?? 0) === required,
      );
    if (
      allocation?.status !== "DISTRIBUTED" &&
      requirements.some(
        ({ dishId, required }) => (allocatedByDish.get(dishId) ?? 0) > required,
      )
    )
      invalid = true;
    const allocatedPortions = adjusted
      ? complete || allocation?.status === "DISTRIBUTED"
        ? demand.totalPortions
        : 0
      : menuDishes.length > 0
        ? Math.min(
            ...menuDishes.map((dish) => allocatedByDish.get(dish.dishId) ?? 0),
          )
        : batches.reduce(
            (sum, batch) => addPortions(sum, batch.allocatedPortions),
            0,
          );

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
              (sum, row) => addPortions(sum, row.allocatedPortions),
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
        !hasMaterials(data, batch.id) &&
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
  mealType?: "LUNCH" | "AFTERNOON",
): AllocationDayResponse {
  if (
    data.demands.some((d) =>
      d.MealAllocation?.mealAllocationBatches.some(
        (row) => row.allocationVersion === 2,
      ),
    )
  )
    return projectMaterialHistory(data, date, mealType);
  const batches: AllocationDayResponse["batches"] = data.batches.map(
    (batch) => ({
      id: batch.id,
      batchCode: batch.batchCode,
      batchNumber: batch.batchNumber ?? null,
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
          groups.length
            ? commonCount !== demand.totalPortions ||
              demand.portionGroups.some(
                (group) =>
                  group.portionGroupId !== common?.id && group.portionCount > 0,
              )
            : demand.portionGroups.length > 0
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
          !batch.dishes.length ||
          batch.dishes.some(
            (dish) =>
              !mealDishes.some((required) => required.dishId === dish.dishId),
          )
        )
          issue ??=
            "Có lô thiếu dữ liệu hoặc số suất các món trong lô không khớp.";
      }
      // Tính suất theo món: mỗi món tính max suất từ các lô chứa món đó,
      // rồi lấy min trên các món để ra số suất thực tế của bữa.
      const portionsByDish = new Map<
        string,
        { planned: number; cooked: number; sampled: number }
      >();
      for (const dish of mealDishes) {
        portionsByDish.set(dish.dishId, { planned: 0, cooked: 0, sampled: 0 });
      }
      for (const batch of mealBatches) {
        const rawBatch = rawBatches.find((rb) => rb.id === batch.id);
        if (!rawBatch) continue;
        for (const dish of rawBatch.dishes) {
          const acc = portionsByDish.get(dish.dishId);
          if (!acc) continue;
          const portions =
            dish.plannedPortions ?? rawBatch.plannedPortions ?? 0;
          acc.planned += portions;
          if (rawBatch.status === "COMPLETED") acc.cooked += portions;
          if (rawBatch.status === "COMPLETED" && batch.hasSample)
            acc.sampled += portions;
        }
      }
      for (const demand of daily.filter(
        (row) =>
          row.status === "FINALIZED" &&
          row.totalPortions > 0 &&
          row.dailyAllergyPortions.length > 0,
      )) {
        if (groups.length) continue;
        try {
          const requirements = mealDishes.map((dish) =>
            allergyDishDemand(data, menu, demand, dish.dishId),
          );
          if (
            requirements.length &&
            requirements.every((row) => row.required === 0)
          )
            issue ??=
              "Lớp " +
              demand.Class.name +
              " không còn món có thể phục vụ do dị ứng.";
        } catch (error) {
          if (!(error instanceof HttpError) || error.statusCode !== 409)
            throw error;
          issue ??= error.message;
        }
      }
      const dishStats = [...portionsByDish].map(([dishId, stats]) => {
        const excluded = groups.length
          ? 0
          : daily
              .filter((row) => row.status === "FINALIZED")
              .reduce(
                (sum, row) =>
                  sum + row.totalPortions - dishRequirement(data, row, dishId),
                0,
              );
        const cover = (value: number) =>
          value > finalized ? value : Math.min(finalized, value + excluded);
        return {
          planned: cover(stats.planned),
          cooked: cover(stats.cooked),
          sampled: cover(stats.sampled),
        };
      });
      if (
        [...portionsByDish.values()].some((row) => row.planned > finalized) &&
        !demandPending
      )
        issue ??= "Số suất của lô vượt số suất giáo viên đã chốt.";
      const planned = dishStats.length
        ? Math.min(...dishStats.map((d) => d.planned))
        : 0;
      const sampledCoverage = dishStats.length
        ? Math.min(...dishStats.map((d) => d.sampled))
        : 0;
      const actual = [...portionsByDish.values()];
      const minimum = (key: "planned" | "cooked" | "sampled") =>
        actual.length ? Math.min(...actual.map((row) => row[key])) : 0;
      if (!finalized) demandPending = true;
      return [
        {
          mealType,
          finalized,
          plannedCoverage: planned,
          sampledCoverage,
          planned: minimum("planned"),
          cooked: minimum("cooked"),
          sampled: minimum("sampled"),
        },
      ];
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
    .update(JSON.stringify({ date, mealType: mealType ?? null, data }))
    .digest("hex");
  const response: AllocationDayResponse = {
    supportsMaterialAllocation:
      data.batches.length > 0 &&
      data.batches.every(
        (batch) =>
          batch.dishes.length > 0 &&
          batch.dishes.every(
            (dish) =>
              dish.allocationRecipeSnapshot !== undefined &&
              dish.allocationRecipeSnapshot !== null,
          ),
      ),
    mealType: mealType ?? null,
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
  if (!verifyStoredMaterialAllocations(data))
    return locked("RECONCILE", "Phân bổ nguyên liệu cần đối soát", null);
  if (issue) return locked("RECONCILE", issue, "COOKING");
  if (demandPending)
    return locked(
      "DEMAND_PENDING",
      "Chưa có đủ số suất giáo viên đã chốt.",
      "RETRY",
    );
  if (menuStats.some((meal) => meal.plannedCoverage > meal.finalized))
    return locked(
      "RECONCILE",
      "Số suất của lô vượt số suất giáo viên đã chốt.",
      "COOKING",
    );
  if (
    menuStats.some((meal) => meal.plannedCoverage < meal.finalized) ||
    batches.some((batch) => batch.status !== "COMPLETED")
  )
    return locked(
      "COOKING_PENDING",
      "Hoàn tất lập và nấu các lô hôm nay trước khi phân bổ.",
      "COOKING",
    );
  if (
    missingSampleBatches ||
    menuStats.some((meal) => meal.sampledCoverage !== meal.finalized)
  )
    return locked(
      "SAMPLES_PENDING",
      "Hoàn tất lưu mẫu cho các lô hôm nay trước khi phân bổ.",
      "SAMPLES",
    );

  const demandById = new Map(demands.map((demand) => [demand.id, demand]));
  const batchById = new Map(batches.map((batch) => [batch.id, batch]));
  const rawById = new Map(data.batches.map((batch) => [batch.id, batch]));
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

  // Tổng suất phân bổ theo từng món cho mỗi lớp (demand).
  // Với single-dish batches, mỗi lô chỉ có 1 món, nên cần tổng hợp
  // theo món rồi lấy min trên các món để ra số suất phân bổ thực tế.
  const allocatedByDemandDish = new Map<string, number>();

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
      if (
        !batch ||
        !raw ||
        !batchAcceptsDemand(data, batchId, demand.id) ||
        batch.mealType !== demand.mealType
      )
        return historyError();
      // Mỗi dòng phân bổ phải ứng với 1 món có trong lô, số suất > 0,
      // và tất cả các món trong lô phải có dòng phân bổ cùng số suất.
      const hasAllergy = data.demands
        .find((row) => row.id === demand.id)
        ?.dailyAllergyPortions.some((row) => (row.portionCount ?? 0) > 0);
      const count = Math.max(...rows.map((row) => row.allocatedPortions));
      if (
        (count <= 0 && rows[0].allocationVersion !== 2) ||
        (hasAllergy
          ? rows.some(
              (row) => !raw.dishes.some((dish) => dish.dishId === row.dishId),
            )
          : rows.length !== raw.dishes.length ||
            raw.dishes.some(
              (dish) =>
                !rows.some(
                  (item) =>
                    item.dishId === dish.dishId &&
                    item.allocatedPortions === count,
                ),
            ))
      )
        return historyError();
      batch.entries.push({
        dailyMealPortionId: demand.id,
        allocatedPortions: count,
        locked: demand.locked,
      });
      // Tích lũy theo (demand, dish) thay vì chỉ theo demand,
      // để không cộng lặp khi lớp được phân bổ từ nhiều lô đơn món.
      for (const item of rows) {
        const key = `${demand.id}:${item.dishId}`;
        allocatedByDemandDish.set(
          key,
          addPortions(
            allocatedByDemandDish.get(key) ?? 0,
            item.allocatedPortions,
          ),
        );
      }
    }
    // Chặn lịch sử thiếu món: nếu lớp đã được phân bổ thì tất cả các món trong thực đơn của bữa phải có cùng số suất
    const rawDemand = data.demands.find((d) => d.id === demand.id);
    if (rawDemand) {
      const menu = data.menus.find((m) => menuAcceptsDemand(m, rawDemand));
      const menuDishes =
        menu?.menuDayDishes.filter((d) => d.mealType === demand.mealType) ?? [];
      if (menuDishes.length > 0) {
        const counts = menuDishes.map(
          (dish) =>
            allocatedByDemandDish.get(`${demand.id}:${dish.dishId}`) ?? 0,
        );
        const adjusted = menuDishes.some(
          (dish) =>
            dishRequirement(data, rawDemand, dish.dishId) !==
            rawDemand.totalPortions,
        );
        if (
          !adjusted &&
          counts.some((c) => c > 0) &&
          counts.some((c) => c !== counts[0])
        ) {
          return historyError();
        }
      }
    }
  }
  // Kiểm tra dung lượng lô và nhu cầu lớp.
  // Với suất theo lớp: lấy min trên các món (mỗi món phải đủ suất).
  if (
    batches.some(
      (batch) =>
        !hasMaterials(data, batch.id) &&
        batch.entries.reduce(
          (sum, row) => addPortions(sum, row.allocatedPortions),
          0,
        ) > batch.plannedPortions!,
    ) ||
    demands.some((demand) => {
      const rawDemand = data.demands.find((d) => d.id === demand.id);
      if (!rawDemand) return false;
      const menu = data.menus.find((m) => menuAcceptsDemand(m, rawDemand));
      const menuDishes =
        menu?.menuDayDishes.filter((d) => d.mealType === demand.mealType) ?? [];
      if (!menuDishes.length) return false;
      return menuDishes.some((dish) => {
        const key = `${demand.id}:${dish.dishId}`;
        return (
          (allocatedByDemandDish.get(key) ?? 0) >
          dishRequirement(data, rawDemand, dish.dishId)
        );
      });
    })
  )
    return historyError();

  const gradeGroups = buildGradeAllocationGroups(data);
  return { ...response, demands, grades: gradeGroups };
}

export function buildGradeAllocationGroups(
  data: AllocationDay,
  editing = false,
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
      const classRequirements = relevantDemands.map((d) => {
        const requiredPortions = dishRequirement(data, d, dishId);
        const menu = data.menus.find((item) => menuAcceptsDemand(item, d));
        const grouped = menu?.portionGroups.some(
          (group) => group.mealType === d.mealType,
        );
        const excludedPortions = grouped
          ? 0
          : d.totalPortions - requiredPortions;
        const allergens =
          menu && excludedPortions > 0
            ? mealDishDetails(data, menu, d, dishId).allergens
            : [];
        return {
          demandId: d.id,
          className: d.Class.name,
          requiredPortions,
          excludedPortions,
          allergens,
        };
      });
      const totalRequiredPortions = classRequirements.reduce(
        (sum, d) => sum + d.requiredPortions,
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
          if (
            allocBatch &&
            (allocBatch.allocatedPortions > 0 ||
              (editing && allocBatch.allocationVersion === 2))
          ) {
            entries.push({
              dailyMealPortionId: demand.id,
              className: demand.Class.name,
              allocatedPortions: allocBatch.allocatedPortions,
              locked: demand.MealAllocation?.status !== "ALLOCATED",
            });
            allocatedCount = addPortions(
              allocatedCount,
              allocBatch.allocatedPortions,
            );
          }
        }

        const materialMode = hasMaterials(data, rawBatch.id);
        const batchCapacity =
          materialMode && !editing
            ? allocatedCount
            : (dishInBatch.plannedPortions ?? rawBatch.plannedPortions ?? 0);
        const availablePortions = Prisma.Decimal.max(
          0,
          new Prisma.Decimal(batchCapacity).sub(allocatedCount),
        ).toNumber();
        const batchRecord = rawBatch as {
          id: string;
          batchCode?: string | null;
          batchNumber?: number | null;
        };

        dishBatches.push({
          cookingBatchId: rawBatch.id,
          allocationVersion: materialMode ? 2 : 1,
          allocatedForGrade: new Prisma.Decimal(allocatedCount).toFixed(2),
          batchCode: batchRecord.batchCode || rawBatch.id,
          batchNumber: batchRecord.batchNumber ?? null,
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

      const autoAssigned =
        !editing &&
        isSingleBatch &&
        canCoverAll &&
        !dishBatches.some((batch) => batch.allocationVersion === 2);

      if (autoAssigned && dishBatches.length === 1) {
        dishBatches[0].autoAssigned = true;
        if (dishBatches[0].entries.length === 0 && totalRequiredPortions > 0) {
          dishBatches[0].entries = relevantDemands
            .filter((d) => dishRequirement(data, d, dishId) > 0)
            .map((d) => ({
              dailyMealPortionId: d.id,
              className: d.Class.name,
              allocatedPortions: dishRequirement(data, d, dishId),
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
        classRequirements,
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

export function prepareChanges(
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
  if (
    view.grades?.some((grade) =>
      grade.dishes.some((dish) =>
        dish.classRequirements?.some((row) => row.excludedPortions > 0),
      ),
    ) &&
    input.batches.some((batch) => !batch.dishId)
  )
    throw new HttpError(400, "Cần chỉ rõ món khi phân bổ suất có dị ứng");
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
        used = addPortions(used, entry.allocatedPortions);
        const total = addPortions(
          totalsByDemand.get(demand.id) ?? 0,
          entry.allocatedPortions,
        );
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
          used = addPortions(used, entry.allocatedPortions);
          const demandDishKey = `${demand.id}:${dishId}`;
          const currentDemandTotal = addPortions(
            totalsByDemandDish.get(demandDishKey) ?? 0,
            entry.allocatedPortions,
          );

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

    // Tự động bảo lưu các lô/món không gửi trong request (gồm món autoAssigned và các lô đã phân bổ trước đó)
    if (view.grades) {
      for (const grade of view.grades) {
        for (const dish of grade.dishes) {
          for (const batchSlot of dish.batches) {
            const hasInputForPair = input.batches.some(
              (b) =>
                b.cookingBatchId === batchSlot.cookingBatchId &&
                (!b.dishId || b.dishId === dish.dishId),
            );
            if (!hasInputForPair) {
              for (const entry of batchSlot.entries) {
                const rows = rowsByDemand.get(entry.dailyMealPortionId) ?? [];
                if (
                  !rows.some(
                    (r) =>
                      r.cookingBatchId === batchSlot.cookingBatchId &&
                      r.dishId === dish.dishId,
                  )
                ) {
                  rows.push({
                    cookingBatchId: batchSlot.cookingBatchId,
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
    for (const dishId of new Set(rows.map((row) => row.dishId))) {
      const total = rows
        .filter((row) => row.dishId === dishId)
        .reduce((sum, row) => addPortions(sum, row.allocatedPortions), 0);
      if (total > dishRequirement(data, demand, dishId))
        throw new HttpError(409, "Số suất vượt nhu cầu món của lớp");
    }
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
    getToday(principal: AuthPrincipal, query: AllocationQueryRequest = {}) {
      assertPermission(principal, "meal_allocation.view");
      const schoolId = schoolIdFor(principal);
      const date = dateFormatter.format(now());
      return withReadTransaction(
        async (tx) =>
          projectAllocationDay(
            await readAllocationDay(
              tx,
              schoolId,
              new Date(date),
              query.mealType,
            ),
            date,
            query.mealType,
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
          const data = await readAllocationDay(
            tx,
            schoolId,
            day,
            input.mealType,
          );
          const view = projectAllocationDay(data, date, input.mealType);
          if (view.status !== "READY")
            throw new HttpError(409, view.message, view.status);
          if (view.revision !== input.revision)
            throw new HttpError(
              409,
              "Dữ liệu phân bổ đã thay đổi. Vui lòng tải lại.",
              "ALLOCATION_STALE",
            );
          if (
            data.demands.some((d) =>
              d.MealAllocation?.mealAllocationBatches.some(
                (row) => row.allocationVersion === 2,
              ),
            )
          )
            throw new HttpError(
              409,
              "Phân bổ nguyên liệu phải được tính lại qua phương án tự động",
            );
          const changes = prepareChanges(data, view, input);
          if (changes.some((change) => !change.allocationId))
            assertPermission(actor, "meal_allocation.create");
          if (!changes.length) return view;
          await writeAllocationDay(tx, actor.id, schoolId, day, changes);
          return projectAllocationDay(
            await readAllocationDay(tx, schoolId, day, input.mealType),
            date,
            input.mealType,
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

/** Public wire representation uses strings for decimal portion values. */
export function serializeAllocationPortions<T>(
  value: T,
): DecimalPortionFields<T>;
export function serializeAllocationPortions(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items: unknown[] = value;
    return items.map((item) => serializeAllocationPortions(item));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        [
          "allocatedPortions",
          "availablePortions",
          "plannedPortions",
          "totalRequiredPortions",
        ].includes(key) && typeof item === "number"
          ? new Prisma.Decimal(item).toFixed(2)
          : serializeAllocationPortions(item),
      ]),
    );
  }
  return value;
}
