import {
  testAdmin,
  testStaff,
  testAuthenticate,
} from "./helpers/authorization";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import express from "express";
import { MemoryStore } from "express-rate-limit";
import { createApp } from "../src/app";
import { ORG_TYPES, ROLES } from "../src/constants/roles";
import { Prisma } from "../src/generated/prisma/client";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import { createApiRateLimiter } from "../src/middlewares/rate-limit.middleware";
import { createAllergyService } from "../src/modules/allergy/allergy.service";
import { createTraceabilityService } from "../src/modules/traceability/traceability.service";
import { createUserRouter } from "../src/modules/user/user.routes";
import {
  createUserService,
  type UserService,
} from "../src/modules/user/user.service";
import { createWarehouseService } from "../src/modules/warehouse/warehouse.service";
import { createRegistrationService } from "../src/modules/registration/registration.service";
import { HttpError } from "../src/utils/http-error";
import { signToken } from "../src/utils/jwt";
import { parseListQuery } from "../src/utils/list-query";
import { startHttp } from "./helpers/http";
import {
  validateMenuMeal,
  validateMenuStandards,
} from "../src/modules/menu/menu.validation";

process.env.NODE_ENV = "test";

const adminHeaders = {
  Authorization: `Bearer ${signToken({ sub: testAdmin.id, role: ROLES.SYSTEM_ADMIN, orgType: ORG_TYPES.SYSTEM })}`,
};
const now = new Date("2026-01-01T00:00:00.000Z");
const userRow = {
  id: "test-user",
  username: "sample-user",
  fullName: "Sample User",
  roleId: "test-role",
  schoolId: null,
  supplierId: null,
  communeFoodSafetyUnitId: null,
  status: "ACTIVE" as const,
  createdAt: now,
  updatedAt: now,
};

async function userApi(context: TestContext, service: UserService) {
  const app = express();
  app.use("/api/users", createUserRouter(service, testAuthenticate));
  app.use(globalErrorHandler);
  const http = await startHttp(app);
  context.after(() => http.close());
  return http;
}

void test("list pagination defaults, rejects unsupported filters and prevents unbounded/overflow queries", () => {
  assert.deepEqual(parseListQuery({}), { page: 1, limit: 20 });
  assert.deepEqual(parseListQuery({ page: "2", limit: "100" }), {
    page: 2,
    limit: 100,
  });
  for (const query of [
    { page: "0" },
    { page: "-1" },
    { page: "1.5" },
    { page: "Infinity" },
    { page: "9007199254740992" },
    { page: "2147483648", limit: "100" },
    { limit: "101" },
    { limit: "0" },
    { limit: "" },
    { page: ["1", "2"] },
    { limit: { value: "1" } },
    { schoolId: "other-school" },
    { select: "passwordHash" },
    { orderBy: "username" },
  ]) {
    assert.throws(
      () => parseListQuery(query),
      (error: unknown) =>
        error instanceof HttpError && error.statusCode === 400,
    );
  }
});

void test("user list bounds reads, uses stable ordering, projects safe fields and detects the next page", async () => {
  let calls = 0;
  const service = createUserService((args) => {
    calls++;
    assert.equal(args.skip, 2);
    assert.equal(args.take, 3);
    assert.deepEqual(args.orderBy, [{ id: "asc" }]);
    assert(!("passwordHash" in args.select));
    assert(!("email" in args.select));
    assert(!("phone" in args.select));
    assert.equal(args.select.fullName, true);
    return Promise.resolve([
      userRow,
      { ...userRow, id: "test-user-2" },
      { ...userRow, id: "test-user-3" },
    ]);
  });
  const result = await service.getAll({ page: 2, limit: 2 }, testAdmin);
  assert.equal(calls, 1);
  assert.deepEqual(
    result.items.map((item) => item.id),
    ["test-user", "test-user-2"],
  );
  assert.deepEqual(result.pagination, { page: 2, limit: 2, hasNext: true });
});

void test("a final or empty page has no next page", async () => {
  for (const rows of [[], [userRow]]) {
    const result = await createUserService(() => Promise.resolve(rows)).getAll(
      {
        page: 1,
        limit: 1,
      },
      testAdmin,
    );
    assert.equal(result.pagination.hasNext, false);
    assert.deepEqual(result.items, rows);
  }
});

void test("registration list returns safe applicant contacts with stable pagination and nullable metadata", async () => {
  let calls = 0;
  const applicantUser = {
    id: "applicant-1",
    username: "school_applicant",
    fullName: "Nguyễn Văn A",
    email: "applicant@example.test",
    phone: "0901234567",
    status: "UNVERIFIED" as const,
    emailVerifiedAt: now,
  };
  const row = {
    id: "request-1",
    applicantUserId: applicantUser.id,
    applicantUser,
    requestType: "SCHOOL" as const,
    status: "PENDING" as const,
    submittedAt: now,
    reviewedAt: null,
    updatedAt: now,
  };
  const nullable = {
    ...row,
    id: "request-2",
    applicantUser: { ...applicantUser, phone: null, emailVerifiedAt: null },
  };
  const service = createRegistrationService((args) => {
    calls++;
    assert.equal(args.skip, 4);
    assert.equal(args.take, 3);
    assert.deepEqual(args.where, {});
    assert.deepEqual(args.orderBy, [{ id: "asc" }]);
    assert.deepEqual(Object.keys(args.select.applicantUser.select).sort(), [
      "email",
      "emailVerifiedAt",
      "fullName",
      "id",
      "phone",
      "status",
      "username",
    ]);
    return Promise.resolve([row, nullable, { ...row, id: "request-3" }]);
  });
  const result = await service.getAll(
    { page: 3, limit: 2 },
    { ...testAdmin, permissions: ["registration.view"] },
  );
  assert.equal(calls, 1);
  assert.deepEqual(result.pagination, { page: 3, limit: 2, hasNext: true });
  assert.deepEqual(
    result.items.map((item) => item.id),
    ["request-1", "request-2"],
  );
  const json: unknown = JSON.parse(JSON.stringify(result));
  assert.deepEqual(json, {
    items: [
      {
        ...row,
        submittedAt: now.toISOString(),
        updatedAt: now.toISOString(),
        applicantUser: { ...applicantUser, emailVerifiedAt: now.toISOString() },
      },
      {
        ...nullable,
        submittedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    ],
    pagination: { page: 3, limit: 2, hasNext: true },
  });
});

void test("registration contact reads still require an assigned permission and System organization scope", () => {
  let reads = 0;
  const service = createRegistrationService(() => {
    reads++;
    return Promise.resolve([]);
  });
  for (const principal of [
    testAdmin,
    { ...testStaff, permissions: ["registration.view"] },
  ]) {
    assert.throws(
      () => service.getAll({ page: 1, limit: 5 }, principal),
      (error: unknown) =>
        error instanceof HttpError && error.statusCode === 403,
    );
  }
  assert.equal(reads, 0);
});

void test("composite-primary-key lists use both keys for deterministic ordering", async () => {
  const service = createAllergyService((args) => {
    assert.deepEqual(args.orderBy, [
      { classId: "asc" },
      { ingredientEntryId: "asc" },
    ]);
    return Promise.resolve([
      {
        classId: "class-1",
        ingredientEntryId: "entry-1",
        affectedCount: 2,
        updatedByUserId: null,
        updatedAt: now,
      },
    ]);
  });
  assert.equal(
    (await service.getAll({ page: 1, limit: 20 }, testAdmin)).items[0]
      .affectedCount,
    2,
  );
});

void test("traceability BigInt block numbers are serialized without losing precision", async () => {
  const service = createTraceabilityService(() =>
    Promise.resolve([
      {
        id: "anchor-1",
        deliveryId: null,
        ingredientLotId: null,
        cookingBatchId: null,
        mealAllocationId: null,
        foodSafetyIncidentId: null,
        payloadHash: "test-hash",
        hashAlgorithm: "SHA-256",
        networkName: "test-network",
        transactionHash: null,
        blockNumber: 9007199254740993n,
        anchorStatus: "PREPARED",
        verificationStatus: "NOT_VERIFIED",
        verifiedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ]),
  );
  const result = await service.getAll({ page: 1, limit: 20 }, testAdmin);
  assert.equal(result.items[0].blockNumber, "9007199254740993");
  assert.doesNotThrow(() => JSON.stringify(result));
});

void test("warehouse Decimal quantities and dates remain JSON-compatible without rounding", async () => {
  const service = createWarehouseService(() =>
    Promise.resolve([
      {
        id: "lot-1",
        deliveryItemId: "delivery-item-1",
        sourceFacilityId: null,
        lotCode: "LOT-1",
        manufactureDate: null,
        expiryDate: now,
        receivedQuantity: new Prisma.Decimal("123.456"),
        availableQuantity: new Prisma.Decimal("23.456"),
        unit: "kg",
        status: "AVAILABLE",
        createdAt: now,
        updatedAt: now,
      },
    ]),
  );
  const result = await service.getAll({ page: 1, limit: 20 }, testAdmin);
  const body: unknown = JSON.parse(JSON.stringify(result));
  assert.deepEqual(body, {
    items: [
      {
        id: "lot-1",
        deliveryItemId: "delivery-item-1",
        sourceFacilityId: null,
        lotCode: "LOT-1",
        manufactureDate: null,
        expiryDate: now.toISOString(),
        receivedQuantity: "123.456",
        availableQuantity: "23.456",
        unit: "kg",
        status: "AVAILABLE",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    ],
    pagination: { page: 1, limit: 20, hasNext: false },
  });
});

void test("every mounted business list rejects forged role claims when the database principal has no permission", async (context) => {
  const store = new MemoryStore();
  const http = await startHttp(
    createApp(
      createApiRateLimiter(store, { windowMs: 60_000, limit: 500 }),
      testAuthenticate,
    ),
  );
  context.after(async () => {
    await http.close();
    store.shutdown();
  });
  const deniedClaims = [
    { role: ROLES.SCHOOL_ADMINISTRATION, orgType: ORG_TYPES.SCHOOL },
    { role: ROLES.INGREDIENT_SUPPLIER_ADMIN, orgType: ORG_TYPES.SUPPLIER },
    { role: ROLES.COMMUNE_FOOD_SAFETY_OFFICER, orgType: ORG_TYPES.AUTHORITY },
    { role: ROLES.SYSTEM_ADMIN, orgType: ORG_TYPES.SCHOOL },
    { role: ROLES.HOMEROOM_TEACHER, orgType: ORG_TYPES.SYSTEM },
  ];
  const deniedHeaders = deniedClaims.map((claims) => ({
    Authorization: `Bearer ${signToken({ ...claims, sub: testStaff.id })}`,
  }));
  const paths = [
    "/api/auth/roles",
    "/api/users",
    "/api/schools",
    "/api/ingredients",
    "/api/menus",
    "/api/supply-requests",
    "/api/ingredient-lots",
    "/api/cooking-batches",
    "/api/meal-portions",
    "/api/meal-complaints",
    "/api/food-safety-incidents",
    "/api/suppliers",
    "/api/commune-food-safety-units",
    "/api/classes",
    "/api/source-facilities",
    "/api/supplier-certifications",
    "/api/registration-requests",
    "/api/school-supplier-relationships",
    "/api/ingredient-entries",
    "/api/class-allergies",
    "/api/deliveries",
    "/api/dishes",
    "/api/inventory-transactions",
    "/api/retained-food-samples",
    "/api/meal-allocations",
    "/api/ingredient-quality-feedback",
    "/api/food-safety-reports",
    "/api/food-analysis-results",
    "/api/incident-school-alerts",
    "/api/traceability-anchors",
    "/api/menu-reviews",
  ];
  for (const path of paths) {
    assert.equal((await http.request(path)).status, 401, path);
    for (const headers of deniedHeaders) {
      assert.equal((await http.request(path, { headers })).status, 403, path);
    }
  }
  assert.equal((await http.request("/api/health")).status, 200);
  assert.equal((await http.request("/api/unregistered")).status, 404);
});

void test("authorized HTTP list validates input before reading and uses the response envelope", async (context) => {
  context.mock.method(console, "error", () => undefined);
  let calls = 0;
  const http = await userApi(
    context,
    createUserService(() => {
      calls++;
      return Promise.resolve([userRow]);
    }),
  );
  for (const query of [
    "?limit=101",
    "?schoolId=other-school",
    "?page=1&page=2",
  ]) {
    assert.equal(
      (await http.request(`/api/users${query}`, { headers: adminHeaders }))
        .status,
      400,
    );
  }
  assert.equal(calls, 0);
  const response = await http.request("/api/users?page=1&limit=1", {
    headers: adminHeaders,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    success: true,
    statusCode: 200,
    message: "Lấy danh sách người dùng thành công",
    data: {
      items: [
        {
          ...userRow,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ],
      pagination: { page: 1, limit: 1, hasNext: false },
    },
  });
  assert.equal(calls, 1);
});

void test("database read rejection reaches the error middleware without exposing connection details", async (context) => {
  context.mock.method(console, "error", () => undefined);
  const http = await userApi(
    context,
    createUserService(() =>
      Promise.reject(
        new Error("postgresql://private:password@localhost/private"),
      ),
    ),
  );
  const response = await http.request("/api/users", { headers: adminHeaders });
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, {
    success: false,
    statusCode: 503,
    message: "Không thể tải danh sách. Vui lòng thử lại sau.",
  });
  assert(!JSON.stringify(response.body).includes("password"));
});

void test("menu standards keep per-dish quantities and one shared meal seasoning", () => {
  const a = "00000000-0000-0000-0000-000000000001";
  const b = "00000000-0000-0000-0000-000000000002";
  const parsed = validateMenuStandards({
    dishes: [
      {
        dishId: a,
        ingredients: [{ ingredientId: a, quantityPerPortion: "80", unit: "g" }],
      },
      {
        dishId: b,
        ingredients: [{ ingredientId: a, quantityPerPortion: "70", unit: "g" }],
      },
    ],
    seasonings: [{ ingredientEntryId: b, quantityPerPortion: "1", unit: "g" }],
  });
  assert.equal(parsed.dishes[0].ingredients[0].quantityPerPortion, "80");
  assert.equal(parsed.dishes[1].ingredients[0].quantityPerPortion, "70");
  assert.equal(parsed.seasonings.length, 1);
  assert.equal(parsed.seasonings[0].quantityPerPortion, "1");
});

void test("menu standards reject invalid precision, duplicates and kitchen-entered totals", () => {
  const id = "00000000-0000-0000-0000-000000000001";
  const line = { ingredientId: id, quantityPerPortion: "1", unit: "g" };
  const dish = { dishId: id, ingredients: [line] };
  const seasoning = {
    ingredientEntryId: id,
    quantityPerPortion: "1",
    unit: "g",
  };
  for (const quantity of [
    "0",
    "-1",
    "NaN",
    "Infinity",
    "0.0001",
    "100000000000",
    {},
    null,
  ]) {
    assert.throws(
      () =>
        validateMenuStandards({
          dishes: [
            {
              ...dish,
              ingredients: [{ ...line, quantityPerPortion: quantity }],
            },
          ],
          seasonings: [],
        }),
      HttpError,
    );
  }
  assert.throws(
    () => validateMenuStandards({ dishes: [dish, dish], seasonings: [] }),
    HttpError,
  );
  assert.throws(
    () =>
      validateMenuStandards({
        dishes: [{ ...dish, ingredients: [line, line] }],
        seasonings: [],
      }),
    HttpError,
  );
  assert.throws(
    () =>
      validateMenuStandards({
        dishes: [dish],
        seasonings: [seasoning, seasoning],
      }),
    HttpError,
  );
  assert.throws(
    () =>
      validateMenuStandards({
        dishes: [dish],
        seasonings: [],
        quantityUsed: 99,
      }),
    HttpError,
  );
  assert.throws(
    () =>
      validateMenuStandards({
        dishes: [dish],
        seasonings: [],
        plannedPortions: 120,
      }),
    HttpError,
  );
  assert.throws(() => validateMenuMeal(id, "BREAKFAST"), HttpError);
  assert.throws(() => validateMenuMeal("not-a-uuid", "LUNCH"), HttpError);
  assert.equal(
    validateMenuStandards({
      dishes: [
        {
          ...dish,
          ingredients: [{ ...line, quantityPerPortion: "99999999999.999" }],
        },
      ],
      seasonings: [],
    }).dishes[0].ingredients[0].quantityPerPortion,
    "99999999999.999",
  );
});
