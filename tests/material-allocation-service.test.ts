import assert from "node:assert/strict";
import { solveInWorker } from "../src/modules/meal-allocation/material-allocation-runtime";
import { projectAllocationDay } from "../src/modules/meal-allocation/meal-allocation.service";
import type { AllocationDay } from "../src/modules/meal-allocation/meal-allocation.repository";
import { createMaterialAllocationService } from "../src/modules/meal-allocation/material-allocation.service";
import { testStaff } from "./helpers/authorization";
import test from "node:test";
import { Prisma } from "../src/generated/prisma/client";
import {
  buildMaterialPlan,
  publicMaterialPlan,
} from "../src/modules/meal-allocation/material-allocation.service";
import { validateAllocationApply } from "../src/modules/meal-allocation/meal-allocation.validation";
import { serializeAllocationPortions } from "../src/modules/meal-allocation/meal-allocation.service";

type Data = Parameters<typeof buildMaterialPlan>[0];

void test("material endpoints reject missing permission before connecting", async () => {
  let connected = false;
  const service = createMaterialAllocationService(() => {
    connected = true;
    throw new Error("unexpected connection");
  });
  const principal = { ...testStaff, permissions: [] };
  const draft = {
    mealType: "LUNCH" as const,
    revision: "a".repeat(64),
    rows: [],
  };
  for (const call of [
    () => service.writeDraft(draft, principal, false),
    () => service.writeDraft(draft, principal, true),
    () => service.retry("LUNCH", principal),
  ])
    await assert.rejects(call, { statusCode: 403 });
  assert.equal(connected, false);
});
function fixture(): Data {
  const snapshot = {
    version: 1,
    profiles: [],
    fallback: [{ ingredientId: "beef", quantityPerPortion: "60", unit: "g" }],
  };
  const data = {
    day: {
      menus: [
        {
          id: "menu",
          WeeklyMenu: { isSchoolWide: true, grades: [] },
          menuDayDishes: [
            { dishId: "dish", mealType: "LUNCH", Dish: { name: "Bò" } },
          ],
          portionGroups: [],
        },
      ],
      demands: [
        {
          id: "d1",
          mealType: "LUNCH",
          totalPortions: 50,
          status: "FINALIZED",
          Class: {
            id: "class",
            name: "4A",
            gradeId: "grade",
            grade: { name: "4" },
          },
          dailyAllergyPortions: [],
          portionGroups: [],
          MealAllocation: null,
        },
      ],
      batches: [],
    },
    batches: [1000, 2000].map((quantity, index) => ({
      id: "b" + index,
      menuDayId: "menu",
      batchNumber: index + 1,
      status: "COMPLETED",
      dishes: [
        {
          dishId: "dish",
          allocationRecipeSnapshot: snapshot,
          retainedFoodSamples: [{ id: "sample" }],
        },
      ],
      cookingBatchLots: [
        {
          dishId: "dish",
          ingredientLotId: "lot" + index,
          quantityUsed: new Prisma.Decimal(quantity),
          unit: "g",
          IngredientLot: {
            DeliveryItem: {
              IngredientEntry: { ingredientId: "beef" },
              SupplyRequestItem: null,
            },
          },
        },
      ],
    })),
    allocations: [],
  };
  return data as unknown as Data;
}
void test("plan serves scope-local classes, source totals and stable plan identity", () => {
  const data = fixture(),
    input = { mealType: "LUNCH" as const, priorityClassIds: [] };
  const plan = buildMaterialPlan(data, "2026-11-20", input);
  assert.deepEqual(
    plan.entries.map((e) => e.allocatedPortions),
    ["16.67", "33.33"],
  );
  assert.equal(plan.groups[0].allocatedMassKg, "3.000000000");
  assert.equal(plan.groups[0].allocatedPortions, "50.00");
  assert.equal(
    plan.revision,
    buildMaterialPlan(data, "2026-11-20", input).revision,
  );
  data.day.demands[0].Class.name = "4B";
  assert.notEqual(
    plan.revision,
    buildMaterialPlan(data, "2026-11-20", input).revision,
  );
});

void test("retained sample quantities and sample-only lots are excluded from material allocation", () => {
  const data = fixture();
  const batch = data.batches[0];
  const cookingLot = {
    ...batch.cookingBatchLots[0],
    sampleQuantity: new Prisma.Decimal(300),
  };
  const sampleOnly = {
    ...cookingLot,
    ingredientLotId: "sample-only",
    quantityUsed: new Prisma.Decimal(0),
  };
  batch.cookingBatchLots = [cookingLot, sampleOnly];
  const plan = buildMaterialPlan(data, "2026-11-20", {
    mealType: "LUNCH",
    priorityClassIds: [],
  });
  assert.equal(plan.groups[0].allocatedMassKg, "3.000000000");
});
void test("draft worker solves off the API thread using serialized quantities", async () => {
  const plan = await solveInWorker(fixture(), "2026-11-20", "LUNCH");
  assert.equal(plan.groups[0].allocatedPortions, "50.00");
  assert.equal(plan.groups[0].allocatedMassKg, "3.000000000");
});

void test("editable draft preserves exact GLPK quantities and rejects invalid apply", () => {
  const data = fixture();
  const input = { mealType: "LUNCH" as const, priorityClassIds: [] };
  const date = "2026-11-20";
  const proposed = buildMaterialPlan(data, date, input);
  const first = proposed.entries[0];
  const second = proposed.entries[1];
  const edited = { ...second, allocatedPortions: "30.00" };
  const saved = buildMaterialPlan(data, date, input, {
    rows: [first, edited],
    previous: proposed.entries,
    complete: false,
  });
  assert.equal(saved.entries[0].theoreticalPortions, first.theoreticalPortions);
  assert.equal(
    saved.entries[0].materials[0].quantity,
    first.materials[0].quantity,
  );
  assert.equal(saved.entries[1].materials[0].quantity, "1800.000000000");
  assert.throws(
    () =>
      buildMaterialPlan(data, date, input, {
        rows: [first, edited],
        previous: saved.entries,
        complete: true,
      }),
    /chưa khớp nhu cầu/,
  );
  assert.throws(
    () =>
      buildMaterialPlan(data, date, input, {
        rows: [{ ...second, allocatedPortions: "34.00" }],
        previous: proposed.entries,
        complete: false,
      }),
    /không đủ nguyên liệu/,
  );
  assert.throws(
    () =>
      buildMaterialPlan(data, date, input, {
        rows: [first, first],
        previous: proposed.entries,
        complete: false,
      }),
    /bị trùng/,
  );
});

void test("legacy batch uses approved menu ingredients when snapshot is absent", () => {
  const data = fixture();
  for (const batch of data.batches) {
    batch.dishes[0].allocationRecipeSnapshot = null;
    batch.MenuDay = {
      menuDayDishes: [
        {
          dishId: "dish",
          ingredients: [
            {
              ingredientId: "beef",
              quantityPerPortion: new Prisma.Decimal(60),
              unit: "g",
            },
          ],
        },
      ],
    };
  }
  const plan = buildMaterialPlan(data, "2026-11-20", {
    mealType: "LUNCH",
    priorityClassIds: [],
  });
  assert.deepEqual(
    plan.entries.map((entry) => entry.allocatedPortions),
    ["16.67", "33.33"],
  );
  assert.equal(plan.groups[0].allocatedMassKg, "3.000000000");
  data.batches[0].MenuDay.menuDayDishes[0].ingredients[0].quantityPerPortion =
    new Prisma.Decimal(61);
  assert.throws(
    () =>
      buildMaterialPlan(data, "2026-11-20", {
        mealType: "LUNCH",
        priorityClassIds: [],
      }),
    /khác nhau/,
  );
});

void test("older round snapshots allocate main ingredients while shared seasonings stay in the meal", () => {
  const data = fixture();
  data.day.menus[0].mealSeasonings = [
    {
      mealType: "LUNCH",
      ingredientEntry: { ingredientId: "salt", Ingredient: { name: "Muối" } },
    },
  ];
  const snapshot = {
    version: 1,
    profiles: [],
    fallback: [
      { ingredientId: "beef", quantityPerPortion: "60", unit: "g" },
      { ingredientId: "salt", quantityPerPortion: "1", unit: "g" },
    ],
  };
  for (const [index, batch] of data.batches.entries()) {
    batch.supplyBatchNo = index + 1;
    batch.dishes[0].allocationRecipeSnapshot = snapshot;
  }
  const input = { mealType: "LUNCH" as const, priorityClassIds: [] };
  const plan = buildMaterialPlan(data, "2026-11-20", input);
  assert.deepEqual(
    [
      ...new Set(
        plan.entries.flatMap(({ materials }) =>
          materials.map(({ ingredientId }) => ingredientId),
        ),
      ),
    ],
    ["beef"],
  );
  for (const batch of data.batches) batch.supplyBatchNo = null;
  assert.throws(
    () => buildMaterialPlan(data, "2026-11-20", input),
    /không đáp ứng đủ nhu cầu/,
  );
});
void test("legacy missing snapshot and unfinished cooking block preview", () => {
  const data = fixture();
  data.batches[0].dishes[0].allocationRecipeSnapshot = null;
  assert.throws(
    () =>
      buildMaterialPlan(data, "2026-11-20", {
        mealType: "LUNCH",
        priorityClassIds: [],
      }),
    /định lượng/,
  );
  const unfinished = fixture();
  unfinished.batches[0].status = "CONFIRMED";
  assert.throws(
    () =>
      buildMaterialPlan(unfinished, "2026-11-20", {
        mealType: "LUNCH",
        priorityClassIds: [],
      }),
    /nấu/,
  );
});
void test("legacy API validates hundredths and decimal serialization", () => {
  const entry = {
    dailyMealPortionId: "253011f0-be45-4426-8c3b-eb491783a4af",
    allocatedPortions: "16.67",
  };
  const input = {
    revision: "a".repeat(64),
    batches: [{ cookingBatchId: entry.dailyMealPortionId, entries: [entry] }],
  };
  assert.equal(
    validateAllocationApply(input).batches[0].entries[0].allocatedPortions,
    16.67,
  );
  assert.throws(() =>
    validateAllocationApply({
      ...input,
      batches: [
        {
          ...input.batches[0],
          entries: [{ ...entry, allocatedPortions: "16.677" }],
        },
      ],
    }),
  );
  assert.deepEqual(
    serializeAllocationPortions({
      allocatedPortions: 16.67,
      availablePortions: 33.33,
    }),
    { allocatedPortions: "16.67", availablePortions: "33.33" },
  );
});

void test("persisted material allocations remain ready and scoped to grade", () => {
  const data = fixture();
  const plan = buildMaterialPlan(data, "2026-11-20", {
    mealType: "LUNCH",
    priorityClassIds: [],
  });
  const day = data.day as AllocationDay;
  day.batches = data.batches.map((batch) => ({
    id: batch.id,
    menuDayId: "menu",
    mealType: "LUNCH",
    batchCode: batch.id,
    batchNumber: batch.batchNumber,
    status: "COMPLETED",
    completedAt: new Date(),
    plannedPortions: 50,
    note: null,
    cookingBatchLots: batch.cookingBatchLots,
    dishes: batch.dishes.map((dish) => ({
      ...dish,
      plannedPortions: 50,
      mealAllocationBatches: [],
    })),
  })) as unknown as AllocationDay["batches"];
  day.demands[0].MealAllocation = {
    id: "allocation",
    status: "ALLOCATED",
    mealAllocationBatches: plan.entries.map((entry) => ({
      cookingBatchId: entry.batchId,
      dishId: entry.dishId,
      allocatedPortions: Number(entry.allocatedPortions),
      allocationVersion: 2,
      theoreticalPortions: new Prisma.Decimal(entry.theoreticalPortions),
      materials: entry.materials.map((m) => ({
        ...m,
        mealAllocationId: "allocation",
        cookingBatchId: entry.batchId,
        dishId: entry.dishId,
        quantity: new Prisma.Decimal(m.quantity),
        quantityPerPortion: new Prisma.Decimal(m.quantityPerPortion),
      })),
    })),
  };
  const view = projectAllocationDay(day, "2026-11-20", "LUNCH");
  assert.equal(view.status, "READY");
  assert.equal(view.distribution.canConfirmDistribution, true);
  assert.equal(view.distribution.demands[0].allocatedPortions, 50);
  assert.deepEqual(
    view.grades?.[0].dishes[0].batches.map((b) => b.plannedPortions),
    [16.67, 33.33],
  );
  day.demands[0].MealAllocation.mealAllocationBatches[0].materials![0].quantity =
    new Prisma.Decimal(1001);
  assert.equal(
    projectAllocationDay(day, "2026-11-20", "LUNCH").status,
    "RECONCILE",
  );
});

void test("public plan hides supplied ingredients but the stored plan keeps exact quantities", () => {
  const plan = buildMaterialPlan(fixture(), "2026-11-20", {
    mealType: "LUNCH",
    priorityClassIds: [],
  });
  assert.ok(plan.entries[0].materials.length > 0);
  const view = publicMaterialPlan(plan) as unknown as Record<string, unknown>;
  assert.equal("remaining" in view, false);
  for (const entry of view.entries as Record<string, unknown>[]) {
    assert.equal("materials" in entry, false);
    assert.equal("massKg" in entry, false);
  }
  for (const group of view.groups as Record<string, unknown>[]) {
    assert.equal("allocatedMassKg" in group, false);
    assert.equal("requiredMassKg" in group, false);
  }
  assert.equal(
    (view.entries as { allocatedPortions: string }[])[0].allocatedPortions,
    plan.entries[0].allocatedPortions,
  );
});
