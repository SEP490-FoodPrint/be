import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "../src/generated/prisma/client";
import {
  aggregateDishRecipes,
  selectDishGradeRecipes,
} from "../src/modules/dish/dish.service";
import { validateDishRecipe } from "../src/modules/dish/dish.validation";
import { expandMenuHolidays } from "../src/modules/menu/menu.service";
import { assertPortionGroupSafety } from "../src/modules/kitchen/kitchen.service";

type Rows = Parameters<typeof aggregateDishRecipes>[0];

void test("grade recipe selection compares normalized quantities and never falls back to another grade", () => {
  const profile = (gradeId: string, quantity: string, unit: string) => ({
    gradeId,
    lines: [
      {
        ingredientEntryId: "meat",
        ingredientRole: "MAIN",
        requiredQuantity: new Prisma.Decimal(quantity),
        unit,
        entry: { ingredientId: "meat", Ingredient: { defaultUnit: "g" } },
      },
    ],
  });
  const rows = [
    {
      id: "dish",
      name: "Dish",
      dishIngredientEntries: [],
      gradeRecipes: [
        profile("small", "80", "g"),
        profile("large", "0.08", "kg"),
      ],
    },
  ] as unknown as Rows;
  const selected = selectDishGradeRecipes(rows, ["small", "large"]);
  assert.equal(
    selected[0].dishIngredientEntries[0].requiredQuantity.toString(),
    "80",
  );
  assert.equal(rows[0].dishIngredientEntries.length, 0);
  assert.throws(() => selectDishGradeRecipes(rows, ["missing"]), {
    statusCode: 422,
  });
  rows[0].gradeRecipes[1].lines[0].requiredQuantity = new Prisma.Decimal(
    "0.12",
  );
  assert.throws(() => selectDishGradeRecipes(rows, ["small", "large"]), {
    statusCode: 422,
  });
});

void test("school holidays include range endpoints, legacy dates, reasons and year boundaries", () => {
  const days = expandMenuHolidays(
    [
      { startDate: "2026-12-31", endDate: "2027-01-02", reason: "Nghỉ Tết" },
      { date: "2027-01-04", reason: "Nghỉ bù" },
    ],
    "2026-12-01",
    "2027-01-31",
  );
  assert.deepEqual(
    days.map((d) => d.date),
    ["2026-12-31", "2027-01-01", "2027-01-02", "2027-01-04"],
  );
  assert.equal(days[1].reason, "Nghỉ Tết");
  assert.deepEqual(
    expandMenuHolidays(
      [{ startDate: "2026-12-31", endDate: "2027-01-02", reason: "Nghỉ" }],
      "2027-01-01",
      "2027-01-01",
    ),
    [{ date: "2027-01-01", reason: "Nghỉ" }],
  );
  assert.throws(() =>
    expandMenuHolidays(
      [{ startDate: "2026-02-30", endDate: "2026-03-02" }],
      "2026-01-01",
      "2026-12-31",
    ),
  );
});

void test("safe substitute main ingredients cannot bypass an allergenic shared seasoning", async () => {
  const group = (id: string, isDefault: boolean, ingredientId: string) => ({
    id,
    isDefault,
    dishes: [
      {
        dishId: id,
        menuDayDish: {
          Dish: { schoolId: "school" },
          ingredients: [{ ingredientId }],
        },
      },
    ],
    avoidances: isDefault
      ? []
      : [
          {
            ingredientEntryId: "avoid-entry",
            ingredientEntry: { schoolId: "school", ingredientId: "peanut" },
          },
        ],
  });
  let seasoning = "peanut";
  const tx = {
    menuMealPortionGroup: {
      findMany: () =>
        Promise.resolve([
          group("normal", true, "peanut"),
          group("alternative", false, "rice"),
        ]),
    },
    menuDayDish: {
      findMany: () =>
        Promise.resolve([{ dishId: "normal" }, { dishId: "alternative" }]),
    },
    menuMealSeasoning: {
      findMany: () =>
        Promise.resolve([
          { ingredientEntry: { schoolId: "school", ingredientId: seasoning } },
        ]),
    },
  } as unknown as Parameters<typeof assertPortionGroupSafety>[0];
  const meal = { menuDayId: "day", mealType: "LUNCH" as const };
  await assert.rejects(
    () => assertPortionGroupSafety(tx, meal, "school"),
    /gia vị chung/,
  );
  seasoning = "salt";
  assert.equal((await assertPortionGroupSafety(tx, meal, "school")).length, 2);
});
function meal(
  extra: {
    id: string;
    quantity: string;
    unit: string;
    role?: string | null;
  }[][],
): Rows {
  return extra.map((lines, i) => ({
    id: `dish-${i}`,
    name: `Dish ${i}`,
    dishIngredientEntries: [
      {
        ingredientEntryId: `main-${i}`,
        ingredientRole: "MAIN",
        requiredQuantity: new Prisma.Decimal("80"),
        unit: "g",
        IngredientEntry: {
          ingredientId: `ingredient-${i}`,
          Ingredient: { name: "Rice", defaultUnit: "kg" },
        },
      },
      ...lines.map((l) => ({
        ingredientEntryId: l.id,
        ingredientRole: l.role === undefined ? "SEASONING" : l.role,
        requiredQuantity: new Prisma.Decimal(l.quantity),
        unit: l.unit,
        IngredientEntry: {
          ingredientId: l.id,
          Ingredient: { name: "Salt", defaultUnit: "g" },
        },
      })),
    ],
  })) as unknown as Rows;
}
void test("shared seasoning sums database recipes with unit conversion and preserves separate ingredient identities", () => {
  const result = aggregateDishRecipes(
    meal([
      [{ id: "salt", quantity: "2", unit: "g" }],
      [
        { id: "salt", quantity: "0.003", unit: "kg" },
        { id: "other-salt", quantity: "1", unit: "g" },
      ],
    ]),
  );
  assert.equal(
    result.seasonings.find((s) => s.ingredientEntryId === "salt")
      ?.quantityPerPortion,
    "5",
  );
  assert.equal(result.seasonings.length, 2);
  assert.equal(result.dishes.length, 2);
  assert.equal(
    aggregateDishRecipes(meal([[{ id: "salt", quantity: "2", unit: "g" }]]))
      .seasonings[0].quantityPerPortion,
    "2",
  );
});
void test("unknown legacy classification, empty recipes and incompatible units block aggregation", () => {
  assert.throws(() =>
    aggregateDishRecipes(
      meal([[{ id: "salt", quantity: "2", unit: "g", role: null }]]),
    ),
  );
  assert.throws(() =>
    aggregateDishRecipes(meal([[{ id: "salt", quantity: "2", unit: "ml" }]])),
  );
  assert.throws(() =>
    aggregateDishRecipes([
      { id: "empty", name: "Empty", dishIngredientEntries: [] },
    ] as unknown as Rows),
  );
});
void test("recipe writes require an explicit role, positive precision and unique entries", () => {
  const line = {
    ingredientEntryId: "11111111-1111-1111-1111-111111111111",
    ingredientRole: "MAIN",
    requiredQuantity: "80",
    unit: "g",
  };
  assert.equal(
    validateDishRecipe({ name: "Rice", lines: [line] }).lines[0]
      .requiredQuantity,
    "80",
  );
  assert.throws(() =>
    validateDishRecipe({ name: "Rice", lines: [line, line] }),
  );
  assert.throws(() =>
    validateDishRecipe({
      name: "Rice",
      lines: [{ ...line, ingredientRole: null }],
    }),
  );
  assert.throws(() =>
    validateDishRecipe({
      name: "Rice",
      lines: [{ ...line, requiredQuantity: "0.0001" }],
    }),
  );
});
