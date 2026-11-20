import { createHash } from "node:crypto";
import type { MaterialPlanResponseDTO } from "./material-allocation.response.dto";
import { z } from "zod";
import { readMealPortionDemand } from "../kitchen/kitchen.service";
import { materialDishDemand } from "./material-allocation-history";
import { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import { withReadTransaction } from "../../utils/read-transaction";
import {
  assertPermission,
  withSchoolTransaction,
} from "../../utils/authorization";
import { HttpError } from "../../utils/http-error";
import type { AuthPrincipal } from "../../types/auth";
import type {
  MaterialPlanRequest,
  MaterialApplyRequest,
} from "./meal-allocation.request.dto";
import {
  readMaterialAllocationData,
  writeMaterialAllocation,
} from "./meal-allocation.repository";
import {
  planMaterialAllocation,
  canonicalAmount,
  type MaterialDemand,
  type MaterialSource,
} from "./material-allocation";

const line = z.object({
  ingredientId: z.string(),
  quantityPerPortion: z
    .string()
    .max(80)
    .regex(/^\d+(?:\.\d+)?$/)
    .refine((value) => new Prisma.Decimal(value).gt(0)),
  unit: z.string().trim().min(1).max(30),
});
const snapshot = z.object({
  version: z.literal(1),
  profiles: z.array(
    z.object({ gradeId: z.string(), lines: z.array(line).min(1) }),
  ),
  fallback: z.array(line).min(1),
});

async function readValidatedMaterialData(
  tx: Prisma.TransactionClient,
  schoolId: string,
  date: Date,
  mealType: "LUNCH" | "AFTERNOON",
) {
  const data = await readMaterialAllocationData(tx, schoolId, date, mealType);
  for (const menu of data.day.menus) {
    if (menu.menuDayDishes.length)
      await readMealPortionDemand(
        tx,
        { menuDayId: menu.id, mealType },
        schoolId,
        date,
      );
  }
  return data;
}
const dateFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Ho_Chi_Minh",
});
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function scope(principal: AuthPrincipal) {
  if (principal.orgType !== "SCHOOL" || !principal.schoolId)
    throw new HttpError(403, "Yêu cầu tài khoản trường");
  return principal.schoolId;
}

export function buildMaterialPlan(
  data: Awaited<ReturnType<typeof readMaterialAllocationData>>,
  date: string,
  input: MaterialPlanRequest,
): MaterialPlanResponseDTO {
  const { day, batches, allocations } = data;
  const revision = hash({ date, input, data });
  if (day.demands.some((d) => d.status !== "FINALIZED"))
    throw new HttpError(409, "Các lớp chưa chốt đủ suất ăn");
  if (
    batches.some(
      (batch) =>
        batch.status !== "COMPLETED" ||
        batch.dishes.some((dish) => !dish.retainedFoodSamples.length),
    )
  )
    throw new HttpError(
      409,
      "Hoàn tất nấu và lưu mẫu cho bữa trước khi phân bổ",
    );
  if (
    new Set(input.priorityClassIds).size !== input.priorityClassIds.length ||
    input.priorityClassIds.some(
      (id) => !day.demands.some((d) => d.Class.id === id),
    )
  )
    throw new HttpError(400, "Thứ tự lớp không hợp lệ");
  const locked = allocations.filter((a) =>
    ["DISTRIBUTED", "FINALIZED"].includes(a.status),
  );
  if (
    locked.some((a) =>
      a.mealAllocationBatches.some(
        (row) => row.allocationVersion !== 2 || !row.materials.length,
      ),
    )
  )
    throw new HttpError(
      409,
      "Phân bổ đã khóa thiếu dữ liệu nguyên liệu; cần đối soát",
    );
  const lockedIds = new Set(
    allocations
      .filter((a) => a.status !== "ALLOCATED")
      .map((a) => a.dailyMealPortionId),
  );
  const sources: MaterialSource[] = batches.flatMap((batch) =>
    batch.cookingBatchLots.map((lot) => {
      const ingredientId =
        lot.IngredientLot.DeliveryItem.IngredientEntry?.ingredientId ??
        lot.IngredientLot.DeliveryItem.SupplyRequestItem?.IngredientEntry
          ?.ingredientId;
      if (!ingredientId)
        throw new HttpError(
          409,
          "Nguồn nguyên liệu chưa xác định được danh mục",
        );
      const normalized = canonicalAmount(lot.quantityUsed.toString(), lot.unit);
      const used = locked
        .flatMap((a) => a.mealAllocationBatches)
        .flatMap((row) => row.materials)
        .filter(
          (m) =>
            m.cookingBatchId === batch.id &&
            m.dishId === lot.dishId &&
            m.ingredientLotId === lot.ingredientLotId,
        )
        .reduce(
          (sum, m) =>
            sum.add(canonicalAmount(m.quantity.toString(), m.unit).quantity),
          new Prisma.Decimal(0),
        );
      const remaining = normalized.quantity.sub(used);
      if (remaining.lt(0))
        throw new HttpError(409, "Lịch sử cấp vượt nguồn nguyên liệu");
      return {
        batchId: batch.id,
        ingredientName: lot.IngredientLot.DeliveryItem.Ingredient?.name,
        dishId: lot.dishId,
        ingredientLotId: lot.ingredientLotId,
        ingredientId,
        quantity: remaining.toString(),
        unit: normalized.unit,
      };
    }),
  );
  const demands: MaterialDemand[] = [];
  const ordered = [...day.demands].sort((a, b) => {
    const ai = input.priorityClassIds.indexOf(a.Class.id),
      bi = input.priorityClassIds.indexOf(b.Class.id);
    return (
      (ai < 0 ? 100000 : ai) - (bi < 0 ? 100000 : bi) ||
      a.id.localeCompare(b.id)
    );
  });
  for (const demand of ordered) {
    if (demand.totalPortions <= 0 || lockedIds.has(demand.id)) continue;
    const menus = day.menus.filter(
      (menu) =>
        menu.menuDayDishes.some((d) => d.mealType === demand.mealType) &&
        (menu.WeeklyMenu?.isSchoolWide !== false ||
          menu.WeeklyMenu.grades.some(
            (g) => g.gradeId === demand.Class.gradeId,
          )),
    );
    if (
      menus.length !== 1 ||
      !demand.Class.gradeId ||
      (demand.dailyAllergyPortions.length > 0 && !menus[0].portionGroups.length)
    )
      throw new HttpError(
        409,
        "Nhu cầu cần đối soát thực đơn, khối hoặc nhóm dị ứng trước khi tự phân bổ",
      );
    for (const dish of menus[0].menuDayDishes) {
      const portions = materialDishDemand(menus[0], demand, dish.dishId);
      if (portions <= 0) continue;
      const recipes = batches
        .filter((b) => b.menuDayId === menus[0].id)
        .flatMap((batch) => {
          const batchDish = batch.dishes.find((d) => d.dishId === dish.dishId);
          if (!batchDish) return [];
          const parsed = snapshot.safeParse(batchDish.allocationRecipeSnapshot);
          const fallback =
            batch.MenuDay?.menuDayDishes
              .find((menuDish) => menuDish.dishId === dish.dishId)
              ?.ingredients.map((ingredient) => ({
                ingredientId: ingredient.ingredientId,
                quantityPerPortion: ingredient.quantityPerPortion.toString(),
                unit: ingredient.unit,
              })) ?? [];
          const gradeLines =
            menus[0].WeeklyMenu?.isSchoolWide !== false
              ? batchDish.Dish?.gradeRecipes
                  .find((recipe) => recipe.gradeId === demand.Class.gradeId)
                  ?.lines.map((recipeLine) => ({
                    ingredientId: recipeLine.entry.ingredientId,
                    quantityPerPortion: recipeLine.requiredQuantity.toString(),
                    unit: recipeLine.unit,
                  }))
              : undefined;
          const lines = parsed.success
            ? (parsed.data.profiles.find(
                (profile) => profile.gradeId === demand.Class.gradeId,
              )?.lines ?? parsed.data.fallback)
            : gradeLines?.length
              ? gradeLines
              : fallback;
          if (!lines.length || !z.array(line).min(1).safeParse(lines).success)
            throw new HttpError(
              409,
              "Chưa có định lượng nguyên liệu hợp lệ cho món và khối",
            );
          return [{ batchId: batch.id, lines }];
        });
      const standards = recipes.map((recipe) =>
        JSON.stringify(
          recipe.lines
            .map((l) => {
              const n = canonicalAmount(l.quantityPerPortion, l.unit);
              return {
                id: l.ingredientId,
                quantity: n.quantity.toString(),
                unit: n.unit,
              };
            })
            .sort((a, b) => a.id.localeCompare(b.id)),
        ),
      );
      if (!recipes.length || standards.some((value) => value !== standards[0]))
        throw new HttpError(
          409,
          "Định lượng giữa các lô không thống nhất; cần đối soát",
        );
      demands.push({
        id: demand.id,
        className: demand.Class.name,
        gradeId: demand.Class.gradeId,
        gradeName: demand.Class.grade?.name ?? "Khối",
        dishId: dish.dishId,
        mealType: demand.mealType,
        portions,
        recipes,
      });
    }
  }
  if (!demands.length)
    throw new HttpError(409, "Không còn nhu cầu có thể chỉnh để phân bổ");
  const deadline = Date.now() + 10000;
  const results = [...new Set(demands.map((d) => d.dishId))].map((dishId) => {
    if (Date.now() >= deadline)
      throw new HttpError(
        409,
        "Chưa tính xong phương án trong giới hạn thời gian; vui lòng thử lại",
      );
    return planMaterialAllocation(
      demands.filter((d) => d.dishId === dishId),
      sources.filter((s) => s.dishId === dishId),
      deadline,
    );
  });
  const entries = results.flatMap((result) => result.entries);
  const rows = entries.map((entry) => {
    const demand = demands.find(
      (d) => d.id === entry.demandId && d.dishId === entry.dishId,
    )!;
    return {
      ...entry,
      materials: entry.materials.map((material) => ({
        ...material,
        ingredientName:
          sources.find(
            (source) => source.ingredientLotId === material.ingredientLotId,
          )?.ingredientName ?? "Nguyên liệu",
      })),
      className: demand.className,
      gradeId: demand.gradeId,
      gradeName: demand.gradeName,
      dishName:
        day.menus
          .flatMap((menu) => menu.menuDayDishes)
          .find((d) => d.dishId === entry.dishId)?.Dish.name ?? "Món ăn",
      batchNumber:
        batches.find((b) => b.id === entry.batchId)?.batchNumber ?? null,
      massKg: entry.materials
        .filter((m) => m.unit === "g")
        .reduce((sum, m) => sum.add(m.quantity), new Prisma.Decimal(0))
        .div(1000)
        .toFixed(9),
    };
  });
  const totals = demands.map((demand) => ({
    demandId: demand.id,
    dishId: demand.dishId,
    className: demand.className,
    gradeId: demand.gradeId,
    requiredPortions: new Prisma.Decimal(demand.portions).toFixed(2),
    allocatedPortions: entries
      .filter((e) => e.demandId === demand.id && e.dishId === demand.dishId)
      .reduce((sum, e) => sum.add(e.allocatedPortions), new Prisma.Decimal(0))
      .toFixed(2),
  }));
  const remaining = results.flatMap((result) => result.remaining);
  const groups = [
    ...new Set(demands.map((d) => d.gradeId + ":" + d.dishId)),
  ].map((key) => {
    const members = demands.filter((d) => d.gradeId + ":" + d.dishId === key);
    const matching = rows.filter(
      (row) => row.gradeId + ":" + row.dishId === key,
    );
    const first = members[0];
    const requiredMass = members.reduce(
      (sum, d) =>
        sum.add(
          d.recipes[0].lines.reduce((mass, l) => {
            const q = canonicalAmount(l.quantityPerPortion, l.unit);
            return q.unit === "g" ? mass.add(q.quantity.mul(d.portions)) : mass;
          }, new Prisma.Decimal(0)),
        ),
      new Prisma.Decimal(0),
    );
    return {
      gradeId: first.gradeId,
      dishId: first.dishId,
      gradeName: first.gradeName,
      dishName: matching[0]?.dishName ?? "Món",
      requiredPortions: new Prisma.Decimal(
        members.reduce((sum, d) => sum + d.portions, 0),
      ).toFixed(2),
      allocatedPortions: matching
        .reduce(
          (sum, row) => sum.add(row.allocatedPortions),
          new Prisma.Decimal(0),
        )
        .toFixed(2),
      requiredMassKg: requiredMass.div(1000).toFixed(9),
      allocatedMassKg: matching
        .reduce((sum, row) => sum.add(row.massKg), new Prisma.Decimal(0))
        .toFixed(9),
      availability: first.recipes.map((recipe) => {
        const capacities = recipe.lines.map((l) => {
          const standard = canonicalAmount(l.quantityPerPortion, l.unit);
          const available = remaining
            .filter(
              (r) =>
                r.batchId === recipe.batchId &&
                r.ingredientId === l.ingredientId,
            )
            .reduce((sum, r) => sum.add(r.quantity), new Prisma.Decimal(0));
          return available.div(standard.quantity);
        });
        return {
          batchId: recipe.batchId,
          batchNumber:
            batches.find((batch) => batch.id === recipe.batchId)?.batchNumber ??
            null,
          availablePortions: Prisma.Decimal.min(...capacities)
            .toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN)
            .toFixed(2),
        };
      }),
    };
  });
  return {
    date,
    mealType: input.mealType,
    revision,
    planId: hash({ revision, entries }),
    algorithmVersion: 2,
    status: "READY",
    optimal: results.every((r) => r.optimal),
    entries: rows,
    totals,
    groups,
    remaining,
  };
}

export function createMaterialAllocationService(
  connect = getPrisma,
  now = () => new Date(),
) {
  return {
    async getToday(
      principal: AuthPrincipal,
      query: import("./meal-allocation.request.dto").AllocationQueryRequest,
      service: import("./meal-allocation.service").MealAllocationService,
    ): Promise<import("./meal-allocation.response.dto").AllocationDayResponse> {
      const day = await service.getToday(principal, query);
      const hasSaved = day.distribution.demands.some(
        (demand) => demand.batches.length > 0,
      );
      if (!query.mealType || day.status !== "READY" || hasSaved) return day;
      try {
        const materialPlan = await this.preview(
          { mealType: query.mealType, priorityClassIds: [] },
          principal,
        );
        return { ...day, supportsMaterialAllocation: true, materialPlan };
      } catch (error) {
        if (!(error instanceof HttpError) || error.statusCode !== 409)
          throw error;
        return {
          ...day,
          supportsMaterialAllocation: true,
          materialPlanError: error.message,
        };
      }
    },
    preview(input: MaterialPlanRequest, principal: AuthPrincipal) {
      assertPermission(principal, "meal_allocation.view");
      const schoolId = scope(principal),
        date = dateFormat.format(now());
      return withReadTransaction(
        async (tx) =>
          buildMaterialPlan(
            await readValidatedMaterialData(
              tx,
              schoolId,
              new Date(date),
              input.mealType,
            ),
            date,
            input,
          ),
        connect,
      );
    },
    async apply(input: MaterialApplyRequest, principal: AuthPrincipal) {
      assertPermission(principal, "meal_allocation.update");
      scope(principal);
      return withSchoolTransaction(
        await connect(),
        principal,
        "meal_allocation.update",
        async (tx, actor, schoolId) => {
          const date = dateFormat.format(now());
          const data = await readValidatedMaterialData(
            tx,
            schoolId,
            new Date(date),
            input.mealType,
          );
          const plan = buildMaterialPlan(data, date, {
            mealType: input.mealType,
            priorityClassIds: input.priorityClassIds,
          });
          if (plan.revision !== input.revision || plan.planId !== input.planId)
            throw new HttpError(
              409,
              "Phương án đã thay đổi; vui lòng tính lại",
              "ALLOCATION_STALE",
            );
          if (
            plan.entries.some(
              (e) =>
                !data.allocations.some(
                  (a) => a.dailyMealPortionId === e.demandId,
                ),
            )
          )
            assertPermission(actor, "meal_allocation.create");
          await writeMaterialAllocation(
            tx,
            schoolId,
            new Date(date),
            actor.id,
            plan.entries,
            data.allocations,
          );
          return { date, mealType: input.mealType, applied: true };
        },
      );
    },
  };
}
export const materialAllocationService = createMaterialAllocationService();
export type MaterialAllocationService = ReturnType<
  typeof createMaterialAllocationService
>;
