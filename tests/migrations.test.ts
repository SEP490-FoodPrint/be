import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { Client } from "pg";
import { verifyBaseline } from "../src/utils/migration-baseline";
import { assertLocalMigrationTarget } from "../src/utils/migration-target";

const root = path.resolve(__dirname, "..");
const execute = promisify(execFile);

function sqlState(error: unknown, code: string, constraint?: string): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === code &&
    (constraint === undefined ||
      ("constraint" in error && error.constraint === constraint))
  );
}

function runPrisma(url: string, args: string[]) {
  return execute(
    process.execPath,
    [path.join(root, "node_modules/prisma/build/index.js"), ...args],
    {
      cwd: root,
      env: {
        ...process.env,
        DATABASE_URL: url,
        PRISMA_HIDE_UPDATE_MESSAGE: "1",
        HUSKY: "0",
      },
      timeout: 60_000,
    },
  );
}

void test("versioned migrations on a fresh disposable local PostgreSQL database", async (context) => {
  const url = process.env.MIGRATION_TEST_DATABASE_URL;
  assert(
    url,
    "Set MIGRATION_TEST_DATABASE_URL to a fresh disposable local test database",
  );
  const target = assertLocalMigrationTarget(url);
  assert.match(target.pathname, /^\/foodprint_migration_test(?:_[a-z0-9_]+)?$/);
  const migrationNames = (
    await readdir(path.join(root, "prisma/migrations"), { withFileTypes: true })
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const db = new Client({ connectionString: url });
  await db.connect();
  context.after(() => db.end());
  assert.equal(
    (
      await db.query<{ name: string | null }>(
        "SELECT to_regnamespace('foodprint')::text AS name",
      )
    ).rows[0].name,
    null,
    "Test database must be fresh; existing schemas are never dropped/reset",
  );

  const readCatalog = async () => {
    await db.query("BEGIN READ ONLY");
    try {
      await db.query("SET LOCAL search_path TO pg_catalog, public");
      await verifyBaseline(
        async (sql) => (await db.query<Record<string, unknown>>(sql)).rows,
      );
    } finally {
      await db.query("ROLLBACK");
    }
  };

  await context.test(
    "baseline replays all existing constraints and matches its catalog manifest",
    async () => {
      await db.query(
        await readFile(
          path.join(root, "prisma/migrations/0_init/migration.sql"),
          "utf8",
        ),
      );
      await readCatalog();
      assert.equal(
        (
          await db.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM foodprint.roles",
          )
        ).rows[0].count,
        0,
        "Baseline must not load configuration seeds or mock/business data",
      );
    },
  );

  await context.test(
    "baseline verification detects missing CHECKs even though Prisma schema diff omits them",
    async () => {
      await db.query("BEGIN");
      try {
        await db.query("SET LOCAL search_path TO pg_catalog, public");
        await db.query(
          "ALTER TABLE foodprint.permissions DROP CONSTRAINT chk_permission_code_format",
        );
        await assert.rejects(
          () =>
            verifyBaseline(
              async (sql) =>
                (await db.query<Record<string, unknown>>(sql)).rows,
            ),
          /Database khác baseline ở: constraints/,
        );
      } finally {
        await db.query("ROLLBACK");
      }
      await readCatalog();
    },
  );

  let schoolId: string;
  await context.test(
    "adopting the existing baseline does not replay its DDL or change existing records",
    async () => {
      schoolId = (
        await db.query<{ id: string }>(
          "INSERT INTO foodprint.schools (name) VALUES ('Migration test marker') RETURNING id",
        )
      ).rows[0].id;
      await runPrisma(url, ["migrate", "resolve", "--applied", "0_init"]);
      await readCatalog();
      assert.equal(
        (
          await db.query<{ name: string | null }>(
            "SELECT to_regclass('foodprint.user_permission_denials')::text AS name",
          )
        ).rows[0].name,
        null,
      );
      await runPrisma(url, ["migrate", "deploy"]);
      const history = await db.query<{
        migration_name: string;
        finished_at: Date | null;
      }>(
        "SELECT migration_name,finished_at FROM foodprint._prisma_migrations ORDER BY migration_name",
      );
      assert.deepEqual(
        history.rows.map((row) => row.migration_name),
        migrationNames,
      );
      assert(history.rows.every((row) => row.finished_at !== null));
      assert.equal(
        (
          await db.query<{ name: string }>(
            "SELECT name FROM foodprint.schools WHERE id=$1",
            [schoolId],
          )
        ).rows[0].name,
        "Migration test marker",
      );
      await runPrisma(url, ["migrate", "deploy"]);
      await runPrisma(url, ["migrate", "status"]);
      await runPrisma(url, [
        "migrate",
        "diff",
        "--from-config-datasource",
        "--to-schema",
        "prisma/schema.prisma",
        "--exit-code",
      ]);
    },
  );

  await context.test(
    "the scoped-denial CHECK and partial unique indexes enforce INSERT and UPDATE",
    async () => {
      const role = (
        await db.query<{ id: string }>(
          "INSERT INTO foodprint.roles(code,name,type) VALUES ('MIGRATION_TEST','Migration test','SCHOOL') RETURNING id",
        )
      ).rows[0].id;
      const permission = (
        await db.query<{ id: string }>(
          "INSERT INTO foodprint.permissions(code,name,module,action) VALUES ('migration_test.view','Migration test','migration_test','view') RETURNING id",
        )
      ).rows[0].id;
      const user = (
        await db.query<{ id: string }>(
          "INSERT INTO foodprint.users(role_id,school_id,username,email,password_hash,full_name) VALUES ($1,$2,'migration_test','migration-test@example.test','test-only-not-a-login','Migration test') RETURNING id",
          [role, schoolId],
        )
      ).rows[0].id;
      const supplier = (
        await db.query<{ id: string }>(
          "INSERT INTO foodprint.suppliers(name) VALUES ('Migration test supplier') RETURNING id",
        )
      ).rows[0].id;
      const unit = (
        await db.query<{ id: string }>(
          "INSERT INTO foodprint.commune_food_safety_units(code,name) VALUES ('MIGRATION_TEST','Migration test unit') RETURNING id",
        )
      ).rows[0].id;
      const organizations = [schoolId, supplier, unit];
      const valid = new Map<number, string>();
      const checkName = "chk_user_permission_denials_exactly_one_organization";
      for (let mask = 0; mask < 8; mask++) {
        const orgs = organizations.map((id, index) =>
          mask & (1 << index) ? id : null,
        );
        const insert = () =>
          db.query<{ id: string }>(
            "INSERT INTO foodprint.user_permission_denials(user_id,permission_id,school_id,supplier_id,commune_food_safety_unit_id,disabled_by_user_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
            [user, permission, ...orgs, user],
          );
        if ([1, 2, 4].includes(mask))
          valid.set(mask, (await insert()).rows[0].id);
        else
          await assert.rejects(insert, (error: unknown) =>
            sqlState(error, "23514", checkName),
          );
      }
      for (const mask of [0, 3, 5, 6, 7]) {
        const orgs = organizations.map((id, index) =>
          mask & (1 << index) ? id : null,
        );
        await assert.rejects(
          () =>
            db.query(
              "UPDATE foodprint.user_permission_denials SET school_id=$1,supplier_id=$2,commune_food_safety_unit_id=$3 WHERE id=$4",
              [...orgs, valid.get(1)],
            ),
          (error: unknown) => sqlState(error, "23514", checkName),
        );
      }
      for (const mask of [1, 2, 4]) {
        const orgs = organizations.map((id, index) =>
          mask & (1 << index) ? id : null,
        );
        await assert.rejects(
          () =>
            db.query(
              "INSERT INTO foodprint.user_permission_denials(user_id,permission_id,school_id,supplier_id,commune_food_safety_unit_id,disabled_by_user_id) VALUES($1,$2,$3,$4,$5,$6)",
              [user, permission, ...orgs, user],
            ),
          (error: unknown) => sqlState(error, "23505"),
        );
      }
      const check = await db.query<{ convalidated: boolean }>(
        "SELECT convalidated FROM pg_constraint WHERE conrelid='foodprint.user_permission_denials'::regclass AND conname=$1",
        [checkName],
      );
      assert.equal(check.rows[0].convalidated, true);
    },
  );

  await context.test(
    "migrate deploy builds an entirely empty database with both migrations",
    async () => {
      const name = `foodprint_migration_test_fresh_${randomUUID().replaceAll("-", "")}`;
      await db.query(`CREATE DATABASE "${name}"`);
      const fresh = new URL(url);
      fresh.pathname = `/${name}`;
      await runPrisma(fresh.toString(), ["migrate", "deploy"]);
      await runPrisma(fresh.toString(), ["migrate", "status"]);
      await runPrisma(fresh.toString(), [
        "migrate",
        "diff",
        "--from-config-datasource",
        "--to-schema",
        "prisma/schema.prisma",
        "--exit-code",
      ]);
      // This database belongs to the disposable test instance; no database/volume is dropped by tests.
    },
  );
});
