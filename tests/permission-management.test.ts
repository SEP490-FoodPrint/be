import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validatePermissionQuery,
  validatePermission,
  validateRolePermissions,
} from "../src/modules/permission/permission.validation";
import { RequestValidationError } from "../src/utils/request-validation";

void test("permission create preserves defaults, trim and optional null", () => {
  assert.deepEqual(
    validatePermission({
      code: " demo.check ",
      name: " Kiểm tra ",
      module: " demo ",
      action: " check ",
    }),
    {
      code: "demo.check",
      name: "Kiểm tra",
      module: "demo",
      action: "check",
      description: null,
    },
  );
});

void test("permission validation reports all fields without reflecting values", () => {
  assert.throws(
    () =>
      validatePermission({
        code: "secret input",
        name: " ",
        module: "Bad Module",
        action: "!",
        isActive: true,
      }),
    (error: unknown) => {
      assert(error instanceof RequestValidationError);
      assert.deepEqual(
        new Set(error.fields.map((item) => item.field)),
        new Set(["code", "name", "module", "action", "isActive"]),
      );
      assert(!JSON.stringify(error.fields).includes("secret input"));
      return true;
    },
  );
});

void test("permission IDs normalize before duplicate detection", () => {
  const id = "abcdefab-abcd-4abc-8abc-abcdefabcdef";
  assert.throws(() =>
    validateRolePermissions({ permissionIds: [id, id.toUpperCase()] }),
  );
  assert.deepEqual(
    validateRolePermissions({ permissionIds: [id.toUpperCase()] }),
    [id],
  );
  assert.deepEqual(validateRolePermissions({ permissionIds: [] }), []);
});

import express, { type RequestHandler } from "express";
import type { PrismaClient, Prisma } from "../src/generated/prisma/client";
import {
  createPermissionRepository,
  type PermissionRepository,
  type PermissionRow,
} from "../src/modules/permission/permission.repository";
import { createPermissionService } from "../src/modules/permission/permission.service";
import { createPermissionRouter } from "../src/modules/permission/permission.routes";
import {
  globalErrorHandler,
  notFoundHandler,
} from "../src/middlewares/error.middleware";
import { createCsrfProtection } from "../src/middlewares/csrf.middleware";
import { testAdmin, testStaff } from "./helpers/authorization";
import { startHttp } from "./helpers/http";
import { HttpError } from "../src/utils/http-error";
import type { AuthPrincipal } from "../src/types/auth";

const roleId = "00000000-0000-4000-8000-000000000066";
const firstId = "00000000-0000-4000-8000-000000000077";
const secondId = "00000000-0000-4000-8000-000000000088";
const manager: AuthPrincipal = {
  ...testAdmin,
  permissions: [
    "role.view",
    "permission.view",
    "permission.create",
    "role_permission.manage",
  ],
};
const first: PermissionRow = {
  id: firstId,
  code: "demo.first",
  name: "Quyền một",
  module: "demo",
  action: "first",
  description: null,
  isActive: true,
};
const second: PermissionRow = {
  ...first,
  id: secondId,
  code: "demo.second",
  action: "second",
  isActive: false,
};

function harness() {
  const state = {
    actor: manager,
    grants: new Set([firstId, secondId]),
    permissions: new Map([
      [firstId, { ...first }],
      [secondId, { ...second }],
    ]),
    locks: 0,
    attempts: 0,
    writes: 0,
    lockHook: () => {},
  };
  const tx = {} as Prisma.TransactionClient;
  const db = {
    async $transaction<T>(
      operation: (client: Prisma.TransactionClient) => Promise<T>,
    ) {
      state.attempts++;
      return operation(tx);
    },
  } as unknown as PrismaClient;
  const repo: PermissionRepository = {
    ...createPermissionRepository(),
    actor: () => Promise.resolve(state.actor),
    lockSystem: () => {
      state.locks++;
      state.lockHook();
      return Promise.resolve();
    },
    listRoles: () =>
      Promise.resolve([
        {
          id: manager.roleId,
          code: "SYSTEM_ADMIN",
          name: "Hệ thống",
          type: "SYSTEM",
        },
      ]),
    list: (_scope, query) =>
      Promise.resolve(
        [...state.permissions.values()].slice(
          (query.page - 1) * query.limit,
          query.page * query.limit + 1,
        ),
      ),
    role: (_scope, id) =>
      Promise.resolve(
        id !== roleId && id !== manager.roleId
          ? null
          : {
              id,
              code:
                id === manager.roleId ? "SYSTEM_ADMIN" : "SCHOOL_KITCHEN_STAFF",
              name: "Vai trò",
              type: id === manager.roleId ? "SYSTEM" : "SCHOOL",
              rolePermissions: [...state.grants].map((id) => ({
                permission: state.permissions.get(id)!,
              })),
            },
      ),
    permissions: (_scope, ids) =>
      Promise.resolve(
        ids.flatMap((id) =>
          state.permissions.has(id) ? [state.permissions.get(id)!] : [],
        ),
      ),
    updateMetadata: (_scope, id, input) => {
      const row = { ...state.permissions.get(id)!, ...input };
      state.permissions.set(id, row);
      state.writes++;
      return Promise.resolve(row);
    },
    updateState: (_scope, id, isActive) => {
      const row = { ...state.permissions.get(id)!, isActive };
      state.permissions.set(id, row);
      state.writes++;
      return Promise.resolve(row);
    },
    replaceGrants: (_scope, _id, ids) => {
      state.writes++;
      state.grants = new Set(ids);
      return Promise.resolve();
    },
    create: (_scope, data) => {
      if ([...state.permissions.values()].some((p) => p.code === data.code))
        throw new HttpError(409, "Permission đã tồn tại");
      const row = { ...data, id: secondId, isActive: true };
      state.permissions.set(row.id, row);
      state.writes++;
      return Promise.resolve(row);
    },
  };
  return {
    state,
    repo,
    db,
    service: createPermissionService(() => Promise.resolve(db), repo),
  };
}
function httpHarness(h: ReturnType<typeof harness>, principal = manager) {
  const auth: RequestHandler = (req, _res, next) => {
    req.auth = principal;
    next();
  };
  const app = express();
  app.use(express.json());
  app.use(createCsrfProtection("http://localhost:3000"));
  app.use("/api", createPermissionRouter(auth, h.service));
  app.use(notFoundHandler);
  app.use(globalErrorHandler);
  return startHttp(app);
}
const fails = (status: number) => (error: unknown) =>
  error instanceof HttpError && error.statusCode === status;
const record = (value: unknown) => value as Record<string, unknown>;

void test("US1 lists reject wrong role/org and missing effective grants without reading", async () => {
  for (const actor of [
    { ...manager, permissions: [] },
    { ...testStaff, permissions: manager.permissions },
    { ...manager, orgType: "SCHOOL" as const, schoolId: testStaff.schoolId },
  ]) {
    await assert.rejects(
      harness().service.list(actor, { page: 1, limit: 20 }),
      fails(403),
    );
  }
  const h = harness();
  const page = await h.service.list(manager, { page: 1, limit: 1 });
  assert.equal(page.items.length, 1);
  assert.deepEqual(page.pagination, { page: 1, limit: 1, hasNext: true });
  const detail = await h.service.role(manager, manager.roleId);
  assert.equal(detail.editable, false);
  assert(detail.permissions.some((p) => !p.isActive));
});
void test("US1 HTTP role listing preserves pagination, editable and no-store", async (t) => {
  const h = harness();
  const http = await httpHarness(h);
  t.after(() => http.close());
  const response = await http.request("/api/roles?limit=100");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const data = record(record(response.body).data);
  assert(Array.isArray(data.items));
  const invalid = await http.request("/api/permissions?schoolId=forged");
  assert.equal(invalid.status, 400);
});
void test("US1 retains existing inactive grants but rejects newly assigned inactive", async () => {
  const h = harness();
  await h.service.replaceRole(manager, roleId, [secondId]);
  assert.deepEqual([...h.state.grants], [secondId]);
  await h.service.replaceRole(manager, roleId, []);
  assert.equal(h.state.grants.size, 0);
  await assert.rejects(
    h.service.replaceRole(manager, roleId, [secondId]),
    fails(400),
  );
  assert.equal(h.state.grants.size, 0);
});
void test("US1 protected role, unknown role and invalid grants do not write", async () => {
  const h = harness();
  await assert.rejects(
    h.service.replaceRole(manager, manager.roleId, []),
    fails(403),
  );
  await assert.rejects(h.service.replaceRole(manager, firstId, []), fails(404));
  await assert.rejects(
    h.service.replaceRole(manager, roleId, [manager.id]),
    fails(400),
  );
  assert.equal(h.state.writes, 0);
});
void test("US1 rechecks actor guard and identity after locks", async () => {
  for (const mutate of [
    (p: AuthPrincipal) => ({ ...p, permissions: [] }),
    (p: AuthPrincipal) => ({ ...p, roleId }),
  ]) {
    const h = harness();
    h.state.lockHook = () => {
      h.state.actor = mutate(manager);
    };
    await assert.rejects(
      h.service.replaceRole(manager, roleId, []),
      fails(403),
    );
    assert.equal(h.state.writes, 0);
    assert.equal(h.state.attempts, 1);
  }
});
void test("US1 retries raw actor serialization conflicts and does not retry business rejection", async () => {
  const h = harness();
  let reads = 0;
  const service = createPermissionService(() => Promise.resolve(h.db), {
    ...h.repo,
    actor: () => {
      if (++reads === 1)
        throw Object.assign(new Error("conflict"), { code: "P2034" });
      return Promise.resolve(manager);
    },
  });
  await service.replaceRole(manager, roleId, []);
  assert.equal(h.state.attempts, 2);
  assert.equal(h.state.writes, 1);
});

void test("US2 state HTTP uses strict boolean, returns DTO and preserves grants", async (t) => {
  const h = harness();
  const http = await httpHarness(h);
  t.after(() => http.close());
  const write = (value: unknown) =>
    http.request("/api/permissions/" + firstId + "/state", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRF-Protection": "1" },
      body: JSON.stringify(value),
    });
  for (const body of [
    { isActive: "false" },
    { isActive: 0 },
    {},
    { isActive: null },
    { isActive: true, code: "bad.code" },
  ])
    assert.equal((await write(body)).status, 400);
  const grants = [...h.state.grants];
  const response = await write({ isActive: false });
  assert.equal(response.status, 200);
  assert.equal(record(record(response.body).data).isActive, false);
  assert.deepEqual([...h.state.grants], grants);
  const writes = h.state.writes;
  assert.equal((await write({ isActive: false })).status, 200);
  assert.equal(h.state.writes, writes);
  assert.equal((await write({ isActive: true })).status, 200);
});
void test("US2 state requires management guard, CSRF and valid target", async (t) => {
  const h = harness();
  const http = await httpHarness(h, {
    ...manager,
    permissions: ["permission.view"],
  });
  t.after(() => http.close());
  const url = "/api/permissions/" + firstId + "/state";
  assert.equal(
    (
      await http.request(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Protection": "1",
        },
        body: '{"isActive":false}',
      })
    ).status,
    403,
  );
  const own = await httpHarness(h);
  t.after(() => own.close());
  assert.equal(
    (
      await own.request(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: '{"isActive":false}',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await own.request("/api/permissions/" + manager.id + "/state", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Protection": "1",
        },
        body: '{"isActive":false}',
      })
    ).status,
    404,
  );
});

void test("US3 duplicate classifier only maps the permission code constraint", async () => {
  const repo = createPermissionRepository();
  const input = validatePermission({
    code: "demo.third",
    name: "Quyền ba",
    module: "demo",
    action: "third",
  });
  for (const [target, expected] of [
    ["code", 409],
    ["id", 0],
  ] as const) {
    const error = Object.assign(new Error("private database detail"), {
      code: "P2002",
      meta: { target: [target] },
    });
    const tx = {
      permission: { create: () => Promise.reject(error) },
    } as unknown as Prisma.TransactionClient;
    await assert.rejects(
      repo.create({ kind: "SYSTEM" }, input, tx),
      (caught: unknown) =>
        expected
          ? caught instanceof HttpError && caught.statusCode === expected
          : caught === error,
    );
  }
  const conflict = Object.assign(new Error("retry"), { code: "P2034" });
  const tx = {
    permission: { create: () => Promise.reject(conflict) },
  } as unknown as Prisma.TransactionClient;
  await assert.rejects(
    repo.create({ kind: "SYSTEM" }, input, tx),
    (error: unknown) => error === conflict,
  );
});
void test("US3 HTTP creates active unassigned permission and rejects duplicate inactive and mass assignment", async (t) => {
  const h = harness();
  const http = await httpHarness(h);
  t.after(() => http.close());
  const post = (body: unknown) =>
    http.request("/api/permissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Protection": "1" },
      body: JSON.stringify(body),
    });
  const body = {
    code: "demo.third",
    name: " Quyền mới ",
    module: "demo",
    action: "third",
  };
  const grants = [...h.state.grants];
  assert.equal((await post({ ...body, isActive: false })).status, 400);
  const response = await post(body);
  assert.equal(response.status, 201);
  const row = record(record(response.body).data);
  assert.equal(row.name, "Quyền mới");
  assert.equal(row.isActive, true);
  assert.deepEqual(
    Object.keys(row).sort(),
    [
      "id",
      "code",
      "name",
      "module",
      "action",
      "description",
      "isActive",
    ].sort(),
  );
  assert.deepEqual([...h.state.grants], grants);
  assert.equal((await post(body)).status, 409);
});
void test("US1/US3 validators enforce maximums and nested paths", () => {
  const ids = Array.from(
    { length: 1001 },
    (_, n) => "00000000-0000-4000-8000-" + n.toString(16).padStart(12, "0"),
  );
  assert.equal(
    validateRolePermissions({ permissionIds: ids.slice(0, 1000) }).length,
    1000,
  );
  assert.throws(
    () => validateRolePermissions({ permissionIds: ids }),
    fails(400),
  );
  assert.throws(
    () => validateRolePermissions({ permissionIds: [firstId, "bad"] }),
    (error: unknown) =>
      error instanceof RequestValidationError &&
      error.fields.some((f) => f.field === "permissionIds.1"),
  );
  assert.throws(
    () =>
      validatePermission({
        code: "demo.check",
        name: "a".repeat(151),
        module: "demo",
        action: "check",
        description: "b".repeat(2001),
      }),
    (error: unknown) =>
      error instanceof RequestValidationError && error.fields.length === 2,
  );
});

void test("US4 metadata HTTP validates partial updates and keeps state/grants", async (t) => {
  const h = harness();
  const http = await httpHarness(h);
  t.after(() => http.close());
  const patch = (body: unknown) =>
    http.request("/api/permissions/" + secondId, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRF-Protection": "1" },
      body: JSON.stringify(body),
    });
  for (const body of [
    {},
    { name: " " },
    { description: "" },
    { code: "new.code" },
    { module: "new" },
    { action: "new" },
    { isActive: true },
  ])
    assert.equal((await patch(body)).status, 400);
  const before = { ...h.state.permissions.get(secondId)! };
  assert.equal(
    (await patch({ name: " Tên đã sửa ", description: " Mô tả " })).status,
    200,
  );
  assert.equal(h.state.permissions.get(secondId)?.name, "Tên đã sửa");
  assert.equal(h.state.permissions.get(secondId)?.description, "Mô tả");
  assert.equal(h.state.permissions.get(secondId)?.isActive, false);
  assert.equal(h.state.permissions.get(secondId)?.code, before.code);
  assert.equal((await patch({ description: null })).status, 200);
  assert.equal(h.state.permissions.get(secondId)?.name, "Tên đã sửa");
  assert.equal(h.state.permissions.get(secondId)?.description, null);
  assert.deepEqual([...h.state.grants], [firstId, secondId]);
});
void test("US4 metadata only needs management permission and rejects forged principals", async (t) => {
  const h = harness();
  h.state.actor = { ...manager, permissions: ["role_permission.manage"] };
  const http = await httpHarness(h, h.state.actor);
  t.after(() => http.close());
  assert.equal(
    (
      await http.request("/api/permissions/" + firstId, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Protection": "1",
        },
        body: '{"description":null}',
      })
    ).status,
    200,
  );
  const forbidden = await httpHarness(h, {
    ...testStaff,
    permissions: ["role_permission.manage"],
  });
  t.after(() => forbidden.close());
  assert.equal(
    (
      await forbidden.request("/api/permissions/" + firstId, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Protection": "1",
        },
        body: '{"description":null}',
      })
    ).status,
    403,
  );
});

void test("database acquisition and exhausted serialization failures are safe 503 responses", async () => {
  const h = harness();
  const secret = new Error("postgresql://private:password@host/database");
  const missing = createPermissionService(() => Promise.reject(secret), h.repo);
  await assert.rejects(
    missing.create(
      manager,
      validatePermission({
        code: "demo.new",
        name: "New",
        module: "demo",
        action: "new",
      }),
    ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 503 &&
      !error.message.includes("password"),
  );
  const failing = createPermissionService(() => Promise.resolve(h.db), {
    ...h.repo,
    actor: () =>
      Promise.reject(
        Object.assign(new Error("private query"), { code: "P2034" }),
      ),
  });
  await assert.rejects(failing.replaceRole(manager, roleId, []), fails(503));
  assert.equal(h.state.attempts, 3);
  assert.equal(h.state.writes, 0);
});
void test("raw COMMIT adapter conflicts retry the entire write with bounded attempts", async () => {
  const h = harness();
  let calls = 0;
  const db = {
    async $transaction<T>(
      operation: (tx: Prisma.TransactionClient) => Promise<T>,
    ) {
      const result = await operation({} as Prisma.TransactionClient);
      if (++calls < 3)
        throw Object.assign(new Error("commit conflict"), {
          name: "DriverAdapterError",
          cause: { kind: "TransactionWriteConflict" },
        });
      return result;
    },
  } as unknown as PrismaClient;
  await createPermissionService(() => Promise.resolve(db), h.repo).replaceRole(
    manager,
    roleId,
    [],
  );
  assert.equal(calls, 3);
});
void test("US2 self-disabling management permission denies subsequent requests without a bypass", async () => {
  const h = harness();
  h.state.permissions.set(firstId, {
    ...first,
    code: "role_permission.manage",
  });
  const repo: PermissionRepository = {
    ...h.repo,
    async updateState(...args) {
      const result = await h.repo.updateState(...args);
      if (!result.isActive)
        h.state.actor = {
          ...manager,
          permissions: manager.permissions.filter(
            (code) => code !== "role_permission.manage",
          ),
        };
      return result;
    },
  };
  const service = createPermissionService(() => Promise.resolve(h.db), repo);
  assert.equal(
    (await service.setPermissionState(manager, firstId, { isActive: false }))
      .isActive,
    false,
  );
  await assert.rejects(
    service.setPermissionState(manager, firstId, { isActive: true }),
    fails(403),
  );
  await assert.rejects(service.replaceRole(manager, roleId, []), fails(403));
});
void test("US3 reports adapter duplicate code but preserves unrelated unique violations", async () => {
  const repo = createPermissionRepository();
  const input = validatePermission({
    code: "demo.new",
    name: "New",
    module: "demo",
    action: "new",
  });
  const error = Object.assign(new Error("adapter secret"), {
    code: "P2002",
    meta: {
      driverAdapterError: {
        cause: { originalCode: "23505", constraint: { fields: ["code"] } },
      },
    },
  });
  const tx = {
    permission: { create: () => Promise.reject(error) },
  } as unknown as Prisma.TransactionClient;
  await assert.rejects(repo.create({ kind: "SYSTEM" }, input, tx), fails(409));
});
void test("US4 stale or missing actor cannot write metadata", async () => {
  const h = harness();
  h.state.lockHook = () => {
    h.state.actor = { ...manager, permissions: [] };
  };
  await assert.rejects(
    h.service.updatePermission(manager, firstId, { name: "Forbidden" }),
    fails(403),
  );
  assert.equal(h.state.writes, 0);
  const missing = harness();
  await assert.rejects(
    missing.service.updatePermission(manager, manager.id, { name: "Missing" }),
    fails(404),
  );
});

void test("permission search normalizes name text and rejects invalid query values", () => {
  assert.equal(
    validatePermissionQuery({ search: " Xem QUYỀN " }).search,
    "Xem QUYỀN",
  );
  assert.equal(validatePermissionQuery({ search: "   " }).search, undefined);
  assert.equal(validatePermissionQuery({}).search, undefined);
  assert.equal(
    validatePermissionQuery({ search: "a".repeat(150) }).search?.length,
    150,
  );
  for (const query of [
    { search: "a".repeat(151) },
    { search: ["one", "two"] },
    { search: { name: "one" } },
    { search: 1 },
  ]) {
    assert.throws(
      () => validatePermissionQuery(query),
      (error: unknown) =>
        error instanceof RequestValidationError &&
        error.fields.some((field) => field.field === "search"),
    );
  }
});
void test("permission search HTTP forwards normalized name query and keeps role lists strict", async (t) => {
  const h = harness();
  let received: unknown;
  const service = createPermissionService(() => Promise.resolve(h.db), {
    ...h.repo,
    list: (_scope, query) => {
      received = query;
      return Promise.resolve([]);
    },
  });
  const http = await httpHarness({ ...h, service });
  t.after(() => http.close());
  const response = await http.request(
    "/api/permissions?search=%20Xem%20&page=2&limit=1",
  );
  assert.equal(response.status, 200);
  assert.deepEqual(received, { page: 2, limit: 1, search: "Xem" });
  assert.deepEqual(record(record(response.body).data).pagination, {
    page: 2,
    limit: 1,
    hasNext: false,
  });
  assert.equal((await http.request("/api/roles?search=Xem")).status, 400);
  assert.equal(
    (await http.request("/api/permissions?search=a&search=b")).status,
    400,
  );
  const forbidden = await httpHarness(h, { ...manager, permissions: [] });
  t.after(() => forbidden.close());
  assert.equal(
    (await forbidden.request("/api/permissions?search=Xem")).status,
    403,
  );
});

void test("inactive permission list is fixed at five and rejects page size overrides", async (t) => {
  const h = harness();
  let received: unknown;
  const service = createPermissionService(() => Promise.resolve(h.db), {
    ...h.repo,
    listInactive: (_scope, query) => {
      received = query;
      return Promise.resolve(Array.from({ length: 6 }, () => second));
    },
  });
  const http = await httpHarness({ ...h, service });
  t.after(() => http.close());
  const response = await http.request("/api/permissions/inactive");
  assert.equal(response.status, 200);
  assert.deepEqual(received, { page: 1, limit: 5 });
  const data = record(record(response.body).data);
  assert.equal((data.items as unknown[]).length, 5);
  assert.deepEqual(data.pagination, { page: 1, limit: 5, hasNext: true });
  for (const query of [
    "page=0",
    "page=abc",
    "page=500000000",
    "limit=20",
    "search=x",
    "page=1&page=2",
  ]) {
    assert.equal(
      (await http.request("/api/permissions/inactive?" + query)).status,
      400,
    );
  }
});
void test("inactive permission list requires permission.view and preserves empty pagination", async (t) => {
  const h = harness();
  const service = createPermissionService(() => Promise.resolve(h.db), {
    ...h.repo,
    listInactive: () => Promise.resolve([]),
  });
  const http = await httpHarness(
    { ...h, service },
    { ...manager, permissions: ["permission.view"] },
  );
  t.after(() => http.close());
  const response = await http.request("/api/permissions/inactive?page=2");
  assert.equal(response.status, 200);
  assert.deepEqual(record(record(response.body).data), {
    items: [],
    pagination: { page: 2, limit: 5, hasNext: false },
  });
  const forbidden = await httpHarness(h, {
    ...testStaff,
    permissions: ["permission.view"],
  });
  t.after(() => forbidden.close());
  assert.equal(
    (await forbidden.request("/api/permissions/inactive")).status,
    403,
  );
});
