import assert from "node:assert/strict";
import test from "node:test";
import type { AllocationDay } from "../src/modules/meal-allocation/meal-allocation.repository";
import { projectAllocationDay } from "../src/modules/meal-allocation/meal-allocation.service";
import { validateAllocationApply } from "../src/modules/meal-allocation/meal-allocation.validation";

const date = "2026-11-12";

function fixture(): AllocationDay {
  return {
    menus: [
      {
        id: "menu",
        portionGroups: [],
        menuDayDishes: ["rice", "main"].map((dishId) => ({
          mealType: "LUNCH",
          dishId,
        })),
      },
    ],
    demands: [40, 35, 25].map((totalPortions, index) => ({
      id: `d${index}`,
      mealType: "LUNCH",
      totalPortions,
      status: "FINALIZED",
      Class: { name: `5${index}` },
      portionGroups: [],
      dailyAllergyPortions: [],
      MealAllocation: null,
    })),
    batches: [60, 40].map((plannedPortions, index) => ({
      id: `b${index}`,
      menuDayId: "menu",
      mealType: "LUNCH",
      status: "COMPLETED",
      completedAt: new Date(date),
      note: null,
      plannedPortions,
      dishes: ["rice", "main"].map((dishId) => ({
        dishId,
        plannedPortions,
        retainedFoodSamples: [{ id: dishId }],
        mealAllocationBatches: [],
      })),
    })),
  };
}

void test("mở màn hình khi đủ suất, ưu tiên nấu trước lưu mẫu", () => {
  const data = fixture();
  assert.equal(projectAllocationDay(data, date).status, "READY");
  data.batches[1].dishes[0].retainedFoodSamples = [];
  const pending = projectAllocationDay(data, date);
  assert.equal(pending.status, "SAMPLES_PENDING");
  assert.equal(pending.totals.sampled, 60);
  assert.equal(pending.missingSampleBatches, 1);
  data.batches[0].status = "CONFIRMED";
  assert.equal(projectAllocationDay(data, date).action, "COOKING");
  data.batches.pop();
  assert.equal(projectAllocationDay(data, date).status, "COOKING_PENDING");
});

void test("không bù số suất giữa hai bữa và không đoán số suất nhóm chung", () => {
  const data = fixture();
  data.menus[0].menuDayDishes.push(
    ...["rice", "main"].map((dishId) => ({
      dishId,
      mealType: "AFTERNOON" as const,
    })),
  );
  data.demands[2].mealType = "AFTERNOON";
  const blocked = projectAllocationDay(data, date);
  assert.equal(blocked.totals.planned, blocked.totals.finalized);
  assert.equal(blocked.status, "RECONCILE");

  const withAllergy = fixture();
  withAllergy.demands[0].dailyAllergyPortions.push({
    ingredientEntryId: "allergen",
  });
  assert.equal(projectAllocationDay(withAllergy, date).status, "RECONCILE");
});

void test("gộp dòng món thành suất, giữ khóa và chặn lịch sử thiếu món", () => {
  const data = fixture();
  const allocation: NonNullable<
    AllocationDay["demands"][number]["MealAllocation"]
  > = {
    id: "allocation",
    status: "DISTRIBUTED",
    mealAllocationBatches: ["rice", "main"].map((dishId) => ({
      cookingBatchId: "b0",
      dishId,
      allocatedPortions: 40,
    })),
  };
  data.demands[0].MealAllocation = allocation;
  const ready = projectAllocationDay(data, date);
  assert.deepEqual(ready.batches[0].entries, [
    { dailyMealPortionId: "d0", allocatedPortions: 40, locked: true },
  ]);
  allocation.mealAllocationBatches.pop();
  assert.equal(projectAllocationDay(data, date).status, "RECONCILE");
});

void test("payload chỉ chấp nhận số suất nguyên dương và từ chối trường thừa", () => {
  const revision = "a".repeat(64);
  assert.deepEqual(validateAllocationApply({ revision, batches: [] }), {
    revision,
    batches: [],
  });
  assert.throws(
    () =>
      validateAllocationApply({ revision, batches: [], schoolId: "client" }),
    { statusCode: 400 },
  );
  assert.throws(
    () =>
      validateAllocationApply({
        revision,
        batches: [
          {
            cookingBatchId: "253011f0-be45-4426-8c3b-eb491783a4af",
            entries: [
              {
                dailyMealPortionId: "253011f0-be45-4426-8c3b-eb491783a4af",
                allocatedPortions: 0,
              },
            ],
          },
        ],
      }),
    { statusCode: 400 },
  );
});
