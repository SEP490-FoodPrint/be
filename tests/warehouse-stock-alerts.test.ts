import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeStockAlerts,
  mealDishPortions,
  type StockAlertSource,
  type StockSupply,
} from "../src/modules/warehouse/warehouse.stock-alerts";

const rice = new Map([["rice", { name: "Gạo tẻ", unit: "kg" }]]);
const need = (date: string, grams: string, portions: number) => ({
  date,
  menuDayId: `day-${date}`,
  mealType: "LUNCH",
  ingredientId: "rice",
  quantityPerPortion: grams,
  unit: "g",
  portions,
});
const lot = (
  quantity: string,
  expiryDate: string | null = null,
): StockSupply => ({
  ingredientId: "rice",
  quantity,
  unit: "kg",
  expiryDate,
  availableFrom: null,
  kind: "LOT",
});
const pending = (quantity: string, availableFrom: string): StockSupply => ({
  ingredientId: "rice",
  quantity,
  unit: "kg",
  expiryDate: null,
  availableFrom,
  kind: "PENDING",
});
const source = (
  supplies: StockSupply[],
  extra: Partial<StockAlertSource> = {},
): StockAlertSource => ({
  ingredients: rice,
  // 100 g × 100 suất = 10 kg mỗi ngày, 3 ngày
  demand: [
    need("2026-11-23", "100", 100),
    need("2026-11-24", "100", 100),
    need("2026-11-25", "100", 100),
  ],
  allocations: [],
  supplies,
  ...extra,
});

void test("đủ đồ lưu kho thì không cảnh báo", () => {
  const result = computeStockAlerts(source([lot("30")]), "2026-11-23");
  assert.deepEqual(result.items, []);
  assert.equal(result.horizonEnd, "2026-11-25");
});

void test("thiếu: báo lượng cần nhập thêm, ngày bắt đầu thiếu và mức theo ngày", () => {
  const [item] = computeStockAlerts(source([lot("15")]), "2026-11-23").items;
  assert.deepEqual(
    [
      item.required,
      item.onHand,
      item.shortage,
      item.firstShortDate,
      item.level,
    ],
    ["30", "15", "15", "2026-11-24", "URGENT"],
  );
  // Ngày thiếu còn cách hơn 1 ngày: chưa gấp
  const [later] = computeStockAlerts(source([lot("25")]), "2026-11-23").items;
  assert.deepEqual(
    [later.shortage, later.firstShortDate, later.level],
    ["5", "2026-11-25", "UPCOMING"],
  );
});

void test("đã gửi yêu cầu nhập đủ trước ngày cần thì hết cảnh báo; nhập thiếu thì còn phần chênh", () => {
  assert.deepEqual(
    computeStockAlerts(
      source([lot("15"), pending("15", "2026-11-24")]),
      "2026-11-23",
    ).items,
    [],
  );
  const [item] = computeStockAlerts(
    source([lot("15"), pending("10", "2026-11-24")]),
    "2026-11-23",
  ).items;
  assert.deepEqual(
    [item.pending, item.shortage, item.firstShortDate],
    ["10", "5", "2026-11-25"],
  );
  // Yêu cầu giao sau ngày cần không bù được ngày đó
  const [late] = computeStockAlerts(
    source([lot("15"), pending("15", "2026-11-25")]),
    "2026-11-23",
  ).items;
  assert.deepEqual([late.shortage, late.firstShortDate], ["5", "2026-11-24"]);
});

void test("lô hết hạn trước ngày dùng không được tính; phần đã phân bổ cho bữa trừ vào nhu cầu", () => {
  const [item] = computeStockAlerts(
    source([lot("30", "2026-11-23")]),
    "2026-11-23",
  ).items;
  assert.deepEqual([item.shortage, item.firstShortDate], ["20", "2026-11-24"]);
  const allocated = computeStockAlerts(
    source([lot("20")], {
      allocations: [
        {
          menuDayId: "day-2026-11-23",
          mealType: "LUNCH",
          ingredientId: "rice",
          quantity: "10000",
          unit: "g",
        },
      ],
    }),
    "2026-11-23",
  );
  assert.deepEqual(allocated.items, []);
});

void test("số suất: lớp chốt dùng số chốt, lớp chưa chốt dùng số đăng ký; món thay thế theo nhóm", () => {
  const groups = [
    { id: "default", isDefault: true, dishIds: ["rice-dish"] },
    { id: "allergy", isDefault: false, dishIds: ["substitute"] },
  ];
  const { total, dishPortions } = mealDishPortions(
    ["rice-dish", "substitute"],
    groups,
    [
      {
        registered: 30,
        finalized: {
          totalPortions: 28,
          groups: [
            { portionGroupId: "default", portionCount: 26 },
            { portionGroupId: "allergy", portionCount: 2 },
          ],
        },
      },
      { registered: 25, finalized: null },
    ],
  );
  assert.equal(total, 53);
  assert.equal(dishPortions.get("rice-dish"), 51);
  assert.equal(dishPortions.get("substitute"), 2);
  assert.equal(
    mealDishPortions(
      ["rice-dish"],
      [],
      [{ registered: 30, finalized: null }],
    ).dishPortions.get("rice-dish"),
    30,
  );
});
