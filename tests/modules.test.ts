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
import { createRegistrationRepository } from "../src/modules/registration/registration.repository";
import { createRegistrationRouter } from "../src/modules/registration/registration.routes";
import {
  RegistrationValidationError,
  validateRegistrationListQuery,
} from "../src/modules/registration/registration.validation";
import { HttpError } from "../src/utils/http-error";
import { signToken } from "../src/utils/jwt";
import { parseListQuery } from "../src/utils/list-query";
import { startHttp } from "./helpers/http";
import {
  validateMenuMeal,
  validateMenuStandards,
  validateMenuWrite,
  validateMenuReview,
  validateAllergyCheck,
  validateMenuPortionGroups,
} from "../src/modules/menu/menu.validation";
import {
  validateKitchenComplete,
  validateKitchenFilters,
} from "../src/modules/kitchen/kitchen.validation";
import {
  validateFoodSample,
  validateSampleDisposal,
} from "../src/modules/retained-sample/retained-sample.validation";
import { createKitchenRouter } from "../src/modules/kitchen/kitchen.routes";
import { createKitchenService } from "../src/modules/kitchen/kitchen.service";
import { createMenuRouter } from "../src/modules/menu/menu.routes";
import { createMenuService } from "../src/modules/menu/menu.service";
import { calendarDate, isoTimestamp } from "../src/utils/auth-validation";
import { validateDailyPortionGroups } from "../src/modules/meal-attendance/meal-attendance.validation";

process.env.NODE_ENV = "test";

void test("kitchen filters use persisted lot modes and bounded search without tenant overrides", () => {
  const query = validateKitchenFilters({
    cookingModeApplied: "SEPARATE_BY_LOT",
    search: "  Cơm  ",
    status: "UNCONFIRMED",
  });
  assert.equal(query.cookingModeApplied, "SEPARATE_BY_LOT");
  assert.equal(query.search, "Cơm");
  assert.equal(
    validateKitchenFilters({ cookingModeApplied: "COMBINE_LOTS" })
      .cookingModeApplied,
    "COMBINE_LOTS",
  );
  assert.equal(validateKitchenFilters({ search: "  " }).search, undefined);
  for (const input of [
    { cookingModeApplied: "ALLERGY" },
    { cookingModeApplied: "COMMON" },
    { cookingModeApplied: { equals: "COMBINE_LOTS" } },
    { search: ["Cơm"] },
    { search: "x".repeat(101) },
    { schoolId: testAdmin.id },
    { status: "DRAFT" },
  ])
    assert.throws(() => validateKitchenFilters(input), HttpError);
});

void test("kitchen list and statistics share school-scoped database filters and expose actual sample state", async () => {
  const calls: { operation: string; args: Record<string, unknown> }[] = [];
  let countCalls = 0;
  const row = {
    id: testStaff.id,
    batchCode: "CB-actual",
    batchGroupId: testAdmin.id,
    BatchGroup: { id: testAdmin.id, batchCode: "B-actual" },
    dishId: testAdmin.id,
    menuDayId: testAdmin.id,
    mealType: "LUNCH",
    dishes: [
      { dishId: testAdmin.id, plannedPortions: 120, Dish: { name: "Cơm" } },
    ],
    Dish: { name: "Cơm" },
    MenuDay: { menuDate: new Date("2026-11-02") },
    note: null,
    confirmedAt: null,
    completedAt: null,
    createdAt: new Date("2026-11-02"),
    updatedAt: new Date("2026-11-02"),
    status: "COMPLETED",
    cookingModeApplied: "SEPARATE_BY_LOT",
    plannedPortions: 120,
    cookingBatchLots: [
      {
        ingredientLotId: testAdmin.id,
        quantityUsed: new Prisma.Decimal("6"),
        unit: "kg",
      },
    ],
    RetainedFoodSample: [
      {
        dishId: testAdmin.id,
        id: testAdmin.id,
        status: "STORED",
        sampledAt: new Date("2026-11-02T05:00:00Z"),
        disposedAt: null,
      },
    ],
  };
  const tx = {
    cookingBatch: {
      findMany: (args: Record<string, unknown>) => {
        calls.push({ operation: "list", args });
        return Promise.resolve([row]);
      },
      count: (args: Record<string, unknown>) => {
        calls.push({ operation: "count", args });
        return Promise.resolve(++countCalls === 1 ? 3 : 1);
      },
      groupBy: (args: Record<string, unknown>) => {
        calls.push({ operation: "states", args });
        return Promise.resolve([{ status: "COMPLETED", _count: 3 }]);
      },
    },
    retainedFoodSample: {
      groupBy: (args: Record<string, unknown>) => {
        calls.push({ operation: "samples", args });
        return Promise.resolve([
          { status: "STORED", _count: 1 },
          { status: "DISPOSED", _count: 1 },
        ]);
      },
    },
  };
  const db = {
    $transaction: (operation: (client: typeof tx) => Promise<unknown>) =>
      operation(tx),
  };
  const service = createKitchenService(
    () => Promise.resolve([]),
    () => Promise.resolve(db as never),
  );
  const principal = { ...testStaff, permissions: ["cooking_batch.view"] };
  const query = validateKitchenFilters({
    page: "2",
    limit: "2",
    date: "2026-11-02",
    mealType: "LUNCH",
    cookingModeApplied: "SEPARATE_BY_LOT",
    status: "COMPLETED",
    search: "120",
  });
  const result = await service.list(query, principal);
  const stats = await service.stats(query, principal);
  const list = calls.find((call) => call.operation === "list")!.args;
  const where = list.where as { AND: [unknown, Record<string, unknown>] };
  assert.deepEqual(where.AND[0], {
    MenuDay: { WeeklyMenu: { schoolId: testStaff.schoolId } },
  });
  assert.equal(where.AND[1].cookingModeApplied, "SEPARATE_BY_LOT");
  assert.equal(where.AND[1].status, "COMPLETED");
  assert.deepEqual(where.AND[1].OR, [
    { batchCode: { contains: "120", mode: "insensitive" } },
    {
      dishes: {
        some: { Dish: { name: { contains: "120", mode: "insensitive" } } },
      },
    },
    { BatchGroup: { batchCode: { contains: "120", mode: "insensitive" } } },
    { plannedPortions: 120 },
  ]);
  assert.equal(list.skip, 2);
  assert.equal(list.take, 2);
  assert.ok((list.select as Record<string, unknown>).RetainedFoodSample);
  assert.deepEqual(
    calls.find((call) => call.operation === "states")!.args.where,
    where,
  );
  assert.deepEqual(
    calls.find((call) => call.operation === "samples")!.args.where,
    { CookingBatch: where },
  );
  assert.equal(result.items[0].cookingModeApplied, "SEPARATE_BY_LOT");
  assert.equal(result.items[0].retainedFoodSamples?.[0]?.status, "STORED");
  assert.equal(result.items[0].cookingBatchLots[0].quantityUsed, "6");
  assert.equal(result.pagination.totalItems, 3);
  assert.deepEqual(stats, {
    total: 3,
    unconfirmed: 0,
    confirmed: 0,
    completed: 3,
    storedSamples: 1,
    disposedSamples: 1,
    pendingSamples: 1,
  });
});

void test("manually selected portion groups require one normal group and explicit avoidance for separate meals", () => {
  const common = {
    name: "Thường",
    isDefault: true,
    dishIds: [testStaff.id],
    avoidedIngredientEntryIds: [],
  };
  const special = {
    name: "Riêng",
    isDefault: false,
    dishIds: [testAdmin.id],
    avoidedIngredientEntryIds: [testStaff.id],
  };
  assert.equal(
    validateMenuPortionGroups({ groups: [common, special] }).groups.length,
    2,
  );
  for (const groups of [
    [special],
    [common, { ...special, isDefault: true }],
    [{ ...common, dishIds: [] }],
    [common, { ...special, avoidedIngredientEntryIds: [] }],
    [common, { ...special, dishIds: [testAdmin.id, testAdmin.id] }],
  ])
    assert.throws(() => validateMenuPortionGroups({ groups }), HttpError);
  assert.throws(
    () =>
      validateMenuPortionGroups({ groups: [common], suggestedIngredients: [] }),
    HttpError,
  );
});
void test("teacher group confirmations reject duplicates, fractional counts and kitchen-entered allocations", () => {
  const input = {
    menuDayId: testStaff.id,
    groups: [{ portionGroupId: testAdmin.id, portionCount: 120 }],
  };
  assert.equal(validateDailyPortionGroups(input).groups[0].portionCount, 120);
  assert.equal(
    validateDailyPortionGroups({
      ...input,
      groups: [{ ...input.groups[0], portionCount: 0 }],
    }).groups[0].portionCount,
    0,
  );
  for (const portionCount of [-1, 1.5, Infinity, 2147483648, "120"])
    assert.throws(
      () =>
        validateDailyPortionGroups({
          ...input,
          groups: [{ ...input.groups[0], portionCount }],
        }),
      HttpError,
    );
  assert.throws(
    () =>
      validateDailyPortionGroups({
        ...input,
        groups: [input.groups[0], input.groups[0]],
      }),
    HttpError,
  );
  assert.throws(
    () => validateDailyPortionGroups({ ...input, quantityUsed: 9.6 }),
    HttpError,
  );
});

void test("menu writes enforce real dates, weekly boundaries and server-owned lifecycle fields", () => {
  const input = {
    weekStartDate: "2030-01-07",
    days: [
      {
        menuDate: "2030-01-07",
        meals: [{ mealType: "LUNCH", dishes: [{ name: "Món mới" }] }],
      },
    ],
  };
  assert.equal(
    validateMenuWrite(input).days[0].meals[0].dishes[0].name,
    "Món mới",
  );
  for (const extra of [
    { schoolId: testStaff.schoolId },
    { status: "APPROVED" },
    { plannedPortions: 120 },
  ])
    assert.throws(() => validateMenuWrite({ ...input, ...extra }), HttpError);
  assert.throws(
    () =>
      validateMenuWrite({
        ...input,
        days: [{ ...input.days[0], menuDate: "2030-01-14" }],
      }),
    HttpError,
  );
  assert.throws(
    () => validateMenuWrite({ ...input, days: [input.days[0], input.days[0]] }),
    HttpError,
  );
  for (const value of ["2026-02-29", "2026-04-31", "2026-1-01"])
    assert.throws(() => calendarDate(value), HttpError);
  for (const value of [
    "2026-02-30T00:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T12:00:00",
  ])
    assert.throws(() => isoTimestamp(value), HttpError);
  assert.equal(
    calendarDate("2028-02-29").toISOString(),
    "2028-02-29T00:00:00.000Z",
  );
});

void test("menu reviews require a revision reason and reject mass assignment or duplicate allergy IDs", () => {
  assert.equal(validateMenuReview({ decision: "APPROVED" }).menuDayId, null);
  assert.equal(
    validateMenuReview({
      decision: "REVISION_REQUESTED",
      feedback: "Sửa định mức",
    }).decision,
    "REVISION_REQUESTED",
  );
  for (const input of [
    { decision: "REVISION_REQUESTED" },
    { decision: "REVISION_REQUIRED" },
    { decision: "APPROVED", reviewerUserId: testStaff.id },
  ])
    assert.throws(() => validateMenuReview(input), HttpError);
  assert.throws(
    () => validateAllergyCheck({ ingredientIds: [testStaff.id, testStaff.id] }),
    HttpError,
  );
  assert.throws(() => validateAllergyCheck({ ingredientIds: [] }), HttpError);
});

void test("validateKitchenComplete validates optional note and ignores legacy inspectionData", () => {
  assert.equal(validateKitchenComplete(undefined), undefined);
  assert.deepEqual(validateKitchenComplete({}), { note: undefined });
  assert.deepEqual(validateKitchenComplete({ note: "  Xong mẻ  " }), {
    note: "Xong mẻ",
  });
  assert.deepEqual(
    validateKitchenComplete({ inspectionData: { any: "data" } }),
    { note: undefined },
  );
  assert.throws(
    () => validateKitchenComplete({ note: "a".repeat(2001) }),
    HttpError,
  );
  assert.throws(
    () => validateKitchenComplete({ unknownField: 123 }),
    HttpError,
  );
});

void test("retained samples and kitchen filters reject malformed quantities, timestamps and tenant selectors", () => {
  const input = {
    quantity: 150,
    unit: "g",
    storageLocation: "Tủ 1",
    sampledAt: "2026-11-01T10:30:00Z",
  };
  assert.equal(validateFoodSample(input).quantity, "150");
  for (const quantity of [0, -1, 0.0001, Infinity, { toString: "bad" }])
    assert.throws(() => validateFoodSample({ ...input, quantity }), HttpError);
  assert.throws(() => validateFoodSample({ ...input, unit: "kg" }), HttpError);
  assert.throws(
    () =>
      validateSampleDisposal({
        disposedAt: input.sampledAt,
        disposalNote: " ",
      }),
    HttpError,
  );
  assert.throws(
    () => validateKitchenFilters({ schoolId: testStaff.schoolId }),
    HttpError,
  );
  assert.throws(
    () => validateKitchenFilters({ status: { value: "COMPLETED" } }),
    HttpError,
  );
  assert.throws(
    () => validateKitchenFilters({ date: "2026-02-30" }),
    HttpError,
  );
});

void test("v1 routes enforce permissions and emit versioned error codes before any database access", async (context) => {
  const app = createApp(
    createApiRateLimiter(new MemoryStore()),
    testAuthenticate,
  );
  const http = await startHttp(app);
  context.after(() => http.close());
  const headers = {
    Authorization: `Bearer ${signToken({ sub: testStaff.id })}`,
    "X-CSRF-Protection": "1",
    "Content-Type": "application/json",
  };
  for (const [method, path] of [
    ["GET", "/menus"],
    ["POST", "/menus"],
    ["GET", `/menus/${testStaff.id}`],
    ["PUT", `/menus/${testStaff.id}`],
    ["DELETE", `/menus/${testStaff.id}`],
    ["POST", `/menus/${testStaff.id}/submit`],
    ["POST", `/menus/${testStaff.id}/revise-and-submit`],
    ["POST", `/menus/${testStaff.id}/reviews`],
    ["GET", `/menus/${testStaff.id}/reviews`],
    ["POST", "/menus/allergy-check"],
    ["GET", "/kitchen"],
    ["GET", "/kitchen/stats"],
    ["DELETE", `/kitchen/${testStaff.id}`],
    ["GET", `/menus/days/${testStaff.id}/meals/LUNCH/portion-groups`],
    ["PUT", `/menus/days/${testStaff.id}/meals/LUNCH/portion-groups`],
    ["GET", `/daily-meal-portions/${testStaff.id}/portion-groups`],
    ["PUT", `/daily-meal-portions/${testStaff.id}/portion-groups`],
    ["POST", `/kitchen/${testStaff.id}/food-samples`],
    ["GET", `/kitchen/${testStaff.id}/food-samples`],
    ["POST", `/food-samples/${testStaff.id}/dispose`],
    ["GET", "/daily-meal-portions"],
  ]) {
    const response = await http.request("/api/v1" + path, { method, headers });
    assert.equal(response.status, 403, `${method} ${path}`);
    assert.equal(
      (response.body as { code: string }).code,
      "ACCESS_DENIED_WRONG_SCHOOL",
    );
  }
  const anonymous = await http.request("/api/v1/kitchen");
  assert.equal(anonymous.status, 401);
  assert.equal(
    (anonymous.body as { code: string }).code,
    "AUTHENTICATION_REQUIRED",
  );
});

void test("v1 complete rejects unauthorized caller before calling inventory services", async (context) => {
  let databaseCalls = 0;
  const service = createKitchenService(undefined, () => {
    databaseCalls++;
    throw new Error("Database must not be called");
  });
  const app = express();
  app.use(express.json());
  app.use(
    "/api/v1/kitchen",
    createKitchenRouter(
      service,
      (req, _res, next) => {
        req.auth = { ...testStaff, permissions: [] };
        next();
      },
      true,
    ),
  );
  app.use(globalErrorHandler);
  const http = await startHttp(app);
  context.after(() => http.close());
  const result = await http.request(
    `/api/v1/kitchen/${testStaff.id}/complete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  assert.equal(result.status, 403);
  assert.equal(databaseCalls, 0);
});

void test("allergy-check honors the class allergy permission separately from menu access", async (context) => {
  let databaseCalls = 0;
  const service = createMenuService(undefined, () => {
    databaseCalls++;
    throw new Error("Denied requests must not connect");
  });
  const app = express();
  app.use(express.json());
  app.use(
    "/api/v1/menus",
    createMenuRouter(
      service,
      (req, _res, next) => {
        req.auth = { ...testStaff, permissions: ["menu.view"] };
        next();
      },
      true,
    ),
  );
  app.use(globalErrorHandler);
  const http = await startHttp(app);
  context.after(() => http.close());
  const response = await http.request("/api/v1/menus/allergy-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ingredientIds: [testStaff.id] }),
  });
  assert.equal(response.status, 403);
  assert.equal(databaseCalls, 0);
  await assert.rejects(
    () =>
      service.allergyCheck(
        { ingredientIds: [testStaff.id] },
        {
          ...testStaff,
          permissions: ["menu.view"],
        },
      ),
    (e: unknown) => e instanceof HttpError && e.statusCode === 403,
  );
});

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
    assert.deepEqual(
      result.items,
      rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    );
  }
});

void test("registration query validation preserves optional pagination, strict inputs and offset bounds", () => {
  assert.deepEqual(validateRegistrationListQuery({}), { page: 1, limit: 20 });
  assert.deepEqual(validateRegistrationListQuery({ limit: "100" }), {
    page: 1,
    limit: 100,
  });
  assert.deepEqual(
    validateRegistrationListQuery({ page: "2147483648", limit: "1" }),
    { page: 2147483648, limit: 1 },
  );
  for (const query of [
    null,
    [],
    { page: null },
    { page: 1 },
    { page: "" },
    { page: "01" },
    { page: " 1 " },
    { page: "1.5" },
    { page: "1e2" },
    { page: "-1" },
    { page: ["1", "2"] },
    { limit: { value: "2" } },
    { page: "9007199254740992" },
    { page: "2147483649", limit: "1" },
    { limit: "101" },
    { schoolId: "other-school" },
  ]) {
    assert.throws(
      () => validateRegistrationListQuery(query),
      (error: unknown) =>
        error instanceof RegistrationValidationError &&
        error.statusCode === 400,
    );
  }
});

void test("registration validation reports multiple fields without reflecting input values", () => {
  assert.throws(
    () =>
      validateRegistrationListQuery({ page: "private-input", limit: "101" }),
    (error: unknown) => {
      assert(error instanceof RegistrationValidationError);
      assert.deepEqual(error.fields, [
        { field: "page", message: "page phải là số nguyên dương" },
        { field: "limit", message: "limit tối đa 100" },
      ]);
      assert(!JSON.stringify(error.fields).includes("private-input"));
      return true;
    },
  );
});

void test("registration search trims codes and names and rejects invalid types or overlong text", () => {
  for (const [input, expected] of [
    ["  fp-reg-00001  ", "fp-reg-00001"],
    ["FP-REG-99999", "FP-REG-99999"],
    ["FP-REG-100000", "FP-REG-100000"],
    ["FP-REG-9007199254740993", "FP-REG-9007199254740993"],
    ["FP-REG-9223372036854775807", "FP-REG-9223372036854775807"],
    ["  Nguyễn Văn An  ", "Nguyễn Văn An"],
    ["nguyễn", "nguyễn"],
    ["FP-REG-00000", "FP-REG-00000"],
    ["FP-REG-9223372036854775808", "FP-REG-9223372036854775808"],
    ["x".repeat(255), "x".repeat(255)],
    ["  " + "x".repeat(255) + "  ", "x".repeat(255)],
    ["", undefined],
    ["   ", undefined],
  ]) {
    const query = validateRegistrationListQuery({ search: input });
    assert.equal(query.search, expected);
    assert.equal(query.page, 1);
    assert.equal(query.limit, 20);
  }
  for (const search of [
    null,
    1,
    ["FP-REG-00001"],
    { equals: "FP-REG-00001" },
    "x".repeat(256),
  ]) {
    assert.throws(
      () => validateRegistrationListQuery({ search }),
      (error: unknown) => {
        assert(error instanceof RegistrationValidationError);
        assert.equal(error.statusCode, 400);
        assert(error.fields.every((issue) => issue.field === "search"));
        assert(!JSON.stringify(error.fields).includes("private-input"));
        return true;
      },
    );
  }
  assert.throws(
    () =>
      validateRegistrationListQuery({
        page: "private-input",
        limit: "101",
        search: ["private-input"],
      }),
    (error: unknown) => {
      assert(error instanceof RegistrationValidationError);
      assert.deepEqual(
        error.fields.map((issue) => issue.field),
        ["page", "limit", "search"],
      );
      assert(!JSON.stringify(error.fields).includes("private-input"));
      return true;
    },
  );
});

void test("registration search filters the stored number exactly before pagination without losing bigint precision", async () => {
  const numbers = [1n, 100000n, 9007199254740992n, 9007199254740993n];
  const rows = numbers.map((registrationNumber, index) => ({
    id: `00000000-0000-4000-8000-00000000000${index + 1}`,
    registrationNumber,
    applicantUserId: testAdmin.id,
    applicantUser: {
      id: testAdmin.id,
      username: "applicant",
      fullName: "Người nộp",
      email: "applicant@example.test",
      phone: null,
      status: "UNVERIFIED" as const,
      emailVerifiedAt: now,
    },
    requestType: "SCHOOL" as const,
    status: "PENDING" as const,
    submittedAt: now,
    reviewedAt: null,
    updatedAt: now,
  }));
  let expectedNumber: bigint | undefined;
  let expectedSearch: string | undefined;
  let calls = 0;
  const service = createRegistrationService(
    createRegistrationRepository((args) => {
      calls++;
      assert.deepEqual(
        args.where,
        expectedNumber === undefined
          ? {}
          : {
              AND: [
                {},
                {
                  OR: [
                    { registrationNumber: expectedNumber },
                    {
                      applicantUser: {
                        fullName: {
                          contains: expectedSearch,
                          mode: "insensitive",
                        },
                      },
                    },
                  ],
                },
              ],
            },
      );
      assert.deepEqual(args.orderBy, [{ id: "asc" }]);
      const filtered = rows.filter(
        (row) =>
          expectedNumber === undefined ||
          row.registrationNumber === expectedNumber,
      );
      const skip = args.skip ?? 0;
      return Promise.resolve(filtered.slice(skip, skip + (args.take ?? 0)));
    }),
  );
  const principal = { ...testAdmin, permissions: ["registration.view"] };
  for (const number of [1n, 100000n, 9007199254740993n, 2n]) {
    expectedNumber = number;
    const search = `FP-REG-${number.toString().padStart(5, "0")}`;
    expectedSearch = search;
    const result = await service.getAll(
      validateRegistrationListQuery({ search, limit: "1" }),
      principal,
    );
    assert.deepEqual(
      result.items.map((row) => row.registrationID),
      number === 2n ? [] : [search],
    );
    assert.deepEqual(result.pagination, {
      page: 1,
      limit: 1,
      hasNext: false,
    });
    assert(!JSON.stringify(result).includes("registrationNumber"));
  }
  expectedNumber = 1n;
  expectedSearch = "FP-REG-00001";
  const laterPage = await service.getAll(
    validateRegistrationListQuery({
      search: "FP-REG-00001",
      page: "2",
      limit: "1",
    }),
    principal,
  );
  assert.deepEqual(laterPage, {
    items: [],
    pagination: { page: 2, limit: 1, hasNext: false },
  });
  expectedNumber = undefined;
  const unfiltered = await service.getAll(
    validateRegistrationListQuery({ search: "  ", limit: "1" }),
    principal,
  );
  assert.deepEqual(unfiltered.pagination, {
    page: 1,
    limit: 1,
    hasNext: true,
  });
  assert.equal(calls, 6);
});

void test("registration name search uses a literal case-insensitive substring before pagination", async () => {
  const names = ["Nguyễn Văn An", "NGUYỄN Thị Bình"];
  const rows = names.map((fullName, index) => ({
    id: `00000000-0000-4000-8000-00000000000${index + 1}`,
    registrationNumber: BigInt(index + 1),
    applicantUserId: testAdmin.id,
    applicantUser: {
      id: testAdmin.id,
      username: "applicant",
      fullName,
      email: "applicant@example.test",
      phone: null,
      status: "UNVERIFIED" as const,
      emailVerifiedAt: now,
    },
    requestType: "SCHOOL" as const,
    status: "PENDING" as const,
    submittedAt: now,
    reviewedAt: null,
    updatedAt: now,
  }));
  let expectedText = "nguyễn";
  let returnedRows = rows;
  const service = createRegistrationService(
    createRegistrationRepository((args) => {
      assert.deepEqual(args.where, {
        AND: [
          {},
          {
            applicantUser: {
              fullName: { contains: expectedText, mode: "insensitive" },
            },
          },
        ],
      });
      assert.deepEqual(args.orderBy, [{ id: "asc" }]);
      const skip = args.skip ?? 0;
      return Promise.resolve(returnedRows.slice(skip, skip + (args.take ?? 0)));
    }),
  );
  const principal = { ...testAdmin, permissions: ["registration.view"] };
  for (const page of [1, 2]) {
    const result = await service.getAll(
      validateRegistrationListQuery({
        search: "  nguyễn  ",
        page: String(page),
        limit: "1",
      }),
      principal,
    );
    assert.deepEqual(
      result.items.map((row) => row.applicantUser.fullName),
      [names[page - 1]],
    );
    assert.deepEqual(result.pagination, {
      page,
      limit: 1,
      hasNext: page === 1,
    });
    assert(!JSON.stringify(result).includes("registrationNumber"));
  }
  expectedText = "Nguyễn Văn An";
  returnedRows = [rows[0]];
  const fullNameResult = await service.getAll(
    validateRegistrationListQuery({ search: expectedText }),
    principal,
  );
  assert.equal(fullNameResult.items[0].registrationID, "FP-REG-00001");
  returnedRows = [];
  for (const [input, escaped] of [
    ["Không có tên này", "Không có tên này"],
    ["FP-REG-1", "FP-REG-1"],
    ["FP-REG-9223372036854775808", "FP-REG-9223372036854775808"],
    [testAdmin.id, testAdmin.id],
    ["%", "\\%"],
    ["_", "\\_"],
    ["An\\_%", "An\\\\\\_\\%"],
  ]) {
    expectedText = escaped;
    const result = await service.getAll(
      validateRegistrationListQuery({ search: input }),
      principal,
    );
    assert.deepEqual(result, {
      items: [],
      pagination: { page: 1, limit: 20, hasNext: false },
    });
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
    registrationNumber: 1n,
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
    registrationNumber: 2n,
    applicantUser: { ...applicantUser, phone: null, emailVerifiedAt: null },
  };
  const repository = createRegistrationRepository((args) => {
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
    return Promise.resolve([
      {
        ...row,
        profileData: { private: "hidden" },
        applicantUser: { ...applicantUser, passwordHash: "hidden" },
      },
      nullable,
      { ...row, id: "request-3" },
    ]);
  });
  const service = createRegistrationService(repository);
  const result = await service.getAll(
    { page: 3, limit: 2 },
    { ...testAdmin, permissions: ["registration.view"] },
  );
  assert.equal(calls, 1);
  assert.equal(result.items[0].submittedAt, now.toISOString());
  assert.equal(
    result.items[0].applicantUser.emailVerifiedAt,
    now.toISOString(),
  );
  assert.deepEqual(result.pagination, { page: 3, limit: 2, hasNext: true });
  assert.deepEqual(
    result.items.map((item) => item.id),
    ["request-1", "request-2"],
  );
  assert.equal(result.items[0].registrationID, "FP-REG-00001");
  assert(!JSON.stringify(result).includes("registrationNumber"));
  const { registrationNumber: _number, ...publicRow } = row;
  const { registrationNumber: _nullableNumber, ...publicNullable } = nullable;
  void _number;
  void _nullableNumber;
  const json: unknown = JSON.parse(JSON.stringify(result));
  assert.deepEqual(json, {
    items: [
      {
        ...publicRow,
        registrationID: "FP-REG-00001",
        submittedAt: now.toISOString(),
        updatedAt: now.toISOString(),
        applicantUser: { ...applicantUser, emailVerifiedAt: now.toISOString() },
      },
      {
        ...publicNullable,
        registrationID: "FP-REG-00002",
        submittedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    ],
    pagination: { page: 3, limit: 2, hasNext: true },
  });
});

void test("registration contact reads still require an assigned permission and System organization scope", () => {
  let reads = 0;
  const service = createRegistrationService({
    listForReview: () => {
      reads++;
      return Promise.resolve([]);
    },
  });
  const repository = createRegistrationRepository(() => {
    reads++;
    return Promise.resolve([]);
  });
  for (const principal of [
    testAdmin,
    { ...testStaff, permissions: ["registration.view"] },
  ]) {
    for (const search of [undefined, "FP-REG-00001", "Nguyễn", "%"]) {
      const query = { page: 1, limit: 5, search };
      assert.throws(
        () => service.getAll(query, principal),
        (error: unknown) =>
          error instanceof HttpError && error.statusCode === 403,
      );
      assert.throws(
        () => repository.listForReview(query, principal),
        (error: unknown) =>
          error instanceof HttpError && error.statusCode === 403,
      );
    }
  }
  assert.equal(reads, 0);
});

void test("registration HTTP preserves envelopes and reports field errors before database access", async (context) => {
  context.mock.method(console, "error", () => undefined);
  let reads = 0;
  let databaseFailure = false;
  let expectedWhere = {};
  const service = createRegistrationService(
    createRegistrationRepository((args) => {
      reads++;
      assert.deepEqual(args.where, expectedWhere);
      if (databaseFailure)
        throw new Error("postgresql://private:password@localhost/private");
      return Promise.resolve([]);
    }),
  );
  const app = express();
  app.use(
    "/api/registration-requests",
    createRegistrationRouter(service, (req, _res, next) => {
      req.auth = { ...testAdmin, permissions: ["registration.view"] };
      next();
    }),
  );
  app.use(globalErrorHandler);
  const http = await startHttp(app);
  context.after(() => http.close());

  const invalid = await http.request(
    "/api/registration-requests?page=private-input&limit=101",
  );
  assert.equal(invalid.status, 400);
  assert.deepEqual(invalid.body, {
    success: false,
    statusCode: 400,
    message: "Tham số danh sách đăng ký không hợp lệ",
    error: {
      fields: [
        { field: "page", message: "page phải là số nguyên dương" },
        { field: "limit", message: "limit tối đa 100" },
      ],
    },
  });
  for (const query of [
    "?page=1&page=2",
    "?schoolId=other-school",
    "?search=FP-REG-00001&search=FP-REG-00002",
    "?search[value]=FP-REG-00001",
    "?registrationId=FP-REG-00001",
  ]) {
    assert.equal(
      (await http.request(`/api/registration-requests${query}`)).status,
      400,
    );
  }
  const invalidSearch = await http.request(
    `/api/registration-requests?search=${"x".repeat(256)}`,
  );
  assert.equal(invalidSearch.status, 400);
  assert.deepEqual(invalidSearch.body, {
    success: false,
    statusCode: 400,
    message: "Tham số danh sách đăng ký không hợp lệ",
    error: {
      fields: [
        { field: "search", message: "Từ khóa tìm kiếm tối đa 255 ký tự" },
      ],
    },
  });
  const detailByCode = await http.request(
    "/api/registration-requests/FP-REG-00001",
  );
  assert.equal(detailByCode.status, 400);
  assert.equal(reads, 0);

  const success = await http.request("/api/registration-requests");
  assert.equal(success.status, 200);
  assert.deepEqual(success.body, {
    success: true,
    statusCode: 200,
    message: "Lấy danh sách yêu cầu đăng ký thành công",
    data: {
      items: [],
      pagination: { page: 1, limit: 20, hasNext: false },
    },
  });
  assert.equal(reads, 1);

  expectedWhere = {
    AND: [
      {},
      {
        OR: [
          { registrationNumber: 1n },
          {
            applicantUser: {
              fullName: { contains: "fp-reg-00001", mode: "insensitive" },
            },
          },
        ],
      },
    ],
  };
  const searched = await http.request(
    "/api/registration-requests?search=%20fp-reg-00001%20",
  );
  assert.equal(searched.status, 200);
  assert.deepEqual(searched.body, success.body);
  assert.equal(reads, 2);

  expectedWhere = {
    AND: [
      {},
      {
        applicantUser: {
          fullName: { contains: "nguyễn", mode: "insensitive" },
        },
      },
    ],
  };
  const nameSearch = await http.request(
    "/api/registration-requests?search=%20nguy%E1%BB%85n%20",
  );
  assert.equal(nameSearch.status, 200);
  assert.deepEqual(nameSearch.body, success.body);
  assert.equal(reads, 3);

  expectedWhere = {};
  const blankSearch = await http.request(
    "/api/registration-requests?search=%20%20",
  );
  assert.equal(blankSearch.status, 200);
  assert.deepEqual(blankSearch.body, success.body);
  assert.equal(reads, 4);

  databaseFailure = true;
  expectedWhere = {
    AND: [
      {},
      {
        applicantUser: {
          fullName: { contains: "Nguyễn", mode: "insensitive" },
        },
      },
    ],
  };
  const failure = await http.request(
    "/api/registration-requests?search=Nguy%E1%BB%85n",
  );
  assert.equal(failure.status, 503);
  assert.deepEqual(failure.body, {
    success: false,
    statusCode: 503,
    message: "Không thể tải danh sách. Vui lòng thử lại sau.",
  });
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
        SourceFacility: null,
        DeliveryItem: {
          id: "delivery-item-1",
          actualQuantity: new Prisma.Decimal("123.456"),
          unit: "kg",
          Delivery: {
            id: "delivery-1",
            deliveryNo: "DEL-001",
            status: "RECEIVED" as const,
            expectedArrivalAt: now,
            arrivedAt: now,
            receivedAt: now,
          },
          SupplyRequestItem: {
            id: "sri-1",
            ingredientEntryId: "entry-1",
            requestedQuantity: new Prisma.Decimal("123.456"),
            unit: "kg",
            IngredientEntry: {
              id: "entry-1",
              handlingType: "DRY_STOCK" as const,
              storageRequirements: null,
              shelfLifeDays: 30,
              Ingredient: {
                id: "ing-1",
                name: "Gạo",
                defaultUnit: "kg",
                description: null,
                ingredientCategory: null,
                Supplier: {
                  id: "sup-1",
                  name: "Supplier A",
                  phone: "0987654321",
                },
              },
            },
          },
        },
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
        SourceFacility: null,
        DeliveryItem: {
          id: "delivery-item-1",
          actualQuantity: "123.456",
          unit: "kg",
          Delivery: {
            id: "delivery-1",
            deliveryNo: "DEL-001",
            status: "RECEIVED",
            expectedArrivalAt: now.toISOString(),
            arrivedAt: now.toISOString(),
            receivedAt: now.toISOString(),
          },
          SupplyRequestItem: {
            id: "sri-1",
            ingredientEntryId: "entry-1",
            requestedQuantity: "123.456",
            unit: "kg",
            IngredientEntry: {
              id: "entry-1",
              handlingType: "DRY_STOCK",
              storageRequirements: null,
              shelfLifeDays: 30,
              Ingredient: {
                id: "ing-1",
                name: "Gạo",
                defaultUnit: "kg",
                description: null,
                ingredientCategory: null,
                Supplier: {
                  id: "sup-1",
                  name: "Supplier A",
                  phone: "0987654321",
                },
              },
            },
          },
        },
      },
    ],
    pagination: { page: 1, limit: 20, hasNext: false },
  });
});

void test("every mounted business list rejects forged role claims when the database principal has no permission", async (context) => {
  context.mock.method(console, "error", () => undefined);
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
  const facilityTarget =
    "/api/source-facilities/11111111-1111-4111-8111-111111111111";
  for (const [method, path] of [
    ["GET", facilityTarget],
    ["POST", "/api/source-facilities"],
    ["PATCH", facilityTarget],
    ["POST", facilityTarget + "/deactivate"],
  ]) {
    const csrfHeaders = { "X-CSRF-Protection": "1" };
    assert.equal(
      (await http.request(path, { method, headers: csrfHeaders })).status,
      401,
    );
    for (const headers of deniedHeaders)
      assert.equal(
        (
          await http.request(path, {
            method,
            headers: { ...headers, ...csrfHeaders },
          })
        ).status,
        403,
      );
  }
  assert.equal((await http.request("/api/health")).status, 200);
  assert.equal((await http.request("/api/unregistered")).status, 404);
  assert.equal((await http.request("/api/v1/meal-allocations")).status, 404);
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
