import assert from "node:assert/strict";
import test from "node:test";
import {
  balanceHundredths,
  planMaterialAllocation,
  type MaterialDemand,
} from "../src/modules/meal-allocation/material-allocation";
void test("hundredth balancing preserves totals and deterministic ties", () => {
  assert.deepEqual(
    balanceHundredths(["16.666666666667", "33.333333333333"], 50),
    ["16.67", "33.33"],
  );
  assert.deepEqual(
    balanceHundredths(
      ["16.666666666666", "16.666666666667", "16.666666666667"],
      50,
    ),
    ["16.66", "16.67", "16.67"],
  );
  assert.deepEqual(balanceHundredths(["16.665", "33.335"], 50), [
    "16.67",
    "33.33",
  ]);
  assert.throws(() => balanceHundredths(["16.66", "33.33"], 50));
});
function demand(
  id: string,
  quantity: string,
  batches: string[],
): MaterialDemand {
  return {
    id,
    className: id,
    gradeId: id,
    gradeName: id,
    dishId: "beef",
    mealType: "LUNCH",
    portions: 50,
    recipes: batches.map((batchId) => ({
      batchId,
      lines: [
        { ingredientId: "beef", quantityPerPortion: quantity, unit: "g" },
      ],
    })),
  };
}
void test("three batches cover two grades with different ingredient standards", () => {
  const plan = planMaterialAllocation(
    [
      demand("g1", "60", ["b1", "b2", "b3"]),
      demand("g2", "80", ["b1", "b2", "b3"]),
    ],
    [2000, 3000, 2000].map((quantity, i) => ({
      batchId: "b" + (i + 1),
      dishId: "beef",
      ingredientLotId: "l" + i,
      ingredientId: "beef",
      quantity: String(quantity),
      unit: "g",
    })),
  );
  for (const id of ["g1", "g2"])
    assert.equal(
      plan.entries
        .filter((e) => e.demandId === id)
        .reduce((s, e) => s + Math.round(Number(e.allocatedPortions) * 100), 0),
      5000,
    );
  assert.equal(
    plan.entries
      .flatMap((e) => e.materials)
      .reduce((s, m) => s + Number(m.quantity), 0),
    7000,
  );
  assert(plan.remaining.every((s) => Number(s.quantity) >= 0));
});
void test("mass cannot substitute for a missing ingredient", () => {
  const d = demand("g1", "60", ["b1"]);
  d.recipes[0].lines.push({
    ingredientId: "mushroom",
    quantityPerPortion: "20",
    unit: "g",
  });
  assert.throws(() =>
    planMaterialAllocation(
      [d],
      [
        {
          batchId: "b1",
          dishId: "beef",
          ingredientLotId: "l1",
          ingredientId: "beef",
          quantity: "10000",
          unit: "g",
        },
      ],
    ),
  );
});
void test("kilograms normalize and fractional contributions retain exact source quantities", () => {
  const plan = planMaterialAllocation(
    [demand("g1", "60", ["b1", "b2"])],
    [1, 2].map((quantity, i) => ({
      batchId: "b" + (i + 1),
      dishId: "beef",
      ingredientLotId: "l" + i,
      ingredientId: "beef",
      quantity: String(quantity),
      unit: "kg",
    })),
  );
  assert.deepEqual(
    plan.entries.map((e) => e.allocatedPortions),
    ["16.67", "33.33"],
  );
  assert.deepEqual(
    plan.entries.map((e) => e.materials[0].quantity),
    ["1000.000000000", "2000.000000000"],
  );
});

void test("zero rounded contribution retains positive source quantities", () => {
  assert.deepEqual(balanceHundredths(["0.004", "49.996"], 50), [
    "0.00",
    "50.00",
  ]);
});

void test("class priority selects earlier batches after link objectives are satisfied", () => {
  const first = demand("priority", "1", ["b1", "b2"]);
  first.portions = 10;
  const second = demand("later", "1", ["b1", "b2"]);
  second.portions = 10;
  const sources = ["b1", "b2"].map((batchId) => ({
    batchId,
    dishId: "beef",
    ingredientLotId: batchId,
    ingredientId: "beef",
    quantity: "10",
    unit: "g",
  }));
  const result = planMaterialAllocation([first, second], sources);
  assert.equal(
    result.entries.find((entry) => entry.demandId === "priority")?.batchId,
    "b1",
  );
  assert.equal(
    result.entries.find((entry) => entry.demandId === "later")?.batchId,
    "b2",
  );
});
