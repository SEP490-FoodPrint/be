import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeDayProgress } from "../src/modules/kitchen/kitchen.service";
import type { KitchenDayProgressRow } from "../src/modules/kitchen/kitchen.repository";

const batch = (status: string, sampled = false) => ({
  CookingBatch: { status },
  retainedFoodSamples: sampled ? [{ id: "s" }] : [],
});
const dish = (
  mealType: "LUNCH" | "AFTERNOON",
  name: string,
  batches: ReturnType<typeof batch>[],
) => ({
  mealType,
  dishId: name,
  Dish: { name },
  cookingBatchDishes: batches,
});
const menu = (
  id: string,
  grades: { id: string; name: string }[],
  dishes: ReturnType<typeof dish>[],
) =>
  ({
    id: `day-${id}`,
    WeeklyMenu: {
      id,
      isSchoolWide: !grades.length,
      grades: grades.map((grade) => ({ grade })),
    },
    menuDayDishes: dishes,
  }) as unknown as KitchenDayProgressRow;

void test("tiến độ chế biến trong ngày gom theo khối và bữa", () => {
  const result = summarizeDayProgress(
    [
      menu(
        "m1",
        [{ id: "g1", name: "Khối 1–3" }],
        [
          dish("LUNCH", "Cơm", [batch("COMPLETED", true)]),
          dish("LUNCH", "Canh", [batch("COMPLETED", true), batch("COMPLETED")]),
          dish("AFTERNOON", "Sữa chua", [batch("COMPLETED", true)]),
        ],
      ),
      menu(
        "m2",
        [{ id: "g2", name: "Khối 4–5" }],
        [
          dish("LUNCH", "Cơm", []),
          dish("LUNCH", "Thịt kho", []),
          dish("AFTERNOON", "Cháo", [batch("CONFIRMED")]),
          dish("AFTERNOON", "Bánh", []),
        ],
      ),
    ],
    "2026-11-23",
  );
  assert.equal(result.date, "2026-11-23");
  const [first, second] = result.menus;
  assert.deepEqual(first.grades, [{ id: "g1", name: "Khối 1–3" }]);
  // Một lô của "Canh" chưa lưu mẫu: bữa trưa nấu xong nhưng chưa lưu đủ mẫu
  assert.deepEqual(
    first.meals.map((meal) => [meal.mealType, meal.status, meal.pendingDishes]),
    [
      [
        "LUNCH",
        "COOKED_NO_SAMPLE",
        [{ name: "Canh", status: "COOKED_NO_SAMPLE" }],
      ],
      ["AFTERNOON", "DONE", []],
    ],
  );
  assert.deepEqual(
    second.meals.map((meal) => [
      meal.mealType,
      meal.status,
      meal.notStarted,
      meal.cooking,
    ]),
    [
      ["LUNCH", "NOT_STARTED", 2, 0],
      ["AFTERNOON", "IN_PROGRESS", 1, 1],
    ],
  );
});

void test("bữa không có món thì không trả về; thực đơn toàn trường không có khối", () => {
  const result = summarizeDayProgress(
    [menu("m", [], [dish("LUNCH", "Cơm", [batch("UNCONFIRMED")])])],
    "2026-11-23",
  );
  assert.equal(result.menus[0].isSchoolWide, true);
  assert.deepEqual(
    result.menus[0].meals.map((meal) => [meal.mealType, meal.status]),
    [["LUNCH", "IN_PROGRESS"]],
  );
});
