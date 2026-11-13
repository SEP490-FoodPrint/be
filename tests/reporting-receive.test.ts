import express from "express";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import { createReportingRouter } from "../src/modules/reporting/reporting.routes";
import { startHttp } from "./helpers/http";
import {
  INITIAL_PERMISSIONS,
  INITIAL_ROLE_PERMISSIONS,
} from "../src/constants/permission-catalog";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "../src/generated/prisma/client";
import type { AuthPrincipal } from "../src/types/auth";
import { testStaff, testAdmin } from "./helpers/authorization";
import { createReportingService } from "../src/modules/reporting/reporting.service";
import type {
  ReportingRepository,
  ReceivedReportRow,
} from "../src/modules/reporting/reporting.repository";
import {
  validateReportingReceiveBody,
  validateReportingReceiveParams,
} from "../src/modules/reporting/reporting.validation";
import { RequestValidationError } from "../src/utils/request-validation";
import { HttpError } from "../src/utils/http-error";

const id = "00000000-0000-4000-8000-000000000006";
const unitId = "00000000-0000-4000-8000-000000000005";
const officer: AuthPrincipal = {
  ...testStaff,
  role: "COMMUNE_FOOD_SAFETY_OFFICER",
  orgType: "AUTHORITY",
  schoolId: null,
  communeFoodSafetyUnitId: unitId,
  permissions: ["food_safety_report.receive"],
};
const tx = {} as Prisma.TransactionClient;
function setup() {
  let row: ReceivedReportRow = {
    id,
    incidentId: "incident",
    recipientUserId: officer.id,
    recipientCommuneFoodSafetyUnitId: unitId,
    receivedAt: null,
    FoodSafetyIncident: { status: "OPEN" },
  };
  let changed = 0;
  let paused = false;
  const repository = {
    connect: () => {
      throw new Error("Unexpected database connection");
    },
    list: () => Promise.resolve([]),
    findForOfficer: (
      _tx: Prisma.TransactionClient,
      reportId: string,
      officerId: string,
      communeId: string,
    ) =>
      Promise.resolve(
        row.id === reportId &&
          row.recipientUserId === officerId &&
          row.recipientCommuneFoodSafetyUnitId === communeId
          ? row
          : null,
      ),
    receive: (
      _tx: Prisma.TransactionClient,
      _id: string,
      _officerId: string,
      _unitId: string,
      time: Date,
    ) => {
      changed += 1;
      row = { ...row, receivedAt: time };
      return Promise.resolve(1);
    },
  } satisfies ReportingRepository;
  const service = createReportingService(repository, {
    transaction: (fn) => fn(tx),
    guard: {
      assertAccess: (_tx, actor) =>
        paused && !row.receivedAt
          ? Promise.reject(
              new HttpError(409, "Cán bộ đang tạm dừng nhận yêu cầu"),
            )
          : Promise.resolve(actor),
    },
  });
  return {
    service,
    repository,
    get changed() {
      return changed;
    },
    get row() {
      return row;
    },
    setRow(value: ReceivedReportRow) {
      row = value;
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
  };
}
void test("report receive validation rejects unknown or missing fields", () => {
  assert.deepEqual(validateReportingReceiveBody(undefined), {});
  assert.throws(
    () => validateReportingReceiveBody({ receivedAt: "fake" }),
    RequestValidationError,
  );
  assert.throws(
    () => validateReportingReceiveBody(null),
    RequestValidationError,
  );
  assert.throws(
    () => validateReportingReceiveParams({ id: "bad" }),
    RequestValidationError,
  );
});

void test("HTTP officer receive enforces pause, strict query, ownership and preserves notification state", async (context) => {
  context.mock.method(console, "error", () => undefined);
  const f = setup();
  let actor = officer;
  Object.assign(f.row, { status: "FAILED", forwardedAt: null });
  const app = express();
  app.use(express.json());
  app.use(
    "/api/food-safety-reports",
    createReportingRouter(f.service, (req, _res, next) => {
      req.auth = actor;
      next();
    }),
  );
  app.use(globalErrorHandler);
  const http = await startHttp(app);
  context.after(() => http.close());
  const request = (query = "", body: unknown = {}) =>
    http.request(`/api/food-safety-reports/${id}/receive${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal((await request("?recipientUserId=other")).status, 400);
  assert.equal((await request("", null)).status, 400);
  actor = { ...officer, permissions: ["food_safety_report.view"] };
  assert.equal((await request()).status, 403);
  actor = { ...officer, id: "another-officer" };
  assert.equal((await request()).status, 404);
  actor = officer;
  f.setRow({ ...f.row, FoodSafetyIncident: { status: "CLOSED" } });
  assert.equal((await request()).status, 409);
  f.setRow({ ...f.row, FoodSafetyIncident: { status: "OPEN" } });
  f.pause();
  assert.equal((await request()).status, 409);
  assert.equal(f.changed, 0);
  f.resume();
  assert.equal(
    f.row.receivedAt,
    null,
    "resume must not receive the report automatically",
  );
  const received = await request();
  assert.equal(received.status, 200);
  const receipt = (received.body as { data: { receivedAt: string } }).data
    .receivedAt;
  assert(!Number.isNaN(Date.parse(receipt)));
  f.pause();
  const retry = await request();
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.body, {
    success: true,
    statusCode: 200,
    message: "Thành công",
    data: {
      id,
      incidentId: "incident",
      recipientUserId: officer.id,
      receivedAt: receipt,
    },
  });
  assert.equal(f.row.FoodSafetyIncident.status, "OPEN");
  assert.equal(Reflect.get(f.row, "status"), "FAILED");
  assert.equal(Reflect.get(f.row, "forwardedAt"), null);
  assert.equal(f.changed, 1);
});

void test("report receive sanitizes connection failures before any receipt write", async (context) => {
  context.mock.method(console, "error", () => undefined);
  const f = setup();
  const unavailable = createReportingService({
    ...f.repository,
    connect: () => Promise.reject(new Error("private connection details")),
  });
  await assert.rejects(
    () => unavailable.receive({ id }, officer),
    (error: unknown) => error instanceof HttpError && error.statusCode === 503,
  );
  assert.equal(f.changed, 0);
});
void test("officer receives a report once, preserving the same receipt on retry", async () => {
  const f = setup();
  const first = await f.service.receive({ id }, officer);
  assert.equal(first.recipientUserId, officer.id);
  assert.match(first.receivedAt, /^\d{4}-\d{2}-\d{2}T/);
  f.pause();
  assert.deepEqual(await f.service.receive({ id }, officer), first);
  assert.equal(f.changed, 1);
});
void test("paused officer, absent receive permission and different role cannot receive", async () => {
  const f = setup();
  f.pause();
  await assert.rejects(f.service.receive({ id }, officer), /tạm dừng/);
  await assert.rejects(
    f.service.receive(
      { id },
      { ...officer, permissions: ["food_safety_report.view"] },
    ),
    /quyền/i,
  );
  await assert.rejects(f.service.receive({ id }, testStaff), /cán bộ/i);
  assert.equal(f.changed, 0);
});
void test("closed report and report for another officer are not accepted", async () => {
  const f = setup();
  f.setRow({ ...f.row, FoodSafetyIncident: { status: "CLOSED" } });
  await assert.rejects(f.service.receive({ id }, officer), /đã đóng/i);
  f.setRow({
    ...f.row,
    recipientUserId: "other",
    FoodSafetyIncident: { status: "OPEN" },
  });
  await assert.rejects(f.service.receive({ id }, officer), /không tìm thấy/i);
  assert.equal(f.changed, 0);
});

void test("receive requires both the designated role and receive permission", async () => {
  const f = setup();
  for (const actor of [
    { ...testAdmin, permissions: ["food_safety_report.receive"] },
    { ...testStaff, permissions: ["food_safety_report.receive"] },
    {
      ...officer,
      role: "INGREDIENT_SUPPLIER_ADMIN",
      orgType: "SUPPLIER" as const,
      communeFoodSafetyUnitId: null,
      supplierId: unitId,
    },
    { ...officer, permissions: ["food_safety_report.view"] },
  ])
    await assert.rejects(
      () => f.service.receive({ id }, actor),
      (error: unknown) =>
        error instanceof HttpError && error.statusCode === 403,
    );
  f.setRow({ ...f.row, recipientCommuneFoodSafetyUnitId: "other-unit" });
  await assert.rejects(
    () => f.service.receive({ id }, officer),
    (error: unknown) => error instanceof HttpError && error.statusCode === 404,
  );
  assert.equal(f.changed, 0);
});

void test("receive permission is granted only to the officer role by the catalog", () => {
  assert(
    INITIAL_PERMISSIONS.some(
      (item) => item.code === "food_safety_report.receive",
    ),
  );
  assert.deepEqual(
    INITIAL_ROLE_PERMISSIONS.filter(
      ([, code]) => code === "food_safety_report.receive",
    ).map(([role]) => role),
    ["COMMUNE_FOOD_SAFETY_OFFICER"],
  );
});

void test("HTTP report receive validates input and preserves the response envelope", async (context) => {
  const f = setup();
  const app = express();
  app.use(express.json());
  app.use(
    "/api/food-safety-reports",
    createReportingRouter(f.service, (req, _res, next) => {
      req.auth = officer;
      next();
    }),
  );
  app.use(globalErrorHandler);
  const http = await startHttp(app);
  context.after(() => http.close());
  const invalid = await http.request(`/api/food-safety-reports/${id}/receive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipientUserId: "other" }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(f.changed, 0);
  const accepted = await http.request(
    `/api/food-safety-reports/${id}/receive`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  assert.equal(accepted.status, 200);
  const body = accepted.body as {
    success: boolean;
    data: { id: string; recipientUserId: string };
  };
  assert.equal(body.success, true);
  assert.equal(body.data.id, id);
  assert.equal(body.data.recipientUserId, officer.id);
  assert.equal(f.changed, 1);
});
