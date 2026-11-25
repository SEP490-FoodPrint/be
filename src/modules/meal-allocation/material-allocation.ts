import GLPK, { type LP } from "glpk.js";
import { Prisma } from "../../generated/prisma/client";
import { HttpError } from "../../utils/http-error";
import { convertQuantity } from "../kitchen/kitchen.service";

const D = Prisma.Decimal;
let solver: ReturnType<typeof GLPK> | undefined;
export interface MaterialLine {
  ingredientId: string;
  quantityPerPortion: string;
  unit: string;
}
export interface MaterialSource {
  ingredientName?: string;
  batchId: string;
  dishId: string;
  ingredientLotId: string;
  ingredientId: string;
  quantity: string;
  unit: string;
}
export interface MaterialDemand {
  id: string;
  className: string;
  gradeId: string;
  gradeName: string;
  dishId: string;
  mealType: string;
  portions: number;
  recipes: { batchId: string; lines: MaterialLine[] }[];
}
export interface MaterialEntry {
  demandId: string;
  batchId: string;
  dishId: string;
  theoreticalPortions: string;
  allocatedPortions: string;
  materials: {
    ingredientName?: string;
    ingredientLotId: string;
    ingredientId: string;
    quantity: string;
    quantityPerPortion: string;
    unit: string;
  }[];
}

/** Keep amount and dimension together; unknown count units only match themselves. */
export function canonicalAmount(quantity: string, unit: string) {
  for (const target of ["g", "ml"]) {
    try {
      return {
        quantity: convertQuantity(new D(quantity), unit, target),
        unit: target,
      };
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
    }
  }
  const normalized = unit.trim().normalize("NFC").toLowerCase();
  if (!normalized || new D(quantity).lt(0))
    throw new HttpError(409, "Đơn vị hoặc lượng nguyên liệu không hợp lệ");
  return { quantity: new D(quantity), unit: normalized };
}

export function balanceHundredths(values: string[], target: number): string[] {
  const rows = values.map((value, index) => {
    const scaled = new D(value).mul(100);
    const whole = scaled.floor();
    return { index, value: new D(value), whole, fraction: scaled.sub(whole) };
  });
  const exact = values.reduce((sum, value) => sum.add(value), new D(0));
  if (exact.sub(target).abs().gt("0.000000001"))
    throw new HttpError(409, "Phương án chưa đáp ứng đủ nhu cầu lớp");
  const missing = new D(target)
    .mul(100)
    .sub(rows.reduce((sum, row) => sum.add(row.whole), new D(0)))
    .toNumber();
  if (!Number.isInteger(missing) || missing < 0 || missing > rows.length)
    throw new HttpError(409, "Không đủ để chia đều suất.");
  const order = [...rows].sort(
    (a, b) =>
      b.fraction.cmp(a.fraction) || a.value.cmp(b.value) || a.index - b.index,
  );
  for (const row of order.slice(0, missing)) row.whole = row.whole.add(1);
  return rows.map((row) => row.whole.div(100).toFixed(2));
}

export function planMaterialAllocation(
  demands: MaterialDemand[],
  sources: MaterialSource[],
  deadline = Date.now() + 10000,
) {
  if (!demands.length) throw new HttpError(409, "Chưa có nhu cầu để phân bổ");
  // GLPK registers process listeners when instantiated. Reuse its synchronous solver.
  const glpk = (solver ??= GLPK());
  const lp: LP = {
    name: "meal-materials",
    objective: { direction: glpk.GLP_MIN, name: "links", vars: [] },
    subjectTo: [],
    bounds: [],
    binaries: [],
  };
  const pairs: {
    name: string;
    demand: MaterialDemand;
    batchId: string;
    lines: MaterialLine[];
  }[] = [];
  const capacities = new Map<
    string,
    { amount: Prisma.Decimal; unit: string }
  >();
  const key = (batchId: string, ingredientId: string) =>
    batchId + ":" + ingredientId;
  for (const source of sources) {
    const amount = canonicalAmount(source.quantity, source.unit);
    const id = key(source.batchId, source.ingredientId);
    const previous = capacities.get(id);
    if (previous && previous.unit !== amount.unit)
      throw new HttpError(409, "Đơn vị nguồn không tương thích");
    capacities.set(id, {
      amount: amount.quantity.add(previous?.amount ?? 0),
      unit: amount.unit,
    });
  }
  for (const demand of demands) {
    if (Date.now() >= deadline)
      throw new HttpError(
        409,
        "Chưa tính xong phương án trong giới hạn thời gian; vui lòng thử lại",
      );
    for (const recipe of demand.recipes) {
      const usable =
        recipe.lines.length > 0 &&
        recipe.lines.every((line) => {
          const capacity = capacities.get(
            key(recipe.batchId, line.ingredientId),
          );
          return (
            capacity &&
            canonicalAmount(line.quantityPerPortion, line.unit).unit ===
              capacity.unit
          );
        });
      if (!usable) continue;
      const name = "x" + pairs.length,
        binary = "y" + pairs.length;
      pairs.push({
        name,
        demand,
        batchId: recipe.batchId,
        lines: recipe.lines,
      });
      lp.binaries!.push(binary);
      lp.bounds!.push({ name, type: glpk.GLP_LO, lb: 0, ub: 0 });
      lp.subjectTo.push({
        name: "link" + name,
        vars: [
          { name, coef: 1 },
          { name: binary, coef: -demand.portions },
        ],
        bnds: { type: glpk.GLP_UP, ub: 0, lb: 0 },
      });
      lp.objective.vars.push({ name: binary, coef: 1 });
    }
    lp.subjectTo.push({
      name: "d" + lp.subjectTo.length,
      vars: pairs
        .filter((pair) => pair.demand === demand)
        .map((pair) => ({ name: pair.name, coef: 1 })),
      bnds: { type: glpk.GLP_FX, lb: demand.portions, ub: demand.portions },
    });
  }
  for (const [id, capacity] of capacities) {
    const vars = pairs.flatMap((pair) =>
      pair.lines
        .filter((line) => key(pair.batchId, line.ingredientId) === id)
        .map((line) => ({
          name: pair.name,
          coef: canonicalAmount(
            line.quantityPerPortion,
            line.unit,
          ).quantity.toNumber(),
        })),
    );
    lp.subjectTo.push({
      name: "c" + lp.subjectTo.length,
      vars,
      bnds: { type: glpk.GLP_UP, lb: 0, ub: capacity.amount.toNumber() },
    });
  }
  const solve = () =>
    glpk.solve(lp, {
      tmlim: Math.max(0.001, (deadline - Date.now()) / 1000),
      msglev: glpk.GLP_MSG_OFF,
      presol: true,
    });
  let result = solve();
  if (![glpk.GLP_OPT, glpk.GLP_FEAS].includes(result.result.status))
    throw new HttpError(
      409,
      "Nguyên liệu hoặc phạm vi lô không đáp ứng đủ nhu cầu",
    );
  const optimalLinks = result.result.status === glpk.GLP_OPT;
  if (optimalLinks && Date.now() < deadline - 2000) {
    lp.subjectTo.push({
      name: "minimum_links",
      vars: [...lp.objective.vars],
      bnds: { type: glpk.GLP_FX, lb: result.result.z, ub: result.result.z },
    });
    const groups = new Map<string, string>();
    const objective: { name: string; coef: number }[] = [];
    for (const [index, pair] of pairs.entries()) {
      const id = pair.batchId + ":" + pair.demand.gradeId;
      let binary = groups.get(id);
      if (!binary) {
        binary = "g" + groups.size;
        groups.set(id, binary);
        lp.binaries!.push(binary);
        objective.push({ name: binary, coef: 1 });
      }
      lp.subjectTo.push({
        name: "grade" + index,
        vars: [
          { name: "y" + index, coef: 1 },
          { name: binary, coef: -1 },
        ],
        bnds: { type: glpk.GLP_UP, lb: 0, ub: 0 },
      });
    }
    lp.objective.vars = objective;
    const second = solve();
    if ([glpk.GLP_OPT, glpk.GLP_FEAS].includes(second.result.status))
      result = second;
    if (second.result.status === glpk.GLP_OPT && Date.now() < deadline - 2000) {
      lp.subjectTo.push({
        name: "minimum_grade_links",
        vars: objective,
        bnds: { type: glpk.GLP_FX, lb: second.result.z, ub: second.result.z },
      });
      const batchOrder = [...new Set(sources.map((source) => source.batchId))];
      lp.objective.vars = pairs.map((pair) => ({
        name: pair.name,
        coef:
          (batchOrder.indexOf(pair.batchId) + 1) *
          (demands.length - demands.indexOf(pair.demand)),
      }));
      const third = solve();
      if ([glpk.GLP_OPT, glpk.GLP_FEAS].includes(third.result.status))
        result = third;
    }
  }
  const remaining = sources.map((source) => ({
    ...source,
    ...canonicalAmount(source.quantity, source.unit),
  }));
  const entries: MaterialEntry[] = [];
  for (const demand of demands) {
    const selected = pairs.filter(
      (pair) =>
        pair.demand === demand && (result.result.vars[pair.name] ?? 0) > 1e-10,
    );
    const values = selected.map((pair) =>
      new D(result.result.vars[pair.name]).toDecimalPlaces(12),
    );
    const difference = new D(demand.portions).sub(
      values.reduce((sum, v) => sum.add(v), new D(0)),
    );
    if (difference.abs().gt("0.000000001") || !values.length)
      throw new HttpError(409, "Chưa chia được suất. Vui lòng tính lại.");
    values[values.length - 1] = values[values.length - 1].add(difference);
    const rounded = balanceHundredths(
      values.map((value) => value.toString()),
      demand.portions,
    );
    for (const [index, pair] of selected.entries()) {
      const entry: MaterialEntry = {
        demandId: demand.id,
        batchId: pair.batchId,
        dishId: demand.dishId,
        theoreticalPortions: values[index].toFixed(12),
        allocatedPortions: rounded[index],
        materials: [],
      };
      for (const line of pair.lines) {
        const standard = canonicalAmount(line.quantityPerPortion, line.unit);
        let required = standard.quantity.mul(values[index]).toDecimalPlaces(9);
        for (const source of remaining.filter(
          (source) =>
            source.batchId === pair.batchId &&
            source.ingredientId === line.ingredientId,
        )) {
          if (source.unit !== standard.unit)
            throw new HttpError(409, "Đơn vị không tương thích");
          const used = D.min(required, source.quantity);
          if (used.gt(0)) {
            entry.materials.push({
              ingredientLotId: source.ingredientLotId,
              ingredientId: source.ingredientId,
              quantity: used.toFixed(9),
              quantityPerPortion: standard.quantity.toFixed(9),
              unit: standard.unit,
            });
            source.quantity = source.quantity.sub(used);
            required = required.sub(used);
          }
        }
        if (required.gt(0))
          throw new HttpError(409, "Chưa chia được suất. Vui lòng tính lại.");
      }
      if (!entry.materials.length)
        throw new HttpError(409, "Lượng cấp quá nhỏ. Kiểm tra lại.");
      entries.push(entry);
    }
  }
  return {
    entries,
    optimal: optimalLinks && result.result.status === glpk.GLP_OPT,
    remaining: remaining.map((source) => ({
      ...source,
      quantity: source.quantity.toFixed(9),
    })),
  };
}

export function verifyStoredMaterialAllocations(
  data: import("./meal-allocation.repository").AllocationDay,
): boolean {
  const used = new Map<string, Prisma.Decimal>();
  for (const demand of data.demands) {
    for (const row of demand.MealAllocation?.mealAllocationBatches ?? []) {
      if (row.allocationVersion !== 2) continue;
      if (!row.materials?.length || !row.theoreticalPortions?.gt(0))
        return false;
      const batch = data.batches.find((b) => b.id === row.cookingBatchId);
      if (!batch) return false;
      const byIngredient = new Map<
        string,
        { amount: Prisma.Decimal; standard: Prisma.Decimal; unit: string }
      >();
      for (const material of row.materials) {
        const source = batch.cookingBatchLots?.find(
          (l) =>
            l.dishId === row.dishId &&
            l.ingredientLotId === material.ingredientLotId,
        );
        if (
          !source ||
          !material.quantity.gt(0) ||
          !material.quantityPerPortion.gt(0)
        )
          return false;
        // Lượng lô là lượng sống; thành phẩm đã cấp luôn ≤ lượng sống nên dùng làm cận trên
        // (không phụ thuộc tỷ lệ hao hụt có thể đã đổi sau khi phân bổ).
        const sourceAmount = canonicalAmount(
          source.quantityUsed.toString(),
          source.unit,
        );
        if (sourceAmount.unit !== material.unit) return false;
        const id = [batch.id, row.dishId, material.ingredientLotId].join(":");
        const total = (used.get(id) ?? new D(0)).add(material.quantity);
        if (total.gt(sourceAmount.quantity)) return false;
        used.set(id, total);
        const previous = byIngredient.get(material.ingredientId);
        if (
          previous &&
          (!previous.standard.eq(material.quantityPerPortion) ||
            previous.unit !== material.unit)
        )
          return false;
        byIngredient.set(material.ingredientId, {
          amount: (previous?.amount ?? new D(0)).add(material.quantity),
          standard: material.quantityPerPortion,
          unit: material.unit,
        });
      }
      for (const value of byIngredient.values()) {
        if (
          value.amount
            .sub(value.standard.mul(row.theoreticalPortions))
            .abs()
            .gt("0.000000001")
        )
          return false;
      }
    }
  }
  return true;
}
