import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { INITIAL_PERMISSIONS } from "../src/constants/permission-catalog";
import { createAuthenticate } from "../src/middlewares/auth.middleware";
import { requirePermission } from "../src/middlewares/permission.middleware";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import {
  principalFromIdentity,
  assertSystemManager,
  assertOrganizationManager,
  databaseOperation,
} from "../src/utils/authorization";
import { listScopes } from "../src/utils/resource-access";
import { HttpError } from "../src/utils/http-error";
import { signToken } from "../src/utils/jwt";
import { validateLogin } from "../src/modules/auth/session.validation";
import {
  validateRolePermissions,
  validatePermission,
} from "../src/modules/permission/permission.validation";
import { testAdmin, testStaff } from "./helpers/authorization";
import { startHttp } from "./helpers/http";

type Identity = NonNullable<Parameters<typeof principalFromIdentity>[0]>;
function identity(overrides: Partial<Identity> = {}): Identity {
  return {
    id: testStaff.id,
    username: "staff",
    fullName: "Staff",
    status: "ACTIVE",
    roleId: testStaff.roleId,
    schoolId: testStaff.schoolId,
    supplierId: null,
    communeFoodSafetyUnitId: null,
    Role: {
      code: "SCHOOL_KITCHEN_STAFF",
      type: "SCHOOL",
      rolePermissions: [{ permission: { code: "menu.view", isActive: true } }],
    },
    permissionDenials: [],
    ...overrides,
  };
}
const status = (value: number) => (error: unknown) =>
  error instanceof HttpError && error.statusCode === value;

void test("effective permissions use only active role grants minus denials in the current organization", () => {
  const user = identity();
  user.Role.rolePermissions.push({
    permission: { code: "menu.update", isActive: false },
  });
  user.permissionDenials.push({
    schoolId: "other-school",
    supplierId: null,
    communeFoodSafetyUnitId: null,
    permission: { code: "menu.view" },
  });
  assert.deepEqual(principalFromIdentity(user).permissions, ["menu.view"]);
  user.permissionDenials.push({
    schoolId: user.schoolId,
    supplierId: null,
    communeFoodSafetyUnitId: null,
    permission: { code: "menu.view" },
  });
  assert.deepEqual(principalFromIdentity(user).permissions, []);
});
void test("identity rejects missing, inactive, mismatched and unscoped accounts", () => {
  assert.throws(() => principalFromIdentity(null), status(401));
  for (const value of [
    identity({ status: "LOCKED" }),
    identity({ schoolId: null }),
    identity({ supplierId: testAdmin.id }),
    identity({
      Role: { code: "SYSTEM_ADMIN", type: "SCHOOL", rolePermissions: [] },
    }),
  ])
    assert.throws(() => principalFromIdentity(value), status(403));
});
void test("all list resources deny absent grants, including System Admin", () => {
  for (const scope of Object.values(listScopes)) {
    assert.throws(() => scope({ ...testAdmin, permissions: [] }), status(403));
    assert.deepEqual(
      scope({
        ...testAdmin,
        permissions: INITIAL_PERMISSIONS.map((p) => p.code),
      }),
      {},
    );
  }
});
void test("organization scope follows trusted membership and nested ownership", () => {
  const p = {
    ...testStaff,
    permissions: [
      "menu.view",
      "supply_request.view",
      "food_safety_report.view",
      "ingredient_quality_feedback.view_own",
    ],
  };
  assert.deepEqual(listScopes.menu(p), { schoolId: p.schoolId });
  assert.deepEqual(listScopes["supply-order"](p), { schoolId: p.schoolId });
  assert.deepEqual(listScopes["ingredient-quality-feedback"](p), {
    Delivery: { SupplyRequest: { schoolId: p.schoolId } },
    submittedByUserId: p.id,
  });
  const authority = {
    ...p,
    role: "COMMUNE_FOOD_SAFETY_OFFICER",
    orgType: "AUTHORITY" as const,
    schoolId: null,
    communeFoodSafetyUnitId: testAdmin.id,
  };
  assert.deepEqual(listScopes.reporting(authority), {
    recipientCommuneFoodSafetyUnitId: testAdmin.id,
  });
  assert.throws(() => listScopes.menu(authority), status(403));
});
void test("administration requires the eligible admin role and an assigned management permission", () => {
  assert.throws(
    () =>
      assertSystemManager(
        { ...testAdmin, permissions: [] },
        "permission.create",
      ),
    status(403),
  );
  assert.throws(
    () =>
      assertOrganizationManager({
        ...testStaff,
        permissions: ["school_user.manage"],
      }),
    status(403),
  );
  assert.doesNotThrow(() =>
    assertOrganizationManager({
      ...testStaff,
      role: "SCHOOL_ADMINISTRATION",
      permissions: ["school_user.manage"],
    }),
  );
  assert.throws(
    () =>
      assertOrganizationManager({
        ...testStaff,
        role: "COMMUNE_FOOD_SAFETY_OFFICER",
        orgType: "AUTHORITY",
        schoolId: null,
        communeFoodSafetyUnitId: testAdmin.id,
        permissions: [
          "school_user.manage",
          "supplier_staff.manage",
          "role_permission.manage",
        ],
      }),
    status(403),
  );
});
void test("permission DTOs reject mass assignment, invalid codes and duplicate UUIDs", () => {
  assert.throws(
    () =>
      validatePermission({
        code: "Invalid",
        name: "Invalid",
        module: "menu",
        action: "view",
      }),
    status(400),
  );
  assert.throws(
    () =>
      validatePermission({
        code: "menu.view",
        name: "View",
        module: "menu",
        action: "view",
        isActive: true,
      }),
    status(400),
  );
  assert.throws(
    () =>
      validateRolePermissions({ permissionIds: [testAdmin.id, testAdmin.id] }),
    status(400),
  );
  assert.deepEqual(validateRolePermissions({ permissionIds: [] }), []);
  assert.throws(
    () => validateLogin({ identifier: "staff", password: "á".repeat(37) }),
    status(400),
  );
  assert.equal(
    validateLogin({ identifier: "staff", password: "á".repeat(36) }).password
      .length,
    36,
  );
});
void test("the same token observes revoked grants on the next request and ignores its claimed role", async (context) => {
  let user = identity();
  const app = express();
  app.get(
    "/menu",
    createAuthenticate(
      () => Promise.resolve(principalFromIdentity(user)),
      () => Promise.resolve(),
    ),
    requirePermission("menu.view"),
    (_req, res) => res.sendStatus(204),
  );
  app.use(globalErrorHandler);
  const http = await startHttp(app);
  context.after(() => http.close());
  const headers = {
    Authorization: `Bearer ${signToken({ sub: user.id, role: "SYSTEM_ADMIN", orgType: "SYSTEM" })}`,
  };
  assert.equal((await http.request("/menu", { headers })).status, 204);
  user = identity({ Role: { ...user.Role, rolePermissions: [] } });
  assert.equal((await http.request("/menu", { headers })).status, 403);
  assert.equal(
    (
      await http.request("/menu", {
        headers: {
          Authorization: `Bearer ${signToken({ role: "SYSTEM_ADMIN" })}`,
        },
      })
    ).status,
    401,
  );
});
void test("database errors fail closed and do not expose connection credentials", async () => {
  await assert.rejects(
    () =>
      databaseOperation(() =>
        Promise.reject(new Error("postgresql://private:secret@host/db")),
      ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 503 &&
      !error.message.includes("secret"),
  );
});

void test("malformed login JSON and unexpected errors never expose password bodies or driver messages", async (context) => {
  const logged: unknown[][] = [];
  context.mock.method(console, "error", (...values: unknown[]) => {
    logged.push(values);
  });
  const app = express();
  app.use(express.json());
  app.post("/login", (_req, res) => {
    res.sendStatus(204);
  });
  app.get("/unexpected", () => {
    throw new Error("postgresql://private:sensitive-password@host/db");
  });
  app.use(globalErrorHandler);
  const http = await startHttp(app);
  context.after(() => http.close());
  const malformed = await http.request("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"password":"sensitive-password",',
  });
  assert.equal(malformed.status, 400);
  const unexpected = await http.request("/unexpected");
  assert.equal(unexpected.status, 500);
  assert(
    !JSON.stringify([malformed.body, unexpected.body, logged]).includes(
      "sensitive-password",
    ),
  );
});

void test("the bootstrap command refuses a remote target without the explicit Azure operator option", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const path = await import("node:path");
  await assert.rejects(
    () =>
      promisify(execFile)(
        process.execPath,
        ["--require", "tsx/cjs", "src/scripts/bootstrap-authorization.ts"],
        {
          cwd: path.resolve(__dirname, ".."),
          env: {
            ...process.env,
            DATABASE_URL:
              "postgresql://test:test-only@not-contacted.postgres.database.azure.com/foodprint_db?schema=foodprint&sslmode=require",
          },
          timeout: 10000,
        },
      ),
    (error: unknown) => {
      assert(
        error !== null &&
          typeof error === "object" &&
          "stderr" in error &&
          typeof error.stderr === "string",
      );
      assert.match(error.stderr, /Bootstrap chưa hoàn tất/);
      assert(!error.stderr.includes("test-only"));
      return true;
    },
  );
});
