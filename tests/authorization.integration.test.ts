import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { MemoryStore } from "express-rate-limit";
import { createApp } from "../src/app";
import { createApiRateLimiter } from "../src/middlewares/rate-limit.middleware";
import { bootstrapAuthorization } from "../src/utils/authorization-bootstrap";
import { loadPrincipal } from "../src/utils/authorization";
import { getPrisma } from "../src/utils/database";
import { assertLocalMigrationTarget } from "../src/utils/migration-target";
import { signToken, verifyToken } from "../src/utils/jwt";
import { startHttp } from "./helpers/http";

const run = promisify(execFile);
const root = path.resolve(__dirname, "..");
function record(value: unknown): Record<string, unknown> {
  assert(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function rows(value: unknown): Record<string, unknown>[] {
  const data = record(record(value).data);
  assert(Array.isArray(data.items));
  return data.items.map((item: unknown) => record(item));
}

void test("authorization with real PostgreSQL, scoped HTTP APIs and concurrent admin writes", async (context) => {
  const base = process.env.MIGRATION_TEST_DATABASE_URL;
  assert(
    base,
    "Set MIGRATION_TEST_DATABASE_URL to a disposable local PostgreSQL instance",
  );
  const target = assertLocalMigrationTarget(base);
  assert.match(target.pathname, /^\/foodprint_migration_test(?:_[a-z0-9_]+)?$/);
  const owner = new Client({ connectionString: base });
  await owner.connect();
  const name =
    "foodprint_authorization_test_" + randomUUID().replaceAll("-", "");
  await owner.query('CREATE DATABASE "' + name + '"');
  await owner.end();
  const fresh = new URL(base);
  fresh.pathname = "/" + name;
  process.env.DATABASE_URL = fresh.toString();
  process.env.JWT_SECRET = "foodprint-authorization-integration-test-only";
  process.env.NODE_ENV = "test";
  await run(
    process.execPath,
    [
      path.join(root, "node_modules/prisma/build/index.js"),
      "migrate",
      "deploy",
    ],
    { cwd: root, env: { ...process.env, DATABASE_URL: fresh.toString() } },
  );
  const db = await getPrisma();
  context.after(() => db.$disconnect());
  await bootstrapAuthorization(db);
  const role = async (code: string) =>
    db.role.findUniqueOrThrow({ where: { code } });
  const permission = async (code: string) =>
    db.permission.findUniqueOrThrow({ where: { code } });
  const password = "auth-test-password";
  const passwordHash = await bcrypt.hash(password, 10);
  const schoolA = await db.school.create({ data: { name: "School A" } });
  const schoolB = await db.school.create({ data: { name: "School B" } });
  const supplierA = await db.supplier.create({ data: { name: "Supplier A" } });
  const supplierB = await db.supplier.create({ data: { name: "Supplier B" } });
  const unitA = await db.communeFoodSafetyUnit.create({
    data: { code: "UNIT_A", name: "Unit A" },
  });
  const unitB = await db.communeFoodSafetyUnit.create({
    data: { code: "UNIT_B", name: "Unit B" },
  });
  async function user(
    code: string,
    scope: {
      schoolId?: string;
      supplierId?: string;
      communeFoodSafetyUnitId?: string;
    } = {},
  ) {
    const r = await role(code);
    const username = "user_" + randomUUID().replaceAll("-", "");
    return db.user.create({
      data: {
        roleId: r.id,
        roleCode: r.code,
        username,
        email: username + "@example.test",
        passwordHash,
        fullName: code,
        status: "ACTIVE",
        ...scope,
      },
    });
  }
  const system = await user("SYSTEM_ADMIN");
  const adminA = await user("SCHOOL_ADMINISTRATION", { schoolId: schoolA.id });
  const adminB = await user("SCHOOL_ADMINISTRATION", { schoolId: schoolB.id });
  const staffA = await user("SCHOOL_HEALTH_OFFICER", { schoolId: schoolA.id });
  const staffB = await user("SCHOOL_HEALTH_OFFICER", { schoolId: schoolB.id });
  const supplierAdmin = await user("INGREDIENT_SUPPLIER_ADMIN", {
    supplierId: supplierA.id,
  });
  const supplierStaffA = await user("INGREDIENT_SUPPLIER_STAFF", {
    supplierId: supplierA.id,
  });
  const supplierStaffB = await user("INGREDIENT_SUPPLIER_STAFF", {
    supplierId: supplierB.id,
  });
  const officerA = await user("COMMUNE_FOOD_SAFETY_OFFICER", {
    communeFoodSafetyUnitId: unitA.id,
  });
  const officerB = await user("COMMUNE_FOOD_SAFETY_OFFICER", {
    communeFoodSafetyUnitId: unitB.id,
  });
  const menuA = await db.weeklyMenu.create({
    data: {
      schoolId: schoolA.id,
      createdByUserId: staffA.id,
      weekStartDate: new Date("2026-10-26"),
      title: "Menu A",
    },
  });
  const menuB = await db.weeklyMenu.create({
    data: {
      schoolId: schoolB.id,
      createdByUserId: staffB.id,
      weekStartDate: new Date("2026-10-26"),
      title: "Menu B",
    },
  });
  const ingredientA = await db.ingredient.create({
    data: { supplierId: supplierA.id, name: "Ingredient A", defaultUnit: "kg" },
  });
  await db.ingredient.create({
    data: { supplierId: supplierB.id, name: "Ingredient B", defaultUnit: "kg" },
  });
  const incidentA = await db.foodSafetyIncident.create({
    data: {
      schoolId: schoolA.id,
      title: "Incident A",
      description: "Incident A test",
    },
  });
  const incidentB = await db.foodSafetyIncident.create({
    data: {
      schoolId: schoolB.id,
      title: "Incident B",
      description: "Incident B test",
    },
  });
  const reportA = await db.foodSafetyReportForwarding.create({
    data: {
      incidentId: incidentA.id,
      recipientCommuneFoodSafetyUnitId: unitA.id,
      recipientName: "Unit A",
      recipientOrganization: "Unit A",
    },
  });
  await db.foodSafetyReportForwarding.create({
    data: {
      incidentId: incidentB.id,
      recipientCommuneFoodSafetyUnitId: unitB.id,
      recipientName: "Unit B",
      recipientOrganization: "Unit B",
    },
  });
  const store = new MemoryStore();
  const http = await startHttp(
    createApp(createApiRateLimiter(store, { windowMs: 60_000, limit: 5000 })),
  );
  context.after(async () => {
    await http.close();
    store.shutdown();
  });
  context.mock.method(console, "error", () => undefined);
  const headers = (id: string) => ({
    Authorization: "Bearer " + signToken({ sub: id }),
    "Content-Type": "application/json",
  });
  const request = (url: string, id: string, method = "GET", body?: unknown) =>
    http.request(url, {
      method,
      headers: headers(id),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  async function grantIds(roleId: string) {
    return (await db.rolePermission.findMany({ where: { roleId } })).map(
      (row) => row.permissionId,
    );
  }

  await context.test(
    "login validates password and active account; JWT carries identity without cached grants",
    async () => {
      const response = await http.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: system.username, password }),
      });
      assert.equal(response.status, 200);
      const data = record(record(response.body).data);
      assert(typeof data.accessToken === "string");
      const claims = verifyToken(data.accessToken);
      assert.equal(claims.sub, system.id);
      assert(!("role" in claims));
      assert(!("permissions" in claims));
      for (const identifier of [system.username, "unknown-user"]) {
        const rejected = await http.request("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifier, password: "wrong-password" }),
        });
        assert.equal(rejected.status, 401);
      }
      assert.equal((await request("/api/auth/me", system.id)).status, 200);
      assert.equal(
        (await request("/api/menus", system.id)).status,
        403,
        "System Admin has no implicit menu grant",
      );
      const forged = await http.request("/api/permissions", {
        headers: {
          Authorization:
            "Bearer " +
            signToken({
              sub: staffA.id,
              role: "SYSTEM_ADMIN",
              orgType: "SYSTEM",
            }),
        },
      });
      assert.equal(forged.status, 403);
    },
  );
  await context.test(
    "catalog create is System-only and own System role cannot be edited",
    async () => {
      const body = {
        code: "menu.export",
        name: "Export menu",
        module: "menu",
        action: "export",
      };
      assert.equal(
        (await request("/api/permissions", adminA.id, "POST", body)).status,
        403,
      );
      assert.equal(
        (await request("/api/permissions", system.id, "POST", body)).status,
        201,
      );
      assert.equal(
        (await request("/api/permissions", system.id, "POST", body)).status,
        409,
      );
      const before = await grantIds(system.roleId);
      assert.equal(
        (
          await request(
            "/api/roles/" + system.roleId + "/permissions",
            system.id,
            "PUT",
            { permissionIds: [] },
          )
        ).status,
        403,
      );
      assert.deepEqual(await grantIds(system.roleId), before);
      assert.equal((await request("/api/permissions", system.id)).status, 200);
    },
  );
  const view = await permission("menu.view");
  const roleUrl = "/api/roles/" + staffA.roleId + "/permissions";
  const denyA = "/api/users/" + staffA.id + "/permission-denials/" + view.id;
  await context.test(
    "System Admin loses access when an assigned management permission is absent",
    async () => {
      const create = await permission("permission.create");
      await db.rolePermission.deleteMany({
        where: { roleId: system.roleId, permissionId: create.id },
      });
      assert.equal(
        (
          await request("/api/permissions", system.id, "POST", {
            code: "menu.blocked",
            name: "Blocked",
            module: "menu",
            action: "blocked",
          })
        ).status,
        403,
      );
      await db.rolePermission.create({
        data: { roleId: system.roleId, permissionId: create.id },
      });
      assert.equal(
        (
          await request(
            "/api/users/" + randomUUID() + "/permissions",
            adminA.id,
          )
        ).status,
        404,
      );
    },
  );
  await context.test(
    "scoped menu reads exclude other schools and refuse client-selected organization filters",
    async () => {
      const a = await request("/api/menus", staffA.id);
      const b = await request("/api/menus", staffB.id);
      assert.equal(a.status, 200);
      assert.equal(b.status, 200);
      assert.deepEqual(
        rows(a.body).map((row) => row.id),
        [menuA.id],
      );
      assert.deepEqual(
        rows(b.body).map((row) => row.id),
        [menuB.id],
      );
      assert.equal(
        (await request("/api/menus?schoolId=" + schoolB.id, staffA.id)).status,
        400,
      );
    },
  );
  await context.test(
    "organization admins cannot edit global grants, grant outside a role or affect another organization",
    async () => {
      assert.equal(
        (await request(roleUrl, adminA.id, "PUT", { permissionIds: [] }))
          .status,
        403,
      );
      assert.equal((await request(denyA, adminB.id, "PUT")).status, 404);
      const unrelated = await permission("supplier.manage");
      assert.equal(
        (
          await request(
            "/api/users/" + staffA.id + "/permission-denials/" + unrelated.id,
            adminA.id,
            "PUT",
          )
        ).status,
        400,
      );
      await db.user.update({
        where: { id: staffB.id },
        data: { status: "LOCKED" },
      });
      assert.equal(
        (await request("/api/users/" + staffB.id + "/permissions", adminA.id))
          .status,
        404,
      );
      assert.equal(
        (
          await request(
            "/api/users/" + staffB.id + "/permission-denials/" + view.id,
            adminA.id,
            "PUT",
          )
        ).status,
        404,
      );
      await db.user.update({
        where: { id: staffB.id },
        data: { status: "ACTIVE" },
      });
      assert.equal(await db.userPermissionDenial.count(), 0);
    },
  );
  await context.test(
    "concurrent disable is idempotent, affects the next request, and enable removes the denial",
    async () => {
      const results = await Promise.all([
        request(denyA, adminA.id, "PUT"),
        request(denyA, adminA.id, "PUT"),
      ]);
      assert(results.every((r) => r.status === 200));
      assert.equal(
        await db.userPermissionDenial.count({
          where: { userId: staffA.id, permissionId: view.id },
        }),
        1,
      );
      assert.equal((await request("/api/menus", staffA.id)).status, 403);
      assert.equal((await request("/api/menus", staffB.id)).status, 200);
      assert.equal((await request(denyA, adminA.id, "DELETE")).status, 200);
      assert.equal((await request(denyA, adminA.id, "DELETE")).status, 200);
      assert.equal(await db.userPermissionDenial.count(), 0);
      assert.equal((await request("/api/menus", staffA.id)).status, 200);
    },
  );
  await context.test(
    "global role edits affect both schools while preserving per-account exceptions",
    async () => {
      assert.equal((await request(denyA, adminA.id, "PUT")).status, 200);
      const grants = await grantIds(staffA.roleId);
      assert.equal(
        (
          await request(roleUrl, system.id, "PUT", {
            permissionIds: grants.filter((id) => id !== view.id),
          })
        ).status,
        200,
      );
      assert.equal((await request("/api/menus", staffA.id)).status, 403);
      assert.equal((await request("/api/menus", staffB.id)).status, 403);
      assert.equal(
        (await request(roleUrl, system.id, "PUT", { permissionIds: grants }))
          .status,
        200,
      );
      assert.equal((await request("/api/menus", staffA.id)).status, 403);
      assert.equal((await request("/api/menus", staffB.id)).status, 200);
      assert.equal((await request(denyA, adminA.id, "DELETE")).status, 200);
      await bootstrapAuthorization(db);
      await db.rolePermission.deleteMany({
        where: { roleId: staffA.roleId, permissionId: view.id },
      });
      await bootstrapAuthorization(db);
      assert.equal(
        await db.rolePermission.count({
          where: { roleId: staffA.roleId, permissionId: view.id },
        }),
        0,
        "bootstrap must not undo runtime role edits",
      );
      await db.rolePermission.create({
        data: { roleId: staffA.roleId, permissionId: view.id },
      });
    },
  );
  await context.test(
    "supplier reads and denials remain isolated to their supplier",
    async () => {
      const ingredientView = await permission("ingredient.view");
      const grants = await grantIds(supplierStaffA.roleId);
      assert.equal(
        (
          await request(
            "/api/roles/" + supplierStaffA.roleId + "/permissions",
            system.id,
            "PUT",
            { permissionIds: [...grants, ingredientView.id] },
          )
        ).status,
        200,
      );
      const response = await request("/api/ingredients", supplierStaffA.id);
      assert.equal(response.status, 200);
      assert.deepEqual(
        rows(response.body).map((row) => row.id),
        [ingredientA.id],
      );
      const url =
        "/api/users/" +
        supplierStaffA.id +
        "/permission-denials/" +
        ingredientView.id;
      assert.equal((await request(url, supplierAdmin.id, "PUT")).status, 200);
      assert.equal(
        (await request("/api/ingredients", supplierStaffA.id)).status,
        403,
      );
      assert.equal(
        (await request("/api/ingredients", supplierStaffB.id)).status,
        200,
      );
      assert.equal(
        (
          await request(
            "/api/users/" +
              supplierStaffB.id +
              "/permission-denials/" +
              ingredientView.id,
            supplierAdmin.id,
            "PUT",
          )
        ).status,
        404,
      );
    },
  );
  await context.test(
    "authority sees only forwarded reports and never gains permission-administration functions",
    async () => {
      const result = await request("/api/food-safety-reports", officerA.id);
      assert.equal(result.status, 200);
      assert.deepEqual(
        rows(result.body).map((row) => row.id),
        [reportA.id],
      );
      assert.deepEqual(
        rows(
          (await request("/api/food-safety-incidents", officerA.id)).body,
        ).map((row) => row.id),
        [incidentA.id],
      );
      assert.equal(
        rows((await request("/api/food-safety-reports", officerB.id)).body)
          .length,
        1,
      );
      const adminPerms = await db.permission.findMany({
        where: {
          code: {
            in: [
              "permission.create",
              "role_permission.manage",
              "school_user.manage",
              "supplier_staff.manage",
            ],
          },
        },
      });
      await db.rolePermission.createMany({
        data: adminPerms.map((p) => ({
          roleId: officerA.roleId,
          permissionId: p.id,
        })),
        skipDuplicates: true,
      });
      assert.equal((await request(denyA, officerA.id, "PUT")).status, 403);
      assert.equal(
        (await request(roleUrl, officerA.id, "PUT", { permissionIds: [] }))
          .status,
        403,
      );
      assert.equal(
        (
          await request("/api/permissions", officerA.id, "POST", {
            code: "menu.test",
            name: "test",
            module: "menu",
            action: "test",
          })
        ).status,
        403,
      );
    },
  );
  await context.test(
    "inactive users and inactive permissions are rejected without changing existing tokens",
    async () => {
      const token = headers(staffA.id);
      await db.user.update({
        where: { id: staffA.id },
        data: { status: "LOCKED" },
      });
      assert.equal(
        (await http.request("/api/menus", { headers: token })).status,
        403,
      );
      await db.user.update({
        where: { id: staffA.id },
        data: { status: "ACTIVE" },
      });
      await db.permission.update({
        where: { id: view.id },
        data: { isActive: false },
      });
      assert.equal(
        (await http.request("/api/menus", { headers: token })).status,
        403,
      );
      await db.permission.update({
        where: { id: view.id },
        data: { isActive: true },
      });
      assert.equal(
        (await http.request("/api/menus", { headers: token })).status,
        200,
      );
    },
  );
  await context.test(
    "SQL permits multiple staff and enforces one admin even under concurrent inserts",
    async () => {
      await assert.rejects(() =>
        user("SCHOOL_ADMINISTRATION", { schoolId: schoolA.id }),
      );
      await assert.rejects(() =>
        user("INGREDIENT_SUPPLIER_ADMIN", { supplierId: supplierA.id }),
      );
      const schoolC = await db.school.create({
        data: { name: "Concurrent school" },
      });
      const result = await Promise.allSettled([
        user("SCHOOL_ADMINISTRATION", { schoolId: schoolC.id }),
        user("SCHOOL_ADMINISTRATION", { schoolId: schoolC.id }),
      ]);
      assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
      const failure: unknown = result.find(
        (entry) => entry.status === "rejected",
      )?.reason;
      assert(
        failure &&
          typeof failure === "object" &&
          "code" in failure &&
          failure.code === "P2002",
      );
      assert.equal(
        await db.user.count({
          where: { schoolId: schoolC.id, roleCode: "SCHOOL_ADMINISTRATION" },
        }),
        1,
      );
      await Promise.all([
        user("SCHOOL_KITCHEN_STAFF", { schoolId: schoolC.id }),
        user("SCHOOL_KITCHEN_STAFF", { schoolId: schoolC.id }),
      ]);
      const pendingRole = await role("INGREDIENT_SUPPLIER_ADMIN");
      const pending = await db.user.create({
        data: {
          roleId: pendingRole.id,
          roleCode: pendingRole.code,
          username: "pending_supplier",
          email: "pending_supplier@example.test",
          passwordHash,
          fullName: "Pending applicant",
          status: "UNVERIFIED",
        },
      });
      await assert.rejects(() => loadPrincipal(pending.id));
      await assert.rejects(() =>
        db.user.update({
          where: { id: pending.id },
          data: { status: "ACTIVE" },
        }),
      );
      const r = await role("SCHOOL_KITCHEN_STAFF");
      await assert.rejects(() =>
        db.user.create({
          data: {
            roleId: r.id,
            roleCode: "SCHOOL_ADMINISTRATION",
            schoolId: schoolC.id,
            username: "mismatch",
            email: "mismatch@example.test",
            passwordHash,
            fullName: "Mismatch",
          },
        }),
      );
      assert.equal((await loadPrincipal(staffA.id)).schoolId, schoolA.id);
    },
  );
  await context.test(
    "migration refuses legacy duplicate admins without deleting or reassigning accounts",
    async () => {
      const owner = new Client({ connectionString: base });
      await owner.connect();
      const legacy =
        "foodprint_authorization_legacy_" + randomUUID().replaceAll("-", "");
      await owner.query('CREATE DATABASE "' + legacy + '"');
      await owner.end();
      const legacyUrl = new URL(base);
      legacyUrl.pathname = "/" + legacy;
      const sql = new Client({ connectionString: legacyUrl.toString() });
      await sql.connect();
      try {
        await sql.query(
          await readFile(
            path.join(root, "prisma/migrations/0_init/migration.sql"),
            "utf8",
          ),
        );
        await sql.query("SET search_path TO foodprint, public");
        await sql.query(
          "INSERT INTO roles(code,name,type) VALUES ('SCHOOL_ADMINISTRATION','Admin','SCHOOL')",
        );
        await sql.query("INSERT INTO schools(name) VALUES ('Legacy school')");
        await sql.query(
          "INSERT INTO users(role_id,school_id,username,email,password_hash,full_name) SELECT r.id,s.id,v,v||'@example.test','preserved-test-hash','Legacy admin' FROM roles r CROSS JOIN schools s CROSS JOIN unnest(ARRAY['legacy_a','legacy_b']) v",
        );
        const migration = await readFile(
          path.join(
            root,
            "prisma/migrations/20261029000200_single_organization_admin/migration.sql",
          ),
          "utf8",
        );
        await assert.rejects(
          () => sql.query(migration),
          (error: unknown) =>
            error !== null &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "23505",
        );
        await sql.query("ROLLBACK");
        const remaining = await sql.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM users WHERE password_hash='preserved-test-hash'",
        );
        assert.equal(remaining.rows[0].count, 2);
        const columns = await sql.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema='foodprint' AND table_name='users' AND column_name='role_code'",
        );
        assert.equal(
          columns.rows[0].count,
          0,
          "failed migration must roll back the column/backfill as well",
        );
      } finally {
        await sql.query("ROLLBACK");
        await sql.end();
      }
    },
  );
});
