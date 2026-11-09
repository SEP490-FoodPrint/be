import assert from "node:assert/strict";
import { test } from "node:test";
import express, { type RequestHandler } from "express";
import { Prisma } from "../src/generated/prisma/client";
import {
  globalErrorHandler,
  notFoundHandler,
} from "../src/middlewares/error.middleware";
import { createMenuService } from "../src/modules/menu/menu.service";
import { createMenuRouter } from "../src/modules/menu/menu.routes";
import { validateMenuFilters } from "../src/modules/menu/menu.validation";
import { createKitchenService } from "../src/modules/kitchen/kitchen.service";
import { createKitchenRouter } from "../src/modules/kitchen/kitchen.routes";
import { validateKitchenFilters } from "../src/modules/kitchen/kitchen.validation";
import { createRetainedSampleService } from "../src/modules/retained-sample/retained-sample.service";
import { createRetainedSampleRouter } from "../src/modules/retained-sample/retained-sample.routes";
import { validateRetainedSampleListQuery } from "../src/modules/retained-sample/retained-sample.validation";
import { HttpError } from "../src/utils/http-error";
import { RequestValidationError } from "../src/utils/request-validation";
import { testStaff, testAdmin } from "./helpers/authorization";
import { startHttp } from "./helpers/http";

const principal = {
  ...testStaff,
  permissions: ["menu.view", "cooking_batch.view", "retained_sample.view"],
};
const authenticate: RequestHandler = (req, _res, next) => {
  req.auth = principal;
  next();
};

void test("list validators reject tenant overrides, malformed pagination, search and reversed date ranges", () => {
  for (const validate of [
    validateMenuFilters,
    validateKitchenFilters,
    validateRetainedSampleListQuery,
  ]) {
    assert.equal(validate({}).limit, 20);
    assert.equal(validate({ search: "  " }).search, undefined);
    for (const input of [
      { page: "0" },
      { limit: "101" },
      { page: "214748365", limit: "100" },
      { search: ["x"] },
      { search: "x".repeat(101) },
      { schoolId: testAdmin.id },
    ]) {
      assert.throws(() => validate(input), HttpError);
    }
  }
  assert.throws(
    () =>
      validateKitchenFilters({
        startDate: "2026-11-09",
        endDate: "2026-11-08",
      }),
    (error: unknown) =>
      error instanceof RequestValidationError &&
      error.fields.some((field) => field.field === "endDate"),
  );
  assert.throws(
    () => validateKitchenFilters({ startDate: "2026-02-30" }),
    HttpError,
  );
  assert.throws(
    () => validateKitchenFilters({ status: "DRAFT", mealType: "BREAKFAST" }),
    (error: unknown) =>
      error instanceof RequestValidationError && error.fields.length === 2,
  );
});

void test("menu search, status and dates combine with school scope for both paged rows and total count", async () => {
  const calls: Record<string, unknown>[] = [];
  const db = {
    weeklyMenu: {
      findMany: (args: Record<string, unknown>) => {
        calls.push(args);
        return Promise.resolve([]);
      },
      count: (args: Record<string, unknown>) => {
        calls.push(args);
        return Promise.resolve(7);
      },
    },
  };
  const service = createMenuService(undefined, () =>
    Promise.resolve(db as never),
  );
  const query = validateMenuFilters({
    page: "2",
    limit: "2",
    status: "APPROVED",
    date: "2026-11-10",
    weekStartDate: "2026-11-09",
    search: "  Cá  ",
  });
  const result = await service.list(query, principal);
  const where = calls[0].where as { AND: [unknown, Record<string, unknown>] };
  assert.deepEqual(where.AND[0], { schoolId: principal.schoolId });
  assert.equal(where.AND[1].status, "APPROVED");
  assert.deepEqual(where.AND[1].weekStartDate, query.weekStartDate);
  assert.deepEqual(where.AND[1].menuDays, { some: { menuDate: query.date } });
  assert.deepEqual(where.AND[1].OR, [
    { title: { contains: "Cá", mode: "insensitive" } },
    {
      menuDays: {
        some: {
          menuDayDishes: {
            some: { Dish: { name: { contains: "Cá", mode: "insensitive" } } },
          },
        },
      },
    },
  ]);
  assert.deepEqual(calls[1].where, calls[0].where);
  assert.equal(calls[0].skip, 2);
  assert.equal(calls[0].take, 2);
  assert.deepEqual(calls[0].orderBy, [
    { weekStartDate: "desc" },
    { id: "asc" },
  ]);
  assert.equal(result.pagination.totalItems, 7);
});

void test("kitchen date ranges are inclusive, override single date, and remain identical in list and KPI queries", async () => {
  const calls: { operation: string; args: Record<string, unknown> }[] = [];
  const capture = (operation: string) => (args: Record<string, unknown>) => {
    calls.push({ operation, args });
    return Promise.resolve([]);
  };
  const tx = {
    cookingBatch: {
      findMany: capture("list"),
      groupBy: capture("states"),
      count: (args: Record<string, unknown>) => {
        calls.push({ operation: "count", args });
        return Promise.resolve(0);
      },
    },
    retainedFoodSample: { groupBy: capture("samples") },
  };
  const db = {
    $transaction: async (operation: (client: typeof tx) => Promise<unknown>) =>
      operation(tx),
  };
  const service = createKitchenService(undefined, () =>
    Promise.resolve(db as never),
  );
  const query = validateKitchenFilters({
    startDate: "2026-11-09",
    endDate: "2026-11-13",
    date: "2026-11-02",
    search: "99999999999999999999",
    page: "3",
    limit: "10",
  });
  await service.list(query, principal);
  await service.stats(query, principal);
  const list = calls.find((call) => call.operation === "list")!.args;
  const where = list.where as {
    AND: [unknown, { MenuDay: unknown; OR: unknown[] }];
  };
  assert.deepEqual(where.AND[0], {
    MenuDay: { WeeklyMenu: { schoolId: principal.schoolId } },
  });
  assert.deepEqual(where.AND[1].MenuDay, {
    menuDate: { gte: query.startDate, lte: query.endDate },
  });
  assert.equal(
    where.AND[1].OR.length,
    2,
    "an out-of-range integer is only a text search",
  );
  assert.equal(list.skip, 20);
  assert.equal(list.take, 10);
  assert.deepEqual(
    calls.find((call) => call.operation === "states")!.args.where,
    where,
  );
  assert.deepEqual(
    calls.find((call) => call.operation === "samples")!.args.where,
    { CookingBatch: where },
  );
  assert.deepEqual(
    calls.find((call) => call.operation === "states")!.args.skip,
    undefined,
  );
});

function sampleDatabase(fail = false) {
  const calls: { operation: string; args: Record<string, unknown> }[] = [];
  const sampledAt = new Date("2026-11-08T05:00:00.000Z");
  const row = {
    id: testStaff.id,
    cookingBatchId: testAdmin.id,
    recordedByUserId: testStaff.id,
    sampledAt,
    quantity: new Prisma.Decimal("100.000"),
    unit: "g",
    storageLocation: "Tủ 01",
    status: "STORED",
    disposedAt: null,
    disposalNote: null,
    createdAt: sampledAt,
    updatedAt: sampledAt,
    CookingBatch: {
      batchCode: "CB-01",
      mealType: "LUNCH",
      plannedPortions: 120,
      Dish: { name: "Cá kho", internal: "hidden" },
    },
    internal: "hidden",
  };
  const tx = {
    retainedFoodSample: {
      findMany: (args: Record<string, unknown>) => {
        calls.push({ operation: "list", args });
        return Promise.resolve([row]);
      },
      count: (args: Record<string, unknown>) => {
        calls.push({ operation: "count", args });
        if (fail) return Promise.reject(new Error("sensitive database detail"));
        return Promise.resolve(3);
      },
    },
  };
  const db = {
    $transaction: async (
      operation: (client: typeof tx) => Promise<unknown>,
      options: Record<string, unknown>,
    ) => {
      assert.equal(options.isolationLevel, "RepeatableRead");
      return operation(tx);
    },
  };
  return { db, calls };
}

void test("retained samples count the same scoped filters, search storage/batch/dish, and serialize expiry safely", async () => {
  const { db, calls } = sampleDatabase();
  const service = createRetainedSampleService(undefined, () =>
    Promise.resolve(db as never),
  );
  const result = await service.getAll(
    validateRetainedSampleListQuery({
      page: "2",
      limit: "1",
      status: "STORED",
      search: " Tủ 01 ",
    }),
    principal,
  );
  const list = calls.find((call) => call.operation === "list")!.args;
  const count = calls.find((call) => call.operation === "count")!.args;
  assert.deepEqual(list.where, count.where);
  const where = list.where as {
    AND: [unknown, { status: string; OR: unknown[] }];
  };
  assert.deepEqual(where.AND[0], {
    CookingBatch: { MenuDay: { WeeklyMenu: { schoolId: principal.schoolId } } },
  });
  assert.equal(where.AND[1].status, "STORED");
  assert.deepEqual(where.AND[1].OR, [
    { storageLocation: { contains: "Tủ 01", mode: "insensitive" } },
    { CookingBatch: { batchCode: { contains: "Tủ 01", mode: "insensitive" } } },
    {
      CookingBatch: {
        Dish: { name: { contains: "Tủ 01", mode: "insensitive" } },
      },
    },
  ]);
  assert.equal(list.skip, 1);
  assert.equal(list.take, 1);
  assert.deepEqual(list.orderBy, [{ sampledAt: "desc" }, { id: "asc" }]);
  assert.deepEqual(result.pagination, {
    page: 2,
    limit: 1,
    totalItems: 3,
    hasNext: true,
  });
  assert.equal(result.items[0].sampledAt, "2026-11-08T05:00:00.000Z");
  assert.equal(result.items[0].expiresAt, "2026-11-09T05:00:00.000Z");
  assert.equal(result.items[0].quantity, "100");
  assert(!JSON.stringify(result).includes("hidden"));
});

void test("retained list database failures return a safe 503 while missing permission fails before connecting", async () => {
  const { db } = sampleDatabase(true);
  const service = createRetainedSampleService(undefined, () =>
    Promise.resolve(db as never),
  );
  await assert.rejects(
    service.getAll(validateRetainedSampleListQuery({}), principal),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 503 &&
      !error.message.includes("sensitive"),
  );
  let connected = false;
  const denied = createRetainedSampleService(undefined, () => {
    connected = true;
    return Promise.resolve(db as never);
  });
  await assert.rejects(
    denied.getAll(validateRetainedSampleListQuery({}), {
      ...principal,
      permissions: [],
    }),
    (error: unknown) => error instanceof HttpError && error.statusCode === 403,
  );
  assert.equal(connected, false);
});

void test("retained aliases apply validated search/status/pagination and return the same HTTP contract", async (context) => {
  const { db } = sampleDatabase();
  const service = createRetainedSampleService(undefined, () =>
    Promise.resolve(db as never),
  );
  const app = express();
  for (const alias of ["food-samples", "retained-samples"])
    app.use(
      `/api/v1/${alias}`,
      createRetainedSampleRouter(service, authenticate),
    );
  app.use(notFoundHandler, globalErrorHandler);
  const http = await startHttp(app);
  context.after(() => http.close());
  const suffix = "?page=2&limit=1&status=STORED&search=T%E1%BB%A7%2001";
  const first = await http.request("/api/v1/food-samples" + suffix);
  const second = await http.request("/api/v1/retained-samples" + suffix);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(first.body, second.body);
});

void test("removed batch editing and export/print routes remain unavailable without calling the database", async (context) => {
  let connections = 0;
  const connect = () => {
    connections++;
    return Promise.reject(new Error("No database for removed features"));
  };
  const kitchens = createKitchenService(undefined, connect);
  assert.equal("update" in kitchens, false);
  const app = express();
  app.use("/api/v1/kitchen", createKitchenRouter(kitchens, authenticate, true));
  app.use(
    "/api/v1/menus",
    createMenuRouter(createMenuService(undefined, connect), authenticate, true),
  );
  app.use(
    "/api/v1/retained-samples",
    createRetainedSampleRouter(undefined, authenticate),
  );
  app.use(notFoundHandler, globalErrorHandler);
  const http = await startHttp(app);
  context.after(() => http.close());
  const routes = [
    ["PUT", `/kitchen/${testStaff.id}`],
    ...["kitchen", "menus", "retained-samples"].flatMap((feature) =>
      ["export", "print"].map((action) => [
        "GET",
        `/${feature}/${testStaff.id}/${action}`,
      ]),
    ),
  ];
  for (const [method, route] of routes)
    assert.equal(
      (await http.request("/api/v1" + route, { method })).status,
      404,
      `${method} ${route}`,
    );
  assert.equal(connections, 0);
});
