import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCarryOver,
  computeFreshDemand,
  unitFactor,
  type CalcInput,
} from "../src/modules/supply-order/fresh-demand.service";
import { HttpError } from "../src/utils/http-error";
import { summarizeAttendance } from "../src/utils/meal-attendance-day";

const G1 = "g1";
const G2 = "g2";
const line = (
  id: string,
  name: string,
  qty: number,
  extra: Partial<
    CalcInput["recipes"] extends Map<string, (infer L)[]> ? L : never
  > = {},
) => ({
  ingredientEntryId: id,
  ingredientId: `ing-${id}`,
  name,
  handlingType: "DIRECT_USE",
  active: true,
  requiredQuantity: qty,
  unit: "g",
  orderUnit: "kg",
  supplierId: "s1",
  supplierName: "NCC",
  ...extra,
});
const dishes = [
  { dishId: "ga", dishName: "Gà xào nấm", mealType: "LUNCH" as const },
  { dishId: "canh", dishName: "Canh nấm", mealType: "AFTERNOON" as const },
];
const recipes = (): CalcInput["recipes"] =>
  new Map([
    [`ga:${G1}`, [line("chicken", "Thịt gà", 50), line("mushroom", "Nấm", 20)]],
    [`ga:${G2}`, [line("chicken", "Thịt gà", 70), line("mushroom", "Nấm", 30)]],
    [`canh:${G1}`, [line("mushroom", "Nấm", 10)]],
    [`canh:${G2}`, [line("mushroom", "Nấm", 15)]],
  ]);
const base = (over: Partial<CalcInput> = {}): CalcInput => ({
  batchNo: 1,
  grades: [
    { id: G1, name: "Khối 1" },
    { id: G2, name: "Khối 2" },
  ],
  planned: new Map([
    [G1, 101],
    [G2, 81],
  ]),
  savedBatch1: null,
  actual: null,
  menus: [
    { id: "m", title: "Toàn trường", isSchoolWide: true, gradeIds: [], dishes },
  ],
  recipes: recipes(),
  ...over,
});
const qty = (r: ReturnType<typeof computeFreshDemand>, id: string) =>
  r.items.find((i) => i.ingredientEntryId === id)?.quantity;

void test("Đợt 1 chia floor theo từng khối và cộng cả bữa chính + bữa xế", () => {
  const r = computeFreshDemand(base());
  assert.deepEqual(
    r.grades.map((g) => g.batchPortions),
    [50, 40],
  );
  assert.equal(qty(r, "chicken"), 5.3);
  assert.equal(qty(r, "mushroom"), 3.3);
});

void test("Thực đơn tách khối cho kết quả giống thực đơn toàn trường", () => {
  const r = computeFreshDemand(
    base({
      menus: [
        { id: "a", title: "K1", isSchoolWide: false, gradeIds: [G1], dishes },
        { id: "b", title: "K2", isSchoolWide: false, gradeIds: [G2], dishes },
      ],
    }),
  );
  assert.equal(qty(r, "chicken"), 5.3);
  assert.equal(qty(r, "mushroom"), 3.3);
});

void test("Đợt 2 trừ theo mốc Đợt 1 đã lưu, không làm tròn", () => {
  const r = computeFreshDemand(
    base({
      batchNo: 2,
      planned: new Map([
        [G1, 120],
        [G2, 90],
      ]),
      savedBatch1: new Map([
        [G1, 50],
        [G2, 40],
      ]),
      actual: new Map([
        [G1, 98],
        [G2, 79],
      ]),
    }),
  );
  assert.deepEqual(
    r.grades.map((g) => g.batchPortions),
    [48, 39],
  );
  assert.equal(qty(r, "chicken"), 5.13);
  assert.equal(qty(r, "mushroom"), 3.195);
});

void test("Đợt 2 bằng 0 khi thực tế thấp hơn mốc Đợt 1", () => {
  const r = computeFreshDemand(
    base({
      batchNo: 2,
      savedBatch1: new Map([
        [G1, 50],
        [G2, 40],
      ]),
      actual: new Map([
        [G1, 30],
        [G2, 41],
      ]),
    }),
  );
  assert.deepEqual(
    r.grades.map((g) => g.batchPortions),
    [0, 1],
  );
});

void test("Báo lỗi khi thiếu công thức theo khối", () => {
  const rec = recipes();
  rec.delete(`canh:${G2}`);
  assert.throws(
    () => computeFreshDemand(base({ recipes: rec })),
    (e: unknown) =>
      e instanceof HttpError && /Canh nấm — Khối 2/.test(e.message),
  );
});

void test("Báo lỗi khi Đợt 2 chưa có mốc Đợt 1", () => {
  assert.throws(
    () => computeFreshDemand(base({ batchNo: 2, actual: new Map([[G1, 1]]) })),
    /chưa có mốc suất Đợt 1/,
  );
});

void test("Báo lỗi khi thực đơn chồng nhau cùng khối cùng buổi", () => {
  assert.throws(
    () =>
      computeFreshDemand(
        base({
          menus: [
            {
              id: "m",
              title: "Toàn trường",
              isSchoolWide: true,
              gradeIds: [],
              dishes,
            },
            {
              id: "a",
              title: "K1",
              isSchoolWide: false,
              gradeIds: [G1],
              dishes,
            },
          ],
        }),
      ),
    /chồng nhau/,
  );
});

void test("Bỏ qua nguyên liệu lưu kho và quy đổi đơn vị", () => {
  const rec = recipes();
  rec
    .get(`ga:${G1}`)!
    .push(line("salt", "Muối", 2, { handlingType: "DRY_STOCK" }));
  const r = computeFreshDemand(base({ recipes: rec }));
  assert.equal(qty(r, "salt"), undefined);
  assert.equal(unitFactor("ml", "lít"), 0.001);
  assert.equal(unitFactor("kg", "kg"), 1);
  assert.equal(unitFactor("quả", "kg"), null);
});

void test("Đợt 2 dùng mốc bù khi Đợt 1 tạo trước khi có bảng mốc", () => {
  const r = computeFreshDemand(
    base({
      batchNo: 2,
      legacyBatch1: true,
      actual: new Map([
        [G1, 98],
        [G2, 79],
      ]),
    }),
  );
  assert.deepEqual(
    r.grades.map((g) => g.batchPortions),
    [48, 39],
  );
});

const item = (r: ReturnType<typeof computeFreshDemand>, id: string) =>
  r.items.find((i) => i.ingredientEntryId === id)!;

void test("Đợt 1 làm tròn xuống, phần lẻ để dành cho Đợt 2", () => {
  const r = computeFreshDemand(base());
  assert.equal(item(r, "chicken").orderQuantity, 5);
  assert.equal(item(r, "chicken").carryOverQuantity, 0.3);
  assert.equal(item(r, "mushroom").orderQuantity, 3);
  assert.equal(item(r, "mushroom").carryOverQuantity, 0.3);
});

void test("Đợt 1 dưới 1 đơn vị: đặt 0, toàn bộ chuyển sang Đợt 2", () => {
  const rec = recipes();
  rec.get(`ga:${G1}`)!.push(line("onion", "Hành", 4));
  const r = computeFreshDemand(base({ recipes: rec }));
  assert.equal(item(r, "onion").orderQuantity, 0);
  assert.equal(item(r, "onion").carryOverQuantity, 0.2);
});

void test("Đợt 2 cộng phần lẻ Đợt 1 vào lượng đặt", () => {
  const r = computeFreshDemand(
    base({
      batchNo: 2,
      savedBatch1: new Map([
        [G1, 50],
        [G2, 40],
      ]),
      actual: new Map([
        [G1, 98],
        [G2, 79],
      ]),
    }),
  );
  const carry = (id: string, name: string, quantity: number) => ({
    ingredientEntryId: id,
    ingredientId: `ing-${id}`,
    name,
    unit: "kg",
    supplierId: "s1",
    supplierName: "NCC",
    quantity,
  });
  const items = applyCarryOver(r.items, [
    carry("chicken", "Thịt gà", 0.3),
    carry("onion", "Hành", 0.2),
  ]);
  const chicken = items.find((i) => i.ingredientEntryId === "chicken")!;
  assert.equal(chicken.quantity, 5.13);
  assert.equal(chicken.carryOverQuantity, 0.3);
  assert.equal(chicken.orderQuantity, 5.43);
  const onion = items.find((i) => i.ingredientEntryId === "onion")!;
  assert.equal(onion.quantity, 0);
  assert.equal(onion.orderQuantity, 0.2);
});

void test("Đợt 2 tính riêng từng bữa: trưa 58, xế 60 trên mốc Đợt 1 là 50", () => {
  const r = computeFreshDemand(
    base({
      batchNo: 2,
      savedBatch1: new Map([
        [G1, 50],
        [G2, 40],
      ]),
      actualByMeal: new Map([
        [
          "LUNCH",
          new Map([
            [G1, 58],
            [G2, 40],
          ]),
        ],
        [
          "AFTERNOON",
          new Map([
            [G1, 60],
            [G2, 40],
          ]),
        ],
      ]),
    }),
  );
  const k1 = r.grades.find((g) => g.gradeId === G1)!;
  assert.deepEqual(k1.meals, [
    { mealType: "LUNCH", actualPortions: 58, batchPortions: 8 },
    { mealType: "AFTERNOON", actualPortions: 60, batchPortions: 10 },
  ]);
  assert.equal(k1.actualPortions, 60);
  // Gà chỉ ở bữa trưa: 8 suất × 50 g; nấm: trưa 8 × 20 g + xế 10 × 10 g.
  assert.equal(qty(r, "chicken"), 0.4);
  assert.equal(qty(r, "mushroom"), 0.26);
});

void test("Điểm danh theo bữa: lớp phải chốt mọi bữa có thực đơn cho khối", () => {
  const summary = summarizeAttendance(
    [
      {
        name: "1A",
        gradeId: G1,
        dailyMealPortions: [
          { mealType: "LUNCH", totalPortions: 30 },
          { mealType: "AFTERNOON", totalPortions: 31 },
        ],
      },
      {
        name: "1B",
        gradeId: G1,
        dailyMealPortions: [{ mealType: "LUNCH", totalPortions: 28 }],
      },
      {
        name: "2A",
        gradeId: G2,
        dailyMealPortions: [{ mealType: "LUNCH", totalPortions: 25 }],
      },
    ],
    [
      {
        isSchoolWide: false,
        grades: [{ gradeId: G1 }],
        menuDays: [
          { menuDayDishes: [{ mealType: "LUNCH" }, { mealType: "AFTERNOON" }] },
        ],
      },
      {
        isSchoolWide: false,
        grades: [{ gradeId: G2 }],
        menuDays: [{ menuDayDishes: [{ mealType: "LUNCH" }] }],
      },
    ],
  );
  assert.deepEqual(summary.pending, ["1B"]);
  assert.equal(summary.actualByMeal.get("LUNCH")!.get(G1), 58);
  assert.equal(summary.actualByMeal.get("AFTERNOON")!.get(G1), 31);
  assert.equal(summary.actualByMeal.get("AFTERNOON")!.has(G2), false);
});
