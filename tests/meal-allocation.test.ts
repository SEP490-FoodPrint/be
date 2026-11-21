import assert from "node:assert/strict";
import test from "node:test";
import { readAllocationDay } from "../src/modules/meal-allocation/meal-allocation.repository";
import { queueAllocationDraft } from "../src/modules/meal-allocation/material-allocation-runtime";
import type { Prisma } from "../src/generated/prisma/client";
import type { AllocationDay } from "../src/modules/meal-allocation/meal-allocation.repository";
import {
  prepareChanges,
  projectAllocationDay,
} from "../src/modules/meal-allocation/meal-allocation.service";
import { validateAllocationApply } from "../src/modules/meal-allocation/meal-allocation.validation";

const date = "2026-11-12";

function fixture(): AllocationDay {
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
        completedAt: new Date(date),
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

void test("draft is queued only when all batch dishes in the meal are sampled", async () => {
  const day = fixture();
  const dish = day.batches[0].dishes[0];
  const samples = dish.retainedFoodSamples;
  dish.retainedFoodSamples = [];
  let queued = 0;
  let current: { state: string } | null = null;
  const tx = {
    menuDay: { findMany: () => Promise.resolve(day.menus) },
    cookingBatch: { findMany: () => Promise.resolve(day.batches) },
    dailyMealPortion: { findMany: () => Promise.resolve(day.demands) },
    mealAllocationDraft: {
      findUnique: () => Promise.resolve(current),
      createMany: () => {
        queued += 1;
        current = { state: "PENDING" };
        return Promise.resolve({ count: 1 });
      },
    },
  } as unknown as Prisma.TransactionClient;
  const queue = () =>
    queueAllocationDraft(tx, "school", new Date(date), "LUNCH");
  await queue();
  assert.equal(queued, 0);
  dish.retainedFoodSamples = samples;
  await queue();
  await queue();
  assert.equal(queued, 1);
});

function gradeFixture(): AllocationDay {
  // 2 khối, mỗi khối 1 thực đơn riêng, 1 món riêng, 1 lô riêng.
  const data = fixture();
  data.demands = data.demands.slice(0, 2);
  data.demands.forEach((demand, index) => {
    demand.Class.gradeId = `grade${index}`;
    demand.totalPortions = 50;
  });
  data.menus = [0, 1].map((index) => ({
    ...data.menus[0],
    id: `menu${index}`,
    WeeklyMenu: {
      isSchoolWide: false,
      grades: [
        { gradeId: `grade${index}`, grade: { name: `Khối ${index + 1}` } },
      ],
    },
    menuDayDishes: [
      {
        dishId: `dish${index}`,
        mealType: "LUNCH",
        Dish: { name: `dish${index}` },
      },
    ],
  }));
  // Single-dish batch per grade
  data.batches = [0, 1].map((index) => ({
    id: `b${index}`,
    batchCode: `b${index}`,
    batchNumber: index + 1,
    menuDayId: `menu${index}`,
    mealType: "LUNCH" as const,
    status: "COMPLETED" as const,
    completedAt: new Date(date),
    note: null,
    plannedPortions: 50,
    dishes: [
      {
        dishId: `dish${index}`,
        plannedPortions: 50,
        retainedFoodSamples: [{ id: `sample${index}` }],
        mealAllocationBatches: [],
      },
    ],
  }));
  return data;
}

void test("hai thực đơn cùng bữa tính suất theo khối và chỉ cho phân bổ tới lớp đúng khối", () => {
  const data = gradeFixture();
  const ready = projectAllocationDay(data, date);
  assert.equal(ready.status, "READY");
  assert.equal(ready.totals.finalized, 100);
  assert.deepEqual(
    ready.batches.map((batch) => batch.eligibleDemandIds),
    [["d0"], ["d1"]],
  );
  assert.deepEqual(
    ready.batches.map((batch) => batch.scopeLabel),
    ["Khối 1", "Khối 2"],
  );
  data.batches[0].plannedPortions = 60;
  data.batches[0].dishes[0].plannedPortions = 60;
  data.batches[1].plannedPortions = 40;
  data.batches[1].dishes[0].plannedPortions = 40;
  assert.equal(
    projectAllocationDay(data, date).status,
    "RECONCILE",
    "không bù số suất giữa các khối dù tổng vẫn đủ",
  );
});

void test("lớp chưa gán khối và lịch sử phân bổ sai khối phải đối soát", () => {
  const data = gradeFixture();
  data.demands[0].Class.gradeId = null;
  assert.equal(projectAllocationDay(data, date).status, "RECONCILE");
  data.demands[0].Class.gradeId = "grade0";
  data.demands[0].MealAllocation = {
    id: "wrong-scope",
    status: "ALLOCATED",
    mealAllocationBatches: [
      { cookingBatchId: "b1", dishId: "dish1", allocatedPortions: 50 },
    ],
  };
  assert.equal(projectAllocationDay(data, date).status, "RECONCILE");
});

void test("mở màn hình khi đủ suất, ưu tiên nấu trước lưu mẫu", () => {
  const data = fixture();
  assert.equal(projectAllocationDay(data, date).status, "READY");
  // Bỏ mẫu lưu trên 1 lô (b1-main) → sampled giảm
  const batchMainB1 = data.batches.find((b) => b.id === "b1-main")!;
  batchMainB1.dishes[0].retainedFoodSamples = [];
  const pending = projectAllocationDay(data, date);
  assert.equal(pending.status, "SAMPLES_PENDING");
  // rice sampled = 60+40=100, main sampled = 60+0=60 → min = 60
  assert.equal(pending.totals.sampled, 60);
  assert.equal(pending.missingSampleBatches, 1);
  // Chuyển 1 lô sang CONFIRMED → ưu tiên trạng thái nấu
  const batchRiceB0 = data.batches.find((b) => b.id === "b0-rice")!;
  batchRiceB0.status = "CONFIRMED";
  assert.equal(projectAllocationDay(data, date).action, "COOKING");
  // Xóa 1 lô → thiếu suất → COOKING_PENDING
  data.batches = data.batches.filter((b) => b.id !== "b1-main");
  assert.equal(projectAllocationDay(data, date).status, "COOKING_PENDING");
});

void test("chỉ mở xác nhận khi cả ngày đủ suất và không cộng lặp các món", () => {
  const data = fixture();
  // Chuyển một cặp lô (b1-rice, b1-main) thành bữa phụ
  // LUNCH: b0-rice(60) + b0-main(60) → 2 lô, suất trưa = 60
  // AFTERNOON: b1-rice(40) + b1-main(40) → 2 lô, suất phụ = 40
  // Nhưng ta cần suất trưa = 75 để đủ cho d0(40)+d1(35)
  for (const batch of data.batches) {
    if (batch.id.startsWith("b0-")) {
      batch.plannedPortions = 75;
      batch.dishes[0].plannedPortions = 75;
    } else {
      batch.mealType = "AFTERNOON";
      batch.plannedPortions = 25;
      batch.dishes[0].plannedPortions = 25;
    }
  }
  // Thêm các món bữa phụ vào thực đơn
  data.menus[0].menuDayDishes.push(
    ...["rice", "main"].map((dishId) => ({
      dishId,
      mealType: "AFTERNOON" as const,
      Dish: { name: dishId },
    })),
  );
  data.demands[2].mealType = "AFTERNOON";

  // Phân bổ cho 1 lớp = phân bổ từ tất cả các lô đơn món liên quan
  const allocate = (
    demandIndex: number,
    batchFilter: (b: (typeof data.batches)[number]) => boolean,
  ) => {
    const demand = data.demands[demandIndex];
    const matchBatches = data.batches.filter(batchFilter);
    demand.MealAllocation = {
      id: `allocation${demandIndex}`,
      status: "ALLOCATED",
      mealAllocationBatches: matchBatches.map((batch) => ({
        cookingBatchId: batch.id,
        dishId: batch.dishes[0].dishId,
        allocatedPortions: demand.totalPortions,
      })),
    };
  };
  const isLunch = (b: (typeof data.batches)[number]) => b.mealType === "LUNCH";
  const isAfternoon = (b: (typeof data.batches)[number]) =>
    b.mealType === "AFTERNOON";
  allocate(0, isLunch);
  allocate(1, isLunch);
  const pending = projectAllocationDay(data, date).distribution;
  assert.equal(pending.status, "PENDING");
  assert.equal(pending.meals[0].allocatedPortions, 75);
  allocate(2, isAfternoon);
  assert.equal(projectAllocationDay(data, date).distribution.status, "READY");
  for (const demand of data.demands)
    demand.MealAllocation!.status = "DISTRIBUTED";
  assert.equal(
    projectAllocationDay(data, date).distribution.status,
    "DISTRIBUTED",
  );
  data.demands[2].MealAllocation!.status = "CANCELLED";
  assert.equal(projectAllocationDay(data, date).distribution.status, "PENDING");
});

void test("không bù số suất giữa hai bữa và không đoán số suất nhóm chung", () => {
  const data = fixture();
  data.menus[0].menuDayDishes.push(
    ...["rice", "main"].map((dishId) => ({
      dishId,
      mealType: "AFTERNOON" as const,
      Dish: { name: dishId },
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

void test("chỉ trừ suất dị ứng ở món khớp và không trừ lặp", () => {
  const data = fixture();
  data.menus[0].menuDayDishes.forEach((dish) => {
    dish.ingredients =
      dish.dishId === "main"
        ? [
            { ingredientId: "bean", ingredient: { name: "Đậu xanh hạt" } },
            { ingredientId: "shrimp", ingredient: { name: "Tôm nõn" } },
          ]
        : [{ ingredientId: "rice", ingredient: { name: "Gạo" } }];
  });
  data.demands[0].dailyAllergyPortions = [
    ["bean", "Đậu xanh"],
    ["shrimp", "Tôm"],
  ].map(([ingredientId, name]) => ({
    ingredientEntryId: ingredientId,
    portionCount: 2,
    ClassAllergy: { IngredientEntry: { ingredientId, Ingredient: { name } } },
  }));
  const view = projectAllocationDay(data, date);
  assert.equal(view.status, "READY");
  assert.equal(view.totals.finalized, 100);
  assert.equal(
    view.grades?.flatMap((g) => g.dishes).find((d) => d.dishId === "main")
      ?.totalRequiredPortions,
    98,
  );
  assert.equal(
    view.grades?.flatMap((g) => g.dishes).find((d) => d.dishId === "rice")
      ?.totalRequiredPortions,
    100,
  );
  assert.throws(
    () =>
      prepareChanges(data, view, {
        revision: view.revision,
        batches: [
          {
            cookingBatchId: "b0-main",
            dishId: "main",
            entries: [{ dailyMealPortionId: "d0", allocatedPortions: 39 }],
          },
        ],
      }),
    /vượt nhu cầu món/,
  );
  data.demands.forEach((demand, index) => {
    demand.MealAllocation = {
      id: demand.id,
      status: "ALLOCATED",
      mealAllocationBatches: ["main", "rice"].map((dishId) => ({
        cookingBatchId: `b${index ? 0 : 1}-${dishId}`,
        dishId,
        allocatedPortions:
          demand.totalPortions - (index === 0 && dishId === "main" ? 2 : 0),
      })),
    };
  });
  const saved = projectAllocationDay(data, date);
  assert.equal(saved.status, "READY");
  assert.equal(saved.distribution.status, "READY");
});

void test("gộp dòng món thành suất, giữ khóa và chặn lịch sử thiếu món", () => {
  const data = fixture();
  // Single-dish batches: phân bổ cho d0 từ cả b0-rice và b0-main
  const allocation: NonNullable<
    AllocationDay["demands"][number]["MealAllocation"]
  > = {
    id: "allocation",
    status: "DISTRIBUTED",
    mealAllocationBatches: [
      { cookingBatchId: "b0-rice", dishId: "rice", allocatedPortions: 40 },
      { cookingBatchId: "b0-main", dishId: "main", allocatedPortions: 40 },
    ],
  };
  data.demands[0].MealAllocation = allocation;
  const ready = projectAllocationDay(data, date);
  // b0-rice là batches[0] → phải có entry từ d0
  const riceEntries = ready.batches.find((b) => b.id === "b0-rice")!.entries;
  assert.deepEqual(riceEntries, [
    { dailyMealPortionId: "d0", allocatedPortions: 40, locked: true },
  ]);
  // b0-main cũng phải có entry từ d0
  const mainEntries = ready.batches.find((b) => b.id === "b0-main")!.entries;
  assert.deepEqual(mainEntries, [
    { dailyMealPortionId: "d0", allocatedPortions: 40, locked: true },
  ]);
  // Xóa 1 món khỏi phân bổ → thiếu → RECONCILE
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

void test("cấu trúc phân cấp grades trả về đúng mô hình Khối -> Món -> Lô -> Lớp", () => {
  const data = fixture();
  data.demands.forEach((d) => {
    d.Class.gradeId = "grade-1";
    d.Class.grade = { name: "Khối 1" };
  });
  const view = projectAllocationDay(data, date);
  assert.ok(view.grades, "phải có trường grades");
  assert.equal(view.grades.length, 1);

  const grade = view.grades[0];
  assert.equal(grade.gradeName, "Khối 1");
  assert.equal(grade.demands.length, 3);
  assert.equal(grade.dishes.length, 2);

  const riceDish = grade.dishes.find((d) => d.dishId === "rice");
  assert.ok(riceDish, "phải có món rice");
  assert.equal(riceDish.batches.length, 2);
  assert.equal(riceDish.totalRequiredPortions, 100);

  const mainDish = grade.dishes.find((d) => d.dishId === "main");
  assert.ok(mainDish, "phải có món main");
  assert.equal(mainDish.batches.length, 2);
});

void test("prepareChanges bảo lưu phân bổ món khác khi FE chỉ gửi món được chỉnh sửa", () => {
  const data = fixture();
  data.demands.forEach((d) => {
    d.Class.gradeId = "grade-1";
    d.Class.grade = { name: "Khối 1" };
  });
  // Giả sử d0 đã có phân bổ rice = 40 từ b0-rice và main = 40 từ b0-main
  data.demands[0].MealAllocation = {
    id: "alloc-d0",
    status: "ALLOCATED",
    mealAllocationBatches: [
      { cookingBatchId: "b0-rice", dishId: "rice", allocatedPortions: 40 },
      { cookingBatchId: "b0-main", dishId: "main", allocatedPortions: 40 },
    ],
  };

  const view = projectAllocationDay(data, date);

  // FE chỉ chỉnh sửa lô b1-rice cho d1 (35 suất)
  const changes = prepareChanges(data, view, {
    revision: view.revision,
    batches: [
      {
        cookingBatchId: "b1-rice",
        dishId: "rice",
        entries: [{ dailyMealPortionId: "d1", allocatedPortions: 35 }],
      },
    ],
  });

  // d0 giữ nguyên cả rice và main nên không cần ghi đè vào DB (changes không có d0)
  const d0Change = changes.find((c) => c.demandId === "d0");
  assert.equal(d0Change, undefined, "d0 không bị ghi đè khi không đổi");

  // d1 có thay đổi mới
  const d1Change = changes.find((c) => c.demandId === "d1");
  assert.ok(d1Change, "d1 phải có thay đổi");
  assert.equal(d1Change.rows.length, 1);
  assert.equal(d1Change.rows[0].cookingBatchId, "b1-rice");
  assert.equal(d1Change.rows[0].allocatedPortions, 35);

  // Nếu FE chỉnh sửa d0 ở món rice (đổi thành 30), món main không gửi vẫn phải được bảo lưu 40
  const changesWithD0 = prepareChanges(data, view, {
    revision: view.revision,
    batches: [
      {
        cookingBatchId: "b0-rice",
        dishId: "rice",
        entries: [{ dailyMealPortionId: "d0", allocatedPortions: 30 }],
      },
    ],
  });

  const modifiedD0 = changesWithD0.find((c) => c.demandId === "d0");
  assert.ok(modifiedD0, "d0 phải có trong changes khi được chỉnh sửa");
  assert.equal(modifiedD0.rows.length, 2, "d0 phải có đủ 2 món rice và main");
  assert.ok(
    modifiedD0.rows.some(
      (r) =>
        r.cookingBatchId === "b0-rice" &&
        r.dishId === "rice" &&
        r.allocatedPortions === 30,
    ),
  );
  assert.ok(
    modifiedD0.rows.some(
      (r) =>
        r.cookingBatchId === "b0-main" &&
        r.dishId === "main" &&
        r.allocatedPortions === 40,
    ),
    "món main không gửi vẫn được bảo lưu 40",
  );
});

void test("meal revisions cannot be used for another scope", () => {
  const data = fixture();
  const lunch = projectAllocationDay(data, date, "LUNCH");
  assert.equal(lunch.status, "READY");
  assert.equal(lunch.mealType, "LUNCH");
  assert.notEqual(lunch.revision, projectAllocationDay(data, date).revision);
  assert.notEqual(
    lunch.revision,
    projectAllocationDay(data, date, "AFTERNOON").revision,
  );
});

void test("lunch readiness is independent from unfinished afternoon cooking", () => {
  const lunch = fixture();
  const day = structuredClone(lunch);
  day.menus[0].menuDayDishes.push({
    dishId: "snack",
    mealType: "AFTERNOON",
    Dish: { name: "snack" },
  });
  day.demands.push({
    ...structuredClone(day.demands[0]),
    id: "afternoon",
    mealType: "AFTERNOON",
    totalPortions: 500,
  });
  assert.equal(projectAllocationDay(day, date).status, "COOKING_PENDING");
  assert.equal(projectAllocationDay(lunch, date, "LUNCH").status, "READY");
  assert.equal(
    projectAllocationDay(lunch, date, "LUNCH").totals.finalized,
    100,
  );
});

void test("repository scopes every meal source consistently", async () => {
  const captured: unknown[] = [];
  const model = {
    findMany: (args: unknown) => {
      captured.push(args);
      return Promise.resolve([]);
    },
  };
  const tx = {
    menuDay: model,
    cookingBatch: model,
    dailyMealPortion: model,
  } as unknown as Prisma.TransactionClient;
  await readAllocationDay(tx, "school", new Date(date), "LUNCH");
  const [menu, batch, demand] = captured as {
    where: { mealType?: string };
    select: {
      menuDayDishes: { where: { mealType: string } };
      portionGroups: { where: { mealType: string } };
    };
  }[];
  assert.equal(menu.select.menuDayDishes.where.mealType, "LUNCH");
  assert.equal(menu.select.portionGroups.where.mealType, "LUNCH");
  assert.equal(batch.where.mealType, "LUNCH");
  assert.equal(demand.where.mealType, "LUNCH");
});
