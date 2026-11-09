import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { Client } from "pg";
import { MemoryStore } from "express-rate-limit";
import { createApp } from "../src/app";
import { createApiRateLimiter } from "../src/middlewares/rate-limit.middleware";
import { bootstrapAuthorization } from "../src/utils/authorization-bootstrap";
import { loadPrincipal } from "../src/utils/authorization";
import { getPrisma } from "../src/utils/database";
import { assertLocalMigrationTarget } from "../src/utils/migration-target";
import { sendError } from "../src/utils/response";
import { startHttp } from "./helpers/http";

const execute = promisify(execFile);
const hour = 3_600_000;
const day = 24 * hour;

function record(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  assert.equal(typeof value, "string");
  return value as string;
}
function array(value: unknown): Record<string, unknown>[] {
  assert(Array.isArray(value));
  return value.map(record);
}
function payload(body: unknown) {
  const envelope = record(body);
  assert.equal(envelope.success, true);
  return record(envelope.data);
}
function items(body: unknown) {
  return array(payload(body).items);
}
function vietnamDay(timestamp: number) {
  return new Date(timestamp + 7 * hour).toISOString().slice(0, 10);
}
function fullWeekWrite(menu: Record<string, unknown>) {
  return {
    weekStartDate: text(menu.weekStartDate).slice(0, 10),
    title: menu.title,
    days: array(menu.menuDays).map((menuDay) => {
      const dishes = array(menuDay.menuDayDishes);
      return {
        menuDate: text(menuDay.menuDate).slice(0, 10),
        note: menuDay.note,
        meals: [...new Set(dishes.map((dish) => text(dish.mealType)))].map(
          (mealType) => ({
            mealType,
            dishes: dishes
              .filter((dish) => dish.mealType === mealType)
              .map((dish) => ({
                dishId: text(dish.dishId),
                ingredients: array(dish.ingredients).map((ingredient) => ({
                  ingredientId: text(ingredient.ingredientId),
                  quantityPerPortion: text(ingredient.quantityPerPortion),
                  unit: text(ingredient.unit),
                })),
              })),
            seasonings: array(menuDay.mealSeasonings)
              .filter((seasoning) => seasoning.mealType === mealType)
              .map((seasoning) => ({
                ingredientEntryId: text(seasoning.ingredientEntryId),
                quantityPerPortion: text(seasoning.quantityPerPortion),
                unit: text(seasoning.unit),
              })),
          }),
        ),
      };
    }),
  };
}

void test("kitchen and nutrition wire contracts use real scoped PostgreSQL data", async (context) => {
  const base = process.env.MIGRATION_TEST_DATABASE_URL;
  assert(
    base,
    "Set MIGRATION_TEST_DATABASE_URL to an explicitly selected disposable local PostgreSQL instance",
  );
  const target = assertLocalMigrationTarget(base);
  assert.match(target.pathname, /^\/foodprint_migration_test(?:_[a-z0-9_]+)?$/);
  assert.equal(target.searchParams.get("schema"), "foodprint");
  const name =
    "foodprint_migration_test_wire_" + randomUUID().replaceAll("-", "");
  const owner = new Client({ connectionString: base });
  await owner.connect();
  try {
    await owner.query(`CREATE DATABASE "${name}"`);
  } finally {
    await owner.end();
  }
  target.pathname = "/" + name;
  process.env.DATABASE_URL = target.toString();
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "foodprint-wire-disposable-test-only-secret";
  process.env.CLIENT_URL = "http://localhost:3001";
  await execute(
    process.execPath,
    [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"],
    { env: { ...process.env }, timeout: 90_000 },
  );
  const db = await getPrisma();
  context.after(() => db.$disconnect());
  await bootstrapAuthorization(db);

  const schoolA = await db.school.create({
    data: {
      name: "Wire school A",
      cookingMode: "COMBINE_LOTS",
      lunchTime: new Date("1970-01-01T11:15:00.000Z"),
      afternoonMealTime: new Date("1970-01-01T14:20:00.000Z"),
    },
  });
  const schoolB = await db.school.create({ data: { name: "Wire school B" } });
  const holidays = [{ date: "2026-11-20", reason: "School event" }];
  const academicYear = await db.schoolAcademicYear.create({
    data: {
      schoolId: schoolA.id,
      academicYear: "2026-2027",
      startDate: new Date("2026-09-07"),
      endDate: new Date("2027-05-28"),
      holidays,
    },
  });
  await db.schoolAcademicYear.create({
    data: {
      schoolId: schoolB.id,
      academicYear: "2025-2026",
      startDate: new Date("2025-09-08"),
      endDate: new Date("2026-05-29"),
      holidays: [],
    },
  });
  async function user(code: string, schoolId: string) {
    const role = await db.role.findUniqueOrThrow({ where: { code } });
    const username = "wire_" + randomUUID().replaceAll("-", "");
    return db.user.create({
      data: {
        roleId: role.id,
        roleCode: code,
        schoolId,
        username,
        email: `${username}@example.test`,
        fullName: code,
        passwordHash: "wire-test-not-used-for-login",
        status: "ACTIVE",
      },
    });
  }
  const nutritionA = await user("SCHOOL_NUTRITION_OFFICER", schoolA.id);
  const chefA = await user("SCHOOL_KITCHEN_STAFF", schoolA.id);
  const nutritionB = await user("SCHOOL_NUTRITION_OFFICER", schoolB.id);
  const chefB = await user("SCHOOL_KITCHEN_STAFF", schoolB.id);
  const supplierA = await db.supplier.create({
    data: { name: "Wire supplier A" },
  });
  const supplierB = await db.supplier.create({
    data: { name: "Wire supplier B" },
  });
  for (const [schoolId, supplierId, linkedByUserId] of [
    [schoolA.id, supplierA.id, nutritionA.id],
    [schoolB.id, supplierB.id, nutritionB.id],
  ])
    await db.schoolSupplierRelationship.create({
      data: { schoolId, supplierId, linkedByUserId },
    });

  const rice = await db.ingredient.create({
    data: { supplierId: supplierA.id, name: "Wire rice A", defaultUnit: "g" },
  });
  const beans = await db.ingredient.create({
    data: { supplierId: supplierA.id, name: "Wire beans A", defaultUnit: "g" },
  });
  const salt = await db.ingredient.create({
    data: { supplierId: supplierA.id, name: "Wire salt A", defaultUnit: "g" },
  });
  const foreignIngredient = await db.ingredient.create({
    data: { supplierId: supplierB.id, name: "Wire rice B", defaultUnit: "g" },
  });
  const riceEntry = await db.ingredientEntry.create({
    data: {
      schoolId: schoolA.id,
      ingredientId: rice.id,
      handlingType: "DRY_STOCK",
    },
  });
  const saltEntry = await db.ingredientEntry.create({
    data: {
      schoolId: schoolA.id,
      ingredientId: salt.id,
      handlingType: "DRY_STOCK",
    },
  });
  const foreignEntry = await db.ingredientEntry.create({
    data: {
      schoolId: schoolB.id,
      ingredientId: foreignIngredient.id,
      handlingType: "DRY_STOCK",
    },
  });
  const inactiveEntry = await db.ingredientEntry.create({
    data: {
      schoolId: schoolA.id,
      ingredientId: beans.id,
      handlingType: "DRY_STOCK",
      status: "INACTIVE",
    },
  });
  const dishA = await db.dish.create({
    data: { schoolId: schoolA.id, name: "Wire rice dish A" },
  });
  const sideA = await db.dish.create({
    data: { schoolId: schoolA.id, name: "Wire side dish A" },
  });
  const inactiveDish = await db.dish.create({
    data: {
      schoolId: schoolA.id,
      name: "Wire inactive dish A",
      status: "INACTIVE",
    },
  });
  const dishB = await db.dish.create({
    data: { schoolId: schoolB.id, name: "Wire rice dish B" },
  });

  // HTTP goes through the actual routers/validators/services/repositories. Only
  // token/session handling is injected; each request reloads its principal from DB.
  const http = await startHttp(
    createApp(
      createApiRateLimiter(new MemoryStore(), {
        windowMs: 60_000,
        limit: 10_000,
      }),
      (req, res, next) => {
        const userId = req.get("X-Test-Principal");
        if (!userId) {
          sendError(res, "Missing test identity", 401);
          return;
        }
        void loadPrincipal(userId, db)
          .then((principal) => {
            req.auth = principal;
            next();
          })
          .catch(next);
      },
    ),
  );
  context.after(() => http.close());
  function request(
    url: string,
    userId: string,
    options: { method?: string; body?: unknown } = {},
  ) {
    return http.request(url, {
      method: options.method ?? "GET",
      headers: {
        "X-Test-Principal": userId,
        Origin: "http://localhost:3001",
        "X-CSRF-Protection": "1",
        "Content-Type": "application/json",
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
  }

  await context.test(
    "view grants read only the trusted school context and preserve configured nullable fields",
    async () => {
      for (const [url, userId] of [
        ["/api/v1/menus/context", nutritionA.id],
        ["/api/v1/kitchen/context", chefA.id],
      ]) {
        const response = await request(url, userId);
        assert.equal(response.status, 200);
        const data = payload(response.body);
        assert.deepEqual(Object.keys(data).sort(), [
          "academicYears",
          "afternoonMealTime",
          "cookingMode",
          "id",
          "lunchTime",
          "name",
        ]);
        assert.equal(data.id, schoolA.id);
        assert.equal(data.name, schoolA.name);
        assert.equal(data.cookingMode, "COMBINE_LOTS");
        assert.equal(data.lunchTime, "11:15");
        assert.equal(data.afternoonMealTime, "14:20");
        const years = array(data.academicYears);
        assert.equal(years.length, 1);
        assert.deepEqual(years[0], {
          id: academicYear.id,
          academicYear: "2026-2027",
          startDate: "2026-09-07",
          endDate: "2027-05-28",
          holidays,
        });
        assert.equal(
          (await request(`${url}?schoolId=${schoolB.id}`, userId)).status,
          400,
        );
      }
      const other = await request("/api/v1/kitchen/context", chefB.id);
      assert.equal(other.status, 200);
      const otherContext = payload(other.body);
      assert.equal(otherContext.id, schoolB.id);
      assert.equal(otherContext.cookingMode, null);
      assert.equal(otherContext.lunchTime, null);
      assert.equal(otherContext.afternoonMealTime, null);
    },
  );

  await context.test(
    "dish and ingredient reads use database search, paging and school IngredientEntry IDs",
    async () => {
      const dishes = await request(
        "/api/v1/menus/dish-options?search=wire&limit=1&page=1",
        nutritionA.id,
      );
      assert.equal(dishes.status, 200);
      assert.equal(items(dishes.body).length, 1);
      assert.equal(record(payload(dishes.body).pagination).totalItems, 2);
      const second = await request(
        "/api/v1/menus/dish-options?search=wire&limit=1&page=2",
        nutritionA.id,
      );
      assert.equal(second.status, 200);
      const dishIds = [...items(dishes.body), ...items(second.body)]
        .map((row) => row.id)
        .sort();
      assert.deepEqual(dishIds, [dishA.id, sideA.id].sort());
      assert(!dishIds.includes(inactiveDish.id));
      assert(!dishIds.includes(dishB.id));
      const main = await request(
        "/api/v1/menus/ingredient-options/main?search=rice",
        nutritionA.id,
      );
      assert.equal(main.status, 200);
      assert.deepEqual(
        items(main.body).map((row) => row.id),
        [rice.id],
      );
      assert.equal(record(payload(main.body).pagination).totalItems, 1);
      const seasoning = await request(
        "/api/v1/menus/ingredient-options/seasoning?search=salt",
        nutritionA.id,
      );
      assert.equal(seasoning.status, 200);
      assert.deepEqual(
        items(seasoning.body).map((row) => row.id),
        [saltEntry.id],
      );
      const avoidance = await request(
        "/api/v1/menus/ingredient-options/avoidance?search=rice",
        nutritionA.id,
      );
      assert.equal(avoidance.status, 200);
      assert.deepEqual(
        items(avoidance.body).map((row) => ({
          id: row.id,
          ingredientId: row.ingredientId,
          name: row.name,
          defaultUnit: row.defaultUnit,
        })),
        [
          {
            id: riceEntry.id,
            ingredientId: rice.id,
            name: rice.name,
            defaultUnit: "g",
          },
        ],
      );
      assert.notEqual(riceEntry.id, rice.id);
      const allAvoidances = await request(
        "/api/v1/menus/ingredient-options/avoidance?limit=100",
        nutritionA.id,
      );
      assert.equal(allAvoidances.status, 200);
      assert(
        !items(allAvoidances.body).some(
          (row) => row.id === foreignEntry.id || row.id === inactiveEntry.id,
        ),
      );
      assert.equal(
        (await request("/api/v1/menus/dish-options?page=0", nutritionA.id))
          .status,
        400,
      );
      assert.equal(
        (
          await request(
            `/api/v1/menus/ingredient-options/avoidance?schoolId=${schoolB.id}`,
            nutritionA.id,
          )
        ).status,
        400,
      );
    },
  );

  const monday = new Date(Date.now() - 14 * day);
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const menuInput = {
    weekStartDate: monday.toISOString().slice(0, 10),
    title: "Wire full week",
    days: Array.from({ length: 5 }, (_, index) => ({
      menuDate: new Date(+monday + index * day).toISOString().slice(0, 10),
      note: `Unedited day ${index}`,
      meals: ["LUNCH", ...(index === 0 ? ["AFTERNOON"] : [])].map(
        (mealType) => ({
          mealType,
          dishes: [
            {
              dishId: mealType === "AFTERNOON" ? sideA.id : dishA.id,
              ingredients: [
                {
                  ingredientId: rice.id,
                  quantityPerPortion:
                    mealType === "AFTERNOON" ? "6.789" : "12.345",
                  unit: "g",
                },
              ],
            },
          ],
          seasonings: [
            {
              ingredientEntryId: saltEntry.id,
              quantityPerPortion: "0.125",
              unit: "g",
            },
          ],
        }),
      ),
    })),
  };
  const created = await request("/api/v1/menus", nutritionA.id, {
    method: "POST",
    body: menuInput,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const menuId = text(payload(created.body).id);
  const foreignWeek = await db.weeklyMenu.create({
    data: {
      schoolId: schoolB.id,
      createdByUserId: nutritionB.id,
      weekStartDate: monday,
      title: "Foreign wire week",
      menuDays: {
        create: {
          menuDate: monday,
          approvalStatus: "DRAFT",
          menuDayDishes: { create: { dishId: dishB.id, mealType: "LUNCH" } },
        },
      },
    },
    include: { menuDays: true },
  });

  await context.test(
    "an HTTP full-week edit persists decimal standards and retains every unedited day and meal",
    async () => {
      const before = await request(`/api/v1/menus/${menuId}`, nutritionA.id);
      assert.equal(before.status, 200);
      const snapshot = fullWeekWrite(payload(before.body));
      assert.equal(snapshot.days.length, 5);
      assert.equal(snapshot.days[0].meals.length, 2);
      const write = structuredClone(snapshot);
      const lunch = write.days[0].meals.find(
        (meal) => meal.mealType === "LUNCH",
      );
      assert(lunch);
      lunch.dishes[0].ingredients[0].quantityPerPortion = "12.346";
      const saved = await request(`/api/v1/menus/${menuId}`, nutritionA.id, {
        method: "PUT",
        body: write,
      });
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      const reloaded = await request(`/api/v1/menus/${menuId}`, nutritionA.id);
      assert.equal(reloaded.status, 200);
      assert.deepEqual(fullWeekWrite(payload(reloaded.body)), write);
      const stored = await db.menuDayDishIngredient.findMany({
        where: {
          menuDay: undefined,
          menuDayId: {
            in: array(payload(reloaded.body).menuDays).map((entry) =>
              text(entry.id),
            ),
          },
        },
      });
      assert(
        stored.some((row) => row.quantityPerPortion.toString() === "12.346"),
      );
      assert(
        stored.some((row) => row.quantityPerPortion.toString() === "6.789"),
      );
      assert.equal(
        (await request(`/api/v1/menus/${foreignWeek.id}`, nutritionA.id))
          .status,
        404,
      );
      assert.equal(
        (await request(`/api/v1/menus/${menuId}`, nutritionB.id)).status,
        404,
      );
      const unchanged = JSON.stringify(fullWeekWrite(payload(reloaded.body)));
      const invalid = structuredClone(write);
      invalid.days[0].meals[0].dishes[0].ingredients[0].quantityPerPortion =
        "0";
      assert.equal(
        (
          await request(`/api/v1/menus/${menuId}`, nutritionA.id, {
            method: "PUT",
            body: invalid,
          })
        ).status,
        400,
      );
      const foreignDish = structuredClone(write);
      foreignDish.days[0].meals[0].dishes[0].dishId = dishB.id;
      assert.equal(
        (
          await request(`/api/v1/menus/${menuId}`, nutritionA.id, {
            method: "PUT",
            body: foreignDish,
          })
        ).status,
        422,
      );
      assert.equal(
        (
          await request(`/api/v1/menus/${menuId}`, chefA.id, {
            method: "PUT",
            body: write,
          })
        ).status,
        403,
      );
      assert.equal(
        JSON.stringify(
          fullWeekWrite(
            payload(
              (await request(`/api/v1/menus/${menuId}`, nutritionA.id)).body,
            ),
          ),
        ),
        unchanged,
      );
      const count = await db.weeklyMenu.count();
      assert.equal(
        (
          await request("/api/v1/menus", nutritionA.id, {
            method: "POST",
            body: { ...menuInput, schoolId: schoolB.id },
          })
        ).status,
        400,
      );
      assert.equal(await db.weeklyMenu.count(), count);
    },
  );

  const menuDay = await db.menuDay.findFirstOrThrow({
    where: { weeklyMenuId: menuId, menuDate: monday },
  });
  const supplierRequest = await db.supplyRequest.create({
    data: {
      schoolId: schoolA.id,
      supplierId: supplierA.id,
      createdByUserId: nutritionA.id,
      requestNo: "wire-" + randomUUID(),
    },
  });
  const requestItem = await db.supplyRequestItem.create({
    data: {
      supplyRequestId: supplierRequest.id,
      ingredientEntryId: riceEntry.id,
      requestedQuantity: "1000",
      unit: "g",
    },
  });
  const delivery = await db.delivery.create({
    data: {
      supplyRequestId: supplierRequest.id,
      supplierId: supplierA.id,
      deliveryNo: "wire-" + randomUUID(),
    },
  });
  const deliveryItem = await db.deliveryItem.create({
    data: {
      deliveryId: delivery.id,
      supplyRequestItemId: requestItem.id,
      actualQuantity: "1000",
      unit: "g",
    },
  });
  const lot = await db.ingredientLot.create({
    data: {
      deliveryItemId: deliveryItem.id,
      lotCode: "WIRE-LOT-REAL",
      receivedQuantity: "1000",
      availableQuantity: "1000",
      unit: "g",
      status: "AVAILABLE",
      expiryDate: new Date("2035-01-31"),
    },
  });
  const now = Date.now();
  const fixtureDay = vietnamDay(now - 48 * hour);
  const midnight = Date.parse(`${fixtureDay}T00:00:00+07:00`);
  async function batch(
    code: string,
    mealType: "LUNCH" | "AFTERNOON",
    foreign = false,
    completed = true,
  ) {
    const actor = foreign ? chefB : chefA;
    return db.cookingBatch.create({
      data: {
        batchCode: code,
        menuDayId: foreign ? foreignWeek.menuDays[0].id : menuDay.id,
        dishId: foreign
          ? dishB.id
          : mealType === "AFTERNOON"
            ? sideA.id
            : dishA.id,
        mealType,
        cookingModeApplied: "COMBINE_LOTS",
        createdByUserId: actor.id,
        plannedPortions: 25,
        status: completed ? "COMPLETED" : "UNCONFIRMED",
        ...(completed
          ? {
              confirmedByUserId: actor.id,
              confirmedAt: new Date(now - 8 * day),
              completedByUserId: actor.id,
              completedAt: new Date(now - 7 * day),
            }
          : {}),
      },
    });
  }
  const readyBatch = await batch("WIRE-A-READY", "LUNCH");
  const youngBatch = await batch("WIRE-A-YOUNG", "AFTERNOON");
  const disposedBatch = await batch("WIRE-A-DISPOSED", "AFTERNOON");
  const heldBatch = await batch("WIRE-A-HELD", "LUNCH");
  const emptyBatch = await batch("WIRE-A-EMPTY", "LUNCH");
  const unconfirmedBatch = await batch(
    "WIRE-A-UNCONFIRMED",
    "LUNCH",
    false,
    false,
  );
  const foreignBatch = await batch("WIRE-B-FOREIGN", "LUNCH", true);
  await db.cookingBatchLot.create({
    data: {
      cookingBatchId: emptyBatch.id,
      ingredientLotId: lot.id,
      quantityUsed: "12.346",
      unit: "g",
    },
  });
  async function sample(
    cookingBatchId: string,
    sampledAt: number,
    status: "STORED" | "DISPOSED" = "STORED",
    foreign = false,
  ) {
    return db.retainedFoodSample.create({
      data: {
        cookingBatchId,
        recordedByUserId: foreign ? chefB.id : chefA.id,
        sampledAt: new Date(sampledAt),
        quantity: "150.125",
        unit: "g",
        storageLocation: "Wire fridge",
        status,
        ...(status === "DISPOSED"
          ? {
              disposedAt: new Date(sampledAt + 25 * hour),
              disposalNote: "Fixture historic disposal",
            }
          : {}),
      },
    });
  }
  const readySample = await sample(readyBatch.id, midnight + 5 * 60_000);
  const youngSample = await sample(youngBatch.id, now - hour);
  const disposedSample = await sample(
    disposedBatch.id,
    midnight - 5 * 60_000,
    "DISPOSED",
  );
  const heldSample = await sample(heldBatch.id, now - 80 * hour);
  const foreignSample = await sample(
    foreignBatch.id,
    now - 100 * hour,
    "STORED",
    true,
  );
  const incident = await db.foodSafetyIncident.create({
    data: {
      schoolId: schoolA.id,
      title: "Wire held sample",
      description: "Disposable integration incident",
      status: "OPEN",
      reportedByUserId: chefA.id,
    },
  });
  await db.foodAnalysisResult.create({
    data: {
      incidentId: incident.id,
      retainedFoodSampleId: heldSample.id,
      resultSummary: "Pending analysis",
    },
  });

  await context.test(
    "kitchen hasSample and lot metadata come from real related rows and exclude another school",
    async () => {
      const response = await request(
        "/api/v1/kitchen?status=COMPLETED&hasSample=false&search=WIRE&limit=1",
        chefA.id,
      );
      assert.equal(response.status, 200);
      assert.deepEqual(
        items(response.body).map((row) => row.id),
        [emptyBatch.id],
      );
      assert.equal(record(payload(response.body).pagination).totalItems, 1);
      const sampled = await request(
        "/api/v1/kitchen?status=COMPLETED&hasSample=true&search=WIRE&limit=100",
        chefA.id,
      );
      assert.equal(sampled.status, 200);
      assert.equal(items(sampled.body).length, 4);
      assert(!items(sampled.body).some((row) => row.id === foreignBatch.id));
      const detail = await request(
        `/api/v1/kitchen/${emptyBatch.id}`,
        chefA.id,
      );
      assert.equal(detail.status, 200);
      const metadata = array(payload(detail.body).cookingBatchLots);
      assert.deepEqual(metadata, [
        {
          ingredientLotId: lot.id,
          quantityUsed: "12.346",
          unit: "g",
          lotCode: "WIRE-LOT-REAL",
          ingredientName: rice.name,
          expiryDate: "2035-01-31",
        },
      ]);
      assert.equal(
        (await request(`/api/v1/kitchen/${foreignBatch.id}`, chefA.id)).status,
        404,
      );
      assert.equal(
        (
          await request(
            `/api/v1/kitchen/${emptyBatch.id}/food-samples`,
            chefA.id,
          )
        ).body &&
          record(
            (
              await request(
                `/api/v1/kitchen/${emptyBatch.id}/food-samples`,
                chefA.id,
              )
            ).body,
          ).data,
        null,
      );
      assert.equal(
        (await request("/api/v1/kitchen?hasSample=unknown", chefA.id)).status,
        400,
      );
    },
  );

  await context.test(
    "sample aliases, VN date boundaries, derived READY, counters and list filters agree",
    async () => {
      const all = await request(
        "/api/v1/retained-samples?limit=100&search=wire",
        chefA.id,
      );
      assert.equal(all.status, 200);
      assert.equal(items(all.body).length, 4);
      assert.equal(record(payload(all.body).pagination).totalItems, 4);
      assert(!items(all.body).some((row) => row.id === foreignSample.id));
      for (const row of items(all.body))
        assert.equal(
          Date.parse(text(row.expiresAt)) - Date.parse(text(row.sampledAt)),
          day,
        );
      const ready = await request(
        "/api/v1/retained-samples?readyToDispose=true&limit=1",
        chefA.id,
      );
      assert.equal(ready.status, 200);
      assert.equal(items(ready.body).length, 1);
      assert.equal(record(payload(ready.body).pagination).totalItems, 2);
      assert.equal(record(payload(ready.body).pagination).hasNext, true);
      const stats = await request("/api/v1/retained-samples/stats", chefA.id);
      assert.equal(stats.status, 200);
      assert.deepEqual(payload(stats.body), {
        total: 4,
        stored: 1,
        ready: 2,
        disposed: 1,
      });
      const filteredStats = await request(
        "/api/v1/retained-samples/stats?readyToDispose=true",
        chefA.id,
      );
      assert.equal(filteredStats.status, 200);
      assert.deepEqual(payload(filteredStats.body), {
        total: 2,
        stored: 0,
        ready: 2,
        disposed: 0,
      });
      const dated = await request(
        `/api/v1/retained-samples?date=${fixtureDay}&mealType=LUNCH&search=READY`,
        chefA.id,
      );
      assert.equal(dated.status, 200);
      assert.deepEqual(
        items(dated.body).map((row) => row.id),
        [readySample.id],
      );
      assert.equal(record(payload(dated.body).pagination).totalItems, 1);
      const wrongMeal = await request(
        `/api/v1/retained-samples?date=${fixtureDay}&mealType=AFTERNOON`,
        chefA.id,
      );
      assert.equal(wrongMeal.status, 200);
      assert(
        !items(wrongMeal.body).some((row) => row.id === disposedSample.id),
      );
      const previousDay = vietnamDay(midnight - 5 * 60_000);
      const previous = await request(
        `/api/v1/retained-samples?date=${previousDay}&mealType=AFTERNOON&status=DISPOSED`,
        chefA.id,
      );
      assert.equal(previous.status, 200);
      assert.deepEqual(
        items(previous.body).map((row) => row.id),
        [disposedSample.id],
      );
      for (const suffix of [
        "?search=wire&limit=2",
        "/stats?mealType=LUNCH",
        `?date=${fixtureDay}&readyToDispose=true`,
      ]) {
        const aliases = await Promise.all(
          ["food-samples", "retained-samples"].map((alias) =>
            request(`/api/v1/${alias}${suffix}`, chefA.id),
          ),
        );
        assert.equal(aliases[0].status, 200);
        assert.equal(aliases[1].status, 200);
        assert.deepEqual(aliases[0].body, aliases[1].body);
      }
    },
  );

  await context.test(
    "rejected writes keep DB state, 24-hour retention and incident holds; valid writes survive reload",
    async () => {
      const disposal = {
        disposedAt: new Date().toISOString(),
        disposalNote: "Wire API disposal",
      };
      const count = await db.retainedFoodSample.count();
      assert.equal(
        (
          await request(
            `/api/v1/retained-samples/${youngSample.id}/dispose`,
            chefA.id,
            { method: "POST", body: disposal },
          )
        ).status,
        422,
      );
      assert.equal(
        (
          await request(
            `/api/v1/food-samples/${heldSample.id}/dispose`,
            chefA.id,
            { method: "POST", body: disposal },
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await request(
            `/api/v1/retained-samples/${foreignSample.id}/dispose`,
            chefA.id,
            { method: "POST", body: disposal },
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await db.retainedFoodSample.findUniqueOrThrow({
            where: { id: youngSample.id },
          })
        ).status,
        "STORED",
      );
      assert.equal(
        (
          await db.retainedFoodSample.findUniqueOrThrow({
            where: { id: heldSample.id },
          })
        ).status,
        "STORED",
      );
      const newSample = {
        quantity: "125.375",
        unit: "g",
        storageLocation: "Wire created fridge",
        sampledAt: new Date(Date.now() - 30_000).toISOString(),
      };
      assert.equal(
        (
          await request(
            `/api/v1/kitchen/${unconfirmedBatch.id}/food-samples`,
            chefA.id,
            { method: "POST", body: newSample },
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await request(
            `/api/v1/kitchen/${emptyBatch.id}/food-samples`,
            chefA.id,
            { method: "POST", body: { ...newSample, quantity: -1 } },
          )
        ).status,
        400,
      );
      assert.equal(await db.retainedFoodSample.count(), count);
      const saved = await request(
        `/api/v1/kitchen/${emptyBatch.id}/food-samples`,
        chefA.id,
        { method: "POST", body: newSample },
      );
      assert.equal(saved.status, 201, JSON.stringify(saved.body));
      const id = text(payload(saved.body).id);
      assert.match(id, /^[0-9a-f-]{36}$/);
      const repeated = await request(
        `/api/v1/kitchen/${emptyBatch.id}/food-samples`,
        chefA.id,
        { method: "POST", body: newSample },
      );
      assert.equal(repeated.status, 200);
      assert.equal(payload(repeated.body).id, id);
      assert.equal(await db.retainedFoodSample.count(), count + 1);
      const stored = await db.retainedFoodSample.findUniqueOrThrow({
        where: { id },
      });
      assert.equal(stored.quantity?.toString(), "125.375");
      const reloaded = await request(
        `/api/v1/kitchen/${emptyBatch.id}/food-samples`,
        chefA.id,
      );
      assert.equal(reloaded.status, 200);
      assert.equal(payload(reloaded.body).id, id);
      assert.equal(payload(reloaded.body).quantity, "125.375");
      const disposed = await request(
        `/api/v1/retained-samples/${readySample.id}/dispose`,
        chefA.id,
        { method: "POST", body: disposal },
      );
      assert.equal(disposed.status, 200);
      assert.equal(
        (
          await db.retainedFoodSample.findUniqueOrThrow({
            where: { id: readySample.id },
          })
        ).status,
        "DISPOSED",
      );
      const changed = await request(
        `/api/v1/food-samples/${readySample.id}/dispose`,
        chefA.id,
        {
          method: "POST",
          body: { ...disposal, disposalNote: "Cannot rewrite history" },
        },
      );
      assert.equal(changed.status, 409);
      assert.equal(
        (
          await db.retainedFoodSample.findUniqueOrThrow({
            where: { id: readySample.id },
          })
        ).disposalNote,
        disposal.disposalNote,
      );
    },
  );

  await context.test(
    "HTTP reloads effective permissions from DB rather than retaining role-only authority",
    async () => {
      const permission = await db.permission.findUniqueOrThrow({
        where: { code: "menu.view" },
      });
      assert.equal(
        (await request("/api/v1/menus/context", nutritionA.id)).status,
        200,
      );
      await db.userPermissionDenial.create({
        data: {
          userId: nutritionA.id,
          permissionId: permission.id,
          schoolId: schoolA.id,
          disabledByUserId: nutritionA.id,
        },
      });
      try {
        assert.equal(
          (await request("/api/v1/menus/context", nutritionA.id)).status,
          403,
        );
        assert.equal(
          (await request("/api/v1/menus/dish-options", nutritionA.id)).status,
          403,
        );
      } finally {
        await db.userPermissionDenial.deleteMany({
          where: {
            userId: nutritionA.id,
            permissionId: permission.id,
            schoolId: schoolA.id,
          },
        });
      }
      assert.equal(
        (await request("/api/v1/menus/context", nutritionA.id)).status,
        200,
      );
    },
  );
});
