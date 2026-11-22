import type { AllocationDay } from "../../src/modules/meal-allocation/meal-allocation.repository";

export const fixtureDate = "2026-11-12";

export function fixture(): AllocationDay {
  // Single-dish batches: mỗi lô chỉ chứa 1 món.
  // Bữa trưa gồm 2 món (rice, main) và 2 mức suất (60, 40).
  // => 4 lô: rice-60, main-60, rice-40, main-40.
  const dishIds = ["rice", "main"];
  const portions = [60, 40];
  return {
    menus: [
      {
        id: "menu",
        portionGroups: [],
        menuDayDishes: dishIds.map((dishId) => ({
          mealType: "LUNCH",
          dishId,
          Dish: { name: dishId },
        })),
      },
    ],
    demands: [40, 35, 25].map((totalPortions, index) => ({
      id: `d${index}`,
      mealType: "LUNCH",
      totalPortions,
      status: "FINALIZED",
      Class: { id: `class${index}`, name: `5${index}` },
      portionGroups: [],
      dailyAllergyPortions: [],
      MealAllocation: null,
    })),
    batches: portions.flatMap((plannedPortions, pIdx) =>
      dishIds.map((dishId, dIdx) => ({
        id: `b${pIdx}-${dishId}`,
        batchCode: `b${pIdx}-${dishId}`,
        batchNumber: pIdx * dishIds.length + dIdx + 1,
        menuDayId: "menu",
        mealType: "LUNCH" as const,
        status: "COMPLETED" as const,
        completedAt: new Date(fixtureDate),
        note: null,
        plannedPortions,
        dishes: [
          {
            dishId,
            plannedPortions,
            retainedFoodSamples: [{ id: `${dishId}-sample-${pIdx}` }],
            mealAllocationBatches: [],
          },
        ],
      })),
    ),
  };
}
