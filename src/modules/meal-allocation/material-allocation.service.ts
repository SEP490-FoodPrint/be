import { createHash, randomBytes } from "node:crypto";
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
import {
  projectAllocationDay,
  buildGradeAllocationGroups,
} from "./meal-allocation.service";
import type { AuthPrincipal } from "../../types/auth";
import type {
  MaterialPlanRequest,
  MaterialApplyRequest,
  AllocationDraftRequest,
} from "./meal-allocation.request.dto";
import {
  readAllocationDay,
  readMaterialAllocationData,
  writeMaterialAllocation,
} from "./meal-allocation.repository";
import {
  planMaterialAllocation,
  canonicalAmount,
  type MaterialDemand,
  type MaterialSource,
  type MaterialEntry,
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

export async function readValidatedMaterialData(
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
export const allocationDateFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Ho_Chi_Minh",
});
export const allocationHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function scope(principal: AuthPrincipal) {
  if (principal.orgType !== "SCHOOL" || !principal.schoolId)
    throw new HttpError(403, "Yêu cầu tài khoản trường");
  return principal.schoolId;
}

export interface AllocationEditRow {
  demandId: string;
  dishId: string;
  batchId: string;
  allocatedPortions: string;
}

function allocateEditedRows(
  demands: MaterialDemand[],
  sources: MaterialSource[],
  edit: {
    rows: AllocationEditRow[];
    previous: MaterialEntry[];
    complete: boolean;
  },
  dishId: string,
) {
  const D = Prisma.Decimal;
  const remaining = sources.map((s) => ({ ...s, quantity: new D(s.quantity) }));
  const totals = new Map<string, Prisma.Decimal>();
  const seen = new Set<string>();
  const prepared = edit.rows
    .filter((row) => row.dishId === dishId)
    .map((row) => {
      const demand = demands.find((item) => item.id === row.demandId);
      const recipe = demand?.recipes.find(
        (item) => item.batchId === row.batchId,
      );
      const key = row.demandId + ":" + row.batchId;
      if (!demand || !recipe || seen.has(key))
        throw new HttpError(409, "Lớp, món hoặc lô không hợp lệ hay bị trùng");
      seen.add(key);
      const portions = new D(row.allocatedPortions);
      totals.set(
        row.demandId,
        (totals.get(row.demandId) ?? new D(0)).add(portions),
      );
      const previous = edit.previous.find(
        (item) =>
          item.dishId === dishId &&
          item.demandId === row.demandId &&
          item.batchId === row.batchId &&
          portions.eq(item.allocatedPortions),
      );
      return { row, recipe, portions, previous };
    });
  for (const demand of demands) {
    const total = totals.get(demand.id) ?? new D(0);
    if (
      total.gt(demand.portions) ||
      (edit.complete && !total.eq(demand.portions))
    )
      throw new HttpError(
        409,
        "Số suất món chưa khớp nhu cầu của lớp " + demand.className,
      );
  }

  // Reserve the original exact quantities before distributing changed rows.
  const entries: MaterialEntry[] = [];
  for (const { previous } of prepared) {
    if (!previous) continue;
    for (const material of previous.materials) {
      const source = remaining.find(
        (item) =>
          item.batchId === previous.batchId &&
          item.ingredientLotId === material.ingredientLotId &&
          item.ingredientId === material.ingredientId,
      );
      const quantity = new D(material.quantity);
      if (
        !source ||
        source.unit !== material.unit ||
        source.quantity.lt(quantity)
      )
        throw new HttpError(409, "Lượng nguyên liệu của phương án đã thay đổi");
      source.quantity = source.quantity.sub(quantity);
    }
    entries.push(previous);
  }

  for (const { row, recipe, portions, previous } of prepared) {
    if (previous) continue;
    if (!portions.gt(0)) throw new HttpError(409, "Số suất phải lớn hơn 0");
    const materials: MaterialEntry["materials"] = [];
    for (const line of recipe.lines) {
      const standard = canonicalAmount(line.quantityPerPortion, line.unit);
      let required = standard.quantity.mul(portions).toDecimalPlaces(9);
      for (const source of remaining) {
        if (
          source.batchId !== row.batchId ||
          source.ingredientId !== line.ingredientId ||
          source.unit !== standard.unit ||
          source.quantity.lte(0) ||
          required.lte(0)
        )
          continue;
        const used = D.min(source.quantity, required);
        materials.push({
          ingredientLotId: source.ingredientLotId,
          ingredientId: source.ingredientId,
          quantity: used.toFixed(9),
          quantityPerPortion: standard.quantity.toFixed(9),
          unit: standard.unit,
        });
        source.quantity = source.quantity.sub(used);
        required = required.sub(used);
      }
      if (required.gt(0))
        throw new HttpError(
          409,
          "Lô không đủ nguyên liệu cho số suất đã chỉnh",
        );
    }
    if (!materials.length)
      throw new HttpError(409, "Lượng cấp nhỏ hơn độ chính xác lưu trữ");
    entries.push({
      ...row,
      allocatedPortions: portions.toFixed(2),
      theoreticalPortions: portions.toFixed(12),
      materials,
    });
  }

  return {
    entries,
    optimal: false,
    remaining: remaining.map((item) => ({
      ...item,
      quantity: item.quantity.toFixed(9),
    })),
  };
}

export function buildMaterialPlan(
  data: Awaited<ReturnType<typeof readMaterialAllocationData>>,
  date: string,
  input: MaterialPlanRequest,
  edit?: {
    rows: AllocationEditRow[];
    previous: MaterialEntry[];
    complete: boolean;
  },
): MaterialPlanResponseDTO {
  const { day, batches, allocations } = data;
  const revision = allocationHash({ date, input, data });
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
    if (menus.length !== 1 || !demand.Class.gradeId)
      throw new HttpError(
        409,
        "Nhu cầu cần đối soát thực đơn, khối hoặc nhóm dị ứng trước khi tự phân bổ",
      );
    const dishDemands = menus[0].menuDayDishes
      .filter((dish) => dish.mealType === demand.mealType)
      .map((dish) => ({
        dish,
        portions: materialDishDemand(menus[0], demand, dish.dishId, day),
      }));
    if (!dishDemands.some(({ portions }) => portions > 0))
      throw new HttpError(
        409,
        "Lớp " + demand.Class.name + " không còn món có thể phục vụ.",
      );
    for (const { dish, portions } of dishDemands) {
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
  if (
    edit?.rows.some(
      (row) =>
        !demands.some((d) => d.dishId === row.dishId && d.id === row.demandId),
    )
  )
    throw new HttpError(409, "Món hoặc lớp không có nhu cầu phân bổ");
  const deadline = Date.now() + 10000;
  const results = [...new Set(demands.map((d) => d.dishId))].map((dishId) => {
    if (edit)
      return allocateEditedRows(
        demands.filter((d) => d.dishId === dishId),
        sources.filter((s) => s.dishId === dishId),
        edit,
        dishId,
      );
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
                r.dishId === first.dishId &&
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
    planId: allocationHash({ revision, entries }),
    algorithmVersion: 2,
    status: "READY",
    optimal: results.every((r) => r.optimal),
    origin: edit ? "MANUAL" : "GLPK",
    entries: rows,
    totals,
    groups,
    remaining,
  };
}

export const draftRevision = () => randomBytes(32).toString("hex");

function persistedEntries(
  data: Awaited<ReturnType<typeof readMaterialAllocationData>>,
): MaterialEntry[] {
  return data.allocations
    .filter((item) => item.status === "ALLOCATED")
    .flatMap((item) =>
      item.mealAllocationBatches
        .filter((row) => row.allocationVersion === 2)
        .map((row) => ({
          demandId: item.dailyMealPortionId,
          dishId: row.dishId,
          batchId: row.cookingBatchId,
          allocatedPortions: row.allocatedPortions.toString(),
          theoreticalPortions: row.theoreticalPortions!.toString(),
          materials: row.materials.map((line) => ({
            ingredientLotId: line.ingredientLotId,
            ingredientId: line.ingredientId,
            quantity: line.quantity.toString(),
            quantityPerPortion: line.quantityPerPortion.toString(),
            unit: line.unit,
          })),
        })),
    );
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
      if (!query.mealType) {
        if (!day.distribution.canConfirmDistribution) return day;
        const schoolId = scope(principal);
        return withReadTransaction(
          async (tx) => ({
            ...day,
            hasUnappliedDrafts:
              (await tx.mealAllocationDraft.count({
                where: {
                  schoolId,
                  mealDate: new Date(day.date),
                  state: "DRAFT",
                },
              })) > 0,
          }),
          connect,
        );
      }
      if (day.status !== "READY") return day;
      const mealType = query.mealType;
      const schoolId = scope(principal);
      return withReadTransaction(async (tx) => {
        const mealDate = new Date(day.date);
        const draft = await tx.mealAllocationDraft.findUnique({
          where: {
            schoolId_mealDate_mealType: { schoolId, mealDate, mealType },
          },
        });
        const current = await readMaterialAllocationData(
          tx,
          schoolId,
          mealDate,
          mealType,
        );
        const locked = current.allocations.some(
          (item) =>
            item.status === "DISTRIBUTED" || item.status === "FINALIZED",
        );
        if (locked) return { ...day, materialEditing: false };
        if (
          !day.supportsMaterialAllocation &&
          !draft &&
          !current.batches.some((batch) => batch.cookingBatchLots.length)
        )
          return day;
        const editorGrades = buildGradeAllocationGroups(current.day, true);
        const revision = allocationHash({
          date: day.date,
          input: { mealType, priorityClassIds: [] },
          data: current,
        });
        if (draft?.state === "DRAFT")
          return {
            ...day,
            supportsMaterialAllocation: true,
            materialEditing: true,
            editorGrades,
            materialPlan: draft.plan as unknown as MaterialPlanResponseDTO,
            draftRevision: allocationHash({
              draft: draft.revision,
              source: revision,
            }),
            ...(draft.sourceRevision !== revision && {
              materialDraftStale: true,
            }),
          };
        if (current.allocations.some((item) => item.status === "ALLOCATED"))
          return {
            ...day,
            materialEditing: true,
            editorGrades,
            draftRevision: revision,
          };
        return {
          ...day,
          supportsMaterialAllocation: true,
          materialPlanPending: draft?.state !== "FAILED",
          ...(draft?.state === "FAILED" && {
            materialPlanError: draft.error ?? "Không thể tạo đề xuất phân bổ",
          }),
        };
      }, connect);
    },
    preview(input: MaterialPlanRequest, principal: AuthPrincipal) {
      assertPermission(principal, "meal_allocation.view");
      const schoolId = scope(principal),
        date = allocationDateFormat.format(now());
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
    async writeDraft(
      input: AllocationDraftRequest,
      principal: AuthPrincipal,
      apply: boolean,
    ) {
      assertPermission(principal, "meal_allocation.update");
      scope(principal);
      return withSchoolTransaction(
        await connect(),
        principal,
        "meal_allocation.update",
        async (tx, actor, schoolId) => {
          const date = allocationDateFormat.format(now());
          const mealDate = new Date(date);
          const mealType = input.mealType;
          const key = { schoolId, mealDate, mealType };
          const where = { schoolId_mealDate_mealType: key };
          const draft = await tx.mealAllocationDraft.findUnique({ where });
          const data = await readValidatedMaterialData(
            tx,
            schoolId,
            mealDate,
            mealType,
          );
          if (
            data.allocations.some(
              (item) =>
                item.status === "DISTRIBUTED" || item.status === "FINALIZED",
            )
          )
            throw new HttpError(409, "Bữa đã xác nhận giao hoặc đã khóa");
          const day = projectAllocationDay(data.day, date, mealType);
          if (day.status !== "READY")
            throw new HttpError(409, day.message, day.status);
          const parameters = { mealType, priorityClassIds: [] };
          const sourceRevision = allocationHash({
            date,
            input: parameters,
            data,
          });
          const working = draft?.state === "DRAFT" ? draft : null;
          const staleSource =
            working !== null && working.sourceRevision !== sourceRevision;
          const revisionToken = working
            ? allocationHash({
                draft: working.revision,
                source: sourceRevision,
              })
            : sourceRevision;
          if (input.revision !== revisionToken || (staleSource && !input.rows))
            throw new HttpError(
              409,
              "Dữ liệu đã thay đổi. Tải lại để đối chiếu bản nháp.",
              "ALLOCATION_STALE",
            );
          const previous = working
            ? (working.plan as unknown as MaterialPlanResponseDTO).entries
            : persistedEntries(data);
          const changed = input.rows === undefined ? previous : input.rows;
          if (!apply && !input.rows)
            throw new HttpError(400, "Cần gửi các dòng phân bổ đã chỉnh");
          const plan = buildMaterialPlan(data, date, parameters, {
            rows: changed,
            previous: staleSource ? [] : previous,
            complete: apply,
          });
          if (apply) {
            if (
              plan.entries.some(
                (entry) =>
                  !data.allocations.some(
                    (item) => item.dailyMealPortionId === entry.demandId,
                  ),
              )
            )
              assertPermission(actor, "meal_allocation.create");
            await writeMaterialAllocation(
              tx,
              schoolId,
              mealDate,
              actor.id,
              plan.entries,
              data.allocations,
            );
            await tx.mealAllocationDraft.deleteMany({ where: key });
            return { date, mealType, applied: true };
          }
          const revision = draftRevision();
          const values = {
            state: "DRAFT",
            revision,
            sourceRevision,
            plan: JSON.parse(JSON.stringify(plan)) as Prisma.InputJsonValue,
            error: null,
          };
          await tx.mealAllocationDraft.upsert({
            where,
            update: values,
            create: { ...key, ...values },
          });
          return {
            date,
            mealType,
            draftRevision: allocationHash({
              draft: revision,
              source: sourceRevision,
            }),
            materialPlan: plan,
          };
        },
      );
    },
    async retry(mealType: "LUNCH" | "AFTERNOON", principal: AuthPrincipal) {
      return withSchoolTransaction(
        await connect(),
        principal,
        "meal_allocation.update",
        async (tx, _actor, schoolId) => {
          const date = allocationDateFormat.format(now());
          const mealDate = new Date(date);
          const view = projectAllocationDay(
            await readAllocationDay(tx, schoolId, mealDate, mealType),
            date,
            mealType,
          );
          if (view.status !== "READY") throw new HttpError(409, view.message);
          await tx.mealAllocationDraft.updateMany({
            where: { schoolId, mealDate, mealType, state: "FAILED" },
            data: { state: "PENDING", revision: draftRevision(), error: null },
          });
          return { mealType, queued: true };
        },
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
          const date = allocationDateFormat.format(now());
          const data = await readValidatedMaterialData(
            tx,
            schoolId,
            new Date(date),
            input.mealType,
          );
          const draft = await tx.mealAllocationDraft.findUnique({
            where: {
              schoolId_mealDate_mealType: {
                schoolId,
                mealDate: new Date(date),
                mealType: input.mealType,
              },
            },
          });
          const plan = draft?.plan as unknown as MaterialPlanResponseDTO | null;
          if (
            !plan ||
            input.priorityClassIds.length ||
            draft?.state !== "DRAFT" ||
            draft.sourceRevision !==
              allocationHash({
                date,
                input: { mealType: input.mealType, priorityClassIds: [] },
                data,
              }) ||
            data.allocations.some(
              (item) =>
                item.status === "DISTRIBUTED" || item.status === "FINALIZED",
            ) ||
            plan.revision !== input.revision ||
            plan.planId !== input.planId
          )
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
          await tx.mealAllocationDraft.deleteMany({
            where: {
              schoolId,
              mealDate: new Date(date),
              mealType: input.mealType,
            },
          });
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
