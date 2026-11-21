import type { PrismaClient } from "../src/generated/prisma/client";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { bootstrapAuthorization } from "../src/utils/authorization-bootstrap";
import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import {
  INITIAL_PERMISSIONS,
  INITIAL_ROLES,
  INITIAL_ROLE_PERMISSIONS,
} from "../src/constants/permission-catalog";
import { createAuthenticate } from "../src/middlewares/auth.middleware";
import { requirePermission } from "../src/middlewares/permission.middleware";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import {
  authorizationTransaction,
  principalFromIdentity,
  assertSystemManager,
  assertOrganizationManager,
  databaseOperation,
} from "../src/utils/authorization";
import {
  ingredientQualityFeedbackReadScope,
  ingredientQualityFeedbackResponseScope,
  listScopes,
  RESOURCE_PERMISSIONS,
  supplierSchoolReadScope,
  supplierStaffManagementScope,
  supplierOrderManagementScope,
  supplierOrderReadScope,
} from "../src/utils/resource-access";
import { HttpError } from "../src/utils/http-error";
import { signToken } from "../src/utils/jwt";
import { validateLogin } from "../src/modules/auth/session.validation";
import {
  validateRolePermissions,
  validatePermission,
} from "../src/modules/permission/permission.validation";
import { testAdmin, testStaff } from "./helpers/authorization";
import { startHttp } from "./helpers/http";
import { createSchoolGradeService } from "../src/modules/school-grade/school-grade.service";

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
  for (const [resource, scope] of Object.entries(listScopes)) {
    assert.throws(() => scope({ ...testAdmin, permissions: [] }), status(403));
    const grantedSystem = {
      ...testAdmin,
      permissions: INITIAL_PERMISSIONS.map((p) => p.code),
    };
    if (
      resource === "source-facility" ||
      resource === "supplier-staff" ||
      resource === "supplier-school"
    ) {
      assert.throws(() => scope(grantedSystem), status(403));
    } else if (resource === "feedback") {
      // Bảng cha `complaints` dùng chung: phạm vi luôn khóa theo loại đơn.
      assert.deepEqual(scope(grantedSystem), { kind: "MEAL" });
    } else if (resource === "ingredient-quality-feedback") {
      assert.deepEqual(scope(grantedSystem), { kind: "INGREDIENT" });
    } else if (resource === "system-complaint") {
      assert.deepEqual(scope(grantedSystem), { kind: "SYSTEM" });
    } else {
      assert.deepEqual(scope(grantedSystem), {});
    }
  }
});
void test("supplier staff management requires its admin role, trusted membership and effective permission", () => {
  const supplierId = "00000000-0000-4000-8000-000000000055";
  const principal = {
    ...testAdmin,
    role: "INGREDIENT_SUPPLIER_ADMIN",
    orgType: "SUPPLIER" as const,
    supplierId,
    permissions: ["supplier_staff.manage"],
  };
  assert.deepEqual(RESOURCE_PERMISSIONS["supplier-staff"], [
    "supplier_staff.manage",
  ]);
  assert.deepEqual(supplierStaffManagementScope(principal), { supplierId });
  assert.deepEqual(listScopes["supplier-staff"](principal), {
    supplierId,
    schoolId: null,
    communeFoodSafetyUnitId: null,
    roleCode: "INGREDIENT_SUPPLIER_STAFF",
    Role: { code: "INGREDIENT_SUPPLIER_STAFF", type: "SUPPLIER" },
  });
  const otherSupplierId = "00000000-0000-4000-8000-000000000066";
  assert.deepEqual(
    supplierStaffManagementScope({ ...principal, supplierId: otherSupplierId }),
    { supplierId: otherSupplierId },
  );
  // The existing directory remains org-wide; the new resource is staff-only.
  assert.deepEqual(listScopes.user(principal), { supplierId });

  for (const denied of [
    { ...principal, permissions: [] },
    { ...principal, permissions: ["user.manage"] },
    { ...principal, permissions: ["school_user.manage"] },
    { ...principal, role: "INGREDIENT_SUPPLIER_STAFF" },
    { ...principal, role: "FUTURE_SUPPLIER_ROLE" },
    { ...principal, role: "SYSTEM_ADMIN" },
    { ...principal, role: "SCHOOL_ADMINISTRATION" },
    { ...principal, role: "COMMUNE_FOOD_SAFETY_OFFICER" },
    { ...principal, supplierId: null },
    { ...principal, schoolId: testStaff.schoolId },
    { ...principal, communeFoodSafetyUnitId: testAdmin.id },
    { ...principal, orgType: "SYSTEM" as const },
    { ...principal, orgType: "SCHOOL" as const },
    { ...principal, orgType: "AUTHORITY" as const },
    { ...testAdmin, permissions: ["supplier_staff.manage"] },
  ]) {
    assert.throws(() => supplierStaffManagementScope(denied), status(403));
    assert.throws(() => listScopes["supplier-staff"](denied), status(403));
  }
});
void test("supplier-school requires INGREDIENT_SUPPLIER_ADMIN, valid SUPPLIER membership and view/manage OR without SYSTEM bypass", () => {
  const supplierId = "00000000-0000-4000-8000-000000000055";
  const otherSupplierId = "00000000-0000-4000-8000-000000000066";
  const principal = {
    ...testAdmin,
    role: "INGREDIENT_SUPPLIER_ADMIN",
    orgType: "SUPPLIER" as const,
    supplierId,
    permissions: ["supplier_relationship.view"],
  };
  assert.deepEqual(RESOURCE_PERMISSIONS["supplier-school"], [
    "supplier_relationship.view",
    "supplier_relationship.manage",
  ]);
  assert.deepEqual(supplierSchoolReadScope(principal), { supplierId });
  assert.deepEqual(listScopes["supplier-school"](principal), { supplierId });
  assert.deepEqual(
    supplierSchoolReadScope({
      ...principal,
      permissions: ["supplier_relationship.manage"],
    }),
    { supplierId },
  );
  assert.deepEqual(
    supplierSchoolReadScope({
      ...principal,
      supplierId: otherSupplierId,
      permissions: [
        "supplier_relationship.view",
        "supplier_relationship.manage",
      ],
    }),
    { supplierId: otherSupplierId },
  );
  // Catalog adds default view only to INGREDIENT_SUPPLIER_ADMIN, not manage or staff.
  const initialRolePermissions: readonly (readonly [string, string])[] =
    INITIAL_ROLE_PERMISSIONS;
  assert(
    initialRolePermissions.some(
      ([role, permission]) =>
        role === "INGREDIENT_SUPPLIER_ADMIN" &&
        permission === "supplier_relationship.view",
    ),
  );
  assert(
    !initialRolePermissions.some(
      ([role, permission]) =>
        role === "INGREDIENT_SUPPLIER_ADMIN" &&
        permission === "supplier_relationship.manage",
    ),
  );
  assert(
    !initialRolePermissions.some(
      ([role, permission]) =>
        role === "INGREDIENT_SUPPLIER_STAFF" &&
        (permission === "supplier_relationship.view" ||
          permission === "supplier_relationship.manage"),
    ),
  );

  for (const denied of [
    { ...principal, permissions: [] },
    { ...principal, permissions: ["supplier.view"] },
    { ...principal, permissions: ["delivery.manage"] },
    { ...principal, role: "INGREDIENT_SUPPLIER_STAFF" },
    {
      ...principal,
      role: "INGREDIENT_SUPPLIER_STAFF",
      permissions: ["supplier_relationship.manage"],
    },
    { ...principal, role: "FUTURE_SUPPLIER_ROLE" },
    { ...principal, role: "SYSTEM_ADMIN" },
    { ...principal, role: "SCHOOL_ADMINISTRATION" },
    { ...principal, role: "SCHOOL_MANAGEMENT_BOARD" },
    { ...principal, role: "COMMUNE_FOOD_SAFETY_OFFICER" },
    { ...principal, supplierId: null },
    { ...principal, schoolId: testStaff.schoolId },
    { ...principal, communeFoodSafetyUnitId: testAdmin.id },
    { ...principal, orgType: "SYSTEM" as const },
    { ...principal, orgType: "SCHOOL" as const },
    { ...principal, orgType: "AUTHORITY" as const },
    {
      ...testAdmin,
      permissions: [
        "supplier_relationship.view",
        "supplier_relationship.manage",
      ],
    },
  ]) {
    assert.throws(() => supplierSchoolReadScope(denied), status(403));
    assert.throws(() => listScopes["supplier-school"](denied), status(403));
  }
});
void test("school grade service requires BGH even when SYSTEM has class.manage", async () => {
  const service = createSchoolGradeService(() =>
    Promise.reject(new Error("Unexpected database access")),
  );
  const actor = { ...testAdmin, permissions: ["class.manage"] };
  assert.deepEqual(listScopes["school-grade"](actor), {});
  await assert.rejects(service.list(actor), status(403));
});

void test("bootstrap System Admin grants allow directory children and preserve permission checks", () => {
  const principal = {
    ...testAdmin,
    permissions: INITIAL_ROLE_PERMISSIONS.filter(
      ([role]) => role === "SYSTEM_ADMIN",
    ).map(([, permission]) => permission),
  };
  for (const resource of [
    "class",
    "school-supplier",
    "user",
    "supplier-certification",
  ] as const) {
    assert.deepEqual(listScopes[resource](principal), {}, resource);
  }
  const withoutRelationship = {
    ...principal,
    permissions: principal.permissions.filter(
      (permission) => permission !== "supplier_relationship.view",
    ),
  };
  assert.throws(
    () => listScopes["school-supplier"](withoutRelationship),
    status(403),
  );
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
    kind: "INGREDIENT",
    ingredientQualityFeedback: { is: { Delivery: { schoolId: p.schoolId } } },
    senderUserId: p.id,
  });
  const deliverySchool = {
    ...testStaff,
    permissions: [
      "delivery.view",
      "ingredient_lot.view",
      "inventory.view",
      "traceability.view",
    ],
  };
  assert.deepEqual(listScopes.delivery(deliverySchool), {
    schoolId: deliverySchool.schoolId,
  });
  assert.deepEqual(listScopes.warehouse(deliverySchool), {
    DeliveryItem: { Delivery: { schoolId: deliverySchool.schoolId } },
  });
  assert.deepEqual(listScopes.inventory(deliverySchool), {
    IngredientLot: {
      DeliveryItem: { Delivery: { schoolId: deliverySchool.schoolId } },
    },
  });
  const supplierBase = {
    ...testStaff,
    orgType: "SUPPLIER" as const,
    role: "INGREDIENT_SUPPLIER_STAFF",
    schoolId: null,
    supplierId: "00000000-0000-4000-8000-000000000055",
  };
  assert.deepEqual(
    supplierOrderManagementScope({
      ...supplierBase,
      permissions: ["delivery.manage"],
    }),
    { supplierId: supplierBase.supplierId },
  );
  assert.deepEqual(
    supplierOrderReadScope({
      ...supplierBase,
      role: "INGREDIENT_SUPPLIER_ADMIN",
      permissions: ["delivery.receive"],
    }),
    { supplierId: supplierBase.supplierId },
  );
  assert.throws(
    () =>
      supplierOrderManagementScope({
        ...supplierBase,
        permissions: ["delivery.view"],
      }),
    status(403),
  );
  assert.throws(
    () =>
      supplierOrderManagementScope({
        ...supplierBase,
        role: "SYSTEM_ADMIN",
        permissions: ["delivery.manage"],
      }),
    status(403),
  );
  assert.throws(
    () =>
      supplierOrderReadScope({
        ...supplierBase,
        role: "FUTURE_SUPPLIER_ROLE",
        permissions: ["delivery.view"],
      }),
    status(403),
  );
  const authority = {
    ...p,
    role: "COMMUNE_FOOD_SAFETY_OFFICER",
    orgType: "AUTHORITY" as const,
    schoolId: null,
    communeFoodSafetyUnitId: testAdmin.id,
  };
  assert.deepEqual(listScopes.reporting(authority), {
    recipientCommuneFoodSafetyUnitId: testAdmin.id,
    OR: [{ recipientUserId: authority.id }, { recipientUserId: null }],
  });
  const reportScope = {
    recipientCommuneFoodSafetyUnitId: testAdmin.id,
    OR: [{ recipientUserId: authority.id }, { recipientUserId: null }],
  };
  const authorizedOfficer = {
    ...authority,
    permissions: [
      "food_safety_incident.view",
      "food_analysis_result.view",
      "traceability.view",
    ],
  };
  assert.deepEqual(listScopes.inspection(authorizedOfficer), {
    foodSafetyReportForwardings: { some: reportScope },
  });
  assert.deepEqual(listScopes["food-analysis"](authorizedOfficer), {
    FoodSafetyIncident: { foodSafetyReportForwardings: { some: reportScope } },
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
void test("database errors fail closed and do not expose connection credentials", async (context) => {
  const logs: unknown[][] = [];
  context.mock.method(console, "error", (...values: unknown[]) => {
    logs.push(values);
  });
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
  assert.equal(logs.length, 1);
  assert(!JSON.stringify(logs).includes("secret"));
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

void test("bootstrap preserves existing officer assignments while provisioning new roles", async () => {
  const officerCode = "COMMUNE_FOOD_SAFETY_OFFICER";
  for (const officerExists of [true, false]) {
    let roleReads = 0;
    let permissionCreate: { skipDuplicates?: boolean } | undefined;
    let inserted: { roleId: string; permissionId: string }[] = [];
    const roles = INITIAL_ROLES.map((role) => ({
      id: role.code,
      code: role.code,
    }));
    const permissions = INITIAL_PERMISSIONS.map((permission) => ({
      id: permission.code,
      code: permission.code,
    }));
    const mockTx = {
      $executeRaw: () => Promise.resolve(0),
      role: {
        findMany: () =>
          Promise.resolve(
            ++roleReads === 1 && !officerExists
              ? roles.filter((role) => role.code !== officerCode)
              : roles,
          ),
        createMany: () => Promise.resolve({ count: 0 }),
      },
      permission: {
        findMany: () => Promise.resolve(permissions),
        createMany: (args: { skipDuplicates?: boolean }) => {
          permissionCreate = args;
          return Promise.resolve({ count: 0 });
        },
      },
      rolePermission: {
        createMany: (args: {
          data: { roleId: string; permissionId: string }[];
        }) => {
          inserted = args.data;
          return Promise.resolve({ count: args.data.length });
        },
      },
    };
    const client = {
      $transaction: (fn: (value: typeof mockTx) => Promise<unknown>) =>
        fn(mockTx),
    } as unknown as import("../src/generated/prisma/client").PrismaClient;
    await bootstrapAuthorization(client);
    assert.equal(permissionCreate?.skipDuplicates, true);
    assert.equal(
      inserted.some(
        (row) =>
          row.roleId === officerCode &&
          row.permissionId === "food_safety_report.receive",
      ),
      !officerExists,
    );
  }
});
void test("bootstrap grants default supplier_relationship.view only when INGREDIENT_SUPPLIER_ADMIN is newly created", async () => {
  const supplierAdminCode = "INGREDIENT_SUPPLIER_ADMIN";
  for (const supplierAdminExists of [true, false]) {
    let roleReads = 0;
    let inserted: { roleId: string; permissionId: string }[] = [];
    const roles = INITIAL_ROLES.map((role) => ({
      id: role.code,
      code: role.code,
    }));
    const permissions = INITIAL_PERMISSIONS.map((permission) => ({
      id: permission.code,
      code: permission.code,
    }));
    const mockTx = {
      $executeRaw: () => Promise.resolve(0),
      role: {
        findMany: () =>
          Promise.resolve(
            ++roleReads === 1 && !supplierAdminExists
              ? roles.filter((role) => role.code !== supplierAdminCode)
              : roles,
          ),
        createMany: () => Promise.resolve({ count: 0 }),
      },
      permission: {
        findMany: () => Promise.resolve(permissions),
        createMany: () => Promise.resolve({ count: 0 }),
      },
      rolePermission: {
        createMany: (args: {
          data: { roleId: string; permissionId: string }[];
        }) => {
          inserted = args.data;
          return Promise.resolve({ count: args.data.length });
        },
      },
    };
    const client = {
      $transaction: (fn: (value: typeof mockTx) => Promise<unknown>) =>
        fn(mockTx),
    } as unknown as import("../src/generated/prisma/client").PrismaClient;
    await bootstrapAuthorization(client);
    assert.equal(
      inserted.some(
        (row) =>
          row.roleId === supplierAdminCode &&
          row.permissionId === "supplier_relationship.view",
      ),
      !supplierAdminExists,
    );
  }
});

void test("serialization retries wait 20ms then 40ms and stop after three transactions", async (context) => {
  context.mock.method(console, "error", () => undefined);
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let attempts = 0;
  const conflict = Object.assign(new Error("private serialization details"), {
    code: "P2034",
  });
  const client = {
    $transaction() {
      attempts++;
      return Promise.reject(conflict);
    },
  } as unknown as PrismaClient;
  const outcome = assert.rejects(
    () => authorizationTransaction(client, () => Promise.resolve(true)),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 503 &&
      !error.message.includes("private"),
  );
  try {
    await yieldTurn();
    assert.equal(attempts, 1);
    context.mock.timers.tick(19);
    await yieldTurn();
    assert.equal(attempts, 1);
    context.mock.timers.tick(1);
    await yieldTurn();
    assert.equal(attempts, 2);
    context.mock.timers.tick(39);
    await yieldTurn();
    assert.equal(attempts, 2);
    context.mock.timers.tick(1);
    await outcome;
    assert.equal(attempts, 3);
  } finally {
    context.mock.timers.reset();
  }
});

void test("authorization refusals are neither delayed nor retried", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let attempts = 0;
  const refused = new HttpError(403, "Quyền đã bị thu hồi");
  const client = {
    $transaction() {
      attempts++;
      return Promise.reject(refused);
    },
  } as unknown as PrismaClient;
  try {
    await assert.rejects(
      () => authorizationTransaction(client, () => Promise.resolve(true)),
      (error) => error === refused,
    );
    assert.equal(attempts, 1);
  } finally {
    context.mock.timers.reset();
  }
});

void test("commit adapter serialization conflicts retry the entire completed callback", async (context) => {
  context.mock.method(console, "error", () => undefined);
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let attempts = 0,
    callbacks = 0;
  const commitConflict = Object.assign(new Error("private commit details"), {
    name: "DriverAdapterError",
    cause: { kind: "TransactionWriteConflict", originalCode: "40001" },
  });
  const client = {
    async $transaction(operation: () => Promise<string>) {
      attempts++;
      const result = await operation();
      if (attempts === 1) throw commitConflict;
      return result;
    },
  } as unknown as PrismaClient;
  const outcome = authorizationTransaction(client, () => {
    callbacks++;
    return Promise.resolve("committed");
  }).then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  try {
    await yieldTurn();
    context.mock.timers.tick(20);
    assert.deepEqual(await outcome, { value: "committed" });
    assert.equal(attempts, 2);
    assert.equal(callbacks, 2);
  } finally {
    context.mock.timers.reset();
  }
});

void test("non-conflict adapter failures are sanitized without retry", async (context) => {
  context.mock.method(console, "error", () => undefined);
  let attempts = 0;
  const failure = Object.assign(new Error("private adapter details"), {
    name: "DriverAdapterError",
    cause: { kind: "AuthenticationFailed", originalCode: "28P01" },
  });
  const client = {
    $transaction() {
      attempts++;
      return Promise.reject(failure);
    },
  } as unknown as PrismaClient;
  await assert.rejects(
    () => authorizationTransaction(client, () => Promise.resolve(true)),
    (error) =>
      error instanceof HttpError &&
      error.statusCode === 503 &&
      !error.message.includes("private"),
  );
  assert.equal(attempts, 1);
});

void test("ingredient-quality-feedback scopes enforce supplier ADMIN/STAFF membership, view_details read, AND respond write, and keep SCHOOL/SYSTEM boundaries", () => {
  const supplierId = "00000000-0000-4000-8000-000000000075";
  const otherSupplierId = "00000000-0000-4000-8000-000000000076";
  const supplierAdmin = {
    ...testAdmin,
    role: "INGREDIENT_SUPPLIER_ADMIN",
    orgType: "SUPPLIER" as const,
    supplierId,
    permissions: ["ingredient_quality_feedback.view_details"],
  };
  const supplierStaff = {
    ...supplierAdmin,
    role: "INGREDIENT_SUPPLIER_STAFF",
  };
  assert.deepEqual(ingredientQualityFeedbackReadScope(supplierAdmin, "list"), {
    kind: "SUPPLIER",
    supplierId,
  });
  assert.deepEqual(
    ingredientQualityFeedbackReadScope(supplierStaff, "detail"),
    { kind: "SUPPLIER", supplierId },
  );
  assert.deepEqual(listScopes["ingredient-quality-feedback"](supplierStaff), {
    kind: "INGREDIENT",
    ingredientQualityFeedback: { is: { Delivery: { supplierId } } },
  });
  assert.deepEqual(
    ingredientQualityFeedbackResponseScope({
      ...supplierStaff,
      supplierId: otherSupplierId,
      permissions: [
        "ingredient_quality_feedback.view_details",
        "ingredient_quality_feedback.respond",
      ],
    }),
    { supplierId: otherSupplierId },
  );

  // AND requirement on write; view_own-only or malformed supplier actors must be rejected.
  for (const deniedRead of [
    { ...supplierAdmin, permissions: [] },
    { ...supplierAdmin, permissions: ["ingredient_quality_feedback.view_own"] },
    { ...supplierStaff, permissions: ["ingredient_quality_feedback.respond"] },
    { ...supplierAdmin, role: "FUTURE_SUPPLIER_ROLE" },
    { ...supplierAdmin, role: "SYSTEM_ADMIN" },
    { ...supplierAdmin, supplierId: null },
    { ...supplierAdmin, schoolId: testStaff.schoolId },
    { ...supplierAdmin, communeFoodSafetyUnitId: testAdmin.id },
    { ...supplierAdmin, orgType: "AUTHORITY" as const },
    {
      ...testStaff,
      role: "COMMUNE_FOOD_SAFETY_OFFICER",
      orgType: "AUTHORITY" as const,
      schoolId: null,
      communeFoodSafetyUnitId: testAdmin.id,
      permissions: ["ingredient_quality_feedback.view_details"],
    },
  ]) {
    assert.throws(
      () => ingredientQualityFeedbackReadScope(deniedRead, "list"),
      status(403),
    );
    assert.throws(
      () => ingredientQualityFeedbackReadScope(deniedRead, "detail"),
      status(403),
    );
    assert.throws(
      () => listScopes["ingredient-quality-feedback"](deniedRead),
      status(403),
    );
  }

  for (const deniedWrite of [
    supplierAdmin, // only view_details
    { ...supplierStaff, permissions: ["ingredient_quality_feedback.respond"] }, // missing view_details
    {
      ...supplierStaff,
      permissions: [
        "ingredient_quality_feedback.view_own",
        "ingredient_quality_feedback.respond",
      ],
    },
    {
      ...testStaff,
      permissions: [
        "ingredient_quality_feedback.view_details",
        "ingredient_quality_feedback.respond",
      ],
    },
    {
      ...testAdmin,
      permissions: [
        "ingredient_quality_feedback.view_details",
        "ingredient_quality_feedback.respond",
      ],
    },
    {
      ...supplierAdmin,
      schoolId: testStaff.schoolId,
      permissions: [
        "ingredient_quality_feedback.view_details",
        "ingredient_quality_feedback.respond",
      ],
    },
  ]) {
    assert.throws(
      () => ingredientQualityFeedbackResponseScope(deniedWrite),
      status(403),
    );
  }

  // SCHOOL keeps own vs details scope; SYSTEM keeps list but cannot open detail or response.
  const schoolOwn = {
    ...testStaff,
    permissions: ["ingredient_quality_feedback.view_own"],
  };
  const schoolDetails = {
    ...testStaff,
    permissions: ["ingredient_quality_feedback.view_details"],
  };
  assert.deepEqual(ingredientQualityFeedbackReadScope(schoolOwn, "list"), {
    kind: "SCHOOL",
    schoolId: testStaff.schoolId!,
    submittedByUserId: testStaff.id,
  });
  assert.deepEqual(ingredientQualityFeedbackReadScope(schoolOwn, "detail"), {
    kind: "SCHOOL",
    schoolId: testStaff.schoolId!,
    submittedByUserId: testStaff.id,
  });
  assert.deepEqual(
    ingredientQualityFeedbackReadScope(schoolDetails, "detail"),
    {
      kind: "SCHOOL",
      schoolId: testStaff.schoolId!,
      submittedByUserId: null,
    },
  );
  const systemViewer = {
    ...testAdmin,
    permissions: ["ingredient_quality_feedback.view_details"],
  };
  assert.deepEqual(ingredientQualityFeedbackReadScope(systemViewer, "list"), {
    kind: "SYSTEM",
  });
  assert.throws(
    () => ingredientQualityFeedbackReadScope(systemViewer, "detail"),
    status(403),
  );
  assert.throws(
    () =>
      ingredientQualityFeedbackReadScope(
        { ...testAdmin, permissions: [] },
        "list",
      ),
    status(403),
  );

  // Verify default catalog grants for supplier roles without changing catalog/bootstrap.
  const grants: readonly (readonly [string, string])[] =
    INITIAL_ROLE_PERMISSIONS;
  for (const role of [
    "INGREDIENT_SUPPLIER_ADMIN",
    "INGREDIENT_SUPPLIER_STAFF",
  ]) {
    assert(
      grants.some(
        ([r, perm]) =>
          r === role && perm === "ingredient_quality_feedback.view_details",
      ),
    );
    assert(
      grants.some(
        ([r, perm]) =>
          r === role && perm === "ingredient_quality_feedback.respond",
      ),
    );
  }
});
