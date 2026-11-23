import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "../src/generated/prisma/client";
import {
  aggregateDishRecipes,
  selectDishGradeRecipes,
} from "../src/modules/dish/dish.service";
import { validateDishRecipe } from "../src/modules/dish/dish.validation";
import {
  isScaledUnit,
  scaleDishLines,
  scaleDishQuantity,
  standardQuantityIssue,
} from "../src/utils/dish-portion";
import { dishRecipeRepository } from "../src/modules/dish/dish.repository";
import { expandMenuHolidays } from "../src/modules/menu/menu.service";
import {
  assertPortionGroupSafety,
  convertQuantity,
  planCookingBatches,
} from "../src/modules/kitchen/kitchen.service";

type Rows = Parameters<typeof aggregateDishRecipes>[0];

void test("dish meal classification validates only lunch, afternoon and both while preserving legacy omission", () => {
  const input = {
    name: "Món mẫu",
    standardQuantity: "100",
    standardUnit: "g",
    lines: [
      {
        ingredientEntryId: "00000000-0000-4000-8000-000000000001",
        ingredientRole: "MAIN",
        requiredQuantity: "80",
        unit: "g",
      },
    ],
  };
  for (const mealType of ["LUNCH", "AFTERNOON", "BOTH", null])
    assert.equal(validateDishRecipe({ ...input, mealType }).mealType, mealType);
  assert.equal(validateDishRecipe(input).mealType, undefined);
  for (const mealType of [
    "BREAKFAST",
    "lunch",
    "",
    ["LUNCH"],
    1,
    { value: "BOTH" },
  ])
    assert.throws(() => validateDishRecipe({ ...input, mealType }));
});

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

void test("separate mode groups lots from the same source facility into one batch", () => {
  const recipe = [
    { ingredientEntryId: "yogurt", quantityPerPortion: "1", unit: "hộp" },
  ];
  const lot = (id: string, quantity: string, sourceFacilityId: string) => ({
    id,
    ingredientEntryId: "yogurt",
    availableQuantity: quantity,
    reservedQuantity: "0",
    unit: "hộp",
    sourceFacilityId,
  });
  const plans = planCookingBatches(617, "SEPARATE_BY_LOT", recipe, [
    lot("fruit-300", "300", "fruit"),
    lot("farm-8", "8", "farm"),
    lot("farm-309", "309", "farm"),
  ]);
  assert.deepEqual(
    plans.map((batch) => batch.plannedPortions),
    [300, 317],
  );
  assert.deepEqual(
    plans[1].lots.map((row) => [row.ingredientLotId, row.quantityUsed]),
    [
      ["farm-8", "8.000"],
      ["farm-309", "309.000"],
    ],
  );
});

void test("combined kitchen plan identifies the ingredient and shortage", () => {
  assert.throws(
    () =>
      planCookingBatches(
        617,
        "COMBINE_LOTS",
        [
          {
            ingredientEntryId: "water-spinach",
            ingredientName: "Rau muống sạch",
            quantityPerPortion: "80",
            unit: "g",
          },
        ],
        [],
      ),
    (error: unknown) =>
      error instanceof Error &&
      "statusCode" in error &&
      error.statusCode === 409 &&
      error.message.includes("Rau muống sạch thiếu 49360 g"),
  );
});

const scaledDish = (gradeRecipes: { gradeId: string; portion: string }[]) =>
  [
    {
      id: "dish",
      name: "Gà xào nấm",
      standardQuantity: new Prisma.Decimal("100"),
      standardUnit: "g",
      dishIngredientEntries: [
        {
          ingredientEntryId: "chicken",
          ingredientRole: "MAIN",
          requiredQuantity: new Prisma.Decimal("60"),
          unit: "g",
          IngredientEntry: {
            ingredientId: "chicken",
            Ingredient: { name: "Gà", defaultUnit: "kg" },
          },
        },
        {
          ingredientEntryId: "salt",
          ingredientRole: "SEASONING",
          requiredQuantity: new Prisma.Decimal("2"),
          unit: "g",
          IngredientEntry: {
            ingredientId: "salt",
            Ingredient: { name: "Muối", defaultUnit: "g" },
          },
        },
      ],
      gradeRecipes: gradeRecipes.map(({ gradeId, portion }) => ({
        gradeId,
        portionQuantity: new Prisma.Decimal(portion),
      })),
    },
  ] as unknown as Rows;

void test("grade recipe scales the dish standard by the grade portion", () => {
  const rows = scaledDish([
    { gradeId: "small", portion: "80" },
    { gradeId: "large", portion: "120" },
  ]);
  const large = selectDishGradeRecipes(rows, ["large"])[0];
  assert.deepEqual(
    large.dishIngredientEntries.map((l) => l.requiredQuantity.toString()),
    ["72", "2.4"],
  );
  // Thực đơn toàn trường dùng đúng mốc chuẩn (tỉ lệ 1).
  assert.deepEqual(
    selectDishGradeRecipes(rows, [])[0].dishIngredientEntries.map((l) =>
      l.requiredQuantity.toString(),
    ),
    ["60", "2"],
  );
  // Không đổi dữ liệu gốc.
  assert.equal(
    rows[0].dishIngredientEntries[0].requiredQuantity.toString(),
    "60",
  );
});

void test("grade recipe selection rejects differing portions and grades without a portion", () => {
  const rows = scaledDish([
    { gradeId: "small", portion: "80" },
    { gradeId: "same", portion: "80.000" },
    { gradeId: "large", portion: "120" },
  ]);
  assert.equal(selectDishGradeRecipes(rows, ["small", "same"]).length, 1);
  assert.throws(() => selectDishGradeRecipes(rows, ["small", "large"]), {
    statusCode: 422,
    message: /hãy tách thực đơn/,
  });
  assert.throws(() => selectDishGradeRecipes(rows, ["missing"]), {
    statusCode: 422,
    message: /chưa có khẩu phần/,
  });
  const tiny = scaledDish([{ gradeId: "tiny", portion: "0.01" }]);
  assert.throws(() => selectDishGradeRecipes(tiny, ["tiny"]), {
    statusCode: 422,
    message: /bằng 0 sau khi làm tròn/,
  });
});

void test("dish portion helper rounds half up to three decimals", () => {
  assert.equal(scaleDishQuantity("1", "1", "3").toString(), "0.333");
  assert.equal(scaleDishQuantity("2", "1", "3").toString(), "0.667");
  assert.equal(scaleDishQuantity("0.0025", "1", "1").toString(), "0.003");
  assert.equal(
    scaleDishLines("100", null, [
      { requiredQuantity: "60", unit: "g" },
    ])[0].requiredQuantity.toString(),
    "60",
  );
});

void test("count units keep the declared quantity while g/ml lines scale", () => {
  const lines = scaleDishLines("100", "80", [
    { requiredQuantity: "60", unit: "g" },
    { requiredQuantity: "5", unit: "ml" },
    { requiredQuantity: "1", unit: "cái" },
    { requiredQuantity: "1", unit: "Quả" },
    { requiredQuantity: "0.026", unit: "hộp" },
  ]);
  assert.deepEqual(
    lines.map((line) => line.requiredQuantity.toString()),
    ["48", "4", "1", "1", "0.026"],
  );
  assert.equal(isScaledUnit(" ML "), true);
  assert.equal(isScaledUnit("phần"), false);
});

void test("standard quantity covers every same-unit line, including seasonings", () => {
  const l = (requiredQuantity: string, unit: string) => ({
    requiredQuantity,
    unit,
  });
  // Mọi dòng cùng đơn vị mốc chuẩn: >= S.
  const allGrams = [l("50", "g"), l("20", "g"), l("2", "g")];
  assert.equal(standardQuantityIssue(allGrams, "72", "g"), null);
  assert.match(
    standardQuantityIssue(allGrams, "71.999", "g")!,
    /hoặc bằng 72 g/,
  );
  // Có dòng khác đơn vị (gia vị ml, quả): > S.
  const mixed = [
    l("50", "g"),
    l("20", "g"),
    l("2", "g"),
    l("5", "ml"),
    l("1", "quả"),
  ];
  assert.match(standardQuantityIssue(mixed, "72", "g")!, /lớn hơn 72 g/);
  assert.equal(standardQuantityIssue(mixed, "72.001", "g"), null);
  // Mốc theo ml chỉ cộng dòng ml.
  assert.equal(standardQuantityIssue(mixed, "5.5", "ml"), null);
  assert.ok(standardQuantityIssue(mixed, "5", "ml"));
  // Không dòng nào cùng đơn vị: chỉ cần > 0.
  assert.equal(standardQuantityIssue([l("1", "quả")], "0.5", "g"), null);
  assert.ok(standardQuantityIssue([l("1", "quả")], "0", "g"));
  // Không quy đổi đơn vị: kg không được cộng vào g.
  assert.equal(
    standardQuantityIssue([l("1", "kg"), l("10", "g")], "11", "g"),
    null,
  );
});

void test("dish write validates standard unit, threshold and grade portions", () => {
  const grade = {
    gradeId: "33333333-3333-4333-8333-333333333333",
    portionQuantity: "120",
  };
  const base = {
    name: "Gà xào nấm",
    standardQuantity: "100",
    standardUnit: "G",
    lines: [
      {
        ingredientEntryId: "11111111-1111-4111-8111-111111111111",
        ingredientRole: "MAIN",
        requiredQuantity: "60",
        unit: "g",
      },
      {
        ingredientEntryId: "22222222-2222-4222-8222-222222222222",
        ingredientRole: "SEASONING",
        requiredQuantity: "5",
        unit: "ml",
      },
    ],
    gradeRecipes: [grade],
  };
  const parsed = validateDishRecipe(base);
  assert.equal(parsed.standardUnit, "g");
  assert.equal(parsed.gradeRecipes?.[0].portionQuantity, "120");
  assert.throws(() => validateDishRecipe({ ...base, standardUnit: "kg" }));
  assert.throws(() => validateDishRecipe({ ...base, standardQuantity: "60" }));
  assert.throws(() => validateDishRecipe({ ...base, standardQuantity: "0" }));
  assert.throws(() =>
    validateDishRecipe({
      ...base,
      gradeRecipes: [{ ...grade, portionQuantity: "0" }],
    }),
  );
  assert.throws(() =>
    validateDishRecipe({ ...base, gradeRecipes: [{ ...grade, lines: [] }] }),
  );
  assert.throws(() =>
    validateDishRecipe({ ...base, gradeRecipes: [grade, grade] }),
  );
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
    validateDishRecipe({
      name: "Rice",
      standardQuantity: "100",
      standardUnit: "g",
      lines: [line],
    }).lines[0].requiredQuantity,
    "80",
  );
  assert.throws(() =>
    validateDishRecipe({
      name: "Rice",
      standardQuantity: "100",
      standardUnit: "g",
      lines: [line, line],
    }),
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
