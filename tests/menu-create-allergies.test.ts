import { measurementUnitMock } from "./helpers/measurement-unit-mock";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Prisma, type PrismaClient } from "../src/generated/prisma/client";
import {
  canEditMenuDay,
  createMenuService,
} from "../src/modules/menu/menu.service";
import { createDishRecipeService } from "../src/modules/dish/dish.service";
import {
  menuRepository as repository,
  type MenuDetailRow,
} from "../src/modules/menu/menu.repository";
import { validateMenuWrite } from "../src/modules/menu/menu.validation";
import { validateDishRecipe } from "../src/modules/dish/dish.validation";
import { principalFromIdentity } from "../src/utils/authorization";
import { dishRecipeRepository } from "../src/modules/dish/dish.repository";
import {
  validateMenuGradeBatch,
  validateMenuSubmitGroup,
} from "../src/modules/menu/menu.validation";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

void test("category operations are school-scoped and refuse deleting a referenced group", async (t) => {
  const f = fixture(t);
  let removed = 0;
  Object.assign(f.tx, {
    schoolDishCategory: {
      findFirst: ({
        where,
      }: {
        where: { id?: string; schoolId: string; name?: { equals: string } };
      }) => {
        assert.equal(where.schoolId, id(3));
        if (where.id === id(90))
          return Promise.resolve({
            id: id(90),
            schoolId: id(3),
            name: "Nhóm",
            _count: { dishes: 1 },
          });
        return Promise.resolve(null);
      },
      delete: () => {
        removed++;
        return Promise.resolve({ id: id(90) });
      },
    },
  });
  const service = createDishRecipeService(() => Promise.resolve(f.db));
  await assert.rejects(
    service.removeCategory(id(90), f.principal),
    /Nhóm đang có món ăn/,
  );
  await assert.rejects(
    service.removeCategory(id(91), f.principal),
    /Không tìm thấy nhóm món/,
  );
  await assert.rejects(
    service.writeCategory(id(91), "Khác", f.principal),
    /Không tìm thấy nhóm món/,
  );
  assert.equal(removed, 0);
});

void test("category create and rename use the trusted school and reject duplicate names", async (t) => {
  const f = fixture(t);
  let name = "Nhóm cũ";
  Object.assign(f.tx, {
    schoolDishCategory: {
      findFirst: ({
        where,
      }: {
        where: { id?: string; schoolId: string; name?: { equals: string } };
      }) => {
        assert.equal(where.schoolId, id(3));
        if (where.id === id(90) || where.name?.equals === name)
          return Promise.resolve({ id: id(90), schoolId: id(3), name });
        return Promise.resolve(null);
      },
      create: ({ data }: { data: { schoolId: string; name: string } }) => {
        assert.equal(data.schoolId, id(3));
        return Promise.resolve({ id: id(91), ...data });
      },
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: { name: string };
      }) => {
        assert.equal(where.id, id(90));
        name = data.name;
        return Promise.resolve({ id: id(90), schoolId: id(3), name });
      },
    },
  });
  const service = createDishRecipeService(() => Promise.resolve(f.db));
  assert.equal(
    (await service.writeCategory(undefined, "Nhóm mới", f.principal)).label,
    "Nhóm mới",
  );
  assert.equal(
    (await service.writeCategory(id(90), "Tên mới", f.principal)).label,
    "Tên mới",
  );
  await assert.rejects(
    service.writeCategory(undefined, "Tên mới", f.principal),
    /đã tồn tại/,
  );
});
function fixture(
  t: TestContext,
  existing = false,
  healthPermission = true,
  calendar = true,
) {
  const permissions = [
    "menu.create",
    "menu.update",
    "menu.view",
    ...(healthPermission ? ["class_allergy.view"] : []),
  ];
  const identity = {
    id: id(1),
    username: "nutrition",
    fullName: "Nutrition",
    status: "ACTIVE",
    roleId: id(2),
    schoolId: id(3),
    supplierId: null,
    communeFoodSafetyUnitId: null,
    permissionDenials: [],
    Role: {
      code: "SCHOOL_NUTRITION_OFFICER",
      type: "SCHOOL",
      rolePermissions: permissions.map((code) => ({
        permission: { code, isActive: true },
      })),
    },
  } as Parameters<typeof principalFromIdentity>[0];
  const principal = principalFromIdentity(identity);
  const day = {
    id: id(5),
    menuDate: new Date("2026-11-09"),
    note: null,
    approvalStatus: "DRAFT",
    menuDayDishes: [
      {
        dishId: id(6),
        mealType: "LUNCH",
        Dish: { id: id(6), status: "ACTIVE", name: "Regular" },
        ingredients: [
          {
            ingredientId: id(7),
            quantityPerPortion: "80",
            unit: "g",
            ingredient: {
              id: id(7),
              name: "Peanut",
              defaultUnit: "g",
              ingredientCategory: null,
            },
          },
        ],
      },
    ],
    mealSeasonings: [
      {
        mealType: "LUNCH",
        ingredientEntryId: id(8),
        quantityPerPortion: "2",
        unit: "g",
        ingredientEntry: {
          ingredientId: id(9),
          Ingredient: { name: "Soy sauce", defaultUnit: "g" },
        },
      },
    ],
    portionGroups: [],
  };
  const menu = {
    id: id(4),
    schoolId: id(3),
    status: "DRAFT",
    weekStartDate: new Date("2026-11-09"),
    title: "Week",
    submittedAt: null,
    menuDays: [day],
  } as unknown as MenuDetailRow;
  const allergyRows = [
    {
      ingredientEntryId: id(10),
      classId: id(11),
      affectedCount: 2,
      Class: { name: "1A" },
      IngredientEntry: { ingredientId: id(7), Ingredient: { name: "Peanut" } },
    },
    {
      ingredientEntryId: id(8),
      classId: id(11),
      affectedCount: 1,
      Class: { name: "1A" },
      IngredientEntry: {
        ingredientId: id(9),
        Ingredient: { name: "Soy sauce" },
      },
    },
    {
      ingredientEntryId: id(10),
      classId: id(12),
      affectedCount: 3,
      Class: { name: "2B" },
      IngredientEntry: { ingredientId: id(7), Ingredient: { name: "Peanut" } },
    },
  ];
  let committedWrites = 0,
    allergyReads = 0,
    failRead = false;
  const tx = {
    measurementUnitAlias: measurementUnitMock,
    menuDayDishIngredient: { findMany: () => Promise.resolve([]) },
    menuMealSeasoning: { findMany: () => Promise.resolve([]) },
    user: { findUnique: () => Promise.resolve(identity) },
    school: { findUnique: () => Promise.resolve({ status: "ACTIVE" }) },
    $queryRaw: () => Promise.resolve([]),
    menuMealPortionGroup: { findMany: () => Promise.resolve([]) },
    classAllergy: {
      findMany: (args: {
        where: {
          Class: { schoolId: string; status: string };
          IngredientEntry: { schoolId: string; Ingredient: unknown };
          affectedCount: { gt: number };
        };
      }) => {
        allergyReads++;
        assert.equal(args.where.Class.schoolId, id(3));
        assert.equal(args.where.Class.status, "ACTIVE");
        assert.equal(args.where.IngredientEntry.schoolId, id(3));
        assert.equal(args.where.affectedCount.gt, 0);
        // Dị ứng chỉ lấy từ nguyên liệu của NCC đang liên kết; so với thực đơn theo tên ở service.
        assert.deepEqual(args.where.IngredientEntry.Ingredient, {
          Supplier: {
            schoolSupplierRelationships: {
              some: { schoolId: id(3), status: "ACTIVE" },
            },
          },
        });
        return failRead
          ? Promise.reject(new Error("test read failure"))
          : Promise.resolve(allergyRows);
      },
    },
  };
  const db = {
    $transaction: async <T>(operation: (client: typeof tx) => Promise<T>) => {
      const before = committedWrites;
      const beforeMenu = structuredClone(menu);
      try {
        return await operation(tx);
      } catch (error) {
        committedWrites = before;
        Object.assign(menu, beforeMenu);
        throw error;
      }
    },
  } as unknown as PrismaClient;
  const stub = (name: keyof typeof repository, value: unknown) =>
    t.mock.method(repository, name, () => Promise.resolve(value));
  // Hạn chót tuần: fixture chưa có biên bản BGH yêu cầu sửa.
  stub("revisionRequestCount", 0);
  stub(
    "academicYears",
    calendar
      ? [
          {
            startDate: new Date("2026-09-07"),
            endDate: new Date("2027-06-01"),
            holidays: [],
          },
        ]
      : [],
  );
  stub("menuForWeek", existing ? menu : null);
  const createWeeklyMenuStub = stub("createWeeklyMenu", { id: id(4) });
  stub("ownedMenu", menu);
  stub("menuEditHeader", { status: "DRAFT", submittedAt: null });
  stub("menuDayHeaders", []);
  stub("createDay", { id: id(5) });
  stub("deleteDayIngredients", {});
  stub("deleteDaySeasonings", {});
  stub("activeSchoolDish", { id: id(6), status: "ACTIVE" });
  stub("saveMealDish", {});
  stub("createMealDishes", {});
  stub("linkedIngredients", [{ id: id(7), defaultUnit: "g" }]);
  stub("activeSeasoningEntries", [
    { id: id(8), Ingredient: { defaultUnit: "g" } },
  ]);
  t.mock.method(repository, "insertDayIngredients", () => {
    committedWrites++;
    return Promise.resolve({ count: 1 });
  });
  stub("insertDaySeasonings", {});
  stub("removedMealDishes", []);
  stub("deleteRemovedMealDishes", {});
  stub("updateMenuTitle", {});
  stub("resetForEditing", {});
  const input = validateMenuWrite({
    weekStartDate: "2026-11-09",
    title: "Week",
    days: [
      {
        menuDate: "2026-11-09",
        meals: [
          {
            mealType: "LUNCH",
            dishes: [
              {
                dishId: id(6),
                ingredients: [
                  { ingredientId: id(7), quantityPerPortion: "80", unit: "g" },
                ],
              },
            ],
            seasonings: [
              { ingredientEntryId: id(8), quantityPerPortion: "2", unit: "g" },
            ],
          },
        ],
      },
    ],
  });
  return {
    db,
    tx,
    // Cố định "hôm nay" trước tuần 09/11/2026 của fixture để test không phụ thuộc ngày chạy.
    service: createMenuService(
      undefined,
      () => Promise.resolve(db),
      () => "2026-11-02",
    ),
    principal,
    createWeeklyMenuStub,
    input,
    menu,
    allergyRows,
    counts: () => ({ committedWrites, allergyReads }),
    fail: () => {
      failRead = true;
    },
  };
}

void test("new menu title comes from the school academic week, not the request", async (t) => {
  const f = fixture(t);
  await f.service.create(f.input, f.principal);
  assert.equal(
    f.createWeeklyMenuStub.mock.calls[0].arguments[4],
    "Thực đơn dinh dưỡng tuần 10",
  );
});

void test("creating outside a configured academic year does not write", async (t) => {
  const f = fixture(t, false, true, false);
  await assert.rejects(f.service.create(f.input, f.principal), {
    statusCode: 422,
  });
  assert.equal(f.createWeeklyMenuStub.mock.callCount(), 0);
});

void test("menu week must start on Monday", () => {
  const body = {
    weekStartDate: "2026-11-09",
    days: [
      {
        menuDate: "2026-11-10",
        meals: [
          {
            mealType: "LUNCH",
            dishes: [{ dishId: id(6), ingredients: [] }],
            seasonings: [],
          },
        ],
      },
    ],
  };
  assert.doesNotThrow(() => validateMenuWrite(body));
  assert.throws(() =>
    validateMenuWrite({ ...body, weekStartDate: "2026-11-10" }),
  );
});

void test("updating a menu cannot change its title", async (t) => {
  const f = fixture(t, true);
  await assert.rejects(
    f.service.update(f.menu.id, { ...f.input, title: "Changed" }, f.principal),
    { statusCode: 409 },
  );
  assert.equal(f.counts().committedWrites, 0);
});

void test("menu creation rejects grades outside the school and overlapping scope before writing", async (t) => {
  const f = fixture(t, true);
  const input = { ...f.input, gradeIds: [id(90)] };
  Object.assign(f.tx, { schoolGrade: { findMany: () => Promise.resolve([]) } });
  await assert.rejects(f.service.create(input, f.principal), {
    statusCode: 422,
  });
  Object.assign(f.tx, {
    schoolGrade: { findMany: () => Promise.resolve([{ id: id(90) }]) },
  });
  await assert.rejects(f.service.create(input, f.principal), {
    statusCode: 409,
  });
  assert.equal(f.counts().committedWrites, 0);
});

void test("saving an unchanged grade menu preserves its recipe snapshot without reading current catalogue profiles", async (t) => {
  const f = fixture(t, true);
  const day = f.menu.menuDays[0];
  t.mock.method(repository, "menuEditHeader", () =>
    Promise.resolve({
      status: "DRAFT",
      submittedAt: null,
      grades: [{ gradeId: id(90) }],
    } as never),
  );
  t.mock.method(repository, "menuDayHeaders", () =>
    Promise.resolve([
      { id: day.id, menuDate: day.menuDate, approvalStatus: "DRAFT" },
    ] as never),
  );
  t.mock.method(repository, "dayBatchCount", () => Promise.resolve(0));
  t.mock.method(repository, "daySeasoningLotCount", () => Promise.resolve(0));
  t.mock.method(repository, "updateDayNote", () =>
    Promise.resolve({ id: day.id } as never),
  );
  Object.assign(f.tx, {
    dish: {
      findMany: () =>
        assert.fail("unchanged snapshot must not read current dish profiles"),
    },
  });
  const saved = await f.service.update(f.menu.id, f.input, f.principal);
  assert.equal(
    saved.menuDays[0].menuDayDishes[0].ingredients[0].quantityPerPortion.toString(),
    "80",
  );
  assert.equal(f.counts().committedWrites, 1);
});

void test("dish category and meal classification persist through create/read/update without clearing omitted values", async (t) => {
  const f = fixture(t);
  let category: string | null = null;
  let mealType: "LUNCH" | "AFTERNOON" | "BOTH" | null = null;
  const categories = [
    { id: id(90), name: "Cơm / Tinh bột" },
    { id: id(91), name: "Món canh" },
  ];
  const entry = {
    id: id(8),
    schoolId: id(3),
    status: "ACTIVE",
    handlingType: "DRY_STOCK",
    ingredientId: id(7),
    Ingredient: {
      name: "Rice",
      status: "ACTIVE",
      defaultUnit: "g",
      supplierId: id(30),
      Supplier: {
        name: "Linked supplier",
        status: "ACTIVE",
        schoolSupplierRelationships: [{ schoolId: id(3) }],
      },
    },
  };
  const row = () => ({
    id: id(6),
    name: "Rice",
    standardQuantity: new Prisma.Decimal("100"),
    standardUnit: "g",
    description: null,
    categoryId: category,
    mealType,
    schoolCategory: categories.find((item) => item.id === category) ?? null,
    dishIngredientEntries: [
      {
        ingredientEntryId: id(8),
        ingredientRole: "MAIN",
        requiredQuantity: "80",
        unit: "g",
        IngredientEntry: entry,
      },
    ],
  });
  const save = ({
    data,
  }: {
    data: { categoryId?: string | null; mealType?: typeof mealType };
  }) => {
    if (data.categoryId !== undefined) category = data.categoryId;
    if (data.mealType !== undefined) mealType = data.mealType;
    return Promise.resolve(row());
  };
  Object.assign(f.tx, {
    schoolDishCategory: {
      findFirst: ({
        where,
      }: {
        where: { id?: string; name?: { equals: string } };
      }) =>
        Promise.resolve(
          categories.find(
            (item) => item.id === where.id || item.name === where.name?.equals,
          ),
        ),
      findMany: () => Promise.resolve(categories),
    },
    ingredientEntry: {
      findMany: ({ where }: { where: { schoolId: string } }) => {
        assert.equal(where.schoolId, id(3));
        return Promise.resolve([entry]);
      },
    },
    dishIngredientEntry: { deleteMany: () => Promise.resolve({ count: 1 }) },
    dish: {
      create: save,
      update: save,
      findFirst: ({ where }: { where: { id: string; schoolId: string } }) => {
        assert.equal(where.schoolId, id(3));
        assert.equal(where.id, id(6));
        return Promise.resolve({ id: id(6) });
      },
      findMany: ({ where }: { where: { schoolId: string } }) => {
        assert.equal(where.schoolId, id(3));
        return Promise.resolve([row()]);
      },
    },
  });
  const service = createDishRecipeService(() => Promise.resolve(f.db));
  const input = {
    name: "Rice",
    standardQuantity: "100",
    standardUnit: "g",
    lines: [
      {
        ingredientEntryId: id(8),
        ingredientRole: "MAIN",
        requiredQuantity: "80",
        unit: "g",
      },
    ],
  };
  const created = await service.save(
    undefined,
    validateDishRecipe({
      ...input,
      category: "RICE_STARCH",
      mealType: "LUNCH",
    }),
    f.principal,
  );
  assert.equal(created.category, id(90));
  assert.equal(created.categoryLabel, "Cơm / Tinh bột");
  assert.equal(created.mealType, "LUNCH");
  const legacyUpdate = await service.save(
    id(6),
    validateDishRecipe(input),
    f.principal,
  );
  assert.equal(legacyUpdate.category, id(90));
  assert.equal(legacyUpdate.mealType, "LUNCH");
  const changed = await service.save(
    id(6),
    validateDishRecipe({ ...input, category: "SOUP", mealType: "BOTH" }),
    f.principal,
  );
  assert.equal(changed.category, id(91));
  assert.equal(changed.mealType, "BOTH");
  const catalog = await service.catalog({ page: 1, limit: 10 }, f.principal);
  assert.equal(catalog.items[0].categoryLabel, "Món canh");
  assert.equal(catalog.categories.length, 2);
  assert.equal(catalog.items[0].mealType, "BOTH");
  const afternoon = await service.save(
    id(6),
    validateDishRecipe({ ...input, mealType: "AFTERNOON" }),
    f.principal,
  );
  assert.equal(afternoon.mealType, "AFTERNOON");
  const cleared = await service.save(
    id(6),
    validateDishRecipe({ ...input, category: null, mealType: null }),
    f.principal,
  );
  assert.equal(cleared.category, null);
  assert.equal(cleared.categoryLabel, null);
  assert.equal(cleared.mealType, null);
  assert.throws(() =>
    validateDishRecipe({ ...input, category: "AUTOMATIC_FROM_NAME" }),
  );
  assert.throws(() => validateDishRecipe({ ...input, mealType: "BREAKFAST" }));
});

for (const references of [0, 1])
  void test(`catalog delete ${references ? "rejects referenced" : "removes only unused owned"} dishes`, async (t) => {
    const f = fixture(t);
    let removed = 0;
    Object.assign(f.tx, {
      dish: {
        findFirst: ({ where }: { where: { id: string; schoolId: string } }) => {
          assert.deepEqual(where, { id: id(6), schoolId: id(3) });
          return Promise.resolve({
            id: id(6),
            _count: {
              menuDayDishes: references,
              cookingBatches: 0,
              cookingBatchDishes: 0,
            },
          });
        },
        delete: () => {
          removed++;
          return Promise.resolve({ id: id(6) });
        },
      },
    });
    const operation = () =>
      createDishRecipeService(() => Promise.resolve(f.db)).remove(
        id(6),
        f.principal,
      );
    if (references) {
      await assert.rejects(operation, { statusCode: 409 });
      assert.equal(removed, 0);
    } else {
      assert.deepEqual(await operation(), { id: id(6) });
      assert.equal(removed, 1);
    }
  });

void test("POST reports no conflicts only after a successful empty database check", async (t) => {
  const f = fixture(t);
  f.allergyRows.splice(0);
  const result = await f.service.create(f.input, f.principal);
  assert.equal(result.hasUnresolvedAllergies, false);
  assert.deepEqual(result.allergyChecks[0].conflicts, []);
  assert.equal(f.counts().allergyReads, 1);
});

for (const existing of [false, true])
  void test(`POST menu reads school allergies for mains and seasonings in ${existing ? "existing" : "new"} draft`, async (t) => {
    const f = fixture(t, existing);
    const result = await f.service.create(f.input, f.principal);
    assert.equal(result.hasUnresolvedAllergies, true);
    assert.equal(result.allergyChecks[0].conflicts.length, 2);
    assert.equal(
      result.allergyChecks[0].conflicts[0].affectedClasses.length,
      2,
    );
    assert.equal(
      result.allergyChecks[0].conflicts[1].ingredientName,
      "Soy sauce",
    );
    assert.equal("affectedStudentsCount" in result.allergyChecks[0], false);
    assert.deepEqual(f.counts(), { committedWrites: 1, allergyReads: 1 });
  });

void test("POST keeps regular and substitute dishes and identifies an uncovered shared-seasoning allergy", async (t) => {
  const f = fixture(t);
  const original = f.menu.menuDays[0].menuDayDishes[0];
  f.menu.menuDays[0].menuDayDishes.push({
    ...original,
    dishId: id(21),
    Dish: { ...original.Dish, id: id(21), name: "Alternative" },
    ingredients: [
      {
        ...original.ingredients[0],
        ingredientId: id(22),
        ingredient: {
          ...original.ingredients[0].ingredient,
          id: id(22),
          name: "Rice",
        },
      },
    ],
  });
  f.menu.menuDays[0].portionGroups = [
    {
      id: id(20),
      mealType: "LUNCH",
      isDefault: false,
      avoidances: [{ ingredientEntryId: id(10) }],
      dishes: [{ dishId: id(21) }],
    },
  ] as (typeof f.menu.menuDays)[0]["portionGroups"];
  const result = await f.service.create(f.input, f.principal);
  assert.equal(result.hasUnresolvedAllergies, true);
  assert.equal(result.allergyChecks[0].hasConflict, true);
  assert.equal(
    result.allergyChecks[0].conflicts[0].coveredBySeparateGroup,
    true,
  );
  assert.equal(
    result.allergyChecks[0].conflicts[1].coveredBySeparateGroup,
    false,
  );
  assert.deepEqual(
    result.menuDays[0].menuDayDishes.map((d) => d.dishId),
    [id(6), id(21)],
  );
});

void test("health permission is rechecked before create writes or allergy reads", async (t) => {
  const f = fixture(t, false, false);
  await assert.rejects(
    () =>
      f.service.create(f.input, {
        ...f.principal,
        permissions: [...f.principal.permissions, "class_allergy.view"],
      }),
    { statusCode: 403 },
  );
  assert.deepEqual(f.counts(), { committedWrites: 0, allergyReads: 0 });
});

void test("an allergy database failure rolls back the create transaction", async (t) => {
  const f = fixture(t);
  f.fail();
  await assert.rejects(() => f.service.create(f.input, f.principal), {
    statusCode: 503,
  });
  assert.deepEqual(f.counts(), { committedWrites: 0, allergyReads: 1 });
});

void test("approved days and approved weeks are immutable; pending days remain editable", () => {
  for (const status of ["DRAFT", "PENDING_APPROVAL", "REVISION_REQUIRED"]) {
    assert.equal(canEditMenuDay(status, "PENDING_APPROVAL"), true);
    assert.equal(canEditMenuDay(status, "APPROVED"), false);
  }
  assert.equal(canEditMenuDay("APPROVED", "DRAFT"), false);
  assert.equal(canEditMenuDay("UNKNOWN", "DRAFT"), false);
});

function pendingRevision(t: TestContext) {
  const f = fixture(t, true);
  f.allergyRows.splice(0);
  f.menu.status = "PENDING_APPROVAL";
  f.menu.submittedAt = new Date("2026-11-09T01:00:00Z");
  f.menu.menuDays[0].approvalStatus = "PENDING_APPROVAL";
  t.mock.method(repository, "menuEditHeader", () => Promise.resolve(f.menu));
  t.mock.method(repository, "resetForEditing", () => {
    f.menu.status = "DRAFT";
    f.menu.submittedAt = null;
    f.menu.menuDays[0].approvalStatus = "DRAFT";
    return Promise.resolve(f.menu);
  });

  t.mock.method(repository, "submitDraftDays", () => {
    f.menu.menuDays.forEach((day) => {
      day.approvalStatus = "PENDING_APPROVAL";
    });
    return Promise.resolve({ count: f.menu.menuDays.length });
  });
  const submission = t.mock.method(
    repository,
    "submitWeeklyMenu",
    (_tx: unknown, menuId: string, submittedAt: Date) => {
      assert.equal(menuId, f.menu.id);
      f.menu.status = "PENDING_APPROVAL";
      f.menu.submittedAt = submittedAt;
      return Promise.resolve(f.menu);
    },
  );
  return { ...f, submission };
}

void test("explicit draft save updates the same pending week and clears its submission", async (t) => {
  const f = pendingRevision(t);
  const result = await f.service.update(f.menu.id, f.input, f.principal);
  assert.equal(result.id, f.menu.id);
  assert.equal(result.status, "DRAFT");
  assert.equal(result.submittedAt, null);
  assert.equal(f.submission.mock.callCount(), 0);
  assert.equal(f.counts().committedWrites, 1);
});

void test("save and resubmit preserves the menu identity, checks every weekday and advances submission version", async (t) => {
  const f = pendingRevision(t);
  f.menu.menuDays[0].menuDayDishes.push({
    ...f.menu.menuDays[0].menuDayDishes[0],
    mealType: "AFTERNOON",
  });
  f.menu.menuDays[0].mealSeasonings.push({
    ...f.menu.menuDays[0].mealSeasonings[0],
    mealType: "AFTERNOON",
  });
  const previous = f.menu.submittedAt!;
  for (let offset = 1; offset < 5; offset++)
    f.menu.menuDays.push({
      ...f.menu.menuDays[0],
      id: id(40 + offset),
      menuDate: new Date(Date.UTC(2026, 10, 9 + offset)),
    });
  f.input.days = f.menu.menuDays.map((day) => ({
    ...structuredClone(f.input.days[0]),
    menuDate: day.menuDate,
  }));
  const result = await f.service.reviseAndSubmit(
    f.menu.id,
    f.input,
    f.principal,
  );
  assert.equal(result.id, f.menu.id);
  assert.equal(result.status, "PENDING_APPROVAL");
  assert.ok(result.submittedAt! > previous);
  assert.equal(f.submission.mock.callCount(), 1);
  assert.equal(
    result.menuDays.every((day) => day.approvalStatus === "PENDING_APPROVAL"),
    true,
  );
  assert.equal(f.counts().committedWrites, 5);
});

void test("incomplete resubmission rolls back writes rather than committing a draft", async (t) => {
  const f = pendingRevision(t);
  await assert.rejects(
    () => f.service.reviseAndSubmit(f.menu.id, f.input, f.principal),
    { statusCode: 422 },
  );
  assert.equal(f.counts().committedWrites, 0);
  assert.equal(f.menu.status, "PENDING_APPROVAL");
  assert.equal(f.menu.submittedAt?.toISOString(), "2026-11-09T01:00:00.000Z");
  assert.equal(f.submission.mock.callCount(), 0);
});

void test("five saved weekdays with lunch only cannot be submitted or approved", async (t) => {
  const f = pendingRevision(t);
  f.allergyRows.splice(0);
  f.menu.menuDays = Array.from({ length: 5 }, (_, index) => ({
    ...structuredClone(f.menu.menuDays[0]),
    id: id(40 + index),
    menuDate: new Date(Date.UTC(2026, 10, 9 + index)),
  }));
  f.menu.status = "DRAFT";
  await assert.rejects(f.service.submit(f.menu.id, f.principal), {
    statusCode: 422,
  });
  f.menu.status = "PENDING_APPROVAL";
  const identity = await f.tx.user.findUnique();
  assert(identity);
  identity.Role.rolePermissions.push({
    permission: { code: "menu.approve", isActive: true },
  });
  const reviewer = {
    ...f.principal,
    permissions: [...f.principal.permissions, "menu.approve"],
  };
  await assert.rejects(
    f.service.review(
      f.menu.id,
      { decision: "APPROVED", feedback: null, menuDayId: null },
      reviewer,
    ),
    /chưa đầy đủ/,
  );
  assert.equal(f.submission.mock.callCount(), 0);
});

void test("both save actions reject an approved week before any write", async (t) => {
  const f = fixture(t, true);
  f.menu.status = "APPROVED";
  for (const operation of [
    () => f.service.update(f.menu.id, f.input, f.principal),
    () => f.service.reviseAndSubmit(f.menu.id, f.input, f.principal),
  ]) {
    await assert.rejects(operation, {
      statusCode: 409,
    });
  }
  assert.equal(f.counts().committedWrites, 0);
});

function gradeFixture(t: TestContext, missingSecond = false) {
  const f = fixture(t);
  f.menu.grades = [];
  f.allergyRows.length = 0;
  const grades = [
    { id: id(90), name: "Khối 1–3" },
    { id: id(91), name: "Khối 4–5" },
  ];
  let activeGrade = grades[0].id;
  const entry = (entryId: string, ingredientId: string, name: string) => ({
    id: entryId,
    ingredientId,
    schoolId: id(3),
    status: "ACTIVE",
    handlingType: "DRY_STOCK",
    Ingredient: {
      name,
      status: "ACTIVE",
      defaultUnit: "g",
      Supplier: {
        status: "ACTIVE",
        schoolSupplierRelationships: [{ schoolId: id(3) }],
      },
    },
  });
  const meat = entry(id(10), id(7), "Thịt"),
    salt = entry(id(8), id(9), "Muối");
  // Mốc chuẩn 100 g: thịt 80 g, muối 2 g. Khối 1 dùng 100 g (thịt 80), khối 2 dùng 125 g (thịt 100).
  const profiles = grades
    .slice(0, missingSecond ? 1 : 2)
    .map((grade, index) => ({
      gradeId: grade.id,
      portionQuantity: new Prisma.Decimal(index ? "125" : "100"),
    }));
  const standardLines = [
    {
      ingredientEntryId: meat.id,
      ingredientRole: "MAIN",
      requiredQuantity: new Prisma.Decimal("80"),
      unit: "g",
      IngredientEntry: meat,
    },
    {
      ingredientEntryId: salt.id,
      ingredientRole: "SEASONING",
      requiredQuantity: new Prisma.Decimal("2"),
      unit: "g",
      IngredientEntry: salt,
    },
  ];
  t.mock.method(
    repository,
    "schoolGrades",
    (_tx: unknown, schoolId: string, ids: string[]) => {
      assert.equal(schoolId, id(3));
      return Promise.resolve(grades.filter((grade) => ids.includes(grade.id)));
    },
  );
  t.mock.method(
    dishRecipeRepository,
    "recipes",
    (_tx: unknown, schoolId: string) => {
      assert.equal(schoolId, id(3));
      return Promise.resolve([
        {
          id: id(6),
          name: "Thịt kho",
          standardQuantity: new Prisma.Decimal("100"),
          standardUnit: "g",
          gradeRecipes: profiles,
          dishIngredientEntries: standardLines,
        },
      ] as never);
    },
  );
  t.mock.method(dishRecipeRepository, "entries", () =>
    Promise.resolve([meat, salt] as never),
  );
  t.mock.method(
    repository,
    "createWeeklyMenu",
    (
      _tx: unknown,
      _school: string,
      _actor: string,
      _date: Date,
      _title: string | null,
      gradeIds: string[] = [],
    ) => {
      activeGrade = gradeIds[0];
      f.menu.id = activeGrade === id(90) ? id(40) : id(41);
      f.menu.grades = [
        {
          gradeId: activeGrade,
          grade: {
            name: grades.find((grade) => grade.id === activeGrade)!.name,
          },
        },
      ] as never;
      f.menu.menuDays[0].id = activeGrade === id(90) ? id(50) : id(51);
      return Promise.resolve({ id: f.menu.id } as never);
    },
  );
  t.mock.method(repository, "menuEditHeader", () =>
    Promise.resolve({
      status: "DRAFT",
      submittedAt: null,
      grades: [{ gradeId: activeGrade }],
    } as never),
  );
  t.mock.method(repository, "createDay", () =>
    Promise.resolve({ id: f.menu.menuDays[0].id } as never),
  );
  const insert = repository.insertDayIngredients.bind(repository);
  const writes: { gradeId: string; quantity: string }[] = [];
  t.mock.method(
    repository,
    "insertDayIngredients",
    async (
      tx: Parameters<typeof repository.insertDayIngredients>[0],
      lines: Parameters<typeof repository.insertDayIngredients>[1],
    ) => {
      await insert(tx, lines);
      writes.push({
        gradeId: activeGrade,
        quantity: lines[0].quantityPerPortion,
      });
      f.menu.menuDays[0].menuDayDishes[0].ingredients[0].quantityPerPortion =
        lines[0].quantityPerPortion as never;
      return { count: lines.length };
    },
  );
  return {
    ...f,
    writes,
    grades,
    batch: {
      ...f.input,
      gradeIds: grades.map((grade) => grade.id),
      submit: false,
    },
  };
}

void test("grade batch writes separate per-serving snapshots from one menu selection in one transaction", async (t) => {
  const f = gradeFixture(t);
  const result = await f.service.saveGradeBatch(f.batch, f.principal);
  assert.deepEqual(f.writes, [
    { gradeId: id(90), quantity: "80" },
    { gradeId: id(91), quantity: "100" },
  ]);
  assert.deepEqual(
    result.menus.map((menu) => menu.gradeIds),
    [[id(90)], [id(91)]],
  );
  assert.deepEqual(
    result.menus.map((menu) => menu.id),
    [id(40), id(41)],
  );
  assert.deepEqual(
    result.allergyChecks.map((check) => check.gradeName),
    ["Khối 1–3", "Khối 4–5"],
  );
  assert.equal(result.submitted, false);
  assert.deepEqual(
    result.menus.map((menu) => menu.status),
    ["DRAFT", "DRAFT"],
  );
  assert.equal(result.hasUnresolvedAllergies, false);
  assert.equal(f.counts().committedWrites, 2);
  assert.equal(
    f.input.days[0].meals[0].dishes[0].ingredients[0].quantityPerPortion,
    "80",
  );
});

void test("grade batch rolls all prior writes back when a later grade has no recipe", async (t) => {
  const f = gradeFixture(t, true);
  const before = structuredClone(f.menu);
  await assert.rejects(
    f.service.saveGradeBatch(f.batch, f.principal),
    /Khối 4–5.*chưa có khẩu phần/,
  );
  assert.equal(f.writes.length, 1);
  assert.equal(f.counts().committedWrites, 0);
  assert.deepEqual(f.menu, before);
});

void test("grade batch refuses foreign grades before writes and rolls back incomplete combined submission", async (t) => {
  const f = gradeFixture(t);
  await assert.rejects(
    f.service.saveGradeBatch({ ...f.batch, gradeIds: [id(99)] }, f.principal),
    { statusCode: 422 },
  );
  assert.equal(f.counts().committedWrites, 0);
  const before = structuredClone(f.menu);
  await assert.rejects(
    f.service.saveGradeBatch({ ...f.batch, submit: true }, f.principal),
    { statusCode: 422 },
  );
  assert.equal(f.counts().committedWrites, 0);
  assert.deepEqual(f.menu, before);
});

void test("batch request validation rejects duplicate grades, arbitrary tenant data and duplicate submit IDs", () => {
  const body = {
    weekStartDate: "2026-11-09",
    gradeIds: [id(90), id(91)],
    days: [
      {
        menuDate: "2026-11-09",
        meals: [
          {
            mealType: "LUNCH",
            useDishRecipes: true,
            dishes: [{ dishId: id(6) }],
          },
        ],
      },
    ],
  };
  assert.equal(validateMenuGradeBatch(body).submit, false);
  assert.throws(() =>
    validateMenuGradeBatch({ ...body, gradeIds: [id(90), id(90)] }),
  );
  assert.throws(() => validateMenuGradeBatch({ ...body, schoolId: id(3) }));
  assert.throws(() => validateMenuSubmitGroup({ menuIds: [id(40), id(40)] }));
});

void test("combined submission keeps every grade in draft when only one grade has an unresolved allergy", async (t) => {
  const f = gradeFixture(t);
  t.mock.method(f.tx.classAllergy, "findMany", () =>
    Promise.resolve(
      f.menu.grades[0].gradeId === id(90)
        ? [
            {
              ingredientEntryId: id(10),
              classId: id(11),
              affectedCount: 2,
              Class: { name: "1A" },
              IngredientEntry: {
                ingredientId: id(7),
                Ingredient: { name: "Peanut" },
              },
            },
          ]
        : [],
    ),
  );
  const result = await f.service.saveGradeBatch(
    { ...f.batch, submit: true },
    f.principal,
  );
  assert.equal(result.hasUnresolvedAllergies, true);
  assert.equal(result.submitted, false);
  assert.deepEqual(
    result.menus.map((menu) => menu.status),
    ["DRAFT", "DRAFT"],
  );
  assert.deepEqual(
    result.allergyChecks.map((check) => check.hasConflict),
    [true, false],
  );
  assert.equal(f.counts().committedWrites, 2);
});

void test("group submission checks ownership first and rolls back a successful first submission if a later menu is incomplete", async (t) => {
  const f = fixture(t);
  f.menu.menuDays[0].menuDayDishes.push({
    ...f.menu.menuDays[0].menuDayDishes[0],
    mealType: "AFTERNOON",
  });
  f.menu.menuDays[0].mealSeasonings.push({
    ...f.menu.menuDays[0].mealSeasonings[0],
    mealType: "AFTERNOON",
  });
  f.allergyRows.length = 0;
  f.menu.grades = [];
  const before = structuredClone(f.menu);
  const complete = Array.from({ length: 5 }, (_, index) => ({
    ...structuredClone(f.menu.menuDays[0]),
    id: id(60 + index),
    menuDate: new Date(Date.UTC(2026, 10, 9 + index)),
  }));
  t.mock.method(repository, "ownedMenu", (_tx: unknown, menuId: string) =>
    Promise.resolve(
      menuId === id(99)
        ? null
        : ({
            ...f.menu,
            id: menuId,
            menuDays:
              menuId === id(40) ? complete : structuredClone(before.menuDays),
          } as never),
    ),
  );
  const submission = t.mock.method(repository, "submitWeeklyMenu", () => {
    f.menu.status = "PENDING_APPROVAL";
    return Promise.resolve(f.menu);
  });
  t.mock.method(repository, "submitDraftDays", () =>
    Promise.resolve({ count: 5 }),
  );
  await assert.rejects(
    f.service.submitGroup({ menuIds: [id(40), id(99)] }, f.principal),
    { statusCode: 404 },
  );
  assert.equal(submission.mock.callCount(), 0);
  await assert.rejects(
    f.service.submitGroup({ menuIds: [id(40), id(41)] }, f.principal),
    { statusCode: 422 },
  );
  assert.equal(submission.mock.callCount(), 1);
  assert.deepEqual(f.menu, before);
});

void test("reopening an unchanged per-grade draft keeps frozen norms rather than current catalogue quantities", async (t) => {
  const f = gradeFixture(t);
  t.mock.method(repository, "dayBatchCount", () => Promise.resolve(0));
  t.mock.method(repository, "daySeasoningLotCount", () => Promise.resolve(0));
  t.mock.method(repository, "updateDayNote", () =>
    Promise.resolve({ id: f.menu.menuDays[0].id } as never),
  );
  f.menu.grades = [{ gradeId: id(90), grade: { name: "Khối 1–3" } }] as never;
  t.mock.method(repository, "menuForWeek", () => Promise.resolve(f.menu));
  t.mock.method(repository, "menuDayHeaders", () =>
    Promise.resolve([
      {
        id: f.menu.menuDays[0].id,
        menuDate: f.menu.menuDays[0].menuDate,
        approvalStatus: "DRAFT",
      },
    ] as never),
  );
  const recipeRead = t.mock.method(dishRecipeRepository, "recipes", () => {
    throw new Error("Unchanged snapshots cannot reload catalogue recipes");
  });
  await f.service.saveGradeBatch(
    { ...f.batch, gradeIds: [id(90)] },
    f.principal,
  );
  assert.equal(recipeRead.mock.callCount(), 0);
  assert.equal(f.writes[0].quantity, "80");
  f.menu.status = "APPROVED";
  await assert.rejects(
    f.service.saveGradeBatch({ ...f.batch, gradeIds: [id(90)] }, f.principal),
    { statusCode: 409 },
  );
});

void test("a complete grade batch submits all grade snapshots together", async (t) => {
  const f = gradeFixture(t);
  const unitLookup = t.mock.method(measurementUnitMock, "findUnique");
  const unitNormLookup = t.mock.method(repository, "existingUnitNorms");
  f.menu.menuDays[0].menuDayDishes.push({
    ...f.menu.menuDays[0].menuDayDishes[0],
    mealType: "AFTERNOON",
  });
  f.menu.menuDays[0].mealSeasonings.push({
    ...f.menu.menuDays[0].mealSeasonings[0],
    mealType: "AFTERNOON",
  });
  const stored = new Map<string, typeof f.menu>();
  f.menu.menuDays = Array.from({ length: 5 }, (_, index) => ({
    ...structuredClone(f.menu.menuDays[0]),
    id: id(60 + index),
    menuDate: new Date(Date.UTC(2026, 10, 9 + index)),
  }));
  f.batch.days = f.menu.menuDays.map((day) => ({
    ...structuredClone(f.input.days[0]),
    menuDate: day.menuDate,
  }));
  t.mock.method(
    repository,
    "createDay",
    (_tx: unknown, _weeklyId: string, date: Date) =>
      Promise.resolve({
        id: f.menu.menuDays.find((day) => +day.menuDate === +date)!.id,
      } as never),
  );
  t.mock.method(repository, "ownedMenu", (_tx: unknown, menuId: string) => {
    if (menuId === f.menu.id) stored.set(menuId, structuredClone(f.menu));
    return Promise.resolve(stored.get(menuId)!);
  });
  t.mock.method(repository, "submitDraftDays", () =>
    Promise.resolve({ count: 5 }),
  );
  t.mock.method(
    repository,
    "submitWeeklyMenu",
    (_tx: unknown, menuId: string) => {
      stored.get(menuId)!.status = "PENDING_APPROVAL";
      if (menuId === f.menu.id) f.menu.status = "PENDING_APPROVAL";
      return Promise.resolve(stored.get(menuId)!);
    },
  );
  const result = await f.service.saveGradeBatch(
    { ...f.batch, submit: true },
    f.principal,
  );
  assert.equal(result.submitted, true);
  assert.deepEqual(
    result.menus.map((menu) => ({ id: menu.id, status: menu.status })),
    [
      { id: id(40), status: "PENDING_APPROVAL" },
      { id: id(41), status: "PENDING_APPROVAL" },
    ],
  );
  assert.equal(f.counts().committedWrites, 10);
  assert.equal(f.counts().allergyReads, 2);
  assert.equal(unitLookup.mock.callCount(), 1);
  assert.equal(unitNormLookup.mock.callCount(), 0);
});
