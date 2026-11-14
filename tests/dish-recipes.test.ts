import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "../src/generated/prisma/client";
import {
  aggregateDishRecipes,
  selectDishGradeRecipes,
} from "../src/modules/dish/dish.service";
import { validateDishRecipe } from "../src/modules/dish/dish.validation";
import { dishRecipeRepository } from "../src/modules/dish/dish.repository";
import { expandMenuHolidays } from "../src/modules/menu/menu.service";
import {
  assertPortionGroupSafety,
  convertQuantity,
  planCookingBatches,
} from "../src/modules/kitchen/kitchen.service";

type Rows = Parameters<typeof aggregateDishRecipes>[0];

void test("dish catalogue requests newest first with stable pagination within the school", async () => {
  let captured: Record<string, unknown> | undefined;
  const tx = {
    dish: {
      findMany: (args: Record<string, unknown>) => {
        captured = args;
        return Promise.resolve([]);
      },
    },
  };
  await dishRecipeRepository.catalog(tx as never, "school-a", 100, 100);
  assert.deepEqual(captured?.where, { schoolId: "school-a", status: "ACTIVE" });
  assert.deepEqual(captured?.orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
  assert.equal(captured?.skip, 100);
  assert.equal(captured?.take, 100);
});

void test("convert Vietnamese and standard unit spellings without guessing dimensions", () => {
  const convert = (value: string, from: string, to: string) =>
    convertQuantity(new Prisma.Decimal(value), from, to).toString();
  assert.equal(convert("1.5", " LÍT ", "ml"), "1500");
  assert.equal(convert("250", "ml", "li\u0301t"), "0.25");
  assert.equal(convert("2", "lit", "l"), "2");
  assert.equal(convert("0.15", "kilogam", "gam"), "150");
  assert.equal(convert("2", "quả", "QUẢ"), "2");
  for (const [from, to] of [
    ["kg", "lít"],
    ["quả", "hộp"],
    ["", "g"],
    ["constructor", "__proto__"],
  ]) {
    assert.throws(
      () => convert("1", from, to),
      (error: unknown) =>
        error instanceof Error &&
        "statusCode" in error &&
        error.statusCode === 409 &&
        error.message.includes(from.trim()) &&
        error.message.includes(to.trim()),
    );
  }
});

void test("plan common and separate batches using ml recipes with lots measured in lít", () => {
  const recipe = [
    { ingredientEntryId: "oil", quantityPerPortion: "50", unit: "ml" },
  ];
  const stock = [
    {
      id: "lot-1",
      ingredientEntryId: "oil",
      availableQuantity: "1",
      reservedQuantity: "0",
      unit: "lít",
    },
    {
      id: "lot-2",
      ingredientEntryId: "oil",
      availableQuantity: "1",
      reservedQuantity: "0",
      unit: "lít",
    },
  ];
  const combined = planCookingBatches(30, "COMBINE_LOTS", recipe, stock);
  assert.deepEqual(
    combined[0].lots.map((lot) => lot.quantityUsed),
    ["1.000", "0.500"],
  );
  const separate = planCookingBatches(30, "SEPARATE_BY_LOT", recipe, stock);
  assert.deepEqual(
    separate.map((batch) => batch.plannedPortions),
    [20, 10],
  );
  assert.deepEqual(
    separate.map((batch) => batch.lots[0].quantityUsed),
    ["1.000", "0.500"],
  );
});

void test("grade recipes with equivalent lít and ml quantities can share a menu", () => {
  const line = (quantity: string, unit: string) => ({
    ingredientEntryId: "oil",
    ingredientRole: "MAIN",
    requiredQuantity: new Prisma.Decimal(quantity),
    unit,
    entry: { ingredientId: "oil", Ingredient: { defaultUnit: "lít" } },
  });
  const rows = [
    {
      id: "dish",
      name: "Dish",
      dishIngredientEntries: [],
      gradeRecipes: [
        { gradeId: "small", lines: [line("250", "ml")] },
        { gradeId: "large", lines: [line("0.25", "lit")] },
      ],
    },
  ] as unknown as Rows;
  assert.equal(selectDishGradeRecipes(rows, ["small", "large"]).length, 1);
  rows[0].gradeRecipes[1].lines[0].requiredQuantity = new Prisma.Decimal("0.3");
  assert.throws(() => selectDishGradeRecipes(rows, ["small", "large"]), {
    statusCode: 422,
  });
});

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
