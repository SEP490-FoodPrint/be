import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma, type CookingMode } from "../src/generated/prisma/client";
import {
  createKitchenLifecycle,
  groupDishPlans,
  type DishPlans,
} from "../src/modules/kitchen/kitchen.service";
import { validateKitchenPlan } from "../src/modules/kitchen/kitchen.validation";
import { testStaff } from "./helpers/authorization";
import { createRetainedSampleService } from "../src/modules/retained-sample/retained-sample.service";
import type { SampleRow } from "../src/modules/retained-sample/retained-sample.repository";

const makePlan = (count: number, lot: string, amount = count) => ({
  plannedPortions: count,
  lots: [{ ingredientLotId: lot, quantityUsed: String(amount), unit: "g" }],
});

void test("separate mode keeps one dish per child and does not split unrelated dishes", () => {
  const input: DishPlans[] = [
    { dishId: "chicken", plans: [makePlan(60, "c1"), makePlan(40, "c2")] },
    ...["beef", "rice", "soup"].map((dishId) => ({
      dishId,
      plans: [makePlan(100, dishId)],
    })),
  ];
  const children = groupDishPlans(input, "SEPARATE_BY_LOT");
  assert.deepEqual(
    children.map((c) => c.plannedPortions),
    [60, 40, 100, 100, 100],
  );
  assert.deepEqual(
    children.map((c) => c.dishes[0].dishId),
    ["chicken", "chicken", "beef", "rice", "soup"],
  );
  assert.ok(children.every((c) => c.dishes.length === 1));
  assert.equal(input[1].plans[0].lots[0].quantityUsed, "100");
});

void test("different ingredient lots and allergy demand conserve every dish and lot", () => {
  const input: DishPlans[] = [
    { dishId: "chicken", plans: [makePlan(60, "c1"), makePlan(40, "c2")] },
    { dishId: "rice", plans: [makePlan(30, "r1"), makePlan(70, "r2")] },
    { dishId: "alternative", plans: [makePlan(10, "a1")] },
  ];
  const children = groupDishPlans(input, "SEPARATE_BY_LOT");
  assert.deepEqual(
    children.map((c) => c.plannedPortions),
    [60, 40, 30, 70, 10],
  );
  assert.ok(children.every((c) => c.dishes.length === 1));
  for (const dish of input) {
    const actual = children.flatMap((c) =>
      c.dishes.filter((d) => d.dishId === dish.dishId),
    );
    assert.equal(
      actual.reduce((n, d) => n + d.plannedPortions, 0),
      dish.plans.reduce((n, plan) => n + plan.plannedPortions, 0),
    );
    for (const plan of dish.plans) {
      const used = actual
        .flatMap((d) => d.lots)
        .filter((l) => l.ingredientLotId === plan.lots[0].ingredientLotId)
        .reduce((n, l) => n.add(l.quantityUsed), new Prisma.Decimal(0));
      assert.equal(
        used.toString(),
        new Prisma.Decimal(plan.lots[0].quantityUsed).toString(),
      );
    }
  }
});

void test("combine mode makes one child per dish even with unequal demand", () => {
  const children = groupDishPlans(
    [
      {
        dishId: "regular",
        plans: [
          {
            plannedPortions: 90,
            lots: [makePlan(50, "c1").lots[0], makePlan(40, "c2").lots[0]],
          },
        ],
      },
      { dishId: "alternative", plans: [makePlan(10, "alt")] },
    ],
    "COMBINE_LOTS",
  );
  assert.equal(children.length, 2);
  assert.deepEqual(
    children.map((c) => c.dishes[0].plannedPortions),
    [90, 10],
  );
  assert.equal(children[0].dishes[0].lots.length, 2);
});

void test("planning rejects duplicate dishes, invalid portions and invalid combine plans", () => {
  assert.throws(() =>
    groupDishPlans(
      [
        { dishId: "a", plans: [makePlan(1, "l")] },
        { dishId: "a", plans: [makePlan(1, "l")] },
      ],
      "SEPARATE_BY_LOT",
    ),
  );
  assert.throws(() =>
    groupDishPlans(
      [{ dishId: "a", plans: [makePlan(0, "l")] }],
      "SEPARATE_BY_LOT",
    ),
  );
  assert.throws(() =>
    groupDishPlans(
      [{ dishId: "a", plans: [makePlan(1, "l1"), makePlan(1, "l2")] }],
      "COMBINE_LOTS",
    ),
  );
});

const principal = {
  ...testStaff,
  permissions: [
    "cooking_batch.create",
    "cooking_batch.confirm",
    "cooking_batch.complete",
    "cooking_batch.view",
    "retained_sample.create",
  ],
};
const meal = {
  menuDayId: "00000000-0000-4000-8000-000000000099",
  mealType: "LUNCH" as const,
};

function fixture(mode: CookingMode, shared = false) {
  type Lot = {
    id: string;
    unit: string;
    lotCode: string;
    availableQuantity: Prisma.Decimal;
    status: string;
    DeliveryItem: {
      SupplyRequestItem: {
        ingredientEntryId: string;
        IngredientEntry: { Ingredient: { name: string } };
      };
    };
  };
  const lots: Lot[] = (
    shared
      ? [["shared", "e", 200]]
      : [
          ["c1", "c", 60],
          ["c2", "c", 40],
          ["beef", "b", 100],
          ["rice", "r", 100],
          ["soup", "s", 100],
        ]
  ).map(([id, entry, amount]) => ({
    id: String(id),
    lotCode: String(id),
    unit: "g",
    availableQuantity: new Prisma.Decimal(amount),
    status: "AVAILABLE",
    DeliveryItem: {
      SupplyRequestItem: {
        ingredientEntryId: String(entry),
        IngredientEntry: { Ingredient: { name: String(entry) } },
      },
    },
  }));
  const dishEntries = shared
    ? [
        ["one", "e"],
        ["two", "e"],
      ]
    : [
        ["chicken", "c"],
        ["beef", "b"],
        ["rice", "r"],
        ["soup", "s"],
      ];
  type Child = {
    id: string;
    batchGroupId: string;
    BatchGroup: { id: string; batchCode: string };
    batchCode: string;
    menuDayId: string;
    dishId: string | null;
    mealType: "LUNCH";
    cookingModeApplied: CookingMode;
    status: string;
    plannedPortions: number;
    note: null;
    confirmedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    Dish: { name: string } | null;
    MenuDay: { menuDate: Date };
    dishes: {
      dishId: string;
      plannedPortions: number;
      Dish: { name: string };
    }[];
    cookingBatchLots: {
      dishId: string;
      ingredientLotId: string;
      quantityUsed: Prisma.Decimal;
      unit: string;
    }[];
  };
  const children: Child[] = [];
  const groups: { id: string; batchCode: string }[] = [];
  const usage: {
    ingredientLotId: string;
    referenceId: string;
    quantity: Prisma.Decimal;
  }[] = [];
  const date = new Date("2026-11-11");
  const tx = {
    $queryRaw: () => Promise.resolve().then(() => []),
    $queryRawUnsafe: () => Promise.resolve().then(() => []),
    user: {
      findUnique: () =>
        Promise.resolve().then(() => ({
          ...principal,
          status: "ACTIVE",
          Role: {
            code: principal.role,
            type: "SCHOOL",
            rolePermissions: principal.permissions.map((code) => ({
              permission: { code, isActive: true },
            })),
          },
          permissionDenials: [],
        })),
    },
    school: {
      findUnique: () => Promise.resolve().then(() => ({ status: "ACTIVE" })),
      findFirst: () =>
        Promise.resolve().then(() => ({
          cookingMode: mode,
          lunchTime: date,
          afternoonMealTime: date,
        })),
    },
    menuDay: {
      findFirst: () =>
        Promise.resolve().then(() => ({
          menuDate: date,
          approvalStatus: "APPROVED",
          menuDayDishes: dishEntries.map(([dishId, entry]) => ({
            dishId,
            Dish: {
              schoolId: principal.schoolId,
              status: "ACTIVE",
              name: dishId,
            },
            ingredients: [
              {
                ingredientId: entry,
                quantityPerPortion: new Prisma.Decimal(1),
                unit: "g",
                ingredient: { ingredientEntries: [{ id: entry }] },
              },
            ],
          })),
        })),
      findUniqueOrThrow: () =>
        Promise.resolve().then(() => ({ menuDate: date })),
      update: () => Promise.resolve().then(() => ({ id: "menu-day" })),
    },
    menuDayDish: {
      findMany: () =>
        Promise.resolve().then(() =>
          dishEntries.map(([dishId]) => ({ dishId })),
        ),
    },
    menuDayDishIngredient: { count: () => Promise.resolve().then(() => 1) },
    menuMealPortionGroup: { findMany: () => Promise.resolve().then(() => []) },
    dailyMealPortion: {
      findMany: () =>
        Promise.resolve().then(() => [
          { totalPortions: 100, portionGroups: [], dailyAllergyPortions: [] },
        ]),
    },
    dailyAllergyPortion: {
      findFirst: () => Promise.resolve().then(() => null),
    },
    menuMealSeasoning: { findMany: () => Promise.resolve().then(() => []) },
    menuMealSeasoningLot: { findMany: () => Promise.resolve().then(() => []) },
    cookingBatchGroup: {
      create: ({ data }: { data: { batchCode: string } }) =>
        Promise.resolve().then(() => {
          const g = { id: `group-${groups.length}`, batchCode: data.batchCode };
          groups.push(g);
          return g;
        }),
    },
    cookingBatch: {
      findMany: () => Promise.resolve().then(() => children.slice()),
      create: ({
        data,
      }: {
        data: Omit<Child, "dishes"> & { dishes: { create: Child["dishes"] } };
      }) =>
        Promise.resolve().then(() => {
          const child: Child = {
            ...data,
            id: `child-${children.length}`,
            status: data.status,
            note: null,
            confirmedAt: data.confirmedAt,
            completedAt: null,
            createdAt: date,
            updatedAt: date,
            BatchGroup: groups.find((g) => g.id === data.batchGroupId)!,
            Dish: null,
            MenuDay: { menuDate: date },
            dishes: data.dishes.create.map((d) => ({
              ...d,
              Dish: { name: d.dishId },
            })),
            cookingBatchLots: [],
          };
          children.push(child);
          return { id: child.id };
        }),
      findUniqueOrThrow: ({ where }: { where: { id: string } }) =>
        Promise.resolve().then(() => children.find((c) => c.id === where.id)!),
      findFirst: ({ where }: { where: { id: string } }) =>
        Promise.resolve().then(
          () => children.find((c) => c.id === where.id) ?? null,
        ),
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<Child>;
      }) =>
        Promise.resolve().then(() =>
          Object.assign(
            children.find((c) => c.id === where.id)!,
            data,
          ),
        ),
    },
    cookingBatchDish: {
      findMany: () =>
        Promise.resolve().then(() =>
          children.flatMap((c) =>
            c.dishes.map((d) => ({ ...d, CookingBatch: { status: c.status } })),
          ),
        ),
    },
    cookingBatchLot: {
      findMany: ({ where }: { where: { ingredientLotId: { in: string[] } } }) =>
        Promise.resolve().then(() =>
          children
            .filter((c) => c.status !== "COMPLETED")
            .flatMap((c) => c.cookingBatchLots)
            .filter((l) =>
              where.ingredientLotId.in.includes(l.ingredientLotId),
            ),
        ),
      createMany: ({
        data,
      }: {
        data: {
          cookingBatchId: string;
          dishId: string;
          ingredientLotId: string;
          quantityUsed: string;
          unit: string;
        }[];
      }) =>
        Promise.resolve().then(() => {
          for (const l of data)
            children
              .find((c) => c.id === l.cookingBatchId)!
              .cookingBatchLots.push({
                ...l,
                quantityUsed: new Prisma.Decimal(l.quantityUsed),
              });
          return { count: data.length };
        }),
    },
    ingredientLot: {
      findMany: ({ where }: { where: { id?: { in: string[] } } }) =>
        Promise.resolve().then(() =>
          lots.filter((l) => !where.id || where.id.in.includes(l.id)),
        ),
      updateMany: ({
        where,
        data,
      }: {
        where: { id: string };
        data: {
          availableQuantity: { decrement: Prisma.Decimal };
          status: string;
        };
      }) =>
        Promise.resolve().then(() => {
          const l = lots.find((l) => l.id === where.id)!;
          l.availableQuantity = l.availableQuantity.sub(
            data.availableQuantity.decrement,
          );
          l.status = data.status;
          return { count: 1 };
        }),
    },
    inventoryTransaction: {
      count: ({ where }: { where: { referenceId: string } }) =>
        Promise.resolve().then(
          () => usage.filter((u) => u.referenceId === where.referenceId).length,
        ),
      create: ({ data }: { data: (typeof usage)[number] }) =>
        Promise.resolve().then(() => {
          usage.push(data);
          return data;
        }),
    },
  };
  const db = {
    $transaction: <T>(operation: (client: typeof tx) => Promise<T>) =>
      Promise.resolve().then(() => operation(tx)),
  };
  return {
    service: createKitchenLifecycle(() =>
      Promise.resolve().then(() => db as never),
    ),
    db,
    tx,
    children,
    groups,
    lots,
    usage,
  };
}

void test("meal API creates one child per dish and lot, and retry never reserves twice", async () => {
  const f = fixture("SEPARATE_BY_LOT");
  const result = await f.service.plan(validateKitchenPlan(meal), principal);
  assert.equal(result.groups.length, 1);
  assert.equal(result.batches.length, 5);
  assert.deepEqual(
    result.batches.map((b) => b.dishes.length),
    [1, 1, 1, 1, 1],
  );
  assert.deepEqual(
    result.batches.map((b) => b.plannedPortions),
    [60, 40, 100, 100, 100],
  );
  assert.equal(
    result.batches.every((b) => b.batchGroupId === result.groups[0].id),
    true,
  );
  const retried = await f.service.plan(validateKitchenPlan(meal), principal);
  assert.equal(retried.created, false);
  assert.equal(f.groups.length, 1);
  assert.equal(f.children.length, 5);
  await f.service.confirm(f.children[0].id, principal);
  await f.service.complete(f.children[0].id, principal);
  await f.service.complete(f.children[0].id, principal);
  assert.equal(f.usage.length, 1, "retry must not consume stock twice");
  assert.equal(
    f.lots.find((l) => l.id === "rice")!.availableQuantity.toString(),
    "100",
  );
  assert.equal(f.children[1].status, "CONFIRMED");
});

void test("two single-dish children sharing one lot each post their own stock usage", async () => {
  const f = fixture("COMBINE_LOTS", true);
  const result = await f.service.plan(validateKitchenPlan(meal), principal);
  assert.equal(result.batches.length, 2);
  assert.ok(result.batches.every((batch) => batch.dishes.length === 1));
  await f.service.confirm(f.children[0].id, principal);
  const completed = await f.service.complete(f.children[0].id, principal);
  assert.equal(completed.inventoryDeducted, true);
  await f.service.complete(f.children[1].id, principal);
  assert.equal(f.usage.length, 2);
  assert.equal(f.usage[0].quantity.toString(), "100");
  assert.equal(f.lots[0].availableQuantity.toString(), "0");
  assert.equal(f.lots[0].status, "DEPLETED");
});

void test("cross-dish stock shortage fails before persisting a parent or child", async () => {
  const f = fixture("COMBINE_LOTS", true);
  f.lots[0].availableQuantity = new Prisma.Decimal(150);
  await assert.rejects(f.service.plan(validateKitchenPlan(meal), principal));
  assert.equal(f.groups.length, 0);
  assert.equal(f.children.length, 0);
  assert.equal(f.usage.length, 0);
});

void test("school policy cannot be overridden in the planning request and unauthorized users never connect", async () => {
  assert.throws(() =>
    validateKitchenPlan({ ...meal, cookingModeApplied: "COMBINE_LOTS" }),
  );
  let connected = false;
  const service = createKitchenLifecycle(() =>
    Promise.resolve().then(() => {
      connected = true;
      throw new Error("must not connect");
    }),
  );
  await assert.rejects(
    service.getGroup("another-school-group", { ...principal, permissions: [] }),
  );
  assert.equal(connected, false);
});

void test("single-dish samples are idempotent and historical multi-dish samples remain supported", async () => {
  const f = fixture("COMBINE_LOTS", true);
  await f.service.plan(validateKitchenPlan(meal), principal);
  const child = f.children[0];
  await f.service.confirm(child.id, principal);
  await f.service.complete(child.id, principal);
  const saved: SampleRow[] = [];
  Object.assign(f.tx, {
    retainedFoodSample: {
      findUnique: ({
        where,
      }: {
        where: {
          cookingBatchId_dishId: { cookingBatchId: string; dishId: string };
        };
      }) =>
        Promise.resolve().then(() => {
          const key = where.cookingBatchId_dishId;
          return (
            saved.find(
              (s) =>
                s.cookingBatchId === key.cookingBatchId &&
                s.dishId === key.dishId,
            ) ?? null
          );
        }),
      create: ({
        data,
      }: {
        data: {
          cookingBatchId: string;
          dishId: string;
          recordedByUserId: string;
          quantity: string;
          unit: string;
          storageLocation: string;
          sampledAt: Date;
        };
      }) =>
        Promise.resolve().then(() => {
          const dish = child.dishes.find((d) => d.dishId === data.dishId)!;
          const sample: SampleRow = {
            ...data,
            id: `sample-${saved.length}`,
            photoPublicId: null,
            photoHash: null,
            quantity: new Prisma.Decimal(data.quantity),
            status: "STORED",
            disposedAt: null,
            disposalNote: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            CookingBatch: {
              batchCode: child.batchCode,
              BatchGroup: child.BatchGroup,
              mealType: child.mealType,
              plannedPortions: child.plannedPortions,
            },
            CookingBatchDish: {
              plannedPortions: dish.plannedPortions,
              Dish: dish.Dish,
            },
          };
          saved.push(sample);
          return sample;
        }),
    },
  });
  const service = createRetainedSampleService(undefined, () =>
    Promise.resolve().then(() => f.db as never),
  );
  const input = {
    quantity: "150",
    unit: "g",
    storageLocation: "Fridge",
    sampledAt: new Date(),
  };
  const single = await service.create(child.id, input, principal);
  assert.equal(single.created, true);
  assert.equal(single.dishId, child.dishes[0].dishId);
  const repeat = await service.create(child.id, input, principal);
  assert.equal(repeat.created, false);
  await assert.rejects(
    service.create(child.id, { ...input, dishId: "foreign-dish" }, principal),
  );
  // A historical multi-dish child still requires selecting the remaining dish.
  child.dishes.push(...f.children[1].dishes);
  await assert.rejects(service.create(child.id, input, principal));
  const second = await service.create(
    child.id,
    { ...input, dishId: child.dishes[1].dishId },
    principal,
  );
  assert.equal(second.created, true);
  assert.equal(saved.length, 2);
});

void test("preview does not persist or consume stock; confirming starts cooking and rejects stale previews", async () => {
  const f = fixture("SEPARATE_BY_LOT");
  const before = f.lots.map((lot) => lot.availableQuantity.toString());
  const preview = await f.service.preview(validateKitchenPlan(meal), principal);
  assert.deepEqual(
    preview.batches.map((b) => b.plannedPortions),
    [60, 40, 100, 100, 100],
  );
  assert.equal(f.groups.length, 0);
  assert.equal(f.children.length, 0);
  assert.equal(f.usage.length, 0);
  assert.deepEqual(
    f.lots.map((lot) => lot.availableQuantity.toString()),
    before,
  );
  await assert.rejects(
    f.service.plan(
      validateKitchenPlan({ ...meal, planVersion: "0".repeat(64) }),
      principal,
    ),
    { statusCode: 409 },
  );
  assert.equal(f.children.length, 0);
  f.lots[0].availableQuantity = new Prisma.Decimal(50);
  f.lots[1].availableQuantity = new Prisma.Decimal(50);
  await assert.rejects(
    f.service.plan(
      validateKitchenPlan({ ...meal, planVersion: preview.planVersion }),
      principal,
    ),
    { statusCode: 409 },
  );
  assert.equal(f.children.length, 0);
  f.lots[0].availableQuantity = new Prisma.Decimal(60);
  f.lots[1].availableQuantity = new Prisma.Decimal(40);
  const created = await f.service.plan(
    validateKitchenPlan({ ...meal, planVersion: preview.planVersion }),
    principal,
  );
  assert.ok(
    created.batches.every((b) => b.status === "CONFIRMED" && b.confirmedAt),
  );
  await f.service.complete(f.children[0].id, principal);
});
