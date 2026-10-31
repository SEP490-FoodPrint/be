import { Prisma, type CookingMode } from "../../generated/prisma/client";
import { HttpError } from "../../utils/http-error";

const Decimal = Prisma.Decimal;
export interface RecipeLine {
  ingredientEntryId: string;
  quantityPerPortion: string;
  unit: string;
}
export interface PlanningLot {
  id: string;
  ingredientEntryId: string;
  availableQuantity: string;
  reservedQuantity: string;
  unit: string;
}
export interface BatchPlan {
  plannedPortions: number;
  lots: { ingredientLotId: string; quantityUsed: string; unit: string }[];
}

function positive(value: string): Prisma.Decimal {
  let decimal: Prisma.Decimal;
  try {
    decimal = new Decimal(value);
  } catch {
    throw new HttpError(409, "Định lượng nguyên liệu không hợp lệ");
  }
  if (!decimal.isFinite() || !decimal.gt(0))
    throw new HttpError(409, "Định lượng nguyên liệu phải lớn hơn 0");
  return decimal;
}

const units: Record<string, { dimension: string; factor: string }> = {
  kg: { dimension: "mass", factor: "1000" },
  g: { dimension: "mass", factor: "1" },
  mg: { dimension: "mass", factor: "0.001" },
  l: { dimension: "volume", factor: "1000" },
  ml: { dimension: "volume", factor: "1" },
};
export function convertQuantity(
  quantity: Prisma.Decimal,
  from: string,
  to: string,
): Prisma.Decimal {
  const source = from.trim().toLowerCase();
  const target = to.trim().toLowerCase();
  if (source && source === target) return quantity;
  const left = units[source];
  const right = units[target];
  if (!left || !right || left.dimension !== right.dimension)
    throw new HttpError(
      409,
      "Đơn vị recipe và lô nguyên liệu chưa thể quy đổi",
    );
  return quantity.mul(left.factor).div(right.factor);
}

function storedQuantity(quantity: Prisma.Decimal): string {
  if (
    !quantity.gt(0) ||
    quantity.decimalPlaces() > 3 ||
    quantity.gte("100000000000")
  )
    throw new HttpError(409, "Lượng phân bổ vượt độ chính xác numeric(14,3)");
  return quantity.toFixed(3);
}

/** Input lot order is deterministic; never round a shortage into a valid plan. */
export function planCookingBatches(
  portions: number,
  mode: CookingMode,
  recipe: readonly RecipeLine[],
  stock: readonly PlanningLot[],
): BatchPlan[] {
  if (!Number.isSafeInteger(portions) || portions <= 0 || portions > 2147483647)
    throw new HttpError(409, "Nhu cầu suất ăn không hợp lệ");
  if (
    !recipe.length ||
    new Set(recipe.map((row) => row.ingredientEntryId)).size !== recipe.length
  )
    throw new HttpError(409, "Recipe trống hoặc trùng nguyên liệu");
  if (new Set(stock.map((row) => row.id)).size !== stock.length)
    throw new HttpError(409, "Lô nguyên liệu bị trùng");
  const ingredients = recipe.map((row) => ({
    ...row,
    perPortion: positive(row.quantityPerPortion),
  }));
  const lots = stock.map((lot) => {
    const available = new Decimal(lot.availableQuantity);
    const reserved = new Decimal(lot.reservedQuantity);
    if (
      !available.isFinite() ||
      !reserved.isFinite() ||
      available.lt(0) ||
      reserved.lt(0) ||
      reserved.gt(available)
    )
      throw new HttpError(
        409,
        "Tồn kho hoặc lượng giữ cho mẻ khác không nhất quán",
      );
    return { ...lot, free: available.sub(reserved) };
  });
  const take = (lot: (typeof lots)[number], amount: Prisma.Decimal) => {
    const quantityUsed = storedQuantity(amount);
    if (amount.gt(lot.free))
      throw new HttpError(409, "Không đủ nguyên liệu khả dụng");
    lot.free = lot.free.sub(amount);
    return { ingredientLotId: lot.id, quantityUsed, unit: lot.unit };
  };

  if (mode === "COMBINE_LOTS") {
    const plan: BatchPlan = { plannedPortions: portions, lots: [] };
    for (const ingredient of ingredients) {
      let needed = ingredient.perPortion.mul(portions);
      for (const lot of lots.filter(
        (row) =>
          row.ingredientEntryId === ingredient.ingredientEntryId &&
          row.free.gt(0),
      )) {
        if (needed.isZero()) break;
        const free = convertQuantity(lot.free, lot.unit, ingredient.unit);
        const allocated = Decimal.min(free, needed);
        plan.lots.push(
          take(lot, convertQuantity(allocated, ingredient.unit, lot.unit)),
        );
        needed = needed.sub(allocated);
      }
      if (!needed.isZero())
        throw new HttpError(
          409,
          "Không đủ nguyên liệu khả dụng cho nhu cầu đã chốt",
        );
    }
    return [plan];
  }
  if (mode !== "SEPARATE_BY_LOT")
    throw new HttpError(409, "Chưa cấu hình chế độ chế biến hợp lệ");
  const plans: BatchPlan[] = [];
  let remaining = portions;
  while (remaining > 0) {
    const selected = ingredients.map((ingredient) => {
      for (const lot of lots.filter(
        (row) =>
          row.ingredientEntryId === ingredient.ingredientEntryId &&
          row.free.gt(0),
      )) {
        const perPortion = convertQuantity(
          ingredient.perPortion,
          ingredient.unit,
          lot.unit,
        );
        if (lot.free.gte(perPortion)) return { lot, perPortion };
      }
      throw new HttpError(
        409,
        "Không đủ nguyên liệu để nấu riêng từng lô theo số suất nguyên",
      );
    });
    const count = Math.min(
      remaining,
      ...selected.map(({ lot, perPortion }) =>
        lot.free.div(perPortion).floor().toNumber(),
      ),
    );
    plans.push({
      plannedPortions: count,
      lots: selected.map(({ lot, perPortion }) =>
        take(lot, perPortion.mul(count)),
      ),
    });
    remaining -= count;
  }
  return plans;
}
