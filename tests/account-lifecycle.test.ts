import express from "express";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import { createAccountLifecycleRouter } from "../src/modules/account-lifecycle/account-lifecycle.routes";
import { startLifecycleHttp } from "./helpers/account-lifecycle";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "../src/generated/prisma/client";
import { HttpError } from "../src/utils/http-error";
import { createAccountLifecycleRepository } from "../src/modules/account-lifecycle/account-lifecycle.repository";
import { createSupplyOrderRouter } from "../src/modules/supply-order/supply-order.routes";
import { createReportingRouter } from "../src/modules/reporting/reporting.routes";
import { testAdmin, testStaff } from "./helpers/authorization";
import { RequestValidationError } from "../src/utils/request-validation";
import {
  validateLifecycleParams,
  validateLifecycleQuery,
  validateLifecycleAction,
  validateIntakeState,
} from "../src/modules/account-lifecycle/account-lifecycle.validation";
import { createAccountLifecycleService } from "../src/modules/account-lifecycle/account-lifecycle.service";
import type {
  AccountLifecycleRepository,
  LifecycleTarget,
} from "../src/modules/account-lifecycle/account-lifecycle.repository";

const userId = "00000000-0000-4000-8000-000000000001";
const schoolId = "00000000-0000-4000-8000-000000000002";
const now = new Date("2026-11-12T00:00:00.000Z");
const tx = {} as Prisma.TransactionClient;

void test("all action controllers retain shared errors and collect field issues before calling services", async (context) => {
  const logs: unknown[] = [];
  context.mock.method(console, "error", (...args: unknown[]) => {
    logs.push(args);
  });
  let status = 403;
  let calls = 0;
  const reject = () => {
    calls++;
    return Promise.reject(new HttpError(status, "Thao tác bị từ chối"));
  };
  const auth: express.RequestHandler = (req, _res, next) => {
    req.auth = testAdmin;
    next();
  };
  const app = express();
  app.use(express.json());
  app.use(
    "/api/users",
    createAccountLifecycleRouter(
      { getLifecycle: reject, deactivate: reject, setIntakeState: reject },
      auth,
    ),
  );
  app.use(
    "/api/supply-requests",
    createSupplyOrderRouter({ getAll: reject, accept: reject }, auth),
  );
  app.use(
    "/api/food-safety-reports",
    createReportingRouter({ getAll: reject, receive: reject }, auth),
  );
  app.use(globalErrorHandler);
  const http = await startLifecycleHttp(app);
  context.after(() => http.close());
  for (const path of [
    `/api/users/${userId}/deactivate`,
    `/api/supply-requests/${userId}/accept`,
    `/api/food-safety-reports/${userId}/receive`,
  ]) {
    const request = (body: unknown) =>
      http.request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const before = calls;
    const invalid = await request({
      password: "private-sentinel",
      organizationId: "private-sentinel",
    });
    assert.equal(invalid.status, 400);
    assert.equal(calls, before);
    const error = invalid.body as {
      error: { fields: { field: string; message: string }[] };
    };
    assert.deepEqual(error.error.fields.map((field) => field.field).sort(), [
      "organizationId",
      "password",
    ]);
    assert(error.error.fields.every((field) => /[À-ỹ]/u.test(field.message)));
    for (status of [401, 403, 404, 409, 503]) {
      const response = await request({});
      assert.equal(response.status, status);
      assert.deepEqual(response.body, {
        success: false,
        statusCode: status,
        message: "Thao tác bị từ chối",
      });
    }
    assert(!JSON.stringify([invalid.body, logs]).includes("private-sentinel"));
  }
});

function setup() {
  let target: LifecycleTarget = {
    id: userId,
    roleCode: "SCHOOL_ADMINISTRATION",
    status: "ACTIVE",
    schoolId,
    supplierId: null,
    communeFoodSafetyUnitId: null,
    intakeState: "ACTIVE",
    updatedAt: now,
    Role: { type: "SCHOOL" },
    School: { intakeState: "ACTIVE", updatedAt: now },
    Supplier: null,
  };
  let ongoing = false;
  let openReports = false;
  let changed = 0;
  let activeMembers = 2;
  const repo = {
    connect: () => {
      throw new Error("Không được kết nối DB trong unit test");
    },
    findTarget: (_tx: Prisma.TransactionClient, id: string) =>
      Promise.resolve(id === target.id ? target : null),
    lockParents: () => Promise.resolve(),
    hasOngoingOrders: () => Promise.resolve(ongoing),
    hasOpenReports: () => Promise.resolve(openReports),
    countAccounts: () => Promise.resolve({ total: 3, active: activeMembers }),
    deactivateOfficer: () => {
      changed += 1;
      return Promise.resolve();
    },
    deactivateAccounts: () => {
      changed += 1;
      return Promise.resolve();
    },
    setIntakeState: (
      _tx: Prisma.TransactionClient,
      _target: LifecycleTarget,
      state: "ACTIVE" | "PAUSED" | "PAUSED_FOR_FOOD_SAFETY_INSPECTION",
    ) => {
      changed += 1;
      target =
        target.roleCode === "SCHOOL_ADMINISTRATION"
          ? { ...target, School: { intakeState: state, updatedAt: now } }
          : target.roleCode === "INGREDIENT_SUPPLIER_ADMIN"
            ? { ...target, Supplier: { intakeState: state, updatedAt: now } }
            : { ...target, intakeState: state };
      return Promise.resolve();
    },
  } satisfies AccountLifecycleRepository;
  const service = createAccountLifecycleService(repo, {
    transaction: (fn) => fn(tx),
    loadActor: () => Promise.resolve(testAdmin),
  });
  return {
    service,
    repo,
    get changed() {
      return changed;
    },
    setOpenReports(value: boolean) {
      openReports = value;
    },
    setOngoing(value: boolean) {
      ongoing = value;
    },
    setTarget(value: LifecycleTarget) {
      target = value;
    },
    get target() {
      return target;
    },
    setActiveMembers(value: number) {
      activeMembers = value;
    },
  };
}

void test("lifecycle validation rejects malformed and extra fields without returning raw values", () => {
  assert.throws(
    () => validateLifecycleParams({ userId: "bad" }),
    RequestValidationError,
  );
  assert.throws(
    () => validateLifecycleQuery({ other: "x" }),
    RequestValidationError,
  );
  assert.throws(() => validateLifecycleAction(null), RequestValidationError);
  assert.throws(
    () => validateLifecycleAction({ role: "SYSTEM_ADMIN" }),
    RequestValidationError,
  );
  assert.throws(
    () => validateIntakeState({ state: "PAUSED", extra: true }),
    RequestValidationError,
  );
  assert.deepEqual(validateLifecycleAction(undefined), {});
  assert.equal(
    validateLifecycleParams({ userId: userId.toUpperCase() }).userId,
    userId,
  );
});

void test("deactivation changes all scoped accounts and returns count", async () => {
  const f = setup();
  const result = await f.service.deactivate({ userId }, testAdmin);
  assert.deepEqual(result, {
    userId,
    targetType: "SCHOOL",
    status: "DEACTIVATED",
    affectedAccountCount: 3,
  });
  assert.equal(f.changed, 1);
});

void test("an ongoing order and missing management permission prevent writes", async () => {
  const f = setup();
  f.setOngoing(true);
  await assert.rejects(
    f.service.deactivate({ userId }, testAdmin),
    /IN_PROGRESS/,
  );
  await assert.rejects(
    f.service.deactivate({ userId }, { ...testAdmin, permissions: [] }),
    /quyền/i,
  );
  await assert.rejects(
    f.service.deactivate({ userId }, testStaff),
    /System Admin/i,
  );
  assert.equal(f.changed, 0);
});

void test("already deactivated organization is idempotent only if every member is deactivated", async () => {
  const f = setup();
  f.setTarget({ ...f.target, status: "DEACTIVATED" });
  await assert.rejects(
    f.service.deactivate({ userId }, testAdmin),
    /trạng thái/i,
  );
  f.setActiveMembers(0);
  assert.equal(
    (await f.service.deactivate({ userId }, testAdmin)).affectedAccountCount,
    3,
  );
  assert.equal(f.changed, 0);
});

void test("pausing school preserves account status and repeated pause is a no-op", async () => {
  const f = setup();
  const paused = await f.service.setIntakeState(
    { userId },
    { state: "PAUSED" },
    testAdmin,
  );
  assert.equal(paused.intakeState, "PAUSED");
  assert.equal(paused.accountStatus, "ACTIVE");
  await f.service.setIntakeState({ userId }, { state: "PAUSED" }, testAdmin);
  assert.equal(f.changed, 1);
  await assert.rejects(
    f.service.setIntakeState(
      { userId },
      { state: "PAUSED_FOR_FOOD_SAFETY_INSPECTION" },
      testAdmin,
    ),
    /không hợp lệ/i,
  );
});

void test("supplier uses its own scope and inspection-specific state", async () => {
  const f = setup();
  f.setTarget({
    ...f.target,
    roleCode: "INGREDIENT_SUPPLIER_ADMIN",
    Role: { type: "SUPPLIER" },
    schoolId: null,
    School: null,
    supplierId: schoolId,
    Supplier: { intakeState: "ACTIVE", updatedAt: now },
  });
  assert.equal(
    (await f.service.deactivate({ userId }, testAdmin)).targetType,
    "SUPPLIER",
  );
  assert.equal(
    (
      await f.service.setIntakeState(
        { userId },
        { state: "PAUSED_FOR_FOOD_SAFETY_INSPECTION" },
        testAdmin,
      )
    ).intakeState,
    "PAUSED_FOR_FOOD_SAFETY_INSPECTION",
  );
  await assert.rejects(
    f.service.setIntakeState({ userId }, { state: "PAUSED" }, testAdmin),
    /không hợp lệ/i,
  );
});

void test("target role organization mismatch is rejected before any write", async () => {
  const f = setup();
  f.setTarget({ ...f.target, Role: { type: "SYSTEM" } });
  await assert.rejects(
    f.service.deactivate({ userId }, testAdmin),
    /Vai trò hoặc tổ chức/i,
  );
  assert.equal(f.changed, 0);
});

void test("revoked permission is rechecked inside the transaction", async () => {
  const f = setup();
  const service = createAccountLifecycleService(f.repo, {
    transaction: (fn) => fn(tx),
    loadActor: (_id, actual) => {
      assert.equal(actual, tx);
      return Promise.resolve({ ...testAdmin, permissions: [] });
    },
  });
  await assert.rejects(service.deactivate({ userId }, testAdmin), /quyền/i);
  assert.equal(f.changed, 0);
});

void test("a target moving to another organization during locking cannot be changed", async () => {
  const f = setup();
  const repo: AccountLifecycleRepository = {
    ...f.repo,
    lockParents: () => {
      f.setTarget({ ...f.target, schoolId: "different-school" });
      return Promise.resolve();
    },
  };
  const service = createAccountLifecycleService(repo, {
    transaction: (fn) => fn(tx),
    loadActor: () => Promise.resolve(testAdmin),
  });
  await assert.rejects(
    service.deactivate({ userId }, testAdmin),
    /đã thay đổi/i,
  );
  assert.equal(f.changed, 0);
});

void test("HTTP lifecycle routes validate inputs and retain the shared envelope", async (context) => {
  const f = setup();
  const app = express();
  app.use(express.json());
  app.use(
    "/api/users",
    createAccountLifecycleRouter(f.service, (req, _res, next) => {
      req.auth = testAdmin;
      next();
    }),
  );
  app.use(globalErrorHandler);
  const http = await startLifecycleHttp(app);
  context.after(() => http.close());
  const get = await http.request(`/api/users/${userId}/lifecycle`);
  assert.equal(get.status, 200);
  assert.deepEqual(get.body, {
    success: true,
    statusCode: 200,
    message: "Thành công",
    data: {
      userId,
      roleCode: "SCHOOL_ADMINISTRATION",
      accountStatus: "ACTIVE",
      targetType: "SCHOOL",
      intakeState: "ACTIVE",
      updatedAt: now.toISOString(),
    },
  });
  const invalid = await http.request(
    `/api/users/${userId}/deactivate?unexpected=yes`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  assert.equal(invalid.status, 400);
  assert.equal(f.changed, 0);
  const updated = await http.request(`/api/users/${userId}/intake-state`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: "PAUSED" }),
  });
  assert.equal(updated.status, 200);
  assert.equal(f.changed, 1);
});

void test("HTTP lifecycle management denies non-system actors even with a management grant", async (context) => {
  const f = setup();
  const app = express();
  app.use(express.json());
  app.use(
    "/api/users",
    createAccountLifecycleRouter(f.service, (req, _res, next) => {
      req.auth = { ...testStaff, permissions: ["user.manage"] };
      next();
    }),
  );
  app.use(globalErrorHandler);
  const http = await startLifecycleHttp(app);
  context.after(() => http.close());
  const result = await http.request(`/api/users/${userId}/deactivate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(result.status, 403);
  assert.equal(f.changed, 0);
});

void test("officer deactivation is blocked by any unclosed request and affects only the selected officer", async () => {
  const f = setup();
  f.setTarget({
    ...f.target,
    roleCode: "COMMUNE_FOOD_SAFETY_OFFICER",
    Role: { type: "AUTHORITY" },
    schoolId: null,
    School: null,
    communeFoodSafetyUnitId: schoolId,
  });
  f.setOpenReports(true);
  await assert.rejects(
    f.service.deactivate({ userId }, testAdmin),
    /chưa CLOSED/,
  );
  assert.equal(f.changed, 0);
  f.setOpenReports(false);
  assert.deepEqual(await f.service.deactivate({ userId }, testAdmin), {
    userId,
    targetType: "OFFICER",
    status: "DEACTIVATED",
    affectedAccountCount: 1,
  });
  assert.equal(f.changed, 1);
});

void test("officer pause is per account and does not change account status", async () => {
  const f = setup();
  f.setTarget({
    ...f.target,
    roleCode: "COMMUNE_FOOD_SAFETY_OFFICER",
    Role: { type: "AUTHORITY" },
    schoolId: null,
    School: null,
    communeFoodSafetyUnitId: schoolId,
  });
  const paused = await f.service.setIntakeState(
    { userId },
    { state: "PAUSED" },
    testAdmin,
  );
  assert.equal(paused.targetType, "OFFICER");
  assert.equal(paused.intakeState, "PAUSED");
  assert.equal(paused.accountStatus, "ACTIVE");
  await assert.rejects(
    f.service.setIntakeState(
      { userId },
      { state: "PAUSED_FOR_FOOD_SAFETY_INSPECTION" },
      testAdmin,
    ),
    /không hợp lệ/i,
  );
});

void test("HTTP lifecycle manages a single officer and retains the unclosed-request blocker", async (context) => {
  context.mock.method(console, "error", () => undefined);
  const f = setup();
  f.setTarget({
    ...f.target,
    roleCode: "COMMUNE_FOOD_SAFETY_OFFICER",
    Role: { type: "AUTHORITY" },
    schoolId: null,
    School: null,
    communeFoodSafetyUnitId: schoolId,
  });
  const app = express();
  app.use(express.json());
  app.use(
    "/api/users",
    createAccountLifecycleRouter(f.service, (req, _res, next) => {
      req.auth = testAdmin;
      next();
    }),
  );
  app.use(globalErrorHandler);
  const http = await startLifecycleHttp(app);
  context.after(() => http.close());
  const pause = await http.request(`/api/users/${userId}/intake-state`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: "PAUSED" }),
  });
  assert.equal(pause.status, 200);
  assert.deepEqual(pause.body, {
    success: true,
    statusCode: 200,
    message: "Thành công",
    data: {
      userId,
      roleCode: "COMMUNE_FOOD_SAFETY_OFFICER",
      accountStatus: "ACTIVE",
      targetType: "OFFICER",
      intakeState: "PAUSED",
      updatedAt: now.toISOString(),
    },
  });
  f.setOpenReports(true);
  const deactivate = () =>
    http.request(`/api/users/${userId}/deactivate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  assert.equal((await deactivate()).status, 409);
  assert.equal(f.changed, 1);
  f.setOpenReports(false);
  const result = await deactivate();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    success: true,
    statusCode: 200,
    message: "Thành công",
    data: {
      userId,
      targetType: "OFFICER",
      status: "DEACTIVATED",
      affectedAccountCount: 1,
    },
  });
});

void test("resuming a deactivated account changes only intake state and preserves entity timestamps on retry", async () => {
  const f = setup();
  const entityTime = new Date("2026-11-10T00:00:00.000Z");
  f.setTarget({
    ...f.target,
    status: "DEACTIVATED",
    School: { intakeState: "PAUSED", updatedAt: entityTime },
  });
  assert.equal(
    (await f.service.getLifecycle({ userId }, testAdmin)).updatedAt,
    entityTime.toISOString(),
  );
  const resumed = await f.service.setIntakeState(
    { userId },
    { state: "ACTIVE" },
    testAdmin,
  );
  assert.equal(resumed.accountStatus, "DEACTIVATED");
  assert.equal(resumed.intakeState, "ACTIVE");
  assert.deepEqual(
    await f.service.setIntakeState({ userId }, { state: "ACTIVE" }, testAdmin),
    resumed,
  );
  assert.equal(f.changed, 1);
});

void test("cascade repository scopes all non-deactivated statuses to the selected organization", async () => {
  const writes: unknown[] = [];
  const client = {
    user: {
      updateMany: (args: unknown) => {
        writes.push(args);
        return Promise.resolve({ count: 4 });
      },
    },
  } as unknown as Prisma.TransactionClient;
  const repo = createAccountLifecycleRepository();
  await repo.deactivateAccounts(client, { schoolId });
  await repo.deactivateAccounts(client, { supplierId: schoolId });
  assert.deepEqual(writes, [
    {
      where: { schoolId, status: { not: "DEACTIVATED" } },
      data: { status: "DEACTIVATED" },
    },
    {
      where: { supplierId: schoolId, status: { not: "DEACTIVATED" } },
      data: { status: "DEACTIVATED" },
    },
  ]);
});

void test("all lifecycle actions reject non-system actors and missing management permission", async () => {
  const f = setup();
  const actors = [
    { ...testAdmin, permissions: [] },
    {
      ...testStaff,
      role: "SCHOOL_ADMINISTRATION",
      permissions: ["user.manage"],
    },
    {
      ...testStaff,
      role: "INGREDIENT_SUPPLIER_ADMIN",
      orgType: "SUPPLIER" as const,
      schoolId: null,
      supplierId: schoolId,
      permissions: ["user.manage"],
    },
    {
      ...testStaff,
      role: "COMMUNE_FOOD_SAFETY_OFFICER",
      orgType: "AUTHORITY" as const,
      schoolId: null,
      communeFoodSafetyUnitId: schoolId,
      permissions: ["user.manage"],
    },
  ];
  for (const actor of actors) {
    for (const action of [
      () => f.service.getLifecycle({ userId }, actor),
      () => f.service.deactivate({ userId }, actor),
      () => f.service.setIntakeState({ userId }, { state: "PAUSED" }, actor),
    ])
      await assert.rejects(
        action,
        (error: unknown) =>
          error instanceof HttpError && error.statusCode === 403,
      );
  }
  assert.equal(f.changed, 0);
});

void test("database initialization failures return sanitized service-unavailable errors", async (context) => {
  context.mock.method(console, "error", () => undefined);
  const f = setup();
  const service = createAccountLifecycleService({
    ...f.repo,
    connect: () =>
      Promise.reject(new Error("postgresql://secret:password@private")),
  });
  await assert.rejects(
    () => service.deactivate({ userId }, testAdmin),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 503 &&
      !error.message.includes("secret"),
  );
});

void test("HTTP lifecycle preserves error envelopes for missing identity, target, blockers and infrastructure", async (context) => {
  context.mock.method(console, "error", () => undefined);
  const f = setup();
  let authenticated = true;
  let offline = false;
  const service = createAccountLifecycleService(f.repo, {
    transaction: (fn) =>
      offline
        ? Promise.reject(
            new HttpError(
              503,
              "Không thể xử lý phân quyền. Vui lòng thử lại sau.",
            ),
          )
        : fn(tx),
    loadActor: () => Promise.resolve(testAdmin),
  });
  const app = express();
  app.use(express.json());
  app.use(
    "/api/users",
    createAccountLifecycleRouter(service, (req, _res, next) => {
      if (authenticated) req.auth = testAdmin;
      next();
    }),
  );
  app.use(globalErrorHandler);
  const http = await startLifecycleHttp(app);
  context.after(() => http.close());
  const action = (path = userId, body: unknown = {}) =>
    http.request(`/api/users/${path}/deactivate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  authenticated = false;
  assert.equal((await action()).status, 401);
  authenticated = true;
  const missing = await action("00000000-0000-4000-8000-000000000099");
  assert.equal(missing.status, 404);
  f.setOngoing(true);
  assert.equal((await action()).status, 409);
  f.setOngoing(false);
  offline = true;
  const unavailable = await action();
  assert.equal(unavailable.status, 503);
  assert.deepEqual(unavailable.body, {
    success: false,
    statusCode: 503,
    message: "Không thể xử lý phân quyền. Vui lòng thử lại sau.",
  });
  offline = false;
  const invalid = await action(userId, {
    password: "private-marker",
    role: "SYSTEM_ADMIN",
  });
  assert.equal(invalid.status, 400);
  assert(!JSON.stringify(invalid.body).includes("private-marker"));
  const success = await action();
  assert.equal(success.status, 200);
  assert.deepEqual(success.body, {
    success: true,
    statusCode: 200,
    message: "Thành công",
    data: {
      userId,
      targetType: "SCHOOL",
      status: "DEACTIVATED",
      affectedAccountCount: 3,
    },
  });
  assert.equal(f.changed, 1);
});
