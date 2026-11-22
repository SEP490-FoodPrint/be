import { Prisma } from "../../generated/prisma/client";
import { convertQuantity } from "../kitchen/kitchen.service";
import type {
  StockAlertItemDTO,
  StockAlertsResponseDTO,
} from "./warehouse.response.dto";
import type { StockAlertSourceRows } from "./warehouse.repository";

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;
const DAY_MS = 86400000;

/** Một dòng nhu cầu của bữa: nguyên liệu × định mức × số suất. */
export interface StockDemandLine {
  date: string;
  menuDayId: string;
  mealType: string;
  ingredientId: string;
  quantityPerPortion: string;
  unit: string;
  portions: number;
}
/** Lượng đã phân bổ cho bữa (lô nấu / gia vị chung đã giữ hoặc đã dùng). */
export interface StockAllocation {
  menuDayId: string;
  mealType: string;
  ingredientId: string;
  quantity: string;
  unit: string;
}
export interface StockSupply {
  ingredientId: string;
  quantity: string;
  unit: string;
  /** Hạn dùng (YYYY-MM-DD); null = không hạn. */
  expiryDate: string | null;
  /** Dùng được từ ngày (YYYY-MM-DD); null = ngay. */
  availableFrom: string | null;
  kind: "LOT" | "PENDING";
}
export interface StockAlertSource {
  ingredients: Map<string, { name: string; unit: string }>;
  demand: StockDemandLine[];
  allocations: StockAllocation[];
  supplies: StockSupply[];
}

const safeConvert = (quantity: Decimal, from: string, to: string) => {
  try {
    return convertQuantity(quantity, from, to);
  } catch {
    return null;
  }
};
const addDays = (date: string, days: number) =>
  new Date(Date.parse(date + "T00:00:00Z") + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
const text = (value: Decimal) => value.toDecimalPlaces(3).toString();

/**
 * Mô phỏng dùng kho theo từng ngày cho mỗi nguyên liệu lưu kho: ngày nào cũng lấy lô còn hạn
 * (hạn sớm dùng trước) và các yêu cầu nhập đã gửi có ngày giao không muộn hơn ngày đó.
 * Phần không đủ là lượng cần nhập thêm; ngày đầu tiên thiếu quyết định mức cảnh báo.
 */
export function computeStockAlerts(
  source: StockAlertSource,
  today: string,
): StockAlertsResponseDTO {
  const tomorrow = addDays(today, 1);
  const days = [...new Set(source.demand.map((line) => line.date))].sort();
  const items: StockAlertItemDTO[] = [];
  for (const [ingredientId, ingredient] of source.ingredients) {
    const unit = ingredient.unit;
    // Nhu cầu từng bữa, trừ phần đã phân bổ cho chính bữa đó
    const perMeal = new Map<string, { date: string; need: Decimal }>();
    for (const line of source.demand) {
      if (line.ingredientId !== ingredientId) continue;
      const quantity = safeConvert(
        new Decimal(line.quantityPerPortion).mul(line.portions),
        line.unit,
        unit,
      );
      if (!quantity) continue;
      const key = `${line.menuDayId}:${line.mealType}`;
      const meal = perMeal.get(key) ?? {
        date: line.date,
        need: new Decimal(0),
      };
      meal.need = meal.need.add(quantity);
      perMeal.set(key, meal);
    }
    if (!perMeal.size) continue;
    for (const allocation of source.allocations) {
      if (allocation.ingredientId !== ingredientId) continue;
      const meal = perMeal.get(
        `${allocation.menuDayId}:${allocation.mealType}`,
      );
      const quantity = safeConvert(
        new Decimal(allocation.quantity),
        allocation.unit,
        unit,
      );
      if (meal && quantity) meal.need = Decimal.max(0, meal.need.sub(quantity));
    }
    const supplies = source.supplies
      .filter((supply) => supply.ingredientId === ingredientId)
      .flatMap((supply) => {
        const quantity = safeConvert(
          new Decimal(supply.quantity),
          supply.unit,
          unit,
        );
        return quantity && quantity.gt(0)
          ? [{ ...supply, left: quantity }]
          : [];
      })
      .sort(
        (a, b) =>
          (a.expiryDate ?? "9999-12-31").localeCompare(
            b.expiryDate ?? "9999-12-31",
          ) || (a.availableFrom ?? "").localeCompare(b.availableFrom ?? ""),
      );
    const onHand = supplies
      .filter((supply) => supply.kind === "LOT")
      .reduce((sum, supply) => sum.add(supply.left), new Decimal(0));
    const pending = supplies
      .filter((supply) => supply.kind === "PENDING")
      .reduce((sum, supply) => sum.add(supply.left), new Decimal(0));
    let required = new Decimal(0);
    let shortage = new Decimal(0);
    let firstShortDate: string | null = null;
    for (const day of days) {
      let need = [...perMeal.values()]
        .filter((meal) => meal.date === day)
        .reduce((sum, meal) => sum.add(meal.need), new Decimal(0));
      required = required.add(need);
      for (const supply of supplies) {
        if (need.lte(0)) break;
        if (supply.left.lte(0)) continue;
        if (supply.availableFrom && supply.availableFrom > day) continue;
        if (supply.expiryDate && supply.expiryDate < day) continue;
        const used = Decimal.min(supply.left, need);
        supply.left = supply.left.sub(used);
        need = need.sub(used);
      }
      if (need.gt(0)) {
        shortage = shortage.add(need);
        firstShortDate ??= day;
      }
    }
    if (!firstShortDate || shortage.lte(0)) continue;
    items.push({
      ingredientId,
      name: ingredient.name,
      unit,
      required: text(required),
      onHand: text(onHand),
      pending: text(pending),
      shortage: text(shortage),
      firstShortDate,
      level: firstShortDate <= tomorrow ? "URGENT" : "UPCOMING",
    });
  }
  items.sort(
    (a, b) =>
      a.firstShortDate.localeCompare(b.firstShortDate) ||
      a.name.localeCompare(b.name, "vi"),
  );
  return { date: today, horizonEnd: days.at(-1) ?? null, items };
}

/** Số suất của một bữa: lớp đã chốt dùng số chốt, lớp chưa chốt ước tính bằng số đăng ký. */
export interface StockMealClass {
  registered: number;
  finalized: {
    totalPortions: number;
    groups: { portionGroupId: string; portionCount: number }[];
  } | null;
}
export interface StockMealGroup {
  id: string;
  isDefault: boolean;
  dishIds: string[];
}

/** Số suất từng món của bữa, theo nhóm suất (món thay thế chỉ tính cho nhóm có món đó). */
export function mealDishPortions(
  dishIds: string[],
  groups: StockMealGroup[],
  classes: StockMealClass[],
): { total: number; dishPortions: Map<string, number> } {
  const total = classes.reduce(
    (sum, row) =>
      sum + (row.finalized ? row.finalized.totalPortions : row.registered),
    0,
  );
  const dishPortions = new Map<string, number>();
  for (const dishId of dishIds) {
    if (!groups.length) {
      dishPortions.set(dishId, total);
      continue;
    }
    const inDefault = groups.some(
      (group) => group.isDefault && group.dishIds.includes(dishId),
    );
    let portions = 0;
    for (const row of classes) {
      if (row.finalized?.groups.length) {
        portions += row.finalized.groups
          .filter((item) =>
            groups.some(
              (group) =>
                group.id === item.portionGroupId &&
                group.dishIds.includes(dishId),
            ),
          )
          .reduce((sum, item) => sum + item.portionCount, 0);
      } else if (inDefault) {
        portions += row.finalized
          ? row.finalized.totalPortions
          : row.registered;
      }
    }
    dishPortions.set(dishId, portions);
  }
  return { total, dishPortions };
}

const isoDate = (value: Date) => value.toISOString().slice(0, 10);

/**
 * Chuyển dữ liệu DB thành đầu vào tính cảnh báo. Chỉ tính nguyên liệu mà trường xếp là đồ lưu kho
 * (mọi mục ACTIVE của nguyên liệu đều là DRY_STOCK). Gia vị chung của bữa thay cho phần gia vị
 * cùng nguyên liệu trong công thức từng món (không tính hai lần).
 */
export function buildStockAlertSource(
  rows: StockAlertSourceRows,
  today: string,
): StockAlertSource {
  const handling = new Map<string, Set<string>>();
  const ingredients = new Map<string, { name: string; unit: string }>();
  for (const entry of rows.entries) {
    const types = handling.get(entry.ingredientId) ?? new Set<string>();
    types.add(entry.handlingType);
    handling.set(entry.ingredientId, types);
    ingredients.set(entry.ingredientId, {
      name: entry.Ingredient.name,
      unit: entry.Ingredient.defaultUnit,
    });
  }
  for (const [ingredientId, types] of handling)
    if (types.size !== 1 || !types.has("DRY_STOCK"))
      ingredients.delete(ingredientId);

  const demand: StockDemandLine[] = [];
  for (const day of rows.menuDays) {
    const date = isoDate(day.menuDate);
    if (date < today) continue;
    const classRows =
      rows.classes.find((item) => item.menuDayId === day.id)?.rows ?? [];
    for (const mealType of ["LUNCH", "AFTERNOON"] as const) {
      const lines = rows.dishLines.filter(
        (line) => line.menuDayId === day.id && line.mealType === mealType,
      );
      const spices = rows.seasonings.filter(
        (row) => row.menuDayId === day.id && row.mealType === mealType,
      );
      if (!lines.length && !spices.length) continue;
      const { total, dishPortions } = mealDishPortions(
        [...new Set(lines.map((line) => line.dishId))],
        rows.groups
          .filter(
            (group) =>
              group.menuDayId === day.id && group.mealType === mealType,
          )
          .map((group) => ({
            id: group.id,
            isDefault: group.isDefault,
            dishIds: group.dishes.map((dish) => dish.dishId),
          })),
        classRows.map((row) => {
          const finalized = row.dailyMealPortions.find(
            (portion) => portion.mealType === mealType,
          );
          return {
            registered: row.registeredMealPortions,
            finalized: finalized
              ? {
                  totalPortions: finalized.totalPortions,
                  groups: finalized.portionGroups,
                }
              : null,
          };
        }),
      );
      const spiceIds = new Set(
        spices.map((row) => row.ingredientEntry.ingredientId),
      );
      for (const line of lines) {
        if (!ingredients.has(line.ingredientId)) continue;
        if (spiceIds.has(line.ingredientId)) continue;
        demand.push({
          date,
          menuDayId: day.id,
          mealType,
          ingredientId: line.ingredientId,
          quantityPerPortion: line.quantityPerPortion.toString(),
          unit: line.unit,
          portions: dishPortions.get(line.dishId) ?? 0,
        });
      }
      for (const spice of spices) {
        const ingredientId = spice.ingredientEntry.ingredientId;
        if (!ingredients.has(ingredientId)) continue;
        demand.push({
          date,
          menuDayId: day.id,
          mealType,
          ingredientId,
          quantityPerPortion: spice.quantityPerPortion.toString(),
          unit: spice.unit,
          portions: total,
        });
      }
    }
  }

  const allocations: StockAllocation[] = [
    ...rows.batchLots.map((row) => ({
      menuDayId: row.CookingBatch.menuDayId,
      mealType: row.CookingBatch.mealType,
      ingredientId: row.IngredientLot.DeliveryItem.ingredientId,
      quantity: row.quantityUsed.toString(),
      unit: row.unit,
    })),
    ...rows.seasoningLots.map((row) => ({
      menuDayId: row.menuDayId,
      mealType: row.mealType,
      ingredientId: row.ingredientLot.DeliveryItem.ingredientId,
      quantity: row.quantityUsed.toString(),
      unit: row.unit,
    })),
  ];

  const supplies: StockSupply[] = [];
  for (const lot of rows.lots) {
    let free = new Decimal(lot.availableQuantity);
    for (const hold of rows.reservations) {
      if (hold.ingredientLotId !== lot.id) continue;
      const quantity = safeConvert(hold.quantityUsed, hold.unit, lot.unit);
      if (quantity) free = free.sub(quantity);
    }
    if (free.lte(0)) continue;
    supplies.push({
      ingredientId: lot.DeliveryItem.ingredientId,
      quantity: free.toString(),
      unit: lot.unit,
      expiryDate: lot.expiryDate ? isoDate(lot.expiryDate) : null,
      availableFrom: null,
      kind: "LOT",
    });
  }
  for (const item of rows.pendingItems) {
    let left = new Decimal(item.requestedQuantity);
    for (const received of item.deliveryItems) {
      const quantity = safeConvert(
        received.actualQuantity,
        received.unit,
        item.unit,
      );
      if (quantity) left = left.sub(quantity);
    }
    if (left.lte(0)) continue;
    const deliveryDate = item.SupplyRequest.requestedDeliveryDate;
    supplies.push({
      ingredientId: item.IngredientEntry.ingredientId,
      quantity: left.toString(),
      unit: item.unit,
      expiryDate: null,
      availableFrom: deliveryDate ? isoDate(deliveryDate) : null,
      kind: "PENDING",
    });
  }
  return { ingredients, demand, allocations, supplies };
}
