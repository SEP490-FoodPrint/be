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
import {
  validateMenuFilters,
  validateMenuWeekSchedule,
} from "../src/modules/menu/menu.validation";
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

function academicCalendarDatabase(configured = true) {
  const calls: Record<string, unknown>[] = [];
  const row = {
    id: "00000000-0000-4000-8000-000000000099",
    academicYear: "2026-2027",
    startDate: new Date("2026-09-09T00:00:00Z"),
    endDate: new Date("2027-05-28T00:00:00Z"),
    holidays: [
      { date: "2027-01-01", reason: "Tết Dương lịch", internal: "hidden" },
    ],
    secret: "hidden",
  };
  return {
    calls,
    db: {
      schoolAcademicYear: {
        findMany: (args: Record<string, unknown>) => {
          calls.push(args);
          return Promise.resolve(configured ? [row] : []);
        },
      },
      weeklyMenu: { findFirst: () => Promise.resolve(null) },
    },
  };
}

void test("nutrition context reads current school meal times with menu.view and rejects tenant overrides", async (context) => {
  const calls: Record<string, unknown>[] = [];
  const db = {
    school: {
      findFirst: (args: Record<string, unknown>) => {
        calls.push(args);
        return Promise.resolve({
          id: principal.schoolId,
          name: "Scoped school",
          cookingMode: "COMBINE_LOTS",
          lunchTime: new Date("1970-01-01T11:15:00Z"),
          afternoonMealTime: null,
          academicYears: [],
        });
      },
    },
  };
  const service = createMenuService(undefined, () =>
    Promise.resolve(db as never),
  );
  const result = await service.getContext(principal);
  assert.equal(result.lunchTime, "11:15");
  assert.equal(result.afternoonMealTime, null);
  assert.deepEqual(calls[0].where, {
    id: principal.schoolId,
    status: "ACTIVE",
  });
  const app = express();
  app.use("/api/v1/menus", createMenuRouter(service, authenticate, true));
  app.use(globalErrorHandler);
  const http = await startHttp(app);
  context.after(() => http.close());
  assert.equal(
    (await http.request("/api/v1/menus/context?schoolId=other")).status,
    400,
  );
  assert.equal(calls.length, 1);
  assert.equal((await http.request("/api/v1/menus/context")).status, 200);
  await assert.rejects(
    service.getContext({ ...principal, permissions: [] }),
    HttpError,
  );
});

void test("academic weeks start at one from the configured school start and continue through January", async (context) => {
  // Monday in Vietnam while the UTC clock is still Sunday.
  context.mock.method(Date, "now", () => Date.parse("2026-11-08T18:00:00Z"));
  const { db, calls } = academicCalendarDatabase();
  const service = createMenuService(undefined, () =>
    Promise.resolve(db as never),
  );
  const {
    academicYears: [year],
  } = await service.getAcademicCalendar({}, principal);
  assert.deepEqual(calls[0].where, { schoolId: principal.schoolId });
  assert.equal(year.academicYear, "2026-2027");
  assert.equal(year.startDate, "2026-09-09");
  assert.equal(year.isCurrent, true);
  assert.equal(year.weeks[0].weekStartDate, "2026-09-07");
  assert.equal(year.weeks[0].weekNumber, 1);
  assert.equal(
    year.weeks.find((week) => week.weekStartDate === "2026-11-02")?.weekNumber,
    9,
  );
  assert.equal(year.weeks.find((week) => week.isCurrentWeek)?.weekNumber, 10);
  assert.equal(
    year.weeks.find((week) => week.weekStartDate === "2027-01-04")?.weekNumber,
    18,
  );
  assert.equal(year.weeks.at(-1)?.weekEndDate, "2027-05-28");
  assert(!JSON.stringify(year).includes("hidden"));
  assert.equal(
    validateMenuWeekSchedule({}).date.toISOString().slice(0, 10),
    "2026-11-09",
  );
  for (const [date, expected] of [
    ["2026-08-31", null],
    ["2026-09-07", 1],
    ["2026-11-02", 9],
    ["2027-01-03", 17],
    ["2027-01-04", 18],
    ["2027-05-31", null],
  ] as const) {
    const schedule = await service.getWeekSchedule(date, principal);
    assert.equal(schedule.weekNumber, expected);
    assert.equal(
      schedule.weekLabel,
      expected === null ? null : `Tuần ${expected}`,
    );
    assert.equal(schedule.academicYear, expected === null ? null : "2026-2027");
  }
});

void test("missing calendar stays empty and cannot be replaced by ISO numbering or another school scope", async () => {
  const { db } = academicCalendarDatabase(false);
  let connections = 0;
  const service = createMenuService(undefined, () => {
    connections++;
    return Promise.resolve(db as never);
  });
  assert.deepEqual(await service.getAcademicCalendar({}, principal), {
    academicYears: [],
  });
  const schedule = await service.getWeekSchedule("2026-11-09", principal);
  assert.equal(schedule.weekNumber, null);
  assert.equal(schedule.academicYear, null);
  assert.equal(schedule.weekStartDate, "2026-11-09");
  const previousConnections = connections;
  for (const actor of [
    { ...principal, permissions: [] },
    { ...testAdmin, permissions: ["menu.view"] },
  ]) {
    await assert.rejects(service.getAcademicCalendar({}, actor), HttpError);
  }
  assert.equal(connections, previousConnections);
});

void test("academic-calendar and week-schedule routes validate input before querying and return school calendar data", async (context) => {
  const { db, calls } = academicCalendarDatabase();
  const app = express();
  app.use(
    "/api/v1/menus",
    createMenuRouter(
      createMenuService(undefined, () => Promise.resolve(db as never)),
      authenticate,
      true,
    ),
  );
  app.use(globalErrorHandler);
  const http = await startHttp(app);
  context.after(() => http.close());
  for (const path of [
    "/academic-calendar?schoolId=foreign-school",
    "/week-schedule?date=2026-02-30",
    "/week-schedule?date=2026-11-09&date=2026-11-16",
  ])
    assert.equal((await http.request("/api/v1/menus" + path)).status, 400);
  assert.equal(calls.length, 0);
  const response = await http.request("/api/v1/menus/academic-calendar");
  assert.equal(response.status, 200);
  const calendarBody = response.body as {
    data: { academicYears: { weeks: { weekNumber: number }[] }[] };
  };
  assert.equal(calendarBody.data.academicYears[0].weeks[0].weekNumber, 1);
  const schedule = await http.request(
    "/api/v1/menus/week-schedule?date=2027-01-04",
  );
  assert.equal(schedule.status, 200);
  assert.equal(
    (schedule.body as { data: { weekNumber: number } }).data.weekNumber,
    18,
  );
});

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
