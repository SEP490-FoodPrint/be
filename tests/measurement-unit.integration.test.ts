import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import express from "express";
import { getPrisma } from "../src/utils/database";
import { bootstrapAuthorization } from "../src/utils/authorization-bootstrap";
import { INITIAL_ROLES } from "../src/constants/permission-catalog";
import { loadPrincipal } from "../src/utils/authorization";
import { createMeasurementUnitRouter } from "../src/modules/measurement-unit/measurement-unit.routes";
import {
  createMeasurementUnitService,
  resolveMeasurementUnit,
} from "../src/modules/measurement-unit/measurement-unit.service";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import {
  validateUnitCreate,
  validateUnitUpdate,
} from "../src/modules/measurement-unit/measurement-unit.validation";

void test("measurement-unit migration and API on explicitly owned cloud test database", async (context) => {
  const target = new URL(
    process.env.DATABASE_URL ?? "postgresql://invalid/invalid",
  );
  assert.match(target.pathname.slice(1), /^foodprint_units_test_[a-f0-9]{32}$/);
  assert.equal(
    target.pathname.slice(1),
    process.env.FOODPRINT_OWNED_UNIT_DATABASE,
  );
  const db = await getPrisma();
  context.after(() => db.$disconnect());
  await context.test(
    "migration backfills aliases without changing legacy quantities and text",
    async () => {
      const client = new Client({ connectionString: target.toString() });
      await client.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "ALTER TABLE foodprint.ingredients DROP COLUMN unit_id; DROP TABLE foodprint.measurement_unit_aliases; DROP TABLE foodprint.measurement_units;",
        );
        const supplier = randomUUID(),
          ingredient = randomUUID();
        await client.query(
          "INSERT INTO foodprint.suppliers(id,name) VALUES($1,'Legacy unit test')",
          [supplier],
        );
        await client.query(
          "INSERT INTO foodprint.ingredients(id,supplier_id,name,default_unit) VALUES($1,$2,'Legacy milk','lít')",
          [ingredient, supplier],
        );
        const schoolId = randomUUID(),
          dishId = randomUUID(),
          entryId = randomUUID(),
          otherId = randomUUID();
        await client.query(
          "INSERT INTO foodprint.schools(id,name) VALUES($1,'Legacy unit school')",
          [schoolId],
        );
        await client.query(
          "INSERT INTO foodprint.dishes(id,school_id,name) VALUES($1,$2,'Legacy dish')",
          [dishId, schoolId],
        );
        await client.query(
          "INSERT INTO foodprint.ingredient_entries(id,school_id,ingredient_id,handling_type) VALUES($1,$2,$3,'DIRECT_USE')",
          [entryId, schoolId, ingredient],
        );
        await client.query(
          "INSERT INTO foodprint.dish_ingredient_entries(dish_id,ingredient_entry_id,ingredient_role,required_quantity,unit) VALUES($1,$2,'MAIN',0.65,'lít')",
          [dishId, entryId],
        );
        await client.query(
          "INSERT INTO foodprint.ingredients(id,supplier_id,name,default_unit) VALUES($1,$2,'Legacy unknown unit','đơn vị lạ')",
          [otherId, supplier],
        );
        const migration = await readFile(
          "prisma/migrations/20261126000100_measurement_units/migration.sql",
          "utf8",
        );
        await client.query(
          migration.replace(/^BEGIN;\s*/, "").replace(/COMMIT;\s*$/, ""),
        );
        const result = await client.query<{
          default_unit: string;
          code: string;
          step: string;
        }>(
          "SELECT i.default_unit,u.code,u.recommended_step::text AS step FROM foodprint.ingredients i JOIN foodprint.measurement_units u ON u.id=i.unit_id WHERE i.id=$1",
          [ingredient],
        );
        assert.equal(result.rows[0].default_unit, "lít");
        assert.equal(result.rows[0].code, "l");
        assert.equal(result.rows[0].step, "0.100");
        const recipe = await client.query<{ quantity: string; unit: string }>(
          "SELECT required_quantity::text AS quantity,unit FROM foodprint.dish_ingredient_entries WHERE dish_id=$1",
          [dishId],
        );
        assert.deepEqual(recipe.rows[0], { quantity: "0.650", unit: "lít" });
        const unknown = await client.query<{ group: string; step: string }>(
          'SELECT u."group",u.recommended_step::text AS step FROM foodprint.ingredients i JOIN foodprint.measurement_units u ON u.id=i.unit_id WHERE i.id=$1',
          [otherId],
        );
        assert.deepEqual(unknown.rows[0], { group: "OTHER", step: "0.001" });
      } finally {
        await client.query("ROLLBACK");
        await client.end();
      }
    },
  );
  await context.test(
    "targeted bootstrap creates only the selected permission and preserves other catalog entries",
    async () => {
      const system = INITIAL_ROLES.find((role) => role.code === "SYSTEM_ADMIN");
      assert(system);
      await db.role.create({ data: { ...system } });
      const beforePermissions = await db.permission.findMany({
        select: { id: true, code: true, isActive: true },
        orderBy: { id: "asc" },
      });
      const beforeRoles = await db.role.count();
      const beforeGrants = await db.rolePermission.count();
      await bootstrapAuthorization(db, {
        permissionCodes: ["measurement_unit.manage"],
      });
      assert.equal(await db.permission.count(), beforePermissions.length + 1);
      assert.equal(await db.role.count(), beforeRoles);
      assert.equal(await db.rolePermission.count(), beforeGrants + 1);
      assert.deepEqual(
        await db.permission.findMany({
          where: { id: { in: beforePermissions.map((p) => p.id) } },
          select: { id: true, code: true, isActive: true },
          orderBy: { id: "asc" },
        }),
        beforePermissions,
      );
      await assert.rejects(
        bootstrapAuthorization(db, { permissionCodes: ["unknown.test"] }),
      );
    },
  );
  await bootstrapAuthorization(db);
  const school = await db.school.create({
    data: { name: "Units test school", status: "ACTIVE" },
  });
  const supplier = await db.supplier.create({
    data: { name: "Units test supplier" },
  });
  async function user(
    code: string,
    scope: { schoolId?: string; supplierId?: string } = {},
  ) {
    const role = await db.role.findUniqueOrThrow({ where: { code } });
    const id = randomUUID();
    return db.user.create({
      data: {
        id,
        roleId: role.id,
        roleCode: role.code,
        username: "unit_" + id,
        email: id + "@example.test",
        passwordHash: "test-only",
        fullName: code,
        status: "ACTIVE",
        ...scope,
      },
    });
  }
  const adminUser = await user("SYSTEM_ADMIN"),
    schoolUser = await user("SCHOOL_KITCHEN_STAFF", { schoolId: school.id }),
    supplierUser = await user("INGREDIENT_SUPPLIER_ADMIN", {
      supplierId: supplier.id,
    });
  const actors = await Promise.all(
    [adminUser, schoolUser, supplierUser].map((u) => loadPrincipal(u.id, db)),
  );
  const service = createMeasurementUnitService(() => Promise.resolve(db));
  const app = express();
  app.use(express.json());
  app.use(
    "/api/measurement-units",
    createMeasurementUnitRouter((req, res, next) => {
      const index = req.headers["x-test-actor"];
      if (typeof index !== "string") {
        res.status(401).json({ message: "Unauthenticated" });
        return;
      }
      req.auth = actors[Number(index)];
      next();
    }, service),
  );
  app.use(globalErrorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  context.after(() => new Promise<void>((r) => server.close(() => r())));
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/measurement-units`;
  const payload = {
    code: "test-count",
    name: "Đơn vị kiểm thử",
    symbol: "testpiece",
    group: "COUNT",
    recommendedStep: "0.5",
    aliases: ["testalias"],
  };
  let unitId = "";
  await context.test(
    "reads require login only; writes require system admin and live permission",
    async () => {
      assert.equal((await fetch(base)).status, 401);
      for (const actor of [1, 2]) {
        const response = await fetch(base, {
          headers: { "x-test-actor": String(actor) },
        });
        assert.equal(response.status, 200);
        assert.equal(
          (
            await fetch(base, {
              method: "POST",
              headers: {
                "x-test-actor": String(actor),
                "content-type": "application/json",
              },
              body: JSON.stringify(payload),
            })
          ).status,
          403,
        );
      }
      const response = await fetch(base, {
        method: "POST",
        headers: { "x-test-actor": "0", "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      assert.equal(response.status, 201);
      const result = (await response.json()) as {
        data: { id: string; recommendedStep: string };
      };
      unitId = result.data.id;
      assert.equal(result.data.recommendedStep, "0.5");
    },
  );
  await context.test(
    "duplicate alias rolls back and immutable update fails",
    async () => {
      const before = await db.measurementUnit.count();
      await assert.rejects(
        service.create(
          validateUnitCreate({
            ...payload,
            code: "test-other",
            symbol: "other",
          }),
          actors[0],
        ),
        { statusCode: 409 },
      );
      assert.equal(await db.measurementUnit.count(), before);
      assert.throws(() => validateUnitUpdate({ symbol: "changed" }), {
        statusCode: 400,
      });
      const updated = await service.update(
        { id: unitId },
        validateUnitUpdate({ recommendedStep: "0.25", status: "INACTIVE" }),
        actors[0],
      );
      assert.equal(updated.recommendedStep, "0.25");
      await db.$transaction(async (tx) => {
        await assert.rejects(resolveMeasurementUnit(tx, "testalias"), {
          statusCode: 422,
        });
        assert.equal(
          (await resolveMeasurementUnit(tx, "testalias", true)).id,
          unitId,
        );
      });
      const active = await service.list(
        {
          page: 1,
          limit: 100,
          status: "ACTIVE",
        },
        actors[0],
      );
      assert(!active.items.some((u) => u.id === unitId));
      assert.equal(
        (await service.get({ id: unitId }, actors[0])).status,
        "INACTIVE",
      );
    },
  );
  await context.test(
    "permission revoked after request principal is loaded is rechecked before write",
    async () => {
      const permission = await db.permission.findUniqueOrThrow({
        where: { code: "measurement_unit.manage" },
      });
      await db.permission.update({
        where: { id: permission.id },
        data: { isActive: false },
      });
      await assert.rejects(
        service.update({ id: unitId }, { name: "Must not save" }, actors[0]),
        { statusCode: 403 },
      );
      assert.equal(
        (await db.measurementUnit.findUniqueOrThrow({ where: { id: unitId } }))
          .name,
        payload.name,
      );
    },
  );
});
