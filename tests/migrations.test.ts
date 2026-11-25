import { recordLocalTestDatabase } from "./helpers/local-test-database";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { Client } from "pg";
import { verifyBaseline } from "../src/utils/migration-baseline";
import {
  pendingDeploymentMigrations,
  readMigrationFiles,
  type MigrationHistoryRow,
} from "../src/utils/migration-deployment";
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

async function verifySupplierStaffUsernameScope(client: Client) {
  const indexes = (
    await client.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname,indexdef FROM pg_indexes
       WHERE schemaname='foodprint' AND tablename='users'
       AND indexname IN ('uq_users_non_staff_username','uq_users_supplier_username')
       ORDER BY indexname`,
    )
  ).rows;
  assert.deepEqual(
    indexes.map((index) => index.indexname),
    ["uq_users_non_staff_username", "uq_users_supplier_username"],
  );
  assert.match(
    indexes[0].indexdef,
    /UNIQUE.*\(username\).*WHERE.*role_code.*<>.*'INGREDIENT_SUPPLIER_STAFF'/,
  );
  assert.match(
    indexes[1].indexdef,
    /UNIQUE.*\(supplier_id, username\).*WHERE.*supplier_id IS NOT NULL/,
  );
  const constraints = (
    await client.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conrelid='foodprint.users'::regclass
       AND conname IN ('users_username_key','users_email_key') ORDER BY conname`,
    )
  ).rows;
  assert.deepEqual(constraints, [{ conname: "users_email_key" }]);
  assert.equal(
    (
      await client.query<{ name: string | null }>(
        "SELECT to_regclass('foodprint.users_username_key')::text AS name",
      )
    ).rows[0].name,
    null,
  );

  // Keep the collision matrix independent from the outer suite's fixtures.
  await client.query("BEGIN");
  try {
    const suffix = randomUUID().replaceAll("-", "");
    const role = async (code: string, type: string) => {
      await client.query(
        "INSERT INTO foodprint.roles(code,name,type) VALUES ($1,$1,$2::foodprint.role_type) ON CONFLICT (code) DO NOTHING",
        [code, type],
      );
      const row = (
        await client.query<{ id: string; type: string }>(
          "SELECT id,type FROM foodprint.roles WHERE code=$1",
          [code],
        )
      ).rows[0];
      assert.equal(row.type, type);
      return row.id;
    };
    const staffRole = await role("INGREDIENT_SUPPLIER_STAFF", "SUPPLIER");
    const adminRole = await role("INGREDIENT_SUPPLIER_ADMIN", "SUPPLIER");
    const schoolRole = await role("SCHOOL_KITCHEN_STAFF", "SCHOOL");
    const supplierIds: string[] = [];
    const schoolIds: string[] = [];
    for (let index = 0; index < 2; index++) {
      supplierIds.push(
        (
          await client.query<{ id: string }>(
            "INSERT INTO foodprint.suppliers(name) VALUES ($1) RETURNING id",
            [`Username scope supplier ${suffix} ${index}`],
          )
        ).rows[0].id,
      );
      schoolIds.push(
        (
          await client.query<{ id: string }>(
            "INSERT INTO foodprint.schools(name) VALUES ($1) RETURNING id",
            [`Username scope school ${suffix} ${index}`],
          )
        ).rows[0].id,
      );
    }
    let serial = 0;
    const insert = async (input: {
      username: string;
      supplierId?: string;
      schoolId?: string;
      roleCode?: string;
      status?: string;
      email?: string;
    }) => {
      const code = input.roleCode ?? "INGREDIENT_SUPPLIER_STAFF";
      const roleId =
        code === "INGREDIENT_SUPPLIER_ADMIN"
          ? adminRole
          : code === "SCHOOL_KITCHEN_STAFF"
            ? schoolRole
            : staffRole;
      return client.query(
        `INSERT INTO foodprint.users(role_id,role_code,supplier_id,school_id,username,email,password_hash,full_name,status)
         VALUES ($1,$2,$3,$4,$5,$6,'username-scope-preserved-hash','Username scope fixture',$7::foodprint.account_status) RETURNING id`,
        [
          roleId,
          code,
          input.supplierId ?? null,
          input.schoolId ?? null,
          input.username,
          input.email ?? `${suffix}-${serial++}@example.test`,
          input.status ?? "ACTIVE",
        ],
      );
    };
    const rejects = async (
      operation: () => Promise<unknown>,
      constraint: string,
    ) => {
      await client.query("SAVEPOINT username_collision");
      try {
        await assert.rejects(operation, (error) =>
          sqlState(error, "23505", constraint),
        );
      } finally {
        await client.query("ROLLBACK TO SAVEPOINT username_collision");
        await client.query("RELEASE SAVEPOINT username_collision");
      }
    };
    const shared = `shared_${suffix}`;
    await insert({ supplierId: supplierIds[0], username: shared });
    await insert({ supplierId: supplierIds[1], username: shared });
    assert.equal(
      (
        await client.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM foodprint.users WHERE username=$1",
          [shared],
        )
      ).rows[0].count,
      2,
    );

    for (const state of [
      "UNVERIFIED",
      "ACTIVE",
      "INACTIVE",
      "LOCKED",
      "DEACTIVATED",
    ]) {
      const username = `status_${state}_${suffix}`;
      const email = `${state}-${suffix}@example.test`;
      await insert({
        supplierId: supplierIds[0],
        username,
        email,
        status: state,
      });
      await rejects(
        () =>
          insert({ supplierId: supplierIds[0], username, status: "ACTIVE" }),
        "uq_users_supplier_username",
      );
      await insert({ supplierId: supplierIds[1], username, status: state });
      // Citext must reject the same email from another organization and role,
      // even if the account already owning it is not active.
      await rejects(
        () =>
          insert({
            roleCode: "SCHOOL_KITCHEN_STAFF",
            schoolId: schoolIds[0],
            username: `email_collision_${state}_${suffix}`,
            email: email.toUpperCase(),
          }),
        "users_email_key",
      );
    }
    const adminName = `admin_${suffix}`;
    await insert({
      roleCode: "INGREDIENT_SUPPLIER_ADMIN",
      supplierId: supplierIds[0],
      username: adminName,
    });
    await rejects(
      () => insert({ supplierId: supplierIds[0], username: adminName }),
      "uq_users_supplier_username",
    );
    await insert({ supplierId: supplierIds[1], username: adminName });
    const existingStaffName = `staff_first_${suffix}`;
    await insert({ supplierId: supplierIds[1], username: existingStaffName });
    await rejects(
      () =>
        insert({
          roleCode: "INGREDIENT_SUPPLIER_ADMIN",
          supplierId: supplierIds[1],
          username: existingStaffName,
        }),
      "uq_users_supplier_username",
    );
    const schoolName = `school_${suffix}`;
    await insert({
      roleCode: "SCHOOL_KITCHEN_STAFF",
      schoolId: schoolIds[0],
      username: schoolName,
      status: "LOCKED",
    });
    await rejects(
      () =>
        insert({
          roleCode: "SCHOOL_KITCHEN_STAFF",
          schoolId: schoolIds[1],
          username: schoolName,
        }),
      "uq_users_non_staff_username",
    );
    await insert({ supplierId: supplierIds[0], username: schoolName });
    const pendingName = `pending_${suffix}`;
    await insert({
      roleCode: "INGREDIENT_SUPPLIER_ADMIN",
      username: pendingName,
      status: "UNVERIFIED",
    });
    await rejects(
      () =>
        insert({
          roleCode: "INGREDIENT_SUPPLIER_ADMIN",
          username: pendingName,
          status: "UNVERIFIED",
        }),
      "uq_users_non_staff_username",
    );
    await insert({ supplierId: supplierIds[0], username: `Case_${suffix}` });
    await insert({ supplierId: supplierIds[0], username: `case_${suffix}` });

    // UPDATE must enforce the same new keys, not only INSERT.
    await rejects(
      () =>
        client.query(
          "UPDATE foodprint.users SET username=$1 WHERE supplier_id=$2 AND username=$3",
          [shared, supplierIds[0], `Case_${suffix}`],
        ),
      "uq_users_supplier_username",
    );
  } finally {
    await client.query("ROLLBACK");
  }
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
          "INSERT INTO foodprint.schools (name,address) VALUES ('Migration test marker','Preserved legacy address') RETURNING id",
        )
      ).rows[0].id;
      const legacyRole = (
        await db.query<{ id: string }>(
          "INSERT INTO foodprint.roles(code,name,type) VALUES ('MIGRATION_BACKFILL','Backfill','SYSTEM') RETURNING id",
        )
      ).rows[0].id;
      const legacyUser = (
        await db.query<{ id: string }>(
          "INSERT INTO foodprint.users(role_id,username,email,password_hash,full_name) VALUES ($1,'backfill_test','backfill@example.test','preserved-test-hash','Backfill test') RETURNING id",
          [legacyRole],
        )
      ).rows[0].id;
      await runPrisma(url, ["migrate", "resolve", "--applied", "0_init"]);
      await readCatalog();
      const files = await readMigrationFiles();
      const readHistory = async () =>
        (
          await db.query<MigrationHistoryRow>(
            "SELECT migration_name,checksum,finished_at,rolled_back_at FROM foodprint._prisma_migrations",
          )
        ).rows;
      assert.deepEqual(
        pendingDeploymentMigrations(files, await readHistory()),
        migrationNames.slice(1),
      );
      assert.equal(
        (
          await db.query<{ name: string | null }>(
            "SELECT to_regclass('foodprint.user_permission_denials')::text AS name",
          )
        ).rows[0].name,
        null,
      );
      const legacySupplier = (
        await db.query<{ id: string }>(
          "INSERT INTO foodprint.suppliers(name) VALUES ('Category migration fixture') RETURNING id",
        )
      ).rows[0].id;
      const oldCategories = [
        null,
        "",
        "   ",
        "Grains",
        "Grains",
        "grains",
        " Grains ",
      ];
      const legacyIngredientIds: string[] = [];
      for (const [index, category] of oldCategories.entries()) {
        legacyIngredientIds.push(
          (
            await db.query<{ id: string }>(
              "INSERT INTO foodprint.ingredients(supplier_id,name,default_unit,category) VALUES ($1,$2,'kg',$3) RETURNING id",
              [legacySupplier, "Category fixture " + index, category],
            )
          ).rows[0].id,
        );
      }
      const linkedEntry = (
        await db.query<{ id: string }>(
          "INSERT INTO foodprint.ingredient_entries(school_id,ingredient_id,handling_type) VALUES ($1,$2,'DRY_STOCK') RETURNING id",
          [schoolId, legacyIngredientIds[3]],
        )
      ).rows[0].id;
      const otherSupplier = (
        await db.query<{ id: string }>(
          "INSERT INTO foodprint.suppliers(name) VALUES ('Other category supplier') RETURNING id",
        )
      ).rows[0].id;
      const otherIngredient = (
        await db.query<{ id: string }>(
          "INSERT INTO foodprint.ingredients(supplier_id,name,default_unit,category) VALUES ($1,'Other grains','kg','Grains') RETURNING id",
          [otherSupplier],
        )
      ).rows[0].id;
      const categoryFixture = "00000056-0000-4000-8000-000000000004";
      const renamedCategoryFixture = "00000056-0000-4000-8000-000000000008";
      await db.query(
        "INSERT INTO foodprint.dishes(id,school_id,name) VALUES ($1,$3,'Cơm gạo ST25'),($2,$3,'Renamed legacy dish')",
        [categoryFixture, renamedCategoryFixture, schoolId],
      );
      const cleanup = "20261206000100_dish_standard_portion_cleanup";
      const temporary = await mkdtemp(
        path.join(tmpdir(), "foodprint-dish-portion-migrations-"),
      );
      const directory = path.join(temporary, "migrations");
      const config = path.join(temporary, "prisma.config.ts");
      try {
        await mkdir(directory);
        await copyFile(
          path.join(root, "prisma/migrations/migration_lock.toml"),
          path.join(directory, "migration_lock.toml"),
        );
        assert(migrationNames.includes(cleanup));
        for (const migration of migrationNames.slice(
          0,
          migrationNames.indexOf(cleanup),
        )) {
          await mkdir(path.join(directory, migration));
          await copyFile(
            path.join(root, "prisma/migrations", migration, "migration.sql"),
            path.join(directory, migration, "migration.sql"),
          );
        }
        await writeFile(
          config,
          `import { defineConfig } from ${JSON.stringify(path.join(root, "node_modules/prisma/config.js"))};\nexport default defineConfig({ schema: ${JSON.stringify(path.join(root, "prisma/schema.prisma"))}, migrations: { path: ${JSON.stringify(directory)} }, datasource: { url: process.env.DATABASE_URL } });\n`,
        );
        await runPrisma(url, ["migrate", "deploy", "--config", config]);
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
      const cleanupSql = await readFile(
        path.join(root, "prisma/migrations", cleanup, "migration.sql"),
        "utf8",
      );
      try {
        await assert.rejects(db.query(cleanupSql), /còn món chưa có mốc chuẩn/);
      } finally {
        await db.query("ROLLBACK");
      }
      await db.query(
        "UPDATE foodprint.dishes SET standard_quantity=100,standard_unit='g' WHERE id=ANY($1::uuid[])",
        [[categoryFixture, renamedCategoryFixture]],
      );
      await runPrisma(url, ["migrate", "deploy"]);
      const classified = await db.query<{
        id: string;
        category: string | null;
      }>(
        "SELECT id,category FROM foodprint.dishes WHERE id=ANY($1::uuid[]) ORDER BY id",
        [[categoryFixture, renamedCategoryFixture]],
      );
      assert.deepEqual(classified.rows, [
        { id: categoryFixture, category: "RICE_STARCH" },
        { id: renamedCategoryFixture, category: null },
      ]);
      await assert.rejects(
        db.query("UPDATE foodprint.dishes SET category='INVALID' WHERE id=$1", [
          categoryFixture,
        ]),
        (error) => sqlState(error, "22P02"),
      );
      const converted = await db.query<{
        id: string;
        supplier_id: string;
        category_name: string | null;
        cover_image: string | null;
        image_description: string[];
        category_id: string | null;
      }>(
        "SELECT i.id,i.supplier_id,i.category_id,c.category_name,i.cover_image,i.image_description FROM foodprint.ingredients i LEFT JOIN foodprint.ingredient_categories c ON c.id=i.category_id WHERE i.supplier_id=$1 ORDER BY i.name",
        [legacySupplier],
      );
      assert.deepEqual(
        converted.rows.map((r) => r.id),
        legacyIngredientIds,
      );
      assert.deepEqual(
        converted.rows.map((r) => r.category_name),
        [null, null, null, "Grains", "Grains", "grains", " Grains "],
      );
      assert.equal(
        converted.rows[3].category_id,
        converted.rows[4].category_id,
      );
      assert.equal(
        (
          await db.query<{ category_id: string }>(
            "SELECT category_id FROM foodprint.ingredients WHERE id=$1",
            [otherIngredient],
          )
        ).rows[0].category_id,
        converted.rows[3].category_id,
      );

      assert(
        converted.rows.every(
          (r) =>
            r.supplier_id === legacySupplier &&
            r.cover_image === null &&
            r.image_description.length === 0,
        ),
      );
      assert.equal(
        (
          await db.query<{ ingredient_id: string }>(
            "SELECT ingredient_id FROM foodprint.ingredient_entries WHERE id=$1",
            [linkedEntry],
          )
        ).rows[0].ingredient_id,
        legacyIngredientIds[3],
      );
      assert.deepEqual(
        (
          await db.query<{ column_name: string }>(
            "SELECT column_name FROM information_schema.columns WHERE table_schema='foodprint' AND table_name='ingredient_categories' ORDER BY ordinal_position",
          )
        ).rows.map((r) => r.column_name),
        ["id", "category_name", "category_description"],
      );
      await assert.rejects(
        () =>
          db.query("DELETE FROM foodprint.ingredient_categories WHERE id=$1", [
            converted.rows[3].category_id,
          ]),
        (error) => sqlState(error, "23503") || sqlState(error, "23001"),
      );
      await assert.rejects(
        () =>
          db.query(
            "INSERT INTO foodprint.ingredient_categories(category_name) VALUES ('  ')",
          ),
        (error) => sqlState(error, "23514"),
      );
      await assert.rejects(
        () =>
          db.query(
            "UPDATE foodprint.ingredients SET image_description=ARRAY[NULL]::text[] WHERE id=$1",
            [legacyIngredientIds[0]],
          ),
        (error) => sqlState(error, "23514"),
      );
      await db.query("DELETE FROM foodprint.ingredients WHERE supplier_id=$1", [
        otherSupplier,
      ]);
      await db.query("DELETE FROM foodprint.suppliers WHERE id=$1", [
        otherSupplier,
      ]);
      // Keep the existing authorization-cardinality assertions isolated from this fixture.
      await db.query("DELETE FROM foodprint.ingredient_entries WHERE id=$1", [
        linkedEntry,
      ]);
      await db.query("DELETE FROM foodprint.ingredients WHERE supplier_id=$1", [
        legacySupplier,
      ]);
      await db.query("DELETE FROM foodprint.suppliers WHERE id=$1", [
        legacySupplier,
      ]);
      const preserved = await db.query<{
        role_id: string;
        role_code: string;
        password_hash: string;
      }>(
        "SELECT role_id,role_code,password_hash FROM foodprint.users WHERE id=$1",
        [legacyUser],
      );
      assert.deepEqual(preserved.rows[0], {
        role_id: legacyRole,
        role_code: "MIGRATION_BACKFILL",
        password_hash: "preserved-test-hash",
      });

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
      assert.deepEqual(
        pendingDeploymentMigrations(files, await readHistory()),
        [],
      );
      assert.equal(
        (
          await db.query<{ name: string }>(
            "SELECT name FROM foodprint.schools WHERE id=$1",
            [schoolId],
          )
        ).rows[0].name,
        "Migration test marker",
      );
      assert.equal(
        (
          await db.query<{ address_line: string }>(
            "SELECT address_line FROM foodprint.schools WHERE id=$1",
            [schoolId],
          )
        ).rows[0].address_line,
        "Preserved legacy address",
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
    "school academic years preserve school data and enforce dates, ownership, uniqueness and holiday arrays",
    async () => {
      assert.equal(
        (
          await db.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM foodprint.school_academic_years",
          )
        ).rows[0].count,
        0,
        "Migration must not create sample academic years or holidays",
      );
      const schoolBefore = (
        await db.query<{ row: unknown }>(
          "SELECT to_jsonb(s) AS row FROM foodprint.schools s WHERE id=$1",
          [schoolId],
        )
      ).rows[0];
      const initial = (
        await db.query<{
          id: string;
          holidays: unknown;
          start_date: string;
          end_date: string;
          created_at: Date;
          updated_at: Date;
        }>(
          "INSERT INTO foodprint.school_academic_years(school_id,academic_year,start_date,end_date) VALUES($1,'2026–2027','2026-09-07','2027-05-28') RETURNING id,holidays,start_date::text,end_date::text,created_at,updated_at",
          [schoolId],
        )
      ).rows[0];
      assert.match(initial.id, /^[a-f0-9-]{36}$/i);
      assert.deepEqual(initial.holidays, []);
      assert.equal(initial.start_date, "2026-09-07");
      assert.equal(initial.end_date, "2027-05-28");
      assert(initial.created_at instanceof Date);
      assert.equal(+initial.created_at, +initial.updated_at);

      const holidays = [
        { date: "2026-10-22", reason: "Nghỉ theo kế hoạch nhà trường" },
        { date: "2027-02-15", reason: "Ngày nghỉ được BGH cấu hình" },
      ];
      const changed = (
        await db.query<{ holidays: unknown; updated_at: Date }>(
          "UPDATE foodprint.school_academic_years SET holidays=$1::jsonb,updated_at=updated_at+interval '1 second' WHERE id=$2 RETURNING holidays,updated_at",
          [JSON.stringify(holidays), initial.id],
        )
      ).rows[0];
      assert.deepEqual(changed.holidays, holidays);
      assert(+changed.updated_at > +initial.updated_at);
      await db.query(
        "INSERT INTO foodprint.school_academic_years(school_id,academic_year,start_date,end_date) VALUES($1,'2027–2028','2027-09-06','2028-05-26')",
        [schoolId],
      );
      const otherSchoolId = (
        await db.query<{ id: string }>(
          "INSERT INTO foodprint.schools(name,address_line) VALUES('Academic calendar fixture','Disposable local fixture') RETURNING id",
        )
      ).rows[0].id;
      await db.query(
        "INSERT INTO foodprint.school_academic_years(school_id,academic_year,start_date,end_date) VALUES($1,'2026–2027','2026-09-07','2027-05-28')",
        [otherSchoolId],
      );
      await db.query(
        "INSERT INTO foodprint.school_academic_years(school_id,academic_year,start_date,end_date) VALUES($1,'Single day','2029-01-01','2029-01-01')",
        [schoolId],
      );

      await assert.rejects(
        db.query(
          "INSERT INTO foodprint.school_academic_years(school_id,academic_year,start_date,end_date) VALUES($1,'2026–2027','2026-09-07','2027-05-28')",
          [schoolId],
        ),
        (error: unknown) =>
          sqlState(error, "23505", "uq_school_academic_year_school_year"),
      );
      await assert.rejects(
        db.query(
          "INSERT INTO foodprint.school_academic_years(school_id,academic_year,start_date,end_date) VALUES($1,'Missing school','2026-09-07','2027-05-28')",
          [randomUUID()],
        ),
        (error: unknown) =>
          sqlState(error, "23503", "school_academic_years_school_id_fkey"),
      );
      await assert.rejects(
        db.query("DELETE FROM foodprint.schools WHERE id=$1", [otherSchoolId]),
        (error: unknown) =>
          sqlState(error, "23001", "school_academic_years_school_id_fkey"),
      );
      for (const academicYear of ["", "   "]) {
        await assert.rejects(
          db.query(
            "INSERT INTO foodprint.school_academic_years(school_id,academic_year,start_date,end_date) VALUES($1,$2,'2026-09-07','2027-05-28')",
            [schoolId, academicYear],
          ),
          (error: unknown) =>
            sqlState(error, "23514", "chk_school_academic_year_label"),
        );
      }
      await assert.rejects(
        db.query(
          "INSERT INTO foodprint.school_academic_years(school_id,academic_year,start_date,end_date) VALUES($1,'Reversed dates','2027-05-28','2026-09-07')",
          [schoolId],
        ),
        (error: unknown) =>
          sqlState(error, "23514", "chk_school_academic_year_dates"),
      );
      for (const holidaysJson of ["{}", "null", '"closed"', "1", "true"]) {
        await assert.rejects(
          db.query(
            "UPDATE foodprint.school_academic_years SET holidays=$1::jsonb,updated_at=CURRENT_TIMESTAMP WHERE id=$2",
            [holidaysJson, initial.id],
          ),
          (error: unknown) =>
            sqlState(error, "23514", "chk_school_academic_year_holidays_array"),
        );
      }
      await assert.rejects(
        db.query(
          "UPDATE foodprint.school_academic_years SET holidays=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1",
          [initial.id],
        ),
        (error: unknown) => sqlState(error, "23502"),
      );
      assert.deepEqual(
        (
          await db.query<{ row: unknown }>(
            "SELECT to_jsonb(s) AS row FROM foodprint.schools s WHERE id=$1",
            [schoolId],
          )
        ).rows[0],
        schoolBefore,
      );
    },
  );

  await context.test(
    "supply-round sample planning adds enums, expand-only columns, CHECKs and the active REQUEST delivery index",
    async () => {
      const labels = (
        await db.query<{ label: string }>(
          `SELECT e.enumlabel AS label FROM pg_enum e
           JOIN pg_type t ON t.oid = e.enumtypid
           JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'foodprint' AND t.typname = 'cooking_batch_status'
           ORDER BY e.enumsortorder`,
        )
      ).rows.map((row) => row.label);
      assert.deepEqual(labels, [
        "UNCONFIRMED",
        "CONFIRMED",
        "COMPLETED",
        "PENDING_APPROVAL",
        "ROUND1_APPROVED",
        "ROUND2_APPROVED",
        "CANCELLED",
      ]);
      const constraint = async (table: string, name: string) =>
        (
          await db.query<{ def: string | null }>(
            `SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
             WHERE n.nspname = 'foodprint' AND r.relname = $1 AND c.conname = $2`,
            [table, name],
          )
        ).rows[0]?.def ?? null;
      assert.match(
        (await constraint(
          "cooking_batch_lots",
          "cooking_batch_lots_quantity_used_check",
        )) ?? "",
        /quantity_used >= .*sample_quantity > /,
      );
      const index = async (name: string) =>
        (
          await db.query<{ def: string }>(
            "SELECT indexdef AS def FROM pg_indexes WHERE schemaname = 'foodprint' AND indexname = $1",
            [name],
          )
        ).rows[0]?.def ?? null;
      assert.equal(await index("uq_deliveries_request_mode"), null);
      assert.match(
        (await index("uq_deliveries_request_active")) ?? "",
        /UNIQUE INDEX .* \(supply_request_id\) WHERE \(\(creation_mode = 'REQUEST'.*REJECTED.*CANCELLED/,
      );
      for (const table of [
        "school_sample_policies",
        "supply_rounds",
        "supply_round_dish_plans",
        "cooking_batch_round_parts",
        "cooking_batch_round_part_lots",
      ])
        assert.equal(
          (
            await db.query<{ count: number }>(
              `SELECT count(*)::int AS count FROM foodprint.${table}`,
            )
          ).rows[0].count,
          0,
          `Migration must not seed ${table}`,
        );
      for (const [table, column] of [
        ["cooking_batch_lots", "sample_quantity"],
        ["menu_meal_seasoning_lots", "sample_quantity"],
        ["ingredient_lots", "sample_top_up_quantity"],
        ["delivery_items", "sample_top_up_quantity"],
        ["supply_request_items", "sample_top_up_quantity"],
      ])
        assert.equal(
          (
            await db.query<{ count: number }>(
              `SELECT count(*)::int AS count FROM foodprint.${table} WHERE ${column} <> 0`,
            )
          ).rows[0].count,
          0,
          `Existing ${table} rows keep ${column} = 0`,
        );

      await db.query("BEGIN");
      try {
        await db.query("SAVEPOINT round_check");
        await assert.rejects(
          db.query(
            "INSERT INTO foodprint.supply_rounds(school_id,delivery_date,batch_no,status,not_needed_at) VALUES ($1,'2026-12-01',1,'NOT_NEEDED',now())",
            [schoolId],
          ),
          /supply_rounds_not_needed_check/,
        );
        await db.query("ROLLBACK TO SAVEPOINT round_check");
        await assert.rejects(
          db.query(
            "INSERT INTO foodprint.supply_rounds(school_id,delivery_date,batch_no,status) VALUES ($1,'2026-12-01',2,'NOT_NEEDED')",
            [schoolId],
          ),
          /supply_rounds_not_needed_check/,
        );
        await db.query("ROLLBACK TO SAVEPOINT round_check");
        await assert.rejects(
          db.query(
            "INSERT INTO foodprint.supply_rounds(school_id,delivery_date,batch_no) VALUES ($1,'2026-12-01',3)",
            [schoolId],
          ),
          /supply_rounds_batch_no_check/,
        );
        await db.query("ROLLBACK TO SAVEPOINT round_check");
        await db.query(
          "INSERT INTO foodprint.supply_rounds(school_id,delivery_date,batch_no,status,not_needed_at) VALUES ($1,'2026-12-01',2,'NOT_NEEDED',now()),($1,'2026-12-01',1,'COLLECTING',NULL)",
          [schoolId],
        );
        await assert.rejects(
          db.query(
            "INSERT INTO foodprint.supply_rounds(school_id,delivery_date,batch_no) VALUES ($1,'2026-12-01',1)",
            [schoolId],
          ),
          /uq_supply_rounds_school_date_batch/,
        );
      } finally {
        await db.query("ROLLBACK");
      }
    },
  );

  await context.test(
    "School profile adoption preserves provisioned data and refuses ambiguous address columns",
    async () => {
      const name = `foodprint_migration_test_school_${randomUUID().replaceAll("-", "")}`;
      await db.query(`CREATE DATABASE "${name}"`);
      recordLocalTestDatabase(name);
      const fresh = new URL(url);
      fresh.pathname = `/${name}`;
      await runPrisma(fresh.toString(), ["migrate", "deploy"]);
      const profileDb = new Client({ connectionString: fresh.toString() });
      await profileDb.connect();
      try {
        const migration = await readFile(
          path.join(
            root,
            "prisma/migrations/20261031000100_school_profile_baseline/migration.sql",
          ),
          "utf8",
        );
        const row = (
          await profileDb.query<{ id: string }>(
            "INSERT INTO foodprint.schools(name,address_line,description,logo_url,cover_image_url,boarding_scale) VALUES ('Provisioned school','Current address','Keep description','https://example.test/logo.png','https://example.test/cover.png','500') RETURNING id",
          )
        ).rows[0];
        const read = async () =>
          (
            await profileDb.query<Record<string, unknown>>(
              "SELECT * FROM foodprint.schools WHERE id=$1",
              [row.id],
            )
          ).rows[0];
        const before = await read();
        await profileDb.query(migration);
        assert.deepEqual(
          await read(),
          before,
          "Re-adopting provisioned columns must not alter profile data or timestamps",
        );
        await profileDb.query(
          "ALTER TABLE foodprint.schools ADD COLUMN address text",
        );
        await profileDb.query(
          "UPDATE foodprint.schools SET address='Conflicting legacy address' WHERE id=$1",
          [row.id],
        );
        const conflict = await read();
        await assert.rejects(
          () => profileDb.query(migration),
          /both address and address_line/,
        );
        await profileDb.query("ROLLBACK");
        assert.deepEqual(
          await read(),
          conflict,
          "Ambiguous address sources must remain untouched for manual review",
        );
      } finally {
        await profileDb.end();
      }
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
          "INSERT INTO foodprint.users(role_id,role_code,school_id,username,email,password_hash,full_name) VALUES ($1,'MIGRATION_TEST',$2,'migration_test','migration-test@example.test','test-only-not-a-login','Migration test') RETURNING id",
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
    "portion group expansion starts empty and has validated ownership foreign keys",
    async () => {
      const tables = [
        "menu_meal_portion_groups",
        "menu_meal_portion_group_dishes",
        "menu_meal_portion_group_avoidances",
        "daily_meal_portion_groups",
      ];
      for (const table of tables) {
        const result = await db.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM foodprint.${table}`,
        );
        assert.equal(
          result.rows[0].count,
          0,
          "Migration must not infer or backfill historical groups",
        );
      }
      const foreignKeys = await db.query<{ count: number; validated: boolean }>(
        "SELECT count(*)::int AS count,bool_and(c.convalidated) AS validated FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='foodprint' AND t.relname=ANY($1::text[]) AND c.contype='f'",
        [tables],
      );
      assert.equal(foreignKeys.rows[0].count, 8);
      assert.equal(foreignKeys.rows[0].validated, true);
      const index = await db.query<{ indexdef: string }>(
        "SELECT indexdef FROM pg_indexes WHERE schemaname='foodprint' AND indexname='uq_menu_meal_default_group'",
      );
      assert.match(index.rows[0].indexdef, /UNIQUE.*WHERE is_default/);
    },
  );

  await context.test(
    "migrate deploy builds an entirely empty database with the full migration history",
    async () => {
      const name = `foodprint_migration_test_fresh_${randomUUID().replaceAll("-", "")}`;
      await db.query(`CREATE DATABASE "${name}"`);
      recordLocalTestDatabase(name);
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
      const empty = new Client({ connectionString: fresh.toString() });
      await empty.connect();
      try {
        const school = (
          await empty.query<{ id: string; intake_state: string }>(
            "INSERT INTO foodprint.schools(name) VALUES ('Intake school') RETURNING id,intake_state",
          )
        ).rows[0];
        const supplier = (
          await empty.query<{ id: string; intake_state: string }>(
            "INSERT INTO foodprint.suppliers(name) VALUES ('Intake supplier') RETURNING id,intake_state",
          )
        ).rows[0];
        assert.equal(school.intake_state, "ACTIVE");
        assert.equal(supplier.intake_state, "ACTIVE");
        await assert.rejects(
          empty.query(
            "UPDATE foodprint.schools SET intake_state='PAUSED_FOR_FOOD_SAFETY_INSPECTION' WHERE id=$1",
            [school.id],
          ),
          (error) => sqlState(error, "23514"),
        );
        await assert.rejects(
          empty.query(
            "UPDATE foodprint.suppliers SET intake_state='PAUSED' WHERE id=$1",
            [supplier.id],
          ),
          (error) => sqlState(error, "23514"),
        );
        const unit = (
          await empty.query<{ id: string }>(
            "INSERT INTO foodprint.commune_food_safety_units(code,name) VALUES ('T-ATTP','Test unit') RETURNING id",
          )
        ).rows[0].id;
        const role = (
          await empty.query<{ id: string }>(
            "INSERT INTO foodprint.roles(code,name,type) VALUES ('COMMUNE_FOOD_SAFETY_OFFICER','Officer','AUTHORITY') RETURNING id",
          )
        ).rows[0].id;
        await assert.rejects(
          empty.query(
            "INSERT INTO foodprint.users(role_id,role_code,username,email,password_hash,full_name,status) VALUES ($1,'COMMUNE_FOOD_SAFETY_OFFICER','unscoped-officer','unscoped@example.test','fixture','Officer','ACTIVE')",
            [role],
          ),
          (error) =>
            sqlState(error, "23514", "chk_commune_officer_organization"),
        );
        const officer = (
          await empty.query<{ id: string; intake_state: string }>(
            "INSERT INTO foodprint.users(role_id,role_code,commune_food_safety_unit_id,username,email,password_hash,full_name,status) VALUES ($1,'COMMUNE_FOOD_SAFETY_OFFICER',$2,'officer-one','officer-one@example.test','fixture','Officer','INACTIVE') RETURNING id,intake_state",
            [role, unit],
          )
        ).rows[0];
        assert.equal(officer.intake_state, "ACTIVE");
        // specs/authority-officer-accounts FR-001: only a pending officer may have no email.
        for (const statement of [
          "UPDATE foodprint.users SET email=NULL,status='ACTIVE' WHERE id=$1",
          "UPDATE foodprint.users SET email=NULL,status='UNVERIFIED',email_verified_at=now() WHERE id=$1",
        ])
          await assert.rejects(empty.query(statement, [officer.id]), (error) =>
            sqlState(error, "23514", "chk_users_email_required"),
          );
        await assert.rejects(
          empty.query(
            "WITH r AS (INSERT INTO foodprint.roles(code,name,type) VALUES ('NO_EMAIL_FIXTURE','Fixture','SYSTEM') RETURNING id,code) INSERT INTO foodprint.users(role_id,role_code,username,password_hash,full_name,status) SELECT id,code,'no-email','fixture','No email','UNVERIFIED' FROM r",
          ),
          (error) => sqlState(error, "23514", "chk_users_email_required"),
        );
        await empty.query(
          "UPDATE foodprint.users SET email=NULL,status='UNVERIFIED' WHERE id=$1",
          [officer.id],
        );
        await empty.query(
          "UPDATE foodprint.users SET email='officer-one@example.test',status='INACTIVE' WHERE id=$1",
          [officer.id],
        );
        await assert.rejects(
          empty.query(
            "INSERT INTO foodprint.users(role_id,role_code,commune_food_safety_unit_id,username,email,password_hash,full_name,status) VALUES ($1,'COMMUNE_FOOD_SAFETY_OFFICER',$2,'officer-two','officer-two@example.test','fixture','Officer','DEACTIVATED')",
            [role, unit],
          ),
          (error) => sqlState(error, "23505", "uq_users_commune_officer"),
        );
        const incident = (
          await empty.query<{ id: string }>(
            "INSERT INTO foodprint.food_safety_incidents(school_id,title,description,status,source) VALUES ($1,'Incident','Test','SUBMITTED_TO_AUTHORITY','LEGACY_IMPORT') RETURNING id",
            [school.id],
          )
        ).rows[0].id;
        await assert.rejects(
          empty.query(
            "INSERT INTO foodprint.food_safety_report_forwardings(incident_id,recipient_organization,received_at) VALUES ($1,'Unit',now())",
            [incident],
          ),
          (error) =>
            sqlState(error, "23514", "chk_forwarding_receipt_recipient"),
        );
        await assert.rejects(
          empty.query(
            "INSERT INTO foodprint.food_safety_report_forwardings(incident_id,recipient_organization,recipient_commune_food_safety_unit_id,recipient_user_id) VALUES ($1,'Unit',$2,$3)",
            [incident, unit, randomUUID()],
          ),
          (error) => sqlState(error, "23503"),
        );
        const initial = (
          await empty.query<{ last_value: string; is_called: boolean }>(
            "SELECT last_value,is_called FROM foodprint.registration_requests_registration_number_seq",
          )
        ).rows[0];
        assert.deepEqual(initial, { last_value: "1", is_called: false });
        assert.equal(
          (
            await empty.query<{ value: string }>(
              "SELECT nextval('foodprint.registration_requests_registration_number_seq') AS value",
            )
          ).rows[0].value,
          "1",
        );
      } finally {
        await empty.end();
      }
      // This database belongs to the disposable test instance; no database/volume is dropped by tests.
    },
  );
  await context.test(
    "registration numbering preserves legacy rows, orders ties deterministically and continues the sequence",
    async () => {
      const name =
        "foodprint_migration_test_codes_" + randomUUID().replaceAll("-", "");
      await db.query(`CREATE DATABASE "${name}"`);
      recordLocalTestDatabase(name);
      const fresh = new URL(url);
      fresh.pathname = "/" + name;
      const legacy = new Client({ connectionString: fresh.toString() });
      await legacy.connect();
      try {
        const numbering = "20261106000100_registration_number";
        for (const migration of migrationNames.filter(
          (value) => value < numbering,
        )) {
          await legacy.query(
            await readFile(
              path.join(root, "prisma/migrations", migration, "migration.sql"),
              "utf8",
            ),
          );
        }
        const roleId = randomUUID();
        await legacy.query(
          "INSERT INTO foodprint.roles(id,code,name,type) VALUES ($1,'SCHOOL_ADMINISTRATION','School admin','SCHOOL')",
          [roleId],
        );
        const supplierRole = randomUUID();
        await legacy.query(
          "INSERT INTO foodprint.roles(id,code,name,type) VALUES ($1,'INGREDIENT_SUPPLIER_ADMIN','Supplier admin','SUPPLIER')",
          [supplierRole],
        );
        const ids = [
          "00000000-0000-4000-8000-000000000003",
          "00000000-0000-4000-8000-000000000002",
          "00000000-0000-4000-8000-000000000001",
        ];
        for (let index = 0; index < 3; index++) {
          const userId = randomUUID();
          const supplier = index % 2 === 1;
          await legacy.query(
            "INSERT INTO foodprint.users(id,role_id,role_code,username,email,password_hash,full_name) VALUES($1,$2,$3,$4,$5,'fixture-only','Legacy applicant')",
            [
              userId,
              supplier ? supplierRole : roleId,
              supplier ? "INGREDIENT_SUPPLIER_ADMIN" : "SCHOOL_ADMINISTRATION",
              `legacy_${index}`,
              `legacy_${index}@example.test`,
            ],
          );
          const status = ["PENDING", "APPROVED", "REJECTED"][index];
          await legacy.query(
            "INSERT INTO foodprint.registration_requests(id,applicant_user_id,request_type,status,profile_data,supporting_documents,submitted_at,updated_at,reviewed_at,rejection_reason) VALUES($1,$2,$3,$4::foodprint.registration_request_status,'{\"name\":\"Legacy\",\"keep\":true}','[]',$5::timestamptz,'2026-11-01T12:34:56.123456Z',CASE WHEN $4::foodprint.registration_request_status='PENDING' THEN NULL ELSE '2026-11-02T00:00:00Z'::timestamptz END,CASE WHEN $4::foodprint.registration_request_status='REJECTED' THEN 'Keep reason' ELSE NULL END)",
            [
              ids[index],
              userId,
              supplier ? "SUPPLIER" : "SCHOOL",
              status,
              index === 0
                ? "2026-11-01T00:00:00.123456Z"
                : "2026-11-01T00:00:00.123457Z",
            ],
          );
        }
        const before = (
          await legacy.query<{ row: unknown }>(
            "SELECT to_jsonb(r) AS row FROM foodprint.registration_requests r ORDER BY id",
          )
        ).rows;
        const migrationSql = await readFile(
          path.join(root, "prisma/migrations", numbering, "migration.sql"),
          "utf8",
        );
        await legacy.query(migrationSql);
        assert.deepEqual(
          (
            await legacy.query<{ row: unknown }>(
              "SELECT to_jsonb(r)-'registration_number' AS row FROM foodprint.registration_requests r ORDER BY id",
            )
          ).rows,
          before,
        );
        const numbered = (
          await legacy.query<{ id: string; registration_number: string }>(
            "SELECT id,registration_number FROM foodprint.registration_requests ORDER BY registration_number",
          )
        ).rows;
        assert.deepEqual(
          numbered.map((row) => row.id),
          [ids[0], ids[2], ids[1]],
        );
        assert.deepEqual(
          numbered.map((row) => row.registration_number),
          ["1", "2", "3"],
        );
        const sequence = (
          await legacy.query<{
            seqincrement: string;
            seqmin: string;
            seqcache: string;
            seqcycle: boolean;
          }>(
            "SELECT seqincrement,seqmin,seqcache,seqcycle FROM pg_sequence WHERE seqrelid='foodprint.registration_requests_registration_number_seq'::regclass",
          )
        ).rows[0];
        assert.deepEqual(sequence, {
          seqincrement: "1",
          seqmin: "1",
          seqcache: "1",
          seqcycle: false,
        });
        assert.equal(
          (
            await legacy.query<{ owner: string }>(
              "SELECT pg_get_serial_sequence('foodprint.registration_requests','registration_number') AS owner",
            )
          ).rows[0].owner,
          "foodprint.registration_requests_registration_number_seq",
        );
        assert.equal(
          (
            await legacy.query<{ value: string }>(
              "SELECT nextval('foodprint.registration_requests_registration_number_seq') AS value",
            )
          ).rows[0].value,
          "4",
        );
        for (const [value, code] of [
          [null, "23502"],
          ["0", "23514"],
          ["-1", "23514"],
          ["1", "23505"],
        ] as const) {
          await assert.rejects(
            legacy.query(
              "UPDATE foodprint.registration_requests SET registration_number=$1 WHERE id=$2",
              [value, ids[1]],
            ),
            (error: unknown) => sqlState(error, code),
          );
        }
      } finally {
        await legacy.end();
      }
    },
  );
  await context.test(
    "business code migration keeps legacy FP-REG codes and enforces FP-XX-NNNNN checks",
    async () => {
      const name = `foodprint_migration_test_bizcode_${randomUUID().replaceAll("-", "")}`;
      await db.query(`CREATE DATABASE "${name}"`);
      recordLocalTestDatabase(name);
      const fresh = new URL(url);
      fresh.pathname = `/${name}`;
      const legacy = new Client({ connectionString: fresh.toString() });
      await legacy.connect();
      try {
        // Một số migration cũ dùng tên bảng không kèm schema.
        await legacy.query("SET search_path TO foodprint, public");
        const feistel = "20261123000100_business_code_feistel";
        for (const migration of migrationNames.filter(
          (value) => value < feistel,
        )) {
          await legacy.query(
            await readFile(
              path.join(root, "prisma/migrations", migration, "migration.sql"),
              "utf8",
            ),
          );
        }
        const roleId = randomUUID();
        await legacy.query(
          "INSERT INTO foodprint.roles(id,code,name,type) VALUES ($1,'SCHOOL_ADMINISTRATION','School admin','SCHOOL')",
          [roleId],
        );
        const legacyNumbers = ["7", "99999", "123456"];
        const ids: string[] = [];
        for (const [index, number] of legacyNumbers.entries()) {
          const userId = randomUUID();
          await legacy.query(
            "INSERT INTO foodprint.users(id,role_id,role_code,username,email,password_hash,full_name) VALUES($1,$2,'SCHOOL_ADMINISTRATION',$3,$4,'fixture-only','Legacy applicant')",
            [
              userId,
              roleId,
              `bizcode_${index}`,
              `bizcode_${index}@example.test`,
            ],
          );
          const id = randomUUID();
          ids.push(id);
          await legacy.query(
            "INSERT INTO foodprint.registration_requests(id,applicant_user_id,request_type,registration_number,profile_data,supporting_documents) VALUES($1,$2,'SCHOOL',$3,'{}','[]')",
            [id, userId, number],
          );
        }
        await legacy.query(
          await readFile(
            path.join(root, "prisma/migrations", feistel, "migration.sql"),
            "utf8",
          ),
        );
        const codes = await legacy.query<{ id: string; code: string }>(
          "SELECT id,code FROM foodprint.registration_requests",
        );
        assert.deepEqual(
          Object.fromEntries(codes.rows.map((row) => [row.id, row.code])),
          {
            [ids[0]]: "FP-REG-00007",
            [ids[1]]: "FP-REG-99999",
            [ids[2]]: "FP-REG-123456",
          },
        );
        await legacy.query(
          "UPDATE foodprint.registration_requests SET code='FP-RG-58213' WHERE id=$1",
          [ids[0]],
        );
        for (const invalid of ["FP-RG-00000", "FP-RG-1234", "FP-XX-12345"]) {
          await assert.rejects(
            legacy.query(
              "UPDATE foodprint.registration_requests SET code=$1 WHERE id=$2",
              [invalid, ids[1]],
            ),
            (error: unknown) => sqlState(error, "23514"),
            invalid,
          );
        }
        await assert.rejects(
          legacy.query(
            "UPDATE foodprint.registration_requests SET code='FP-RG-58213' WHERE id=$1",
            [ids[1]],
          ),
          (error: unknown) => sqlState(error, "23505"),
        );
        await assert.rejects(
          legacy.query(
            "UPDATE foodprint.registration_requests SET code=NULL WHERE id=$1",
            [ids[1]],
          ),
          (error: unknown) => sqlState(error, "23502"),
        );
        await legacy.query(
          "INSERT INTO foodprint.business_code_counters(code_type,last_sequence) VALUES('DE',100000)",
        );
        await assert.rejects(
          legacy.query(
            "UPDATE foodprint.business_code_counters SET last_sequence=100001 WHERE code_type='DE'",
          ),
          (error: unknown) => sqlState(error, "23514"),
        );
        await assert.rejects(
          legacy.query(
            "INSERT INTO foodprint.business_code_counters(code_type,last_sequence) VALUES('de',1)",
          ),
          (error: unknown) => sqlState(error, "23514"),
        );
        for (const table of ["meal_complaints", "food_safety_incidents"]) {
          const column = await legacy.query<{ is_nullable: string }>(
            "SELECT is_nullable FROM information_schema.columns WHERE table_schema='foodprint' AND table_name=$1 AND column_name='code'",
            [table],
          );
          assert.equal(column.rows[0]?.is_nullable, "YES", table);
        }
      } finally {
        await legacy.end();
      }
    },
  );
  await context.test(
    "cooking grouping backfill preserves child/sample history and enforces dish context",
    async () => {
      const name = `foodprint_migration_test_cooking_${randomUUID().replaceAll("-", "")}`;
      await db.query(`CREATE DATABASE "${name}"`);
      recordLocalTestDatabase(name);
      const fresh = new URL(url);
      fresh.pathname = `/${name}`;
      const legacy = new Client({ connectionString: fresh.toString() });
      await legacy.connect();
      try {
        const grouping = "20261111000100_cooking_batch_groups";
        for (const migration of migrationNames.filter(
          (value) => value < grouping,
        )) {
          await legacy.query<{ id: string; n: number; row: unknown }>(
            await readFile(
              path.join(root, "prisma/migrations", migration, "migration.sql"),
              "utf8",
            ),
          );
        }
        const school = (
          await legacy.query<{ id: string; n: number; row: unknown }>(
            "INSERT INTO foodprint.schools(name) VALUES('Group migration school') RETURNING id",
          )
        ).rows[0].id;
        const role = (
          await legacy.query<{ id: string; n: number; row: unknown }>(
            "INSERT INTO foodprint.roles(code,name,type) VALUES('SCHOOL_KITCHEN_STAFF','Chef','SCHOOL') RETURNING id",
          )
        ).rows[0].id;
        const user = (
          await legacy.query<{ id: string; n: number; row: unknown }>(
            "INSERT INTO foodprint.users(role_id,role_code,school_id,username,email,password_hash,full_name) VALUES($1,'SCHOOL_KITCHEN_STAFF',$2,'group_chef','group-chef@example.test','fixture-only','Chef') RETURNING id",
            [role, school],
          )
        ).rows[0].id;
        const week = (
          await legacy.query<{ id: string; n: number; row: unknown }>(
            "INSERT INTO foodprint.weekly_menus(school_id,created_by_user_id,week_start_date) VALUES($1,$2,'2030-01-07') RETURNING id",
            [school, user],
          )
        ).rows[0].id;
        const day = (
          await legacy.query<{ id: string; n: number; row: unknown }>(
            "INSERT INTO foodprint.menu_days(weekly_menu_id,menu_date) VALUES($1,'2030-01-07') RETURNING id",
            [week],
          )
        ).rows[0].id;
        const dish = (
          await legacy.query<{ id: string; n: number; row: unknown }>(
            "INSERT INTO foodprint.dishes(school_id,name) VALUES($1,'Original dish') RETURNING id",
            [school],
          )
        ).rows[0].id;
        await legacy.query<{ id: string; n: number; row: unknown }>(
          "INSERT INTO foodprint.menu_day_dishes(menu_day_id,dish_id,meal_type) VALUES($1,$2,'LUNCH')",
          [day, dish],
        );
        const completed = (
          await legacy.query<{ id: string; n: number; row: unknown }>(
            "INSERT INTO foodprint.cooking_batches(batch_code,menu_day_id,dish_id,meal_type,cooking_mode_applied,created_by_user_id,status,planned_portions,confirmed_by_user_id,confirmed_at,completed_by_user_id,completed_at) VALUES('OLD-CB',$1,$2,'LUNCH','COMBINE_LOTS',$3,'COMPLETED',12,$3,'2030-01-07T03:00:00Z',$3,'2030-01-07T04:00:00Z') RETURNING id",
            [day, dish, user],
          )
        ).rows[0].id;
        await legacy.query<{ id: string; n: number; row: unknown }>(
          "INSERT INTO foodprint.cooking_batches(batch_code,menu_day_id,dish_id,meal_type,cooking_mode_applied,created_by_user_id) VALUES('UNKNOWN-PLAN',$1,$2,'LUNCH','COMBINE_LOTS',$3)",
          [day, dish, user],
        );
        await legacy.query<{ id: string; n: number; row: unknown }>(
          "INSERT INTO foodprint.retained_food_samples(cooking_batch_id,recorded_by_user_id,sampled_at,quantity,unit) VALUES($1,$2,'2030-01-07T05:00:00Z',150,'g')",
          [completed, user],
        );
        const before = (
          await legacy.query<{ id: string; n: number; row: unknown }>(
            "SELECT to_jsonb(b) AS row FROM foodprint.cooking_batches b ORDER BY id",
          )
        ).rows;
        const beforeSamples = (
          await legacy.query<{ id: string; n: number; row: unknown }>(
            "SELECT to_jsonb(s) AS row FROM foodprint.retained_food_samples s ORDER BY id",
          )
        ).rows;
        await legacy.query<{ id: string; n: number; row: unknown }>(
          await readFile(
            path.join(root, "prisma/migrations", grouping, "migration.sql"),
            "utf8",
          ),
        );
        assert.deepEqual(
          (
            await legacy.query<{ id: string; n: number; row: unknown }>(
              "SELECT to_jsonb(b)-'batch_group_id' AS row FROM foodprint.cooking_batches b ORDER BY id",
            )
          ).rows,
          before,
        );
        assert.deepEqual(
          (
            await legacy.query<{ id: string; n: number; row: unknown }>(
              "SELECT to_jsonb(s)-'dish_id' AS row FROM foodprint.retained_food_samples s ORDER BY id",
            )
          ).rows,
          beforeSamples,
        );
        assert.equal(
          (
            await legacy.query<{ id: string; n: number; row: unknown }>(
              "SELECT count(*)::int AS n FROM foodprint.cooking_batch_groups",
            )
          ).rows[0].n,
          2,
        );
        assert.equal(
          (
            await legacy.query<{ id: string; n: number; row: unknown }>(
              "SELECT count(*)::int AS n FROM foodprint.cooking_batch_dishes",
            )
          ).rows[0].n,
          2,
        );
        assert.equal(
          (
            await legacy.query<{ id: string; n: number; row: unknown }>(
              "SELECT count(*)::int AS n FROM foodprint.cooking_batch_dishes WHERE planned_portions IS NULL",
            )
          ).rows[0].n,
          1,
        );
        const secondDish = (
          await legacy.query<{ id: string; n: number; row: unknown }>(
            "INSERT INTO foodprint.dishes(school_id,name) VALUES($1,'Second dish') RETURNING id",
            [school],
          )
        ).rows[0].id;
        await legacy.query<{ id: string; n: number; row: unknown }>(
          "INSERT INTO foodprint.menu_day_dishes(menu_day_id,dish_id,meal_type) VALUES($1,$2,'LUNCH')",
          [day, secondDish],
        );
        await legacy.query<{ id: string; n: number; row: unknown }>(
          "INSERT INTO foodprint.cooking_batch_dishes(cooking_batch_id,dish_id,menu_day_id,meal_type,planned_portions) VALUES($1,$2,$3,'LUNCH',12)",
          [completed, secondDish, day],
        );
        await legacy.query<{ id: string; n: number; row: unknown }>(
          "INSERT INTO foodprint.retained_food_samples(cooking_batch_id,dish_id,recorded_by_user_id,quantity,unit) VALUES($1,$2,$3,150,'g')",
          [completed, secondDish, user],
        );
        assert.equal(
          (
            await legacy.query<{ id: string; n: number; row: unknown }>(
              "SELECT count(*)::int AS n FROM foodprint.retained_food_samples WHERE cooking_batch_id=$1",
              [completed],
            )
          ).rows[0].n,
          2,
        );
        await assert.rejects(
          legacy.query<{ id: string; n: number; row: unknown }>(
            "INSERT INTO foodprint.retained_food_samples(cooking_batch_id,dish_id,recorded_by_user_id,quantity,unit) VALUES($1,$2,$3,150,'g')",
            [completed, secondDish, user],
          ),
          (error) => sqlState(error, "23505"),
        );
        await assert.rejects(
          legacy.query<{ id: string; n: number; row: unknown }>(
            "UPDATE foodprint.cooking_batch_dishes SET meal_type='AFTERNOON' WHERE cooking_batch_id=$1 AND dish_id=$2",
            [completed, secondDish],
          ),
          (error) => sqlState(error, "23503"),
        );
      } finally {
        await legacy.end();
      }
      // Keep the disposable database for inspection, following the suite's existing policy.
    },
  );
  await context.test(
    "complaint_supertype stops on legacy complaint rows, then enforces ticket CHECKs and child kind FKs",
    async () => {
      const migration = "20261126000100_complaint_supertype";
      const name = `foodprint_migration_test_ticket_${randomUUID().replaceAll("-", "")}`;
      await db.query(`CREATE DATABASE "${name}"`);
      recordLocalTestDatabase(name);
      const fresh = new URL(url);
      fresh.pathname = `/${name}`;
      const legacy = new Client({ connectionString: fresh.toString() });
      await legacy.connect();
      try {
        await legacy.query(
          "CREATE SCHEMA IF NOT EXISTS foodprint; SET search_path = foodprint, public;",
        );
        for (const version of migrationNames.filter(
          (value) => value < migration,
        ))
          await legacy.query(
            await readFile(
              path.join(root, "prisma/migrations", version, "migration.sql"),
              "utf8",
            ),
          );
        await legacy.query("SET search_path = public;");
        const sql = await readFile(
          path.join(root, "prisma/migrations", migration, "migration.sql"),
          "utf8",
        );
        const seeded = await legacy.query<{
          user_id: string;
          school_id: string;
          portion_id: string;
        }>(`
          WITH school AS (
            INSERT INTO foodprint.schools(name) VALUES ('Ticket school') RETURNING id
          ), role AS (
            INSERT INTO foodprint.roles(code,name,type) VALUES ('PARENTS_COMMITTEE','Parent','SCHOOL') RETURNING id
          ), actor AS (
            INSERT INTO foodprint.users(role_id,role_code,school_id,username,email,password_hash,full_name)
            SELECT role.id,'PARENTS_COMMITTEE',school.id,'ticket_test','ticket@example.test','test-only','Parent'
            FROM role, school RETURNING id
          ), classroom AS (
            INSERT INTO foodprint.classes(school_id,name) SELECT id,'5A' FROM school RETURNING id
          ), portion AS (
            INSERT INTO foodprint.daily_meal_portions(class_id,confirmed_by_user_id,meal_date,meal_type,total_portions)
            SELECT classroom.id,actor.id,'2026-11-12','LUNCH',30 FROM classroom,actor RETURNING id
          )
          SELECT actor.id AS user_id, school.id AS school_id, portion.id AS portion_id
          FROM actor, school, portion
        `);
        const {
          user_id: userId,
          school_id: schoolId,
          portion_id: portionId,
        } = seeded.rows[0];
        await legacy.query(
          `INSERT INTO foodprint.meal_complaints(daily_meal_portion_id,submitted_by_user_id,complaint_type,description)
           VALUES($1,$2,'OTHER','Legacy row')`,
          [portionId, userId],
        );
        await assert.rejects(legacy.query(sql), /complaint_supertype/);
        await legacy.query("ROLLBACK");
        assert.equal(
          (await legacy.query("SELECT 1 FROM foodprint.meal_complaints"))
            .rowCount,
          1,
        );
        assert.equal(
          (
            await legacy.query<{ name: string | null }>(
              "SELECT to_regclass('foodprint.complaints')::text AS name",
            )
          ).rows[0].name,
          null,
        );
        await legacy.query("DELETE FROM foodprint.meal_complaints");
        await legacy.query(sql);

        const insertComplaint = (columns: string, values: string) =>
          legacy.query<{ id: string }>(
            `INSERT INTO foodprint.complaints(sender_user_id,sender_role_code,title,description,${columns})
             VALUES($1,'PARENTS_COMMITTEE','Tiêu đề','Mô tả',${values}) RETURNING id`,
            [userId],
          );
        const meal = await insertComplaint("kind,code", "'MEAL','FP-MC-12345'");
        const mealId = meal.rows[0].id;
        await legacy.query(
          `INSERT INTO foodprint.meal_complaints(id,school_id,daily_meal_portion_id,complaint_type)
           VALUES($1,$2,$3,'OTHER')`,
          [mealId, schoolId, portionId],
        );
        const rejected: [string, string, string][] = [
          ["kind,code", "'MEAL','FP-CP-12345'", "complaints_code_kind"],
          ["kind,code", "'MEAL','FP-MC-00000'", "complaints_code_format"],
          [
            "kind,code,status",
            "'MEAL','FP-MC-11111','RESOLVED'",
            "complaints_resolved_timestamp",
          ],
          [
            "kind,code,status",
            "'MEAL','FP-MC-11112','CLOSED'",
            "complaints_closed_fields",
          ],
          [
            "kind,code,status,close_reason,closed_at,closed_by_user_id",
            "'MEAL','FP-MC-11113','CLOSED','AUTO_CLOSED',now(),$1",
            "complaints_closed_actor",
          ],
          [
            "kind,code,status,close_reason,closed_at,closed_by_user_id",
            "'INGREDIENT','FP-CP-11114','CLOSED','ESCALATED',now(),$1",
            "complaints_escalated_kind",
          ],
          [
            "kind,code,resolved_count",
            "'MEAL','FP-MC-11115',-1",
            "complaints_resolved_count_range",
          ],
        ];
        for (const [columns, values, constraint] of rejected)
          await assert.rejects(
            insertComplaint(columns, values),
            (error: unknown) => sqlState(error, "23514", constraint),
            constraint,
          );
        await insertComplaint(
          "kind,code,status,close_reason,closed_at",
          "'MEAL','FP-MC-11116','CLOSED','AUTO_CLOSED',now()",
        );
        await assert.rejects(
          legacy.query(
            "UPDATE foodprint.complaints SET code='FP-MC-12345' WHERE code='FP-MC-11116'",
          ),
          (error: unknown) => sqlState(error, "23505", "complaints_code_key"),
        );
        // Bảng con chỉ trỏ được tới bản ghi cha cùng loại (FK tổ hợp id, kind).
        const ingredient = await insertComplaint(
          "kind,code",
          "'INGREDIENT','FP-CP-100000'",
        );
        await assert.rejects(
          legacy.query(
            `INSERT INTO foodprint.meal_complaints(id,school_id,daily_meal_portion_id,complaint_type)
             VALUES($1,$2,$3,'OTHER')`,
            [ingredient.rows[0].id, schoolId, portionId],
          ),
          (error: unknown) =>
            sqlState(error, "23503", "meal_complaints_id_kind_fkey"),
        );
        await assert.rejects(
          legacy.query(
            `INSERT INTO foodprint.complaint_comments(complaint_id,author_user_id,author_role_code,author_side,comment_type,content)
             VALUES($1,$2,'PARENTS_COMMITTEE','REQUESTER','RESOLUTION','Không hợp lệ')`,
            [mealId, userId],
          ),
          (error: unknown) =>
            sqlState(error, "23514", "complaint_comments_resolution_side"),
        );
        await assert.rejects(
          legacy.query(
            `INSERT INTO foodprint.complaint_comments(complaint_id,author_user_id,author_role_code,author_side,comment_type,content)
             VALUES($1,$2,'PARENTS_COMMITTEE','REQUESTER','MESSAGE','   ')`,
            [mealId, userId],
          ),
          (error: unknown) =>
            sqlState(error, "23514", "complaint_comments_content_present"),
        );
        await assert.rejects(
          legacy.query(
            `INSERT INTO foodprint.complaint_status_histories(complaint_id,to_status,actor_type,actor_user_id,actor_role_code)
             VALUES($1,'IN_PROGRESS','SYSTEM',$2,'PARENTS_COMMITTEE')`,
            [mealId, userId],
          ),
          (error: unknown) =>
            sqlState(error, "23514", "complaint_status_histories_actor"),
        );
        await legacy.query(
          `INSERT INTO foodprint.complaint_status_histories(complaint_id,from_status,to_status,close_reason,actor_type)
           VALUES($1,'RESOLVED','CLOSED','AUTO_CLOSED','SYSTEM')`,
          [mealId],
        );
        for (const legacyType of [
          "complaint_status",
          "ingredient_quality_feedback_status",
        ])
          assert.equal(
            (
              await legacy.query(
                "SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='foodprint' AND t.typname=$1",
                [legacyType],
              )
            ).rowCount,
            0,
            legacyType,
          );
      } finally {
        await legacy.end();
        await db.query(`DROP DATABASE "${name}"`);
      }
    },
  );
  await context.test(
    "food_safety_incident_workflow: maps legacy statuses per §6.3 and enforces source, cancellation, review and recipient CHECKs",
    async () => {
      const name = `foodprint_migration_test_incident_${randomUUID().replaceAll("-", "")}`;
      await db.query(`CREATE DATABASE "${name}"`);
      recordLocalTestDatabase(name);
      const fresh = new URL(url);
      fresh.pathname = `/${name}`;
      const client = new Client({ connectionString: fresh.toString() });
      await client.connect();
      try {
        const migration = "20261129000100_food_safety_incident_workflow";
        await client.query(
          "CREATE SCHEMA IF NOT EXISTS foodprint; SET search_path = foodprint, public;",
        );
        for (const previous of migrationNames.filter(
          (value) => value < migration,
        ))
          await client.query(
            await readFile(
              path.join(root, "prisma/migrations", previous, "migration.sql"),
              "utf8",
            ),
          );
        await client.query("SET search_path = public;");
        const one = async (sql: string, values: unknown[] = []) =>
          (await client.query<{ id: string }>(sql, values)).rows[0].id;
        const school = await one(
          "INSERT INTO foodprint.schools(name) VALUES ('Incident school') RETURNING id",
        );
        const unit = await one(
          "INSERT INTO foodprint.commune_food_safety_units(code,name) VALUES ('INC-A','Unit A') RETURNING id",
        );
        const legacy = async (status: string) =>
          one(
            "INSERT INTO foodprint.food_safety_incidents(school_id,title,description,status) VALUES ($1,$2,'Legacy',$3::foodprint.incident_status) RETURNING id",
            [school, status, status],
          );
        const openPending = await legacy("OPEN");
        const openForwarded = await legacy("OPEN");
        const investigating = await legacy("INVESTIGATING");
        const resolved = await legacy("RESOLVED");
        const closed = await legacy("CLOSED");
        await client.query(
          "INSERT INTO foodprint.food_safety_report_forwardings(incident_id,recipient_organization,recipient_commune_food_safety_unit_id) VALUES ($1,'Unit A',$2)",
          [openForwarded, unit],
        );
        // Bản chuyển ra ngoài hệ thống (không có đơn vị) vẫn hợp lệ cho dữ liệu cũ.
        await client.query(
          "INSERT INTO foodprint.food_safety_report_forwardings(incident_id,recipient_organization) VALUES ($1,'Sở Y tế')",
          [investigating],
        );
        await client.query(
          await readFile(
            path.join(root, "prisma/migrations", migration, "migration.sql"),
            "utf8",
          ),
        );
        const mapped = (
          await client.query<{
            id: string;
            status: string;
            source: string;
            recipient: string | null;
          }>(
            "SELECT id,status::text,source::text,recipient_commune_food_safety_unit_id AS recipient FROM foodprint.food_safety_incidents",
          )
        ).rows;
        const byId = new Map(mapped.map((row) => [row.id, row]));
        assert.deepEqual(
          [openPending, openForwarded, investigating, resolved, closed].map(
            (id) => [byId.get(id)?.status, byId.get(id)?.recipient ?? null],
          ),
          [
            ["PENDING_SCHOOL_REVIEW", null],
            ["SUBMITTED_TO_AUTHORITY", unit],
            ["UNDER_INSPECTION", null],
            ["INSPECTION_COMPLETED", null],
            ["CLOSED", null],
          ],
        );
        assert(mapped.every((row) => row.source === "LEGACY_IMPORT"));
        assert.equal(
          (
            await client.query(
              "SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='foodprint' AND t.typname='incident_status'",
            )
          ).rowCount,
          0,
        );

        const role = async (code: string) =>
          one(
            "INSERT INTO foodprint.roles(code,name,type) VALUES ($1,$1,'SCHOOL') RETURNING id",
            [code],
          );
        const parentRole = await role("PARENTS_COMMITTEE");
        await role("HOMEROOM_TEACHER");
        await role("SCHOOL_MANAGEMENT_BOARD");
        const parent = await one(
          "INSERT INTO foodprint.users(role_id,role_code,school_id,username,email,password_hash,full_name,status) VALUES ($1,'PARENTS_COMMITTEE',$2,'incident-parent','incident-parent@example.test','fixture','Parent','ACTIVE') RETURNING id",
          [parentRole, school],
        );
        let sequence = 10000;
        const insert = (fields: Record<string, unknown>) => {
          const row: Record<string, unknown> = {
            school_id: school,
            title: "Sự cố",
            description: "Nhiều học sinh đau bụng",
            status: "PENDING_SCHOOL_REVIEW",
            source: "PARENT_REPORT",
            reported_by_user_id: parent,
            reported_role_code: "PARENTS_COMMITTEE",
            reported_symptomatic_count: 3,
            code: `FP-IC-${++sequence}`,
            ...fields,
          };
          const keys = Object.keys(row);
          return client.query<{ id: string }>(
            `INSERT INTO foodprint.food_safety_incidents(${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`,
            keys.map((key) => row[key]),
          );
        };
        const rejects = async (
          fields: Record<string, unknown>,
          constraint: string,
        ) =>
          assert.rejects(insert(fields), (error) =>
            sqlState(error, "23514", constraint),
          );
        await rejects({ code: null }, "food_safety_incidents_reporter");
        await rejects(
          { reported_symptomatic_count: null },
          "food_safety_incidents_reporter",
        );
        await rejects(
          { reported_role_code: "HOMEROOM_TEACHER" },
          "food_safety_incidents_source_role",
        );
        await rejects(
          {
            source: "TEACHER_REPORT",
            reported_role_code: "HOMEROOM_TEACHER",
          },
          "food_safety_incidents_source_role",
        );
        await rejects(
          { source: "SCHOOL_DIRECT" },
          "food_safety_incidents_source_role",
        );
        await rejects(
          { reported_symptomatic_count: 0 },
          "food_safety_incidents_symptomatic_count",
        );
        await rejects(
          { status: "CANCELLED_BY_SCHOOL" },
          "food_safety_incidents_cancellation",
        );
        await rejects(
          { cancellation_reason: "DUPLICATE_REPORT", cancellation_note: "x" },
          "food_safety_incidents_cancellation",
        );
        await rejects(
          {
            status: "CANCELLED_BY_SCHOOL",
            cancellation_reason: "DUPLICATE_REPORT",
          },
          "food_safety_incidents_cancellation",
        );
        await rejects(
          { school_preliminary_assessment: "OUTSIDE_MEAL" },
          "food_safety_incidents_school_review",
        );
        await rejects(
          { recipient_commune_food_safety_unit_id: unit },
          "food_safety_incidents_recipient",
        );
        const reviewed = {
          school_preliminary_assessment: "OUTSIDE_MEAL",
          school_reviewed_by_user_id: parent,
          school_reviewed_at: new Date(),
        };
        await rejects(
          { status: "SUBMITTED_TO_AUTHORITY", ...reviewed },
          "food_safety_incidents_recipient",
        );
        await rejects(
          {
            status: "SUBMITTED_TO_AUTHORITY",
            recipient_commune_food_safety_unit_id: unit,
          },
          "food_safety_incidents_recipient",
        );
        await assert.rejects(insert({ code: "FP-IC-1" }), (error) =>
          sqlState(error, "23514", "food_safety_incidents_code_format"),
        );
        const pending = (await insert({})).rows[0].id;
        await insert({
          status: "SUBMITTED_TO_AUTHORITY",
          recipient_commune_food_safety_unit_id: unit,
          ...reviewed,
        });
        await insert({
          status: "CANCELLED_BY_SCHOOL",
          cancellation_reason: "DATA_ENTRY_ERROR",
          cancellation_note: "Nhập nhầm trường",
        });

        const history = (fields: string, values: unknown[]) =>
          client.query(
            `INSERT INTO foodprint.food_safety_incident_status_histories(incident_id,${fields}) VALUES ($1,${values.map((_, i) => `$${i + 2}`).join(",")})`,
            [pending, ...values],
          );
        await history("from_status,to_status,actor_user_id,actor_role_code", [
          null,
          "PENDING_SCHOOL_REVIEW",
          parent,
          "PARENTS_COMMITTEE",
        ]);
        await assert.rejects(
          history("to_status,actor_user_id", ["PENDING_SCHOOL_REVIEW", parent]),
          (error) =>
            sqlState(
              error,
              "23514",
              "food_safety_incident_status_histories_actor",
            ),
        );
        await assert.rejects(
          history("from_status,to_status", [
            "PENDING_SCHOOL_REVIEW",
            "PENDING_SCHOOL_REVIEW",
          ]),
          (error) =>
            sqlState(
              error,
              "23514",
              "food_safety_incident_status_histories_change",
            ),
        );
      } finally {
        await client.end();
      }
    },
  );

  await context.test(
    "complaint_email_outbox: email_outbox has exactly one source and complaint rows carry an event",
    async () => {
      const name = `foodprint_migration_test_complaint_email_${randomUUID().replaceAll("-", "")}`;
      await db.query(`CREATE DATABASE "${name}"`);
      recordLocalTestDatabase(name);
      const fresh = new URL(url);
      fresh.pathname = `/${name}`;
      const client = new Client({ connectionString: fresh.toString() });
      await client.connect();
      try {
        await client.query(
          "CREATE SCHEMA IF NOT EXISTS foodprint; SET search_path = foodprint, public;",
        );
        for (const version of migrationNames.filter(
          (value) => value <= "20261203000100_complaint_email_outbox",
        ))
          await client.query(
            await readFile(
              path.join(root, "prisma/migrations", version, "migration.sql"),
              "utf8",
            ),
          );
        await client.query("SET search_path = public;");
        const insert = (fields: string, values: unknown[]) =>
          client.query(
            `INSERT INTO foodprint.email_outbox(${fields},recipient_email,subject,text,html) VALUES (${values.map((_, index) => `$${index + 1}`).join(",")},'a@example.test','s','t','h')`,
            values,
          );
        // CHECK chạy trước FK nên không cần dữ liệu nguồn thật.
        await assert.rejects(
          client.query(
            "INSERT INTO foodprint.email_outbox(recipient_email,subject,text,html) VALUES ('a@example.test','s','t','h')",
          ),
          (error) => sqlState(error, "23514", "email_outbox_source_check"),
        );
        await assert.rejects(
          insert("registration_id,complaint_id,complaint_event", [
            randomUUID(),
            randomUUID(),
            "CREATED",
          ]),
          (error) => sqlState(error, "23514", "email_outbox_source_check"),
        );
        await assert.rejects(insert("complaint_id", [randomUUID()]), (error) =>
          sqlState(error, "23514", "email_outbox_complaint_event_check"),
        );
        await assert.rejects(
          insert("registration_id,complaint_event", [randomUUID(), "CREATED"]),
          (error) =>
            sqlState(error, "23514", "email_outbox_complaint_event_check"),
        );
        await assert.rejects(
          insert("complaint_id,complaint_event", [randomUUID(), "RESOLVED"]),
          (error) => sqlState(error, "23503", "email_outbox_complaint_id_fkey"),
        );
      } finally {
        await client.end();
      }
    },
  );

  await context.test(
    "supplier_enforcement: evidence FK, decision/execution CHECKs, one PENDING and one active restriction (NULLS NOT DISTINCT)",
    async () => {
      const name = `foodprint_migration_test_enforcement_${randomUUID().replaceAll("-", "")}`;
      await db.query(`CREATE DATABASE "${name}"`);
      recordLocalTestDatabase(name);
      const fresh = new URL(url);
      fresh.pathname = `/${name}`;
      const client = new Client({ connectionString: fresh.toString() });
      await client.connect();
      try {
        await client.query(
          "CREATE SCHEMA IF NOT EXISTS foodprint; SET search_path = foodprint, public;",
        );
        for (const version of migrationNames.filter(
          (value) => value <= "20261202000100_supplier_enforcement",
        ))
          await client.query(
            await readFile(
              path.join(root, "prisma/migrations", version, "migration.sql"),
              "utf8",
            ),
          );
        await client.query("SET search_path = public;");
        const one = async (sql: string, values: unknown[] = []) =>
          (await client.query<{ id: string }>(sql, values)).rows[0].id;
        const placeholders = (count: number) =>
          Array.from({ length: count }, (_, index) => `$${index + 1}`).join(
            ",",
          );
        const school = await one(
          "INSERT INTO foodprint.schools(name) VALUES ('Enforcement school') RETURNING id",
        );
        const incident = await one(
          "INSERT INTO foodprint.food_safety_incidents(school_id,title,description,status,source) VALUES ($1,'Sự cố','Legacy','INSPECTION_COMPLETED','LEGACY_IMPORT') RETURNING id",
          [school],
        );
        const otherIncident = await one(
          "INSERT INTO foodprint.food_safety_incidents(school_id,title,description,status,source) VALUES ($1,'Sự cố 2','Legacy','INSPECTION_COMPLETED','LEGACY_IMPORT') RETURNING id",
          [school],
        );
        const role = await one(
          "INSERT INTO foodprint.roles(code,name,type) VALUES ('SCHOOL_MANAGEMENT_BOARD','BGH','SCHOOL') RETURNING id",
        );
        const actor = await one(
          "INSERT INTO foodprint.users(role_id,role_code,school_id,username,email,password_hash,full_name,status) VALUES ($1,'SCHOOL_MANAGEMENT_BOARD',$2,'enforcement-actor','enforcement-actor@example.test','fixture','Actor','ACTIVE') RETURNING id",
          [role, school],
        );
        const supplier = await one(
          "INSERT INTO foodprint.suppliers(name) VALUES ('Enforcement supplier') RETURNING id",
        );
        const inspection = await one(
          "INSERT INTO foodprint.food_safety_inspections(incident_id,team_description,scheduled_at,created_by_user_id) VALUES ($1,'Đoàn',now(),$2) RETURNING id",
          [incident, actor],
        );
        const insert = (table: string, row: Record<string, unknown>) => {
          const keys = Object.keys(row);
          return client.query<{ id: string }>(
            `INSERT INTO foodprint.${table}(${keys.join(",")}) VALUES (${placeholders(keys.length)}) RETURNING id`,
            keys.map((key) => row[key]),
          );
        };
        const action = (fields: Record<string, unknown>) =>
          insert("supplier_enforcement_actions", {
            incident_id: incident,
            supplier_id: supplier,
            action_type: "PAUSE_INTAKE",
            requested_by_user_id: actor,
            request_reason: "Nguyên liệu quá hạn",
            ...fields,
          });
        const rejects = (
          promise: Promise<unknown>,
          state: string,
          constraint: string,
        ) =>
          assert.rejects(promise, (error) =>
            sqlState(error, state, constraint),
          );
        await rejects(
          action({ action_type: "LOCK_ACCOUNT" }),
          "23514",
          "supplier_enforcement_actions_lock_evidence",
        );
        await rejects(
          action({ request_reason: "  " }),
          "23514",
          "supplier_enforcement_actions_reason",
        );
        await rejects(
          action({ decision_status: "APPROVED" }),
          "23514",
          "supplier_enforcement_actions_decision",
        );
        await rejects(
          action({
            decision_status: "REJECTED",
            decided_by_user_id: actor,
            decided_at: new Date(),
          }),
          "23514",
          "supplier_enforcement_actions_decision",
        );
        await rejects(
          action({
            decision_status: "APPROVED",
            decided_by_user_id: actor,
            decided_at: new Date(),
          }),
          "23514",
          "supplier_enforcement_actions_execution",
        );
        await rejects(
          action({
            decision_status: "APPROVED",
            decided_by_user_id: actor,
            decided_at: new Date(),
            execution_status: "FAILED",
            executed_at: new Date(),
          }),
          "23514",
          "supplier_enforcement_actions_execution",
        );
        // Căn cứ phải là đợt kiểm tra của chính hồ sơ (FK tổ hợp).
        await rejects(
          action({
            incident_id: otherIncident,
            action_type: "LOCK_ACCOUNT",
            evidence_inspection_id: inspection,
          }),
          "23503",
          "supplier_enforcement_actions_evidence_inspection_fkey",
        );
        const source = (
          await action({
            action_type: "LOCK_ACCOUNT",
            evidence_inspection_id: inspection,
          })
        ).rows[0].id;
        await rejects(
          action({
            action_type: "LOCK_ACCOUNT",
            evidence_inspection_id: inspection,
          }),
          "23505",
          "uq_supplier_enforcement_actions_pending",
        );
        await client.query(
          "UPDATE foodprint.supplier_enforcement_actions SET decision_status='APPROVED',decided_by_user_id=$2,decided_at=now(),execution_status='APPLIED',executed_at=now() WHERE id=$1",
          [source, actor],
        );

        const restriction = (fields: Record<string, unknown>) =>
          insert("supplier_restrictions", {
            supplier_id: supplier,
            incident_id: incident,
            restriction_type: "ACCOUNT_LOCKED",
            source_action_id: source,
            ...fields,
          });
        await rejects(
          restriction({ source_action_id: null }),
          "23514",
          "supplier_restrictions_source",
        );
        await rejects(
          restriction({ is_active: false }),
          "23514",
          "supplier_restrictions_lifted",
        );
        await rejects(
          restriction({ incident_id: otherIncident }),
          "23503",
          "supplier_restrictions_source_action_fkey",
        );
        const active = (await restriction({})).rows[0].id;
        await rejects(
          restriction({}),
          "23505",
          "uq_supplier_restrictions_active",
        );
        // Hạn chế thủ công (incident_id NULL): NULLS NOT DISTINCT chặn bản thứ hai.
        await restriction({ incident_id: null, source_action_id: null });
        await rejects(
          restriction({ incident_id: null, source_action_id: null }),
          "23505",
          "uq_supplier_restrictions_active",
        );
        await client.query(
          "UPDATE foodprint.supplier_restrictions SET is_active=false,lifted_at=now() WHERE id=$1",
          [active],
        );
        await restriction({});

        await client.query(
          "INSERT INTO foodprint.supplier_restriction_locked_accounts(restriction_id,user_id,previous_status) VALUES ($1,$2,'ACTIVE')",
          [active, actor],
        );
        await rejects(
          client.query(
            "INSERT INTO foodprint.supplier_restriction_locked_accounts(restriction_id,user_id,previous_status) VALUES ($1,$2,'LOCKED')",
            [active, actor],
          ),
          "23514",
          "supplier_restriction_locked_accounts_previous_status",
        );
        await rejects(
          client.query(
            "INSERT INTO foodprint.account_status_histories(user_id,from_status,to_status,reason,actor_user_id) VALUES ($1,'LOCKED','LOCKED','x',$1)",
            [actor],
          ),
          "23514",
          "account_status_histories_change",
        );
        await rejects(
          client.query(
            "INSERT INTO foodprint.account_status_histories(user_id,from_status,to_status,reason,actor_user_id) VALUES ($1,'ACTIVE','LOCKED',' ',$1)",
            [actor],
          ),
          "23514",
          "account_status_histories_reason",
        );
      } finally {
        await client.end();
      }
    },
  );

  await context.test(
    "food_safety_inspections: result columns follow status, findings keyed by inspection and supplier",
    async () => {
      const name = `foodprint_migration_test_inspection_${randomUUID().replaceAll("-", "")}`;
      await db.query(`CREATE DATABASE "${name}"`);
      recordLocalTestDatabase(name);
      const fresh = new URL(url);
      fresh.pathname = `/${name}`;
      const client = new Client({ connectionString: fresh.toString() });
      await client.connect();
      try {
        await client.query(
          "CREATE SCHEMA IF NOT EXISTS foodprint; SET search_path = foodprint, public;",
        );
        for (const version of migrationNames.filter(
          (value) => value <= "20261201000100_food_safety_inspections",
        ))
          await client.query(
            await readFile(
              path.join(root, "prisma/migrations", version, "migration.sql"),
              "utf8",
            ),
          );
        await client.query("SET search_path = public;");
        const one = async (sql: string, values: unknown[] = []) =>
          (await client.query<{ id: string }>(sql, values)).rows[0].id;
        const school = await one(
          "INSERT INTO foodprint.schools(name) VALUES ('Inspection school') RETURNING id",
        );
        const incident = await one(
          "INSERT INTO foodprint.food_safety_incidents(school_id,title,description,status,source) VALUES ($1,'Sự cố','Legacy','UNDER_INSPECTION','LEGACY_IMPORT') RETURNING id",
          [school],
        );
        const officerRole = await one(
          "INSERT INTO foodprint.roles(code,name,type) VALUES ('SCHOOL_MANAGEMENT_BOARD','BGH','SCHOOL') RETURNING id",
        );
        const actor = await one(
          "INSERT INTO foodprint.users(role_id,role_code,school_id,username,email,password_hash,full_name,status) VALUES ($1,'SCHOOL_MANAGEMENT_BOARD',$2,'inspection-actor','inspection-actor@example.test','fixture','Actor','ACTIVE') RETURNING id",
          [officerRole, school],
        );
        const supplier = await one(
          "INSERT INTO foodprint.suppliers(name) VALUES ('Inspection supplier') RETURNING id",
        );
        const insert = (fields: Record<string, unknown>) => {
          const row: Record<string, unknown> = {
            incident_id: incident,
            team_description: "Đoàn kiểm tra",
            scheduled_at: new Date(),
            created_by_user_id: actor,
            ...fields,
          };
          const keys = Object.keys(row);
          return client.query<{ id: string }>(
            `INSERT INTO foodprint.food_safety_inspections(${keys.join(",")}) VALUES (${keys.map((_, index) => `$${index + 1}`).join(",")}) RETURNING id`,
            keys.map((key) => row[key]),
          );
        };
        const rejects = (fields: Record<string, unknown>, constraint: string) =>
          assert.rejects(insert(fields), (error) =>
            sqlState(error, "23514", constraint),
          );
        const result = {
          status: "COMPLETED",
          result_summary: "Phát hiện thịt quá hạn",
          overall_conclusion: "SUPPLIER_AT_FAULT",
          recorded_by_user_id: actor,
          completed_at: new Date(),
        };
        await rejects(
          { team_description: "   " },
          "food_safety_inspections_team_description",
        );
        await rejects(
          { result_summary: "Có kết quả" },
          "food_safety_inspections_result",
        );
        await rejects(
          { ...result, completed_at: null },
          "food_safety_inspections_result",
        );
        await rejects(
          { ...result, result_summary: " " },
          "food_safety_inspections_result",
        );
        const planned = (await insert({})).rows[0].id;
        const completed = (await insert(result)).rows[0].id;
        assert.ok(planned);
        const finding = (finding: string) =>
          client.query(
            "INSERT INTO foodprint.food_safety_inspection_supplier_findings(inspection_id,supplier_id,finding) VALUES ($1,$2,$3)",
            [completed, supplier, finding],
          );
        await finding("AT_FAULT");
        await assert.rejects(finding("CLEARED"), (error) =>
          sqlState(
            error,
            "23505",
            "food_safety_inspection_supplier_findings_pkey",
          ),
        );
      } finally {
        await client.end();
      }
    },
  );

  await context.test(
    "food_safety_incident_trace_snapshots: keeps PR5 rows NULL, enforces completeness, hash and same-incident snapshot FK",
    async () => {
      const migration = "20261130000100_food_safety_incident_trace_snapshots";
      const name = `foodprint_migration_test_snapshot_${randomUUID().replaceAll("-", "")}`;
      await db.query(`CREATE DATABASE "${name}"`);
      recordLocalTestDatabase(name);
      const fresh = new URL(url);
      fresh.pathname = `/${name}`;
      const client = new Client({ connectionString: fresh.toString() });
      await client.connect();
      const apply = async (version: string) =>
        client.query(
          await readFile(
            path.join(root, "prisma/migrations", version, "migration.sql"),
            "utf8",
          ),
        );
      const placeholders = (count: number) =>
        Array.from({ length: count }, (_, index) => `$${index + 1}`).join(",");
      try {
        await client.query(
          "CREATE SCHEMA IF NOT EXISTS foodprint; SET search_path = foodprint, public;",
        );
        for (const version of migrationNames.filter(
          (value) => value < migration,
        ))
          await apply(version);
        await client.query("SET search_path = public;");
        const one = async (sql: string, values: unknown[] = []) =>
          (await client.query<{ id: string }>(sql, values)).rows[0].id;
        const school = await one(
          "INSERT INTO foodprint.schools(name) VALUES ('Snapshot school') RETURNING id",
        );
        const unit = await one(
          "INSERT INTO foodprint.commune_food_safety_units(code,name) VALUES ('SNAP-A','Unit A') RETURNING id",
        );
        const boardRole = await one(
          "INSERT INTO foodprint.roles(code,name,type) VALUES ('SCHOOL_MANAGEMENT_BOARD','BGH','SCHOOL') RETURNING id",
        );
        const board = await one(
          "INSERT INTO foodprint.users(role_id,role_code,school_id,username,email,password_hash,full_name,status) VALUES ($1,'SCHOOL_MANAGEMENT_BOARD',$2,'snapshot-board','snapshot-board@example.test','fixture','Board','ACTIVE') RETURNING id",
          [boardRole, school],
        );
        let sequence = 20000;
        const incident = (status: string) => {
          const row: Record<string, unknown> = {
            school_id: school,
            title: "Sự cố",
            description: "Nhiều học sinh đau bụng",
            status,
            source: "SCHOOL_DIRECT",
            reported_by_user_id: board,
            reported_role_code: "SCHOOL_MANAGEMENT_BOARD",
            reported_symptomatic_count: 3,
            code: `FP-IC-${++sequence}`,
          };
          if (status !== "PENDING_SCHOOL_REVIEW")
            Object.assign(row, {
              school_preliminary_assessment: "UNDETERMINED",
              school_reviewed_by_user_id: board,
              school_reviewed_at: new Date(),
              recipient_commune_food_safety_unit_id: unit,
            });
          const keys = Object.keys(row);
          return one(
            `INSERT INTO foodprint.food_safety_incidents(${keys.join(",")}) VALUES (${placeholders(keys.length)}) RETURNING id`,
            keys.map((key) => row[key]),
          );
        };
        // Hồ sơ PR5 đã chuyển ATTP trước PR5b: migration không được hỏng, giữ NULL.
        const before = await incident("SUBMITTED_TO_AUTHORITY");
        await client.query(
          "INSERT INTO foodprint.food_safety_report_forwardings(incident_id,recipient_organization,recipient_commune_food_safety_unit_id) VALUES ($1,'Unit A',$2)",
          [before, unit],
        );
        await client.query("SET search_path = foodprint, public;");
        await apply(migration);
        await client.query("SET search_path = public;");
        const kept = await client.query<{ trace_completeness: string | null }>(
          "SELECT trace_completeness FROM foodprint.food_safety_incidents WHERE id=$1",
          [before],
        );
        assert.equal(kept.rows[0].trace_completeness, null);
        assert.equal(
          (
            await client.query(
              "SELECT 1 FROM foodprint.food_safety_report_forwardings WHERE incident_id=$1 AND trace_snapshot_id IS NULL",
              [before],
            )
          ).rowCount,
          1,
        );

        const pending = await incident("PENDING_SCHOOL_REVIEW");
        await assert.rejects(
          client.query(
            "UPDATE foodprint.food_safety_incidents SET trace_completeness='MISSING' WHERE id=$1",
            [pending],
          ),
          (error) =>
            sqlState(
              error,
              "23514",
              "food_safety_incidents_trace_completeness",
            ),
        );
        const hash = `0x${"a".repeat(64)}`;
        const snapshot = (fields: Record<string, unknown>) => {
          const row: Record<string, unknown> = {
            incident_id: before,
            version: 1,
            completeness: "MISSING",
            missing_reasons: JSON.stringify([{ code: "NO_ALLOCATIONS" }]),
            payload: JSON.stringify({ incident: { id: before } }),
            payload_hash: hash,
            created_by_user_id: board,
            ...fields,
          };
          const keys = Object.keys(row);
          return client.query<{ id: string }>(
            `INSERT INTO foodprint.food_safety_incident_trace_snapshots(${keys.join(",")}) VALUES (${placeholders(keys.length)}) RETURNING id`,
            keys.map((key) => row[key]),
          );
        };
        const rejects = async (
          fields: Record<string, unknown>,
          constraint: string,
        ) =>
          assert.rejects(snapshot(fields), (error) =>
            sqlState(error, "23514", constraint),
          );
        await rejects(
          { version: 0 },
          "food_safety_incident_trace_snapshots_version",
        );
        await rejects(
          { payload_hash: hash.toUpperCase() },
          "food_safety_incident_trace_snapshots_hash",
        );
        await rejects(
          { hash_algorithm: "SHA-256" },
          "food_safety_incident_trace_snapshots_hash",
        );
        await rejects(
          { payload: "[]" },
          "food_safety_incident_trace_snapshots_payload",
        );
        await rejects(
          { completeness: "COMPLETE" },
          "food_safety_incident_trace_snapshots_missing",
        );
        await rejects(
          { missing_reasons: "[]" },
          "food_safety_incident_trace_snapshots_missing",
        );
        await rejects(
          { missing_reasons: "{}" },
          "food_safety_incident_trace_snapshots_missing",
        );
        const v1 = (await snapshot({})).rows[0].id;
        await snapshot({
          version: 2,
          completeness: "COMPLETE",
          missing_reasons: "[]",
        });
        await assert.rejects(snapshot({}), (error) =>
          sqlState(
            error,
            "23505",
            "food_safety_incident_trace_snapshots_incident_id_version_key",
          ),
        );
        const other = await incident("SUBMITTED_TO_AUTHORITY");
        const forward = (incidentId: string) =>
          client.query(
            "INSERT INTO foodprint.food_safety_report_forwardings(incident_id,recipient_organization,trace_snapshot_id) VALUES ($1,'Unit A',$2)",
            [incidentId, v1],
          );
        await forward(before);
        await assert.rejects(forward(other), (error) =>
          sqlState(
            error,
            "23503",
            "food_safety_report_forwardings_trace_snapshot_fkey",
          ),
        );
      } finally {
        await client.end();
      }
    },
  );

  await context.test(
    "authority_complaints: AUTHORITY parent with FP-AC code, one C05 per C03, one ATTP unit per ward",
    async () => {
      const migration = "20261128000100_authority_complaints";
      const name = `foodprint_migration_test_ac_${randomUUID().replaceAll("-", "")}`;
      await db.query(`CREATE DATABASE "${name}"`);
      recordLocalTestDatabase(name);
      const fresh = new URL(url);
      fresh.pathname = `/${name}`;
      const client = new Client({ connectionString: fresh.toString() });
      await client.connect();
      try {
        await client.query(
          "CREATE SCHEMA IF NOT EXISTS foodprint; SET search_path = foodprint, public;",
        );
        for (const version of migrationNames.filter(
          (value) => value <= migration,
        ))
          await client.query(
            await readFile(
              path.join(root, "prisma/migrations", version, "migration.sql"),
              "utf8",
            ),
          );
        await client.query("SET search_path = public;");
        const seeded = await client.query<{
          user_id: string;
          school_id: string;
          portion_id: string;
          ward_id: string;
          unit_id: string;
          unit2_id: string;
        }>(`
          WITH ward AS (
            INSERT INTO foodprint.locations(code,name,type,level) VALUES ('W-AC','Phường AC','WARD',2) RETURNING id
          ), school AS (
            INSERT INTO foodprint.schools(name,location_id) SELECT 'AC school',id FROM ward RETURNING id
          ), unit AS (
            INSERT INTO foodprint.commune_food_safety_units(code,name,location_id) SELECT 'ATTP-AC','ATTP AC',id FROM ward RETURNING id
          ), unit2 AS (
            INSERT INTO foodprint.commune_food_safety_units(code,name) VALUES ('ATTP-AC2','ATTP AC 2') RETURNING id
          ), role AS (
            INSERT INTO foodprint.roles(code,name,type) VALUES ('PARENTS_COMMITTEE','Parent','SCHOOL') RETURNING id
          ), actor AS (
            INSERT INTO foodprint.users(role_id,role_code,school_id,username,email,password_hash,full_name)
            SELECT role.id,'PARENTS_COMMITTEE',school.id,'ac_test','ac@example.test','test-only','Parent'
            FROM role, school RETURNING id
          ), classroom AS (
            INSERT INTO foodprint.classes(school_id,name) SELECT id,'5A' FROM school RETURNING id
          ), portion AS (
            INSERT INTO foodprint.daily_meal_portions(class_id,confirmed_by_user_id,meal_date,meal_type,total_portions)
            SELECT classroom.id,actor.id,'2026-11-20','LUNCH',30 FROM classroom,actor RETURNING id
          )
          SELECT actor.id AS user_id, school.id AS school_id, portion.id AS portion_id,
                 ward.id AS ward_id, unit.id AS unit_id, unit2.id AS unit2_id
          FROM actor, school, portion, ward, unit, unit2
        `);
        const row = seeded.rows[0];
        // Mỗi phường/xã gắn tối đa một đơn vị ATTP.
        await assert.rejects(
          client.query(
            "UPDATE foodprint.commune_food_safety_units SET location_id = $1 WHERE id = $2",
            [row.ward_id, row.unit2_id],
          ),
          (error: unknown) =>
            sqlState(
              error,
              "23505",
              "uq_commune_food_safety_units_location_id",
            ),
        );
        const insertComplaint = (columns: string, values: string) =>
          client.query<{ id: string }>(
            `INSERT INTO foodprint.complaints(sender_user_id,sender_role_code,title,description,${columns})
             VALUES($1,'PARENTS_COMMITTEE','Tiêu đề','Mô tả',${values}) RETURNING id`,
            [row.user_id],
          );
        const meal = await insertComplaint("kind,code", "'MEAL','FP-MC-22345'");
        const mealId = meal.rows[0].id;
        await client.query(
          `INSERT INTO foodprint.meal_complaints(id,school_id,daily_meal_portion_id,complaint_type)
           VALUES($1,$2,$3,'OTHER')`,
          [mealId, row.school_id, row.portion_id],
        );
        const insertChild = (id: string, kind = "AUTHORITY", source = mealId) =>
          client.query(
            `INSERT INTO foodprint.authority_complaints(id,kind,school_id,recipient_commune_food_safety_unit_id,escalated_from_meal_complaint_id)
             VALUES($1,$2,$3,$4,$5)`,
            [id, kind, row.school_id, row.unit_id, source],
          );
        const c05 = await insertComplaint(
          "kind,code",
          "'AUTHORITY','FP-AC-12345'",
        );
        await insertChild(c05.rows[0].id);
        await assert.rejects(
          insertComplaint("kind,code", "'AUTHORITY','FP-MC-12346'"),
          (error: unknown) => sqlState(error, "23514", "complaints_code_kind"),
        );
        const second = await insertComplaint(
          "kind,code",
          "'AUTHORITY','FP-AC-12347'",
        );
        await assert.rejects(insertChild(second.rows[0].id), (error: unknown) =>
          sqlState(error, "23505", "uq_authority_complaints_escalated_from"),
        );
        await assert.rejects(
          insertChild(second.rows[0].id, "AUTHORITY", randomUUID()),
          (error: unknown) =>
            sqlState(
              error,
              "23503",
              "authority_complaints_escalated_from_fkey",
            ),
        );
        const meal2 = await insertComplaint(
          "kind,code",
          "'MEAL','FP-MC-22346'",
        );
        const meal2Id = meal2.rows[0].id;
        await client.query(
          `INSERT INTO foodprint.meal_complaints(id,school_id,daily_meal_portion_id,complaint_type)
           VALUES($1,$2,$3,'OTHER')`,
          [meal2Id, row.school_id, row.portion_id],
        );
        await assert.rejects(
          insertChild(meal2Id, "AUTHORITY", meal2Id),
          (error: unknown) =>
            sqlState(error, "23503", "authority_complaints_id_kind_fkey"),
        );
        await assert.rejects(
          insertChild(meal2Id, "MEAL", meal2Id),
          (error: unknown) =>
            sqlState(error, "23514", "authority_complaints_kind"),
        );
      } finally {
        await client.end();
        await db.query(`DROP DATABASE "${name}"`);
      }
    },
  );
  await context.test(
    "system_complaints child table only accepts SYSTEM parents with FP-SC codes",
    async () => {
      const migration = "20261127000100_system_complaints";
      const name = `foodprint_migration_test_sc_${randomUUID().replaceAll("-", "")}`;
      await db.query(`CREATE DATABASE "${name}"`);
      recordLocalTestDatabase(name);
      const fresh = new URL(url);
      fresh.pathname = `/${name}`;
      const client = new Client({ connectionString: fresh.toString() });
      await client.connect();
      try {
        await client.query(
          "CREATE SCHEMA IF NOT EXISTS foodprint; SET search_path = foodprint, public;",
        );
        for (const version of migrationNames.filter(
          (value) => value <= migration,
        ))
          await client.query(
            await readFile(
              path.join(root, "prisma/migrations", version, "migration.sql"),
              "utf8",
            ),
          );
        await client.query("SET search_path = public;");
        const seeded = await client.query<{ user_id: string }>(`
          WITH role AS (
            INSERT INTO foodprint.roles(code,name,type) VALUES ('INGREDIENT_SUPPLIER_STAFF','Staff','SUPPLIER') RETURNING id
          ), supplier AS (
            INSERT INTO foodprint.suppliers(name) VALUES ('SC supplier') RETURNING id
          ), actor AS (
            INSERT INTO foodprint.users(role_id,role_code,supplier_id,username,email,password_hash,full_name)
            SELECT role.id,'INGREDIENT_SUPPLIER_STAFF',supplier.id,'sc_test','sc@example.test','test-only','Staff'
            FROM role, supplier RETURNING id
          )
          SELECT actor.id AS user_id FROM actor
        `);
        const userId = seeded.rows[0].user_id;
        const insertComplaint = (columns: string, values: string) =>
          client.query<{ id: string }>(
            `INSERT INTO foodprint.complaints(sender_user_id,sender_role_code,title,description,${columns})
             VALUES($1,'INGREDIENT_SUPPLIER_STAFF','Tiêu đề','Mô tả',${values}) RETURNING id`,
            [userId],
          );
        const system = await insertComplaint(
          "kind,code",
          "'SYSTEM','FP-SC-12345'",
        );
        const systemId = system.rows[0].id;
        await client.query(
          "INSERT INTO foodprint.system_complaints(id,category) VALUES($1,'TECHNICAL')",
          [systemId],
        );
        await assert.rejects(
          insertComplaint("kind,code", "'SYSTEM','FP-CP-12346'"),
          (error: unknown) => sqlState(error, "23514", "complaints_code_kind"),
        );
        await assert.rejects(
          insertComplaint(
            "kind,code,status,close_reason,closed_at,closed_by_user_id",
            "'SYSTEM','FP-SC-12347','CLOSED','ESCALATED',now(),$1",
          ),
          (error: unknown) =>
            sqlState(error, "23514", "complaints_escalated_kind"),
        );
        const meal = await insertComplaint("kind,code", "'MEAL','FP-MC-12348'");
        await assert.rejects(
          client.query(
            "INSERT INTO foodprint.system_complaints(id,category) VALUES($1,'OTHER')",
            [meal.rows[0].id],
          ),
          (error: unknown) =>
            sqlState(error, "23503", "system_complaints_id_kind_fkey"),
        );
        await assert.rejects(
          client.query(
            "INSERT INTO foodprint.system_complaints(id,kind,category) VALUES($1,'MEAL','OTHER')",
            [meal.rows[0].id],
          ),
          (error: unknown) =>
            sqlState(error, "23514", "system_complaints_kind"),
        );
        await assert.rejects(
          client.query(
            "INSERT INTO foodprint.system_complaints(id,category) VALUES($1,'BILLING')",
            [systemId],
          ),
          /invalid input value for enum/,
        );

        // specs/remove-system-complaints: migration gỡ C06 xóa dữ liệu FP-SC, giữ đơn loại khác.
        await client.query(
          `INSERT INTO foodprint.complaint_comments(complaint_id,author_user_id,author_role_code,author_side,comment_type,content)
           VALUES($1,$2,'INGREDIENT_SUPPLIER_STAFF','REQUESTER','MESSAGE','Bổ sung')`,
          [systemId, userId],
        );
        await client.query(
          `INSERT INTO foodprint.complaint_status_histories(complaint_id,to_status,actor_type,actor_user_id,actor_role_code)
           VALUES($1,'NEW','USER',$2,'INGREDIENT_SUPPLIER_STAFF')`,
          [systemId, userId],
        );
        const grant = await client.query<{ id: string }>(`
          WITH permission AS (
            INSERT INTO foodprint.permissions(code,name,module,action)
            VALUES ('system_complaint.submit','Gửi','system_complaint','submit') RETURNING id
          )
          INSERT INTO foodprint.role_permissions(role_id,permission_id)
          SELECT role.id, permission.id FROM foodprint.roles role, permission
          WHERE role.code = 'INGREDIENT_SUPPLIER_STAFF' RETURNING permission_id AS id
        `);
        assert.equal(grant.rowCount, 1);
        const removal = "20261209000100_remove_system_complaints";
        await client.query("SET search_path = foodprint, public;");
        for (const version of migrationNames.filter(
          (value) => value > migration && value <= removal,
        )) {
          if (version === "20261203000100_complaint_email_outbox") {
            await client.query(
              await readFile(
                path.join(root, "prisma/migrations", version, "migration.sql"),
                "utf8",
              ),
            );
            await client.query(
              `INSERT INTO foodprint.email_outbox(complaint_id,complaint_event,recipient_email,subject,text,html)
               VALUES($1,'CREATED','sc@example.test','s','t','h')`,
              [systemId],
            );
            continue;
          }
          await client.query(
            await readFile(
              path.join(root, "prisma/migrations", version, "migration.sql"),
              "utf8",
            ),
          );
        }
        await client.query("SET search_path = public;");
        const remaining = await client.query<{
          system: number;
          meal: number;
          comments: number;
          histories: number;
          outbox: number;
          permissions: number;
          grants: number;
          table: string | null;
          category: string | null;
        }>(`
          SELECT
            (SELECT count(*)::int FROM foodprint.complaints WHERE kind = 'SYSTEM') AS system,
            (SELECT count(*)::int FROM foodprint.complaints WHERE id = '${meal.rows[0].id}') AS meal,
            (SELECT count(*)::int FROM foodprint.complaint_comments) AS comments,
            (SELECT count(*)::int FROM foodprint.complaint_status_histories) AS histories,
            (SELECT count(*)::int FROM foodprint.email_outbox) AS outbox,
            (SELECT count(*)::int FROM foodprint.permissions WHERE code LIKE 'system_complaint.%') AS permissions,
            (SELECT count(*)::int FROM foodprint.role_permissions WHERE permission_id = '${grant.rows[0].id}') AS grants,
            to_regclass('foodprint.system_complaints')::text AS table,
            to_regtype('foodprint.system_complaint_category')::text AS category
        `);
        assert.deepEqual(remaining.rows[0], {
          system: 0,
          meal: 1,
          comments: 0,
          histories: 0,
          outbox: 0,
          permissions: 0,
          grants: 0,
          table: null,
          category: null,
        });
        await assert.rejects(
          insertComplaint("kind,code", "'SYSTEM','FP-SC-12349'"),
          (error: unknown) =>
            sqlState(error, "23514", "chk_complaints_kind_not_system"),
        );
      } finally {
        await client.end();
        await db.query(`DROP DATABASE "${name}"`);
      }
    },
  );
  await context.test(
    "complaint migration preserves existing meal and response",
    async () => {
      const migration =
        "20261113000100_link_meal_complaints_to_daily_meal_portions";
      const name = `foodprint_migration_test_complaints_${randomUUID().replaceAll("-", "")}`;
      await db.query(`CREATE DATABASE "${name}"`);
      recordLocalTestDatabase(name);
      const fresh = new URL(url);
      fresh.pathname = `/${name}`;
      const legacy = new Client({ connectionString: fresh.toString() });
      await legacy.connect();
      try {
        for (const version of migrationNames.filter(
          (value) => value < migration,
        ))
          await legacy.query(
            await readFile(
              path.join(root, "prisma/migrations", version, "migration.sql"),
              "utf8",
            ),
          );
        const before = await legacy.query(`
        WITH school AS (
          INSERT INTO foodprint.schools(name) VALUES ('Complaint migration school') RETURNING id
        ), role AS (
          INSERT INTO foodprint.roles(code,name,type) VALUES ('HOMEROOM_TEACHER','Teacher','SCHOOL') RETURNING id
        ), actor AS (
          INSERT INTO foodprint.users(role_id,role_code,school_id,username,email,password_hash,full_name)
          SELECT role.id,'HOMEROOM_TEACHER',school.id,'complaint_test','complaint@example.test','test-only','Teacher'
          FROM role, school RETURNING id
        ), classroom AS (
          INSERT INTO foodprint.classes(school_id,name) SELECT id,'5A' FROM school RETURNING id
        ), portion AS (
          INSERT INTO foodprint.daily_meal_portions(class_id,confirmed_by_user_id,meal_date,meal_type,total_portions)
          SELECT classroom.id,actor.id,'2026-11-12','LUNCH',30 FROM classroom,actor RETURNING id
        ), allocation AS (
          INSERT INTO foodprint.meal_allocations(daily_meal_portion_id,created_by_user_id)
          SELECT portion.id,actor.id FROM portion,actor RETURNING id,daily_meal_portion_id
        ), complaint AS (
          INSERT INTO foodprint.meal_complaints
            (meal_allocation_id,submitted_by_user_id,complaint_type,description,status,handled_by_user_id,resolution,resolved_at)
          SELECT allocation.id,actor.id,'OTHER','Original description','RESOLVED',actor.id,'Original resolution',now()
          FROM allocation,actor
          RETURNING *
        )
        SELECT (to_jsonb(complaint) - 'meal_allocation_id') ||
          jsonb_build_object('daily_meal_portion_id', allocation.daily_meal_portion_id) AS row
        FROM complaint, allocation
      `);
        await legacy.query(
          await readFile(
            path.join(root, "prisma/migrations", migration, "migration.sql"),
            "utf8",
          ),
        );
        const after = await legacy.query(
          "SELECT to_jsonb(c) AS row FROM foodprint.meal_complaints c",
        );
        assert.deepEqual(after.rows, before.rows);
        await legacy.query(`
          INSERT INTO foodprint.roles (code, name, type)
          VALUES ('PARENTS_COMMITTEE', 'Parent committee', 'SCHOOL');
          INSERT INTO foodprint.permissions (code, name, module, action)
          VALUES ('meal_complaint.view', 'Read complaints', 'meal_complaint', 'view');
        `);
        const grant = await readFile(
          path.join(
            root,
            "prisma/migrations/20261113000200_grant_parent_meal_complaint_view/migration.sql",
          ),
          "utf8",
        );
        await legacy.query(grant);
        await legacy.query(grant);
        const grants = await legacy.query(`
          SELECT role.code AS role, permission.code AS permission
          FROM foodprint.role_permissions AS grant_row
          JOIN foodprint.roles AS role ON role.id = grant_row.role_id
          JOIN foodprint.permissions AS permission ON permission.id = grant_row.permission_id
        `);
        assert.deepEqual(grants.rows, [
          { role: "PARENTS_COMMITTEE", permission: "meal_complaint.view" },
        ]);
      } finally {
        await legacy.end();
      }
    },
  );
  await context.test(
    "account lifecycle upgrade rejects ambiguous legacy data and preserves reports",
    async () => {
      const name = `foodprint_migration_test_intake_${randomUUID().replaceAll("-", "")}`;
      await db.query(`CREATE DATABASE "${name}"`);
      recordLocalTestDatabase(name);
      const fresh = new URL(url);
      fresh.pathname = `/${name}`;
      const legacy = new Client({ connectionString: fresh.toString() });
      await legacy.connect();
      try {
        const migration = "20261112000100_account_lifecycle_intake";
        for (const previous of migrationNames.filter(
          (value) => value < migration,
        )) {
          await legacy.query(
            await readFile(
              path.join(root, "prisma/migrations", previous, "migration.sql"),
              "utf8",
            ),
          );
        }
        const sql = await readFile(
          path.join(root, "prisma/migrations", migration, "migration.sql"),
          "utf8",
        );
        const role = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.roles(code,name,type) VALUES ('COMMUNE_FOOD_SAFETY_OFFICER','Officer','AUTHORITY') RETURNING id",
          )
        ).rows[0].id;
        const unit = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.commune_food_safety_units(code,name) VALUES ('LEGACY-A','Unit A') RETURNING id",
          )
        ).rows[0].id;
        const unitB = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.commune_food_safety_units(code,name) VALUES ('LEGACY-B','Unit B') RETURNING id",
          )
        ).rows[0].id;
        const insertOfficer = async (unitId: string, username: string) =>
          (
            await legacy.query<{ id: string }>(
              "INSERT INTO foodprint.users(role_id,role_code,commune_food_safety_unit_id,username,email,password_hash,full_name,status) VALUES ($1,'COMMUNE_FOOD_SAFETY_OFFICER',$2,$3,$4,'fixture','Officer','INACTIVE') RETURNING id",
              [role, unitId, username, `${username}@example.test`],
            )
          ).rows[0].id;
        const officer = await insertOfficer(unit, "legacy-officer-one");
        const duplicate = await insertOfficer(unit, "legacy-officer-two");
        await assert.rejects(legacy.query(sql), (error) =>
          sqlState(error, "P0001"),
        );
        await legacy.query("ROLLBACK");
        assert.equal(
          (
            await legacy.query<{ count: number }>(
              "SELECT count(*)::int AS count FROM foodprint.users",
            )
          ).rows[0].count,
          2,
        );
        await legacy.query("DELETE FROM foodprint.users WHERE id=$1", [
          duplicate,
        ]);
        const school = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.schools(name) VALUES ('Legacy school') RETURNING id",
          )
        ).rows[0].id;
        const incident = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.food_safety_incidents(school_id,title,description) VALUES ($1,'Incident','Legacy') RETURNING id",
            [school],
          )
        ).rows[0].id;
        const report = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.food_safety_report_forwardings(incident_id,recipient_commune_food_safety_unit_id,recipient_organization,status,forwarded_at) VALUES ($1,$2,'Unit B','SENT',now()) RETURNING id",
            [incident, unitB],
          )
        ).rows[0].id;
        await assert.rejects(legacy.query(sql), (error) =>
          sqlState(error, "P0001"),
        );
        await legacy.query("ROLLBACK");
        const officerB = await insertOfficer(unitB, "legacy-officer-three");
        const external = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.food_safety_report_forwardings(incident_id,recipient_organization) VALUES ($1,'External') RETURNING id",
            [incident],
          )
        ).rows[0].id;
        await legacy.query(sql);
        const rows = (
          await legacy.query<{
            id: string;
            recipient_user_id: string | null;
            received_at: Date | null;
          }>(
            "SELECT id,recipient_user_id,received_at FROM foodprint.food_safety_report_forwardings WHERE id=ANY($1::uuid[])",
            [[report, external]],
          )
        ).rows;
        assert.equal(
          rows.find((row) => row.id === report)?.recipient_user_id,
          officerB,
        );
        assert.equal(rows.find((row) => row.id === report)?.received_at, null);
        assert.equal(
          rows.find((row) => row.id === external)?.recipient_user_id,
          null,
        );
        assert.equal(
          (
            await legacy.query<{ count: number }>(
              "SELECT count(*)::int AS count FROM foodprint.users WHERE id=ANY($1::uuid[])",
              [[officer, officerB]],
            )
          ).rows[0].count,
          2,
        );
      } finally {
        await legacy.end();
      }
    },
  );
  await context.test(
    "late-merged migrations deploy after newer history without changing completed rows",
    async () => {
      const name = `foodprint_migration_test_late_${randomUUID().replaceAll("-", "")}`;
      await db.query(`CREATE DATABASE "${name}"`);
      recordLocalTestDatabase(name);
      const isolated = new URL(url);
      isolated.pathname = `/${name}`;
      const temporary = await mkdtemp(
        path.join(tmpdir(), "foodprint-023-migrations-"),
      );
      const directory = path.join(temporary, "migrations");
      const config = path.join(temporary, "prisma.config.ts");
      const late = new Set([
        "20261112000100_account_lifecycle_intake",
        "20261115000100_school_dish_categories",
      ]);
      const client = new Client({ connectionString: isolated.toString() });
      try {
        await mkdir(directory);
        await copyFile(
          path.join(root, "prisma/migrations/migration_lock.toml"),
          path.join(directory, "migration_lock.toml"),
        );
        const copyMigration = async (migration: string) => {
          await mkdir(path.join(directory, migration));
          await copyFile(
            path.join(root, "prisma/migrations", migration, "migration.sql"),
            path.join(directory, migration, "migration.sql"),
          );
        };
        for (const migration of migrationNames)
          if (!late.has(migration)) await copyMigration(migration);
        await writeFile(
          config,
          `import { defineConfig } from ${JSON.stringify(path.join(root, "node_modules/prisma/config.js"))};\nexport default defineConfig({ schema: ${JSON.stringify(path.join(root, "prisma/schema.prisma"))}, migrations: { path: ${JSON.stringify(directory)} }, datasource: { url: process.env.DATABASE_URL } });\n`,
        );
        await runPrisma(isolated.toString(), [
          "migrate",
          "deploy",
          "--config",
          config,
        ]);
        await client.connect();
        const readHistory = async () =>
          (
            await client.query<MigrationHistoryRow>(
              "SELECT migration_name,checksum,finished_at,rolled_back_at FROM foodprint._prisma_migrations ORDER BY migration_name",
            )
          ).rows;
        const before = await readHistory();
        assert.equal(before.length, migrationNames.length - late.size);
        const files = await readMigrationFiles();
        assert.deepEqual(
          pendingDeploymentMigrations(files, before),
          [...late].sort(),
        );
        for (const migration of late) await copyMigration(migration);
        await runPrisma(isolated.toString(), [
          "migrate",
          "deploy",
          "--config",
          config,
        ]);
        const after = await readHistory();
        assert.deepEqual(pendingDeploymentMigrations(files, after), []);
        assert.deepEqual(
          after.filter((row) => !late.has(row.migration_name)),
          before,
        );
        await runPrisma(isolated.toString(), [
          "migrate",
          "diff",
          "--from-config-datasource",
          "--to-schema",
          path.join(root, "prisma/schema.prisma"),
          "--exit-code",
          "--config",
          config,
        ]);
      } finally {
        await client.end();
        await db.query(`DROP DATABASE "${name}"`);
        await rm(temporary, { recursive: true, force: true });
      }
    },
  );
  await context.test(
    "grade FK preserves unassigned classes and enforces same-school membership",
    async () => {
      const rows = await db.query<{ id: string }>(
        "INSERT INTO foodprint.schools(name) VALUES ('Grade school A'), ('Grade school B') RETURNING id",
      );
      const [a, b] = rows.rows.map((row) => row.id);
      const {
        rows: [grade],
      } = await db.query<{ id: string }>(
        "INSERT INTO foodprint.school_grades(school_id,name) VALUES ($1,'Khối 5') RETURNING id",
        [a],
      );
      await db.query(
        "INSERT INTO foodprint.school_grades(school_id,name) VALUES ($1,'Khối 5')",
        [b],
      );
      await assert.rejects(
        db.query(
          "INSERT INTO foodprint.school_grades(school_id,name) VALUES ($1,'Khối 5')",
          [a],
        ),
        (error) => sqlState(error, "23505"),
      );
      const {
        rows: [classroom],
      } = await db.query<{ id: string; grade_id: string | null }>(
        "INSERT INTO foodprint.classes(school_id,name) VALUES ($1,'Grade test class') RETURNING id,grade_id",
        [b],
      );
      assert.equal(classroom.grade_id, null);
      await assert.rejects(
        db.query("UPDATE foodprint.classes SET grade_id=$1 WHERE id=$2", [
          grade.id,
          classroom.id,
        ]),
        (error) => sqlState(error, "23503"),
      );
    },
  );
  await context.test(
    "grade menu migration replaces the baseline constraint and permits distinct grade scopes",
    async () => {
      const school = (
        await db.query<{ id: string }>(
          "INSERT INTO foodprint.schools(name) VALUES ('Menu grade migration') RETURNING id",
        )
      ).rows[0];
      const user = (
        await db.query<{ id: string }>(
          "SELECT id FROM foodprint.users WHERE username = 'backfill_test'",
        )
      ).rows[0];
      const grades = (
        await db.query<{ id: string }>(
          "INSERT INTO foodprint.school_grades(school_id,name) VALUES ($1,'Khối 1'), ($1,'Khối 2') RETURNING id",
          [school.id],
        )
      ).rows;
      const menus = (
        await db.query<{ id: string }>(
          "INSERT INTO foodprint.weekly_menus(school_id,created_by_user_id,week_start_date,is_school_wide) VALUES ($1,$2,'2032-01-05',false), ($1,$2,'2032-01-05',false) RETURNING id",
          [school.id, user.id],
        )
      ).rows;
      await db.query(
        "INSERT INTO foodprint.weekly_menu_grades(weekly_menu_id,school_id,week_start_date,grade_id) VALUES ($1,$2,'2032-01-05',$3),($4,$2,'2032-01-05',$5)",
        [menus[0].id, school.id, grades[0].id, menus[1].id, grades[1].id],
      );
      await assert.rejects(
        db.query(
          "UPDATE foodprint.weekly_menu_grades SET grade_id=$1 WHERE weekly_menu_id=$2",
          [grades[0].id, menus[1].id],
        ),
        (error) => sqlState(error, "23505"),
      );
      await db.query(
        "INSERT INTO foodprint.weekly_menus(school_id,created_by_user_id,week_start_date) VALUES ($1,$2,'2032-01-12')",
        [school.id, user.id],
      );
      await assert.rejects(
        db.query(
          "INSERT INTO foodprint.weekly_menus(school_id,created_by_user_id,week_start_date) VALUES ($1,$2,'2032-01-12')",
          [school.id, user.id],
        ),
        (error) => sqlState(error, "23505"),
      );
    },
  );
  await context.test(
    "dish meal classification preserves legacy dishes and keeps cooking meal types unchanged",
    async () => {
      const name = `foodprint_migration_test_dishmeal_${randomUUID().replaceAll("-", "")}`;
      await db.query(`CREATE DATABASE "${name}"`);
      recordLocalTestDatabase(name);
      const target = new URL(url);
      target.pathname = `/${name}`;
      const local = new Client({ connectionString: target.toString() });
      await local.connect();
      try {
        const migration = "20261120000100_dish_meal_classification";
        for (const folder of migrationNames.filter(
          (value) => value < migration,
        )) {
          await local.query("SET search_path TO foodprint, public");
          await local.query(
            await readFile(
              path.join(root, "prisma/migrations", folder, "migration.sql"),
              "utf8",
            ),
          );
        }
        const school = (
          await local.query<{ id: string }>(
            "INSERT INTO foodprint.schools(name) VALUES ('Dish meal school') RETURNING id",
          )
        ).rows[0].id;
        const dish = (
          await local.query<{ id: string }>(
            "INSERT INTO foodprint.dishes(school_id,name,description) VALUES ($1,'Existing dish','Preserve recipe history') RETURNING id",
            [school],
          )
        ).rows[0].id;
        const fields =
          "id, school_id, name, category, category_id, description, status, created_at, updated_at";
        const before = (
          await local.query<Record<string, unknown>>(
            `SELECT ${fields} FROM foodprint.dishes WHERE id=$1`,
            [dish],
          )
        ).rows[0];
        await local.query(
          await readFile(
            path.join(root, "prisma/migrations", migration, "migration.sql"),
            "utf8",
          ),
        );
        assert.deepEqual(
          (
            await local.query<Record<string, unknown>>(
              `SELECT ${fields} FROM foodprint.dishes WHERE id=$1`,
              [dish],
            )
          ).rows[0],
          before,
        );
        assert.equal(
          (
            await local.query<{ meal_type: string | null }>(
              "SELECT meal_type FROM foodprint.dishes WHERE id=$1",
              [dish],
            )
          ).rows[0].meal_type,
          null,
        );
        for (const mealType of ["LUNCH", "AFTERNOON", "BOTH", null]) {
          await local.query(
            "UPDATE foodprint.dishes SET meal_type=$2 WHERE id=$1",
            [dish, mealType],
          );
          assert.equal(
            (
              await local.query<{ meal_type: string | null }>(
                "SELECT meal_type FROM foodprint.dishes WHERE id=$1",
                [dish],
              )
            ).rows[0].meal_type,
            mealType,
          );
        }
        assert.deepEqual(
          (
            await local.query<{ value: string }>(
              "SELECT unnest(enum_range(NULL::foodprint.meal_type))::text value",
            )
          ).rows.map((row) => row.value),
          ["LUNCH", "AFTERNOON"],
        );
        await assert.rejects(
          local.query(
            "UPDATE foodprint.dishes SET meal_type='BREAKFAST' WHERE id=$1",
            [dish],
          ),
          (error) => sqlState(error, "22P02"),
        );
      } finally {
        await local.end();
        await db.query(`DROP DATABASE "${name}"`);
      }
    },
  );
  await context.test(
    "new batches require exactly one dish while legacy multi-dish history survives",
    async () => {
      const name = `foodprint_migration_test_single_${randomUUID().replaceAll("-", "")}`;
      await db.query(`CREATE DATABASE "${name}"`);
      recordLocalTestDatabase(name);
      const target = new URL(url);
      target.pathname = `/${name}`;
      const local = new Client({ connectionString: target.toString() });
      await local.connect();
      try {
        const migration = "20261117000100_single_dish_new_batches";
        await local.query("SET search_path TO foodprint, public");
        for (const folder of migrationNames.filter(
          (value) => value < migration,
        )) {
          await local.query(
            await readFile(
              path.join(root, "prisma/migrations", folder, "migration.sql"),
              "utf8",
            ),
          );
        }
        await local.query("SET search_path TO foodprint, public");
        const school = (
          await local.query<{ id: string }>(
            "INSERT INTO foodprint.schools(name) VALUES ('Single dish school') RETURNING id",
          )
        ).rows[0].id;
        const role = (
          await local.query<{ id: string }>(
            "INSERT INTO foodprint.roles(code,name,type) VALUES('SCHOOL_KITCHEN_STAFF','Chef','SCHOOL') RETURNING id",
          )
        ).rows[0].id;
        const user = (
          await local.query<{ id: string }>(
            "INSERT INTO foodprint.users(role_id,role_code,school_id,username,email,password_hash,full_name) VALUES($1,'SCHOOL_KITCHEN_STAFF',$2,'single_chef','single-chef@example.test','fixture-only','Chef') RETURNING id",
            [role, school],
          )
        ).rows[0].id;
        const week = (
          await local.query<{ id: string }>(
            "INSERT INTO foodprint.weekly_menus(school_id,created_by_user_id,week_start_date) VALUES($1,$2,'2030-01-07') RETURNING id",
            [school, user],
          )
        ).rows[0].id;
        const day = (
          await local.query<{ id: string }>(
            "INSERT INTO foodprint.menu_days(weekly_menu_id,menu_date) VALUES($1,'2030-01-07') RETURNING id",
            [week],
          )
        ).rows[0].id;
        const dishes = (
          await local.query<{ id: string }>(
            "INSERT INTO foodprint.dishes(school_id,name) VALUES($1,'A'),($1,'B') RETURNING id",
            [school],
          )
        ).rows.map((row) => row.id);
        await local.query(
          "INSERT INTO foodprint.menu_day_dishes(menu_day_id,dish_id,meal_type) VALUES($1,$2,'LUNCH'),($1,$3,'LUNCH')",
          [day, ...dishes],
        );
        const group = (
          await local.query<{ id: string }>(
            "INSERT INTO foodprint.cooking_batch_groups(batch_code,menu_day_id,meal_type,created_by_user_id) VALUES('GROUP',$1,'LUNCH',$2) RETURNING id",
            [day, user],
          )
        ).rows[0].id;
        const insertBatch = async (code: string) =>
          (
            await local.query<{ id: string }>(
              "INSERT INTO foodprint.cooking_batches(batch_code,batch_group_id,menu_day_id,meal_type,cooking_mode_applied,created_by_user_id) VALUES($1,$2,$3,'LUNCH','COMBINE_LOTS',$4) RETURNING id",
              [code, group, day, user],
            )
          ).rows[0].id;
        const insertDish = async (batch: string, dish: string) =>
          local.query(
            "INSERT INTO foodprint.cooking_batch_dishes(cooking_batch_id,dish_id,menu_day_id,meal_type) VALUES($1,$2,$3,'LUNCH')",
            [batch, dish, day],
          );
        const legacy = await insertBatch("LEGACY");
        await insertDish(legacy, dishes[0]);
        await insertDish(legacy, dishes[1]);
        await local.query(
          await readFile(
            path.join(root, "prisma/migrations", migration, "migration.sql"),
            "utf8",
          ),
        );
        assert.equal(
          Number(
            (
              await local.query<{ n: string }>(
                "SELECT count(*) n FROM foodprint.cooking_batch_dishes WHERE cooking_batch_id=$1",
                [legacy],
              )
            ).rows[0].n,
          ),
          2,
        );
        await assert.rejects(insertBatch("EMPTY"), (error) =>
          sqlState(error, "23514", "cooking_batch_requires_dish"),
        );
        await local.query("BEGIN");
        const single = await insertBatch("SINGLE");
        await insertDish(single, dishes[0]);
        await local.query("COMMIT");
        await assert.rejects(insertDish(single, dishes[1]), (error) =>
          sqlState(error, "23514", "cooking_batch_single_dish"),
        );
        await assert.rejects(
          local.query(
            "DELETE FROM foodprint.cooking_batch_dishes WHERE cooking_batch_id=$1",
            [single],
          ),
          (error) => sqlState(error, "23514", "cooking_batch_requires_dish"),
        );
        await local.query("DELETE FROM foodprint.cooking_batches WHERE id=$1", [
          single,
        ]);
      } finally {
        await local.end();
        await db.query(`DROP DATABASE "${name}"`);
      }
    },
  );

  await context.test(
    "supplier order creation migration backfills legacy deliveries, keeps multiple legacy deliveries per request, rejects inconsistent rows, and enforces mode constraints",
    async () => {
      const name = `foodprint_migration_test_soc_${randomUUID().replaceAll("-", "")}`;
      await db.query(`CREATE DATABASE "${name}"`);
      recordLocalTestDatabase(name);
      const fresh = new URL(url);
      fresh.pathname = `/${name}`;
      const legacy = new Client({ connectionString: fresh.toString() });
      await legacy.connect();
      try {
        await legacy.query("SET search_path TO foodprint, public");
        const migration = "20261116000200_supplier_order_creation";
        for (const previous of migrationNames.filter(
          (value) => value < migration,
        )) {
          await legacy.query(
            await readFile(
              path.join(root, "prisma/migrations", previous, "migration.sql"),
              "utf8",
            ),
          );
        }
        const sql = await readFile(
          path.join(root, "prisma/migrations", migration, "migration.sql"),
          "utf8",
        );
        const supplierRole = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.roles(code,name,type) VALUES ('INGREDIENT_SUPPLIER_ADMIN','Supplier Admin','SUPPLIER') RETURNING id",
          )
        ).rows[0].id;
        const schoolRole = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.roles(code,name,type) VALUES ('SCHOOL_ADMINISTRATION','School Admin','SCHOOL') RETURNING id",
          )
        ).rows[0].id;
        const school = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.schools(name) VALUES ('Legacy Delivery School') RETURNING id",
          )
        ).rows[0].id;
        const supplier = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.suppliers(name) VALUES ('Legacy Delivery Supplier A') RETURNING id",
          )
        ).rows[0].id;
        const otherSupplier = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.suppliers(name) VALUES ('Legacy Delivery Supplier B') RETURNING id",
          )
        ).rows[0].id;
        const supplierUser = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.users(role_id,role_code,supplier_id,username,email,password_hash,full_name,status) VALUES ($1,'INGREDIENT_SUPPLIER_ADMIN',$2,'legacy-sup','legacy-sup@example.test','hash','Legacy Supplier','ACTIVE') RETURNING id",
            [supplierRole, supplier],
          )
        ).rows[0].id;
        const schoolUser = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.users(role_id,role_code,school_id,username,email,password_hash,full_name,status) VALUES ($1,'SCHOOL_ADMINISTRATION',$2,'legacy-sch','legacy-sch@example.test','hash','Legacy School','ACTIVE') RETURNING id",
            [schoolRole, school],
          )
        ).rows[0].id;
        const ing1 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.ingredients(supplier_id,name,default_unit) VALUES ($1,'Gạo tẻ','kg') RETURNING id",
            [supplier],
          )
        ).rows[0].id;
        const ing2 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.ingredients(supplier_id,name,default_unit) VALUES ($1,'Dầu ăn','l') RETURNING id",
            [supplier],
          )
        ).rows[0].id;
        const entry1 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.ingredient_entries(school_id,ingredient_id,handling_type) VALUES ($1,$2,'DRY_STOCK') RETURNING id",
            [school, ing1],
          )
        ).rows[0].id;
        const entry2 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.ingredient_entries(school_id,ingredient_id,handling_type) VALUES ($1,$2,'DRY_STOCK') RETURNING id",
            [school, ing2],
          )
        ).rows[0].id;
        const sr1 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.supply_requests(request_no,school_id,supplier_id,created_by_user_id,status) VALUES ('SR-LEGACY-1',$1,$2,$3,'IN_PROGRESS') RETURNING id",
            [school, supplier, schoolUser],
          )
        ).rows[0].id;
        const sr2 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.supply_requests(request_no,school_id,supplier_id,created_by_user_id,status) VALUES ('SR-LEGACY-2',$1,$2,$3,'ACCEPTED') RETURNING id",
            [school, supplier, schoolUser],
          )
        ).rows[0].id;
        const sri1 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.supply_request_items(supply_request_id,ingredient_entry_id,requested_quantity,unit) VALUES ($1,$2,25.500,'kg') RETURNING id",
            [sr1, entry1],
          )
        ).rows[0].id;
        const sri2 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.supply_request_items(supply_request_id,ingredient_entry_id,requested_quantity,unit) VALUES ($1,$2,10.000,'l') RETURNING id",
            [sr1, entry2],
          )
        ).rows[0].id;
        const preservedUpdatedAt = "2025-05-01T10:20:30.000Z";
        const legacyD1 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.deliveries(delivery_no,supply_request_id,supplier_id,status,created_by_user_id,updated_at) VALUES ('DG-LEGACY-01',$1,$2,'REJECTED',$3,$4) RETURNING id",
            [sr1, supplier, supplierUser, preservedUpdatedAt],
          )
        ).rows[0].id;
        const legacyD2 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.deliveries(delivery_no,supply_request_id,supplier_id,status,created_by_user_id,received_by_user_id,received_at,updated_at) VALUES ('DG-LEGACY-02',$1,$2,'RECEIVED',$3,$4,$5,$5) RETURNING id",
            [sr1, supplier, supplierUser, schoolUser, preservedUpdatedAt],
          )
        ).rows[0].id;
        const legacyItem1 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.delivery_items(delivery_id,supply_request_item_id,actual_quantity,unit,note) VALUES ($1,$2,25.500,'kg','Lan 1') RETURNING id",
            [legacyD1, sri1],
          )
        ).rows[0].id;
        const legacyItem2 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.delivery_items(delivery_id,supply_request_item_id,actual_quantity,unit,note) VALUES ($1,$2,10.000,'l','Lan 2') RETURNING id",
            [legacyD2, sri2],
          )
        ).rows[0].id;
        await legacy.query(
          "INSERT INTO foodprint.delivery_approvals(delivery_id,user_id,role_id,decision,reason) VALUES ($1,$2,$3,'REJECT','Thieu hoa don')",
          [legacyD1, schoolUser, schoolRole],
        );

        const badDelivery = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.deliveries(delivery_no,supply_request_id,supplier_id,status,created_by_user_id) VALUES ('DG-BAD-SUP',$1,$2,'CREATED',$3) RETURNING id",
            [sr1, otherSupplier, supplierUser],
          )
        ).rows[0].id;
        await assert.rejects(legacy.query(sql), (error) =>
          sqlState(error, "P0001"),
        );
        await legacy.query("ROLLBACK");
        await legacy.query("DELETE FROM foodprint.deliveries WHERE id=$1", [
          badDelivery,
        ]);

        await legacy.query(sql);

        const backfilledDeliveries = (
          await legacy.query<{
            id: string;
            delivery_no: string;
            school_id: string;
            supply_request_id: string | null;
            creation_mode: string | null;
            creation_key: string | null;
            creation_fingerprint: string | null;
            status: string;
            updated_at: Date;
          }>(
            "SELECT id,delivery_no,school_id,supply_request_id,creation_mode,creation_key,creation_fingerprint,status,updated_at FROM foodprint.deliveries WHERE id=ANY($1::uuid[]) ORDER BY delivery_no ASC",
            [[legacyD1, legacyD2]],
          )
        ).rows;
        assert.equal(backfilledDeliveries.length, 2);
        assert.deepEqual(
          backfilledDeliveries.map((row) => ({
            id: row.id,
            delivery_no: row.delivery_no,
            school_id: row.school_id,
            supply_request_id: row.supply_request_id,
            creation_mode: row.creation_mode,
            creation_key: row.creation_key,
            creation_fingerprint: row.creation_fingerprint,
            updated_at: row.updated_at.toISOString(),
          })),
          [
            {
              id: legacyD1,
              delivery_no: "DG-LEGACY-01",
              school_id: school,
              supply_request_id: sr1,
              creation_mode: null,
              creation_key: null,
              creation_fingerprint: null,
              updated_at: preservedUpdatedAt,
            },
            {
              id: legacyD2,
              delivery_no: "DG-LEGACY-02",
              school_id: school,
              supply_request_id: sr1,
              creation_mode: null,
              creation_key: null,
              creation_fingerprint: null,
              updated_at: preservedUpdatedAt,
            },
          ],
        );

        const backfilledItems = (
          await legacy.query<{
            id: string;
            ingredient_id: string;
            ingredient_entry_id: string | null;
            actual_quantity: string;
            unit: string;
          }>(
            "SELECT id,ingredient_id,ingredient_entry_id,actual_quantity::text,unit FROM foodprint.delivery_items WHERE id=ANY($1::uuid[]) ORDER BY actual_quantity DESC",
            [[legacyItem1, legacyItem2]],
          )
        ).rows;
        assert.deepEqual(backfilledItems, [
          {
            id: legacyItem1,
            ingredient_id: ing1,
            ingredient_entry_id: entry1,
            actual_quantity: "25.500",
            unit: "kg",
          },
          {
            id: legacyItem2,
            ingredient_id: ing2,
            ingredient_entry_id: entry2,
            actual_quantity: "10.000",
            unit: "l",
          },
        ]);

        const approvalCount = (
          await legacy.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM foodprint.delivery_approvals WHERE delivery_id=$1",
            [legacyD1],
          )
        ).rows[0].count;
        assert.equal(approvalCount, 1);

        const fp1 = "a".repeat(64);
        const fp2 = "b".repeat(64);
        const keyReq = randomUUID();
        const keyStd1 = randomUUID();
        const keyStd2 = randomUUID();

        await legacy.query(
          "INSERT INTO foodprint.deliveries(delivery_no,school_id,supply_request_id,supplier_id,creation_mode,creation_key,creation_fingerprint,created_by_user_id) VALUES ('DG-REQ-1',$1,$2,$3,'REQUEST',$4,$5,$6)",
          [school, sr2, supplier, keyReq, fp1, supplierUser],
        );
        await assert.rejects(
          legacy.query(
            "INSERT INTO foodprint.deliveries(delivery_no,school_id,supply_request_id,supplier_id,creation_mode,creation_key,creation_fingerprint,created_by_user_id) VALUES ('DG-REQ-2',$1,$2,$3,'REQUEST',$4,$5,$6)",
            [school, sr2, supplier, randomUUID(), fp2, supplierUser],
          ),
          (error) => sqlState(error, "23505", "uq_deliveries_request_mode"),
        );

        const std1 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.deliveries(delivery_no,school_id,supply_request_id,supplier_id,creation_mode,creation_key,creation_fingerprint,created_by_user_id) VALUES ('DG-STD-1',$1,NULL,$2,'STANDALONE',$3,$4,$5) RETURNING id",
            [school, supplier, keyStd1, fp1, supplierUser],
          )
        ).rows[0].id;
        await legacy.query(
          "INSERT INTO foodprint.deliveries(delivery_no,school_id,supply_request_id,supplier_id,creation_mode,creation_key,creation_fingerprint,created_by_user_id) VALUES ('DG-STD-2',$1,NULL,$2,'STANDALONE',$3,$4,$5)",
          [school, supplier, keyStd2, fp1, supplierUser],
        );
        await assert.rejects(
          legacy.query(
            "INSERT INTO foodprint.deliveries(delivery_no,school_id,supply_request_id,supplier_id,creation_mode,creation_key,creation_fingerprint,created_by_user_id) VALUES ('DG-STD-DUP',$1,NULL,$2,'STANDALONE',$3,$4,$5)",
            [school, supplier, keyStd1, fp2, supplierUser],
          ),
          (error) =>
            sqlState(error, "23505", "uq_deliveries_creation_idempotency"),
        );

        await assert.rejects(
          legacy.query(
            "INSERT INTO foodprint.deliveries(delivery_no,school_id,supply_request_id,supplier_id,creation_mode,creation_key,creation_fingerprint,created_by_user_id) VALUES ('DG-BAD-1',$1,$2,$3,'STANDALONE',$4,$5,$6)",
            [school, sr2, supplier, randomUUID(), fp1, supplierUser],
          ),
          (error) =>
            sqlState(error, "23514", "chk_delivery_creation_mode_source"),
        );
        await assert.rejects(
          legacy.query(
            "INSERT INTO foodprint.deliveries(delivery_no,school_id,supply_request_id,supplier_id,creation_mode,creation_key,creation_fingerprint,created_by_user_id) VALUES ('DG-BAD-2',$1,NULL,$2,NULL,NULL,NULL,$3)",
            [school, supplier, supplierUser],
          ),
          (error) =>
            sqlState(error, "23514", "chk_delivery_creation_mode_source"),
        );
        await assert.rejects(
          legacy.query(
            "INSERT INTO foodprint.deliveries(delivery_no,school_id,supply_request_id,supplier_id,creation_mode,creation_key,creation_fingerprint,created_by_user_id) VALUES ('DG-BAD-HASH',$1,NULL,$2,'STANDALONE',$3,'not-sha256',$4)",
            [school, supplier, randomUUID(), supplierUser],
          ),
          (error) =>
            sqlState(
              error,
              "23514",
              "chk_delivery_creation_fingerprint_sha256",
            ),
        );

        await legacy.query(
          "INSERT INTO foodprint.delivery_items(delivery_id,supply_request_item_id,ingredient_id,ingredient_entry_id,actual_quantity,unit) VALUES ($1,NULL,$2,NULL,4.500,'kg')",
          [std1, ing1],
        );
        await assert.rejects(
          legacy.query(
            "INSERT INTO foodprint.delivery_items(delivery_id,supply_request_item_id,ingredient_id,ingredient_entry_id,actual_quantity,unit) VALUES ($1,NULL,$2,NULL,2.000,'kg')",
            [std1, ing1],
          ),
          (error) =>
            sqlState(
              error,
              "23505",
              "delivery_items_delivery_id_ingredient_id_key",
            ),
        );
        await assert.rejects(
          legacy.query(
            "INSERT INTO foodprint.delivery_items(delivery_id,supply_request_item_id,ingredient_id,ingredient_entry_id,actual_quantity,unit) VALUES ($1,NULL,$2,NULL,2.000,'   ')",
            [std1, ing2],
          ),
          (error) =>
            sqlState(error, "23514", "chk_delivery_item_unit_not_blank"),
        );
      } finally {
        await legacy.end();
        await db.query(`DROP DATABASE "${name}"`);
      }
    },
  );

  await context.test(
    "supplier delivery traceability migration preserves baseline histories and multi-lot sources, moves delivery_no uniqueness per supplier, and enforces v1 metadata checks",
    async () => {
      const name = `foodprint_migration_test_trace_${randomUUID().replaceAll("-", "")}`;
      await db.query(`CREATE DATABASE "${name}"`);
      recordLocalTestDatabase(name);
      const fresh = new URL(url);
      fresh.pathname = `/${name}`;
      const legacy = new Client({ connectionString: fresh.toString() });
      await legacy.connect();
      try {
        await legacy.query("SET search_path TO foodprint, public");
        const migration = "20261118000100_supplier_delivery_traceability";
        for (const previous of migrationNames.filter(
          (value) => value < migration,
        )) {
          await legacy.query(
            await readFile(
              path.join(root, "prisma/migrations", previous, "migration.sql"),
              "utf8",
            ),
          );
        }
        const sql = await readFile(
          path.join(root, "prisma/migrations", migration, "migration.sql"),
          "utf8",
        );

        const supplierRole = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.roles(code,name,type) VALUES ('INGREDIENT_SUPPLIER_ADMIN','Supplier Admin','SUPPLIER') RETURNING id",
          )
        ).rows[0].id;
        const schoolRole = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.roles(code,name,type) VALUES ('SCHOOL_ADMINISTRATION','School Admin','SCHOOL') RETURNING id",
          )
        ).rows[0].id;
        const school = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.schools(name) VALUES ('Trace Migration School') RETURNING id",
          )
        ).rows[0].id;
        const supplierA = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.suppliers(name) VALUES ('Trace Supplier A') RETURNING id",
          )
        ).rows[0].id;
        const supplierB = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.suppliers(name) VALUES ('Trace Supplier B') RETURNING id",
          )
        ).rows[0].id;
        const supplierUserA = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.users(role_id,role_code,supplier_id,username,email,password_hash,full_name,status) VALUES ($1,'INGREDIENT_SUPPLIER_ADMIN',$2,'trace-sup-a','trace-sup-a@example.test','hash','Trace Sup A','ACTIVE') RETURNING id",
            [supplierRole, supplierA],
          )
        ).rows[0].id;
        const supplierUserB = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.users(role_id,role_code,supplier_id,username,email,password_hash,full_name,status) VALUES ($1,'INGREDIENT_SUPPLIER_ADMIN',$2,'trace-sup-b','trace-sup-b@example.test','hash','Trace Sup B','ACTIVE') RETURNING id",
            [supplierRole, supplierB],
          )
        ).rows[0].id;
        const schoolUser = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.users(role_id,role_code,school_id,username,email,password_hash,full_name,status) VALUES ($1,'SCHOOL_ADMINISTRATION',$2,'trace-sch','trace-sch@example.test','hash','Trace Sch','ACTIVE') RETURNING id",
            [schoolRole, school],
          )
        ).rows[0].id;
        const facA1 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.source_facilities(supplier_id,facility_code,name,status) VALUES ($1,'SF-A1','Trang trại A1','ACTIVE') RETURNING id",
            [supplierA],
          )
        ).rows[0].id;
        const facA2NullCode = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.source_facilities(supplier_id,facility_code,name,status) VALUES ($1,NULL,'Hợp tác xã cũ không mã','ACTIVE') RETURNING id",
            [supplierA],
          )
        ).rows[0].id;
        const ingA1 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.ingredients(supplier_id,name,default_unit) VALUES ($1,'Rau cải xanh','kg') RETURNING id",
            [supplierA],
          )
        ).rows[0].id;
        const ingB1 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.ingredients(supplier_id,name,default_unit) VALUES ($1,'Gạo ST25','kg') RETURNING id",
            [supplierB],
          )
        ).rows[0].id;
        const entryA1 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.ingredient_entries(school_id,ingredient_id,handling_type) VALUES ($1,$2,'DIRECT_USE') RETURNING id",
            [school, ingA1],
          )
        ).rows[0].id;
        const sr1 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.supply_requests(request_no,school_id,supplier_id,created_by_user_id,status) VALUES ('SR-TRACE-1',$1,$2,$3,'IN_PROGRESS') RETURNING id",
            [school, supplierA, schoolUser],
          )
        ).rows[0].id;
        const sri1 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.supply_request_items(supply_request_id,ingredient_entry_id,requested_quantity,unit) VALUES ($1,$2,15.000,'kg') RETURNING id",
            [sr1, entryA1],
          )
        ).rows[0].id;

        const preservedCreatedAt = "2025-05-10T08:00:00.000Z";
        const preservedUpdatedAt = "2025-05-10T09:30:00.000Z";
        const legacyD1 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.deliveries(delivery_no,supply_request_id,school_id,supplier_id,creation_mode,status,created_by_user_id,received_by_user_id,received_at,created_at,updated_at) VALUES ('DG-HIST-001',$1,$2,$3,NULL,'RECEIVED',$4,$5,$6,$7,$6) RETURNING id",
            [
              sr1,
              school,
              supplierA,
              supplierUserA,
              schoolUser,
              preservedUpdatedAt,
              preservedCreatedAt,
            ],
          )
        ).rows[0].id;
        const legacyD2 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.deliveries(delivery_no,supply_request_id,school_id,supplier_id,creation_mode,status,created_by_user_id,created_at,updated_at) VALUES ('DG-HIST-002',$1,$2,$3,NULL,'REJECTED',$4,$5,$6) RETURNING id",
            [
              sr1,
              school,
              supplierA,
              supplierUserA,
              preservedCreatedAt,
              preservedUpdatedAt,
            ],
          )
        ).rows[0].id;
        const legacyItem1 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.delivery_items(delivery_id,supply_request_item_id,ingredient_id,ingredient_entry_id,actual_quantity,unit,note) VALUES ($1,$2,$3,$4,15.000,'kg','Lô hỗn hợp cũ') RETURNING id",
            [legacyD1, sri1, ingA1, entryA1],
          )
        ).rows[0].id;
        const approval1 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.delivery_approvals(delivery_id,user_id,role_id,decision) VALUES ($1,$2,$3,'APPROVE') RETURNING id",
            [legacyD1, schoolUser, schoolRole],
          )
        ).rows[0].id;
        const lot1 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.ingredient_lots(delivery_item_id,source_facility_id,lot_code,received_quantity,available_quantity,unit,status) VALUES ($1,$2,'OLD-L1',10.000,10.000,'kg','AVAILABLE') RETURNING id",
            [legacyItem1, facA1],
          )
        ).rows[0].id;
        const lot2 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.ingredient_lots(delivery_item_id,source_facility_id,lot_code,received_quantity,available_quantity,unit,status) VALUES ($1,$2,'OLD-L2',5.000,5.000,'kg','AVAILABLE') RETURNING id",
            [legacyItem1, facA2NullCode],
          )
        ).rows[0].id;
        const inv1 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.inventory_transactions(ingredient_lot_id,movement_type,quantity,unit,created_by_user_id) VALUES ($1,'RECEIPT',10.000,'kg',$2) RETURNING id",
            [lot1, schoolUser],
          )
        ).rows[0].id;
        const inv2 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.inventory_transactions(ingredient_lot_id,movement_type,quantity,unit,created_by_user_id) VALUES ($1,'RECEIPT',5.000,'kg',$2) RETURNING id",
            [lot2, schoolUser],
          )
        ).rows[0].id;

        const readBaselineState = async () => {
          const deliveries = (
            await legacy.query(
              "SELECT id, delivery_no, status::text, creation_mode::text, created_at::text, updated_at::text FROM foodprint.deliveries ORDER BY delivery_no",
            )
          ).rows;
          const items = (
            await legacy.query(
              "SELECT id, delivery_id, supply_request_item_id, ingredient_id, ingredient_entry_id, actual_quantity::text, unit, note FROM foodprint.delivery_items ORDER BY id",
            )
          ).rows;
          const approvals = (
            await legacy.query(
              "SELECT id, delivery_id, user_id, role_id, decision::text FROM foodprint.delivery_approvals ORDER BY id",
            )
          ).rows;
          const lots = (
            await legacy.query(
              "SELECT id, delivery_item_id, source_facility_id, lot_code, received_quantity::text, available_quantity::text, unit, status::text FROM foodprint.ingredient_lots ORDER BY lot_code",
            )
          ).rows;
          const inventory = (
            await legacy.query(
              "SELECT id, ingredient_lot_id, movement_type::text, quantity::text, unit FROM foodprint.inventory_transactions ORDER BY id",
            )
          ).rows;
          return { deliveries, items, approvals, lots, inventory };
        };

        const before = await readBaselineState();
        await legacy.query(sql);
        const after = await readBaselineState();
        assert.deepEqual(after, before);

        const legacyMeta = (
          await legacy.query<{
            traceability_version: number | null;
            source_facility_id: string | null;
            source_facility_name_snapshot: string | null;
            source_facility_code_snapshot: string | null;
            ingredient_name_snapshot: string | null;
            qr_token: string | null;
            qr_url: string | null;
          }>(
            `SELECT d.traceability_version, di.source_facility_id, di.source_facility_name_snapshot,
                    di.source_facility_code_snapshot, di.ingredient_name_snapshot, di.qr_token, di.qr_url
             FROM foodprint.deliveries d
             JOIN foodprint.delivery_items di ON di.delivery_id = d.id
             WHERE d.id = $1`,
            [legacyD1],
          )
        ).rows[0];
        assert.deepEqual(legacyMeta, {
          traceability_version: null,
          source_facility_id: null,
          source_facility_name_snapshot: null,
          source_facility_code_snapshot: null,
          ingredient_name_snapshot: null,
          qr_token: null,
          qr_url: null,
        });
        assert.ok(approval1 && inv1 && inv2 && legacyD2);

        const fingerprint = "b".repeat(64);
        const eta = "2026-11-20T06:00:00.000Z";
        const v1SupA = (
          await legacy.query<{ id: string }>(
            `INSERT INTO foodprint.deliveries(
               delivery_no, supply_request_id, school_id, supplier_id, creation_mode,
               creation_key, creation_fingerprint, traceability_version, status,
               created_by_user_id, expected_arrival_at, vehicle_plate
             ) VALUES ('FP-DE-00001', NULL, $1, $2, 'STANDALONE', $3, $4, 1, 'IN_TRANSIT', $5, $6, '51A-12345')
             RETURNING id`,
            [school, supplierA, randomUUID(), fingerprint, supplierUserA, eta],
          )
        ).rows[0].id;
        await legacy.query(
          `INSERT INTO foodprint.deliveries(
             delivery_no, supply_request_id, school_id, supplier_id, creation_mode,
             creation_key, creation_fingerprint, traceability_version, status,
             created_by_user_id, expected_arrival_at, vehicle_plate
           ) VALUES ('FP-DE-00001', NULL, $1, $2, 'STANDALONE', $3, $4, 1, 'IN_TRANSIT', $5, $6, '29B-54321')`,
          [school, supplierB, randomUUID(), fingerprint, supplierUserB, eta],
        );
        await assert.rejects(
          legacy.query(
            `INSERT INTO foodprint.deliveries(
               delivery_no, supply_request_id, school_id, supplier_id, creation_mode,
               creation_key, creation_fingerprint, traceability_version, status,
               created_by_user_id, expected_arrival_at, vehicle_plate
             ) VALUES ('FP-DE-00001', NULL, $1, $2, 'STANDALONE', $3, $4, 1, 'IN_TRANSIT', $5, $6, '51A-99999')`,
            [school, supplierA, randomUUID(), fingerprint, supplierUserA, eta],
          ),
          (error) => sqlState(error, "23505", "uq_deliveries_supplier_no"),
        );

        for (const [badSql, badParams] of [
          [
            "INSERT INTO foodprint.deliveries(delivery_no, supply_request_id, school_id, supplier_id, creation_mode, creation_key, creation_fingerprint, traceability_version, status, created_by_user_id, expected_arrival_at, vehicle_plate) VALUES ('FP-DE-00002', NULL, $1, $2, 'STANDALONE', $3, $4, 2, 'IN_TRANSIT', $5, $6, '51A-12345')",
            [school, supplierA, randomUUID(), fingerprint, supplierUserA, eta],
          ],
          [
            "INSERT INTO foodprint.deliveries(delivery_no, supply_request_id, school_id, supplier_id, creation_mode, creation_key, creation_fingerprint, traceability_version, status, created_by_user_id, expected_arrival_at, vehicle_plate) VALUES ('FP-DE-00002', NULL, $1, $2, 'STANDALONE', $3, $4, 1, 'IN_TRANSIT', $5, $6, '   ')",
            [school, supplierA, randomUUID(), fingerprint, supplierUserA, eta],
          ],
          [
            "INSERT INTO foodprint.deliveries(delivery_no, supply_request_id, school_id, supplier_id, creation_mode, creation_key, creation_fingerprint, traceability_version, status, created_by_user_id, expected_arrival_at, vehicle_plate) VALUES ('FP-DE-00002', NULL, $1, $2, 'STANDALONE', $3, $4, 1, 'IN_TRANSIT', $5, NULL, '51A-12345')",
            [school, supplierA, randomUUID(), fingerprint, supplierUserA],
          ],
          [
            "INSERT INTO foodprint.deliveries(delivery_no, supply_request_id, school_id, supplier_id, creation_mode, creation_key, creation_fingerprint, traceability_version, status, created_by_user_id, expected_arrival_at, vehicle_plate) VALUES ('FP-DE-00000', NULL, $1, $2, 'STANDALONE', $3, $4, 1, 'IN_TRANSIT', $5, $6, '51A-12345')",
            [school, supplierA, randomUUID(), fingerprint, supplierUserA, eta],
          ],
          [
            "INSERT INTO foodprint.deliveries(delivery_no, supply_request_id, school_id, supplier_id, creation_mode, creation_key, creation_fingerprint, traceability_version, status, created_by_user_id, expected_arrival_at, vehicle_plate) VALUES ('FP-DE-000001', NULL, $1, $2, 'STANDALONE', $3, $4, 1, 'IN_TRANSIT', $5, $6, '51A-12345')",
            [school, supplierA, randomUUID(), fingerprint, supplierUserA, eta],
          ],
          [
            "INSERT INTO foodprint.deliveries(delivery_no, supply_request_id, school_id, supplier_id, creation_mode, creation_key, creation_fingerprint, traceability_version, status, created_by_user_id, expected_arrival_at, vehicle_plate) VALUES ('FP-DE-00002', NULL, $1, $2, 'STANDALONE', $3, $4, 1, 'CREATED', $5, $6, '51A-12345')",
            [school, supplierA, randomUUID(), fingerprint, supplierUserA, eta],
          ],
        ] as const) {
          await assert.rejects(legacy.query(badSql, [...badParams]), (error) =>
            sqlState(error, "23514", "chk_delivery_traceability_version"),
          );
        }

        const token1 = "c".repeat(64);
        await legacy.query(
          `INSERT INTO foodprint.delivery_items(
             delivery_id, supply_request_item_id, ingredient_id, ingredient_entry_id,
             source_facility_id, source_facility_name_snapshot, source_facility_code_snapshot,
             ingredient_name_snapshot, qr_token, qr_url, actual_quantity, unit
           ) VALUES ($1, NULL, $2, NULL, $3, 'Hợp tác xã cũ không mã', NULL, 'Rau cải xanh', $4, $5, 4.000, 'kg')`,
          [
            v1SupA,
            ingA1,
            facA2NullCode,
            token1,
            `https://trace.example.test/api/public/delivery-items/${token1}`,
          ],
        );

        const partialItemSql = [
          [
            "INSERT INTO foodprint.delivery_items(delivery_id, supply_request_item_id, ingredient_id, ingredient_entry_id, source_facility_id, source_facility_name_snapshot, source_facility_code_snapshot, ingredient_name_snapshot, qr_token, qr_url, actual_quantity, unit) VALUES ($1, NULL, $2, NULL, $3, 'Trang trại A1', NULL, 'Gạo ST25', NULL, NULL, 1.000, 'kg')",
            [v1SupA, ingB1, facA1],
            "chk_delivery_item_v1_metadata",
          ],
          [
            "INSERT INTO foodprint.delivery_items(delivery_id, supply_request_item_id, ingredient_id, ingredient_entry_id, source_facility_id, source_facility_name_snapshot, source_facility_code_snapshot, ingredient_name_snapshot, qr_token, qr_url, actual_quantity, unit) VALUES ($1, NULL, $2, NULL, NULL, NULL, 'SF-ONLY', NULL, NULL, NULL, 1.000, 'kg')",
            [v1SupA, ingB1],
            "chk_delivery_item_v1_metadata",
          ],
          [
            "INSERT INTO foodprint.delivery_items(delivery_id, supply_request_item_id, ingredient_id, ingredient_entry_id, source_facility_id, source_facility_name_snapshot, source_facility_code_snapshot, ingredient_name_snapshot, qr_token, qr_url, actual_quantity, unit) VALUES ($1, NULL, $2, NULL, $3, 'Trang trại A1', 'SF-A1', 'Gạo ST25', 'INVALID-TOKEN', 'https://trace.example.test/x', 1.000, 'kg')",
            [v1SupA, ingB1, facA1],
            "chk_delivery_item_qr_token_format",
          ],
          [
            "INSERT INTO foodprint.delivery_items(delivery_id, supply_request_item_id, ingredient_id, ingredient_entry_id, source_facility_id, source_facility_name_snapshot, source_facility_code_snapshot, ingredient_name_snapshot, qr_token, qr_url, actual_quantity, unit) VALUES ($1, NULL, $2, NULL, $3, 'Trang trại A1', 'SF-A1', 'Gạo ST25', $4, 'https://trace.example.test/x', 1.000, 'kg')",
            [v1SupA, ingB1, facA1, token1],
            "delivery_items_qr_token_key",
          ],
        ] as const;

        for (const [
          sqlItem,
          paramsItem,
          expectedConstraint,
        ] of partialItemSql) {
          await assert.rejects(
            legacy.query(sqlItem, [...paramsItem]),
            (error) =>
              sqlState(
                error,
                expectedConstraint === "delivery_items_qr_token_key"
                  ? "23505"
                  : "23514",
                expectedConstraint,
              ),
          );
        }

        const preservedIndexes = (
          await legacy.query<{ indexname: string; indexdef: string }>(
            `SELECT indexname, indexdef
             FROM pg_indexes
             WHERE schemaname = 'foodprint'
               AND indexname IN (
                 'uq_deliveries_supplier_no',
                 'uq_deliveries_request_mode',
                 'uq_deliveries_creation_idempotency',
                 'uq_inventory_initial_receipt_per_lot',
                 'uq_source_facility_supplier_code',
                 'delivery_items_qr_token_key'
               )
             ORDER BY indexname`,
          )
        ).rows;
        assert.deepEqual(
          preservedIndexes.map((row) => row.indexname),
          [
            "delivery_items_qr_token_key",
            "uq_deliveries_creation_idempotency",
            "uq_deliveries_request_mode",
            "uq_deliveries_supplier_no",
            "uq_inventory_initial_receipt_per_lot",
            "uq_source_facility_supplier_code",
          ],
        );
        const requestModeDef = preservedIndexes.find(
          (row) => row.indexname === "uq_deliveries_request_mode",
        )?.indexdef;
        const idempotencyDef = preservedIndexes.find(
          (row) => row.indexname === "uq_deliveries_creation_idempotency",
        )?.indexdef;
        assert.ok(requestModeDef?.includes("REQUEST"));
        assert.ok(idempotencyDef?.includes("creation_key IS NOT NULL"));
      } finally {
        await legacy.end();
        await db.query(`DROP DATABASE "${name}"`);
      }
    },
  );

  await context.test(
    "supplier order stages migrations commit PREPARING enum before workflow_version checks, preserve legacy/v1 history, replace item uniques with three partial indexes, and enforce v2 constraints",
    async () => {
      const name = `foodprint_migration_test_stages_${randomUUID().replaceAll("-", "")}`;
      await db.query(`CREATE DATABASE "${name}"`);
      recordLocalTestDatabase(name);
      const isolated = new URL(url);
      isolated.pathname = `/${name}`;
      const temporary = await mkdtemp(
        path.join(tmpdir(), "foodprint-supplier-stages-"),
      );
      const directory = path.join(temporary, "migrations");
      const config = path.join(temporary, "prisma.config.ts");
      const stageEnumMigration = "20261118000200_delivery_preparing_status";
      const stageSchemaMigration = "20261118000300_supplier_order_stages";
      const legacy = new Client({ connectionString: isolated.toString() });
      const hex64 = () =>
        `${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`;
      try {
        await mkdir(directory);
        await copyFile(
          path.join(root, "prisma/migrations/migration_lock.toml"),
          path.join(directory, "migration_lock.toml"),
        );
        const copyMigration = async (migration: string) => {
          await mkdir(path.join(directory, migration));
          await copyFile(
            path.join(root, "prisma/migrations", migration, "migration.sql"),
            path.join(directory, migration, "migration.sql"),
          );
        };
        for (const previous of migrationNames.filter(
          (item) => item < stageEnumMigration,
        )) {
          await copyMigration(previous);
        }
        await writeFile(
          config,
          `import { defineConfig } from ${JSON.stringify(path.join(root, "node_modules/prisma/config.js"))};\nexport default defineConfig({ schema: ${JSON.stringify(path.join(root, "prisma/schema.prisma"))}, migrations: { path: ${JSON.stringify(directory)} }, datasource: { url: process.env.DATABASE_URL } });\n`,
        );

        await runPrisma(isolated.toString(), [
          "migrate",
          "deploy",
          "--config",
          config,
        ]);
        await legacy.connect();

        const supRole = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.roles(code,name,type) VALUES ('INGREDIENT_SUPPLIER_ADMIN','Supplier Admin','SUPPLIER') RETURNING id",
          )
        ).rows[0].id;
        const schRole = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.roles(code,name,type) VALUES ('SCHOOL_ADMINISTRATION','School Admin','SCHOOL') RETURNING id",
          )
        ).rows[0].id;
        const school = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.schools(name) VALUES ('Stages Migration School') RETURNING id",
          )
        ).rows[0].id;
        const supplier = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.suppliers(name) VALUES ('Stages Migration Supplier') RETURNING id",
          )
        ).rows[0].id;
        const supUser = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.users(role_id,role_code,supplier_id,username,email,password_hash,full_name,status) VALUES ($1,'INGREDIENT_SUPPLIER_ADMIN',$2,'stages-sup','stages-sup@example.test','hash','Stages Sup','ACTIVE') RETURNING id",
            [supRole, supplier],
          )
        ).rows[0].id;
        const schUser = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.users(role_id,role_code,school_id,username,email,password_hash,full_name,status) VALUES ($1,'SCHOOL_ADMINISTRATION',$2,'stages-sch','stages-sch@example.test','hash','Stages Sch','ACTIVE') RETURNING id",
            [schRole, school],
          )
        ).rows[0].id;
        const facA = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.source_facilities(supplier_id,facility_code,name,status) VALUES ($1,'SF-S1','Trang trại S1','ACTIVE') RETURNING id",
            [supplier],
          )
        ).rows[0].id;
        const facB = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.source_facilities(supplier_id,facility_code,name,status) VALUES ($1,'SF-S2','Trang trại S2','ACTIVE') RETURNING id",
            [supplier],
          )
        ).rows[0].id;
        const ing1 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.ingredients(supplier_id,name,default_unit) VALUES ($1,'Gạo ST25 Stage','kg') RETURNING id",
            [supplier],
          )
        ).rows[0].id;
        const ing2 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.ingredients(supplier_id,name,default_unit) VALUES ($1,'Cà rốt Stage','kg') RETURNING id",
            [supplier],
          )
        ).rows[0].id;
        const entry1 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.ingredient_entries(school_id,ingredient_id,handling_type) VALUES ($1,$2,'DRY_STOCK') RETURNING id",
            [school, ing1],
          )
        ).rows[0].id;
        const entry2 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.ingredient_entries(school_id,ingredient_id,handling_type) VALUES ($1,$2,'DIRECT_USE') RETURNING id",
            [school, ing2],
          )
        ).rows[0].id;
        const srLegacy = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.supply_requests(request_no,school_id,supplier_id,created_by_user_id,status) VALUES ('SR-STG-LEG',$1,$2,$3,'COMPLETED') RETURNING id",
            [school, supplier, schUser],
          )
        ).rows[0].id;
        const srV1 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.supply_requests(request_no,school_id,supplier_id,created_by_user_id,status) VALUES ('SR-STG-V1',$1,$2,$3,'IN_PROGRESS') RETURNING id",
            [school, supplier, schUser],
          )
        ).rows[0].id;
        const srV2 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.supply_requests(request_no,school_id,supplier_id,created_by_user_id,status) VALUES ('SR-STG-V2',$1,$2,$3,'IN_PROGRESS') RETURNING id",
            [school, supplier, schUser],
          )
        ).rows[0].id;
        const sriLegacy = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.supply_request_items(supply_request_id,ingredient_entry_id,requested_quantity,unit) VALUES ($1,$2,12.000,'kg') RETURNING id",
            [srLegacy, entry1],
          )
        ).rows[0].id;
        const sriV1 = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.supply_request_items(supply_request_id,ingredient_entry_id,requested_quantity,unit) VALUES ($1,$2,8.000,'kg') RETURNING id",
            [srV1, entry1],
          )
        ).rows[0].id;
        const sriV2a = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.supply_request_items(supply_request_id,ingredient_entry_id,requested_quantity,unit) VALUES ($1,$2,10.000,'kg') RETURNING id",
            [srV2, entry1],
          )
        ).rows[0].id;
        const sriV2b = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.supply_request_items(supply_request_id,ingredient_entry_id,requested_quantity,unit) VALUES ($1,$2,5.000,'kg') RETURNING id",
            [srV2, entry2],
          )
        ).rows[0].id;

        const preservedTs = "2025-06-15T08:09:10.000Z";
        const legacyDel = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.deliveries(delivery_no,supply_request_id,school_id,supplier_id,creation_mode,status,created_by_user_id,received_by_user_id,received_at,created_at,updated_at) VALUES ('DG-STG-LEG-1',$1,$2,$3,NULL,'RECEIVED',$4,$5,$6,$6,$6) RETURNING id",
            [srLegacy, school, supplier, supUser, schUser, preservedTs],
          )
        ).rows[0].id;
        const legacyItem = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.delivery_items(delivery_id,supply_request_item_id,ingredient_id,ingredient_entry_id,actual_quantity,unit) VALUES ($1,$2,$3,$4,12.000,'kg') RETURNING id",
            [legacyDel, sriLegacy, ing1, entry1],
          )
        ).rows[0].id;
        await legacy.query(
          "INSERT INTO foodprint.delivery_approvals(delivery_id,user_id,role_id,decision,reason) VALUES ($1,$2,$3,'APPROVE','Đạt chuẩn')",
          [legacyDel, schUser, schRole],
        );
        const legacyLot = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.ingredient_lots(delivery_item_id,source_facility_id,lot_code,received_quantity,available_quantity,unit,status) VALUES ($1,$2,'STG-OLD-01',12.000,12.000,'kg','AVAILABLE') RETURNING id",
            [legacyItem, facA],
          )
        ).rows[0].id;
        await legacy.query(
          "INSERT INTO foodprint.inventory_transactions(ingredient_lot_id,movement_type,quantity,unit,created_by_user_id) VALUES ($1,'RECEIPT',12.000,'kg',$2)",
          [legacyLot, schUser],
        );

        const v1Arrival = "2026-11-20T09:00:00.000Z";
        const v1QrToken = hex64();
        const v1Del = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.deliveries(delivery_no,supply_request_id,school_id,supplier_id,creation_mode,creation_key,creation_fingerprint,traceability_version,status,created_by_user_id,expected_arrival_at,vehicle_plate,created_at,updated_at) VALUES ('FP-DE-00001',$1,$2,$3,'REQUEST',$4,$5,1,'IN_TRANSIT',$6,$7,'51C-88888',$8,$8) RETURNING id",
            [
              srV1,
              school,
              supplier,
              randomUUID(),
              hex64(),
              supUser,
              v1Arrival,
              preservedTs,
            ],
          )
        ).rows[0].id;
        const v1Item = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.delivery_items(delivery_id,supply_request_item_id,ingredient_id,ingredient_entry_id,source_facility_id,source_facility_name_snapshot,source_facility_code_snapshot,ingredient_name_snapshot,qr_token,qr_url,actual_quantity,unit) VALUES ($1,$2,$3,$4,$5,'Trang trại S1','SF-S1','Gạo ST25 Stage',$6,$7,8.000,'kg') RETURNING id",
            [
              v1Del,
              sriV1,
              ing1,
              entry1,
              facA,
              v1QrToken,
              `https://trace.example.test/public/trace/${v1QrToken}`,
            ],
          )
        ).rows[0].id;

        const readBaselineSnapshot = async () =>
          (
            await legacy.query<{
              id: string;
              delivery_no: string;
              status: string;
              traceability_version: number | null;
              creation_mode: string | null;
              expected_arrival_at: Date | null;
              vehicle_plate: string | null;
              created_at: Date;
              updated_at: Date;
              item_id: string;
              qr_token: string | null;
              qr_url: string | null;
              approval_count: number;
              lots_summary: string | null;
              inv_tx_count: number;
            }>(
              `SELECT
                 d.id,
                 d.delivery_no,
                 d.status::text AS status,
                 d.traceability_version,
                 d.creation_mode,
                 d.expected_arrival_at,
                 d.vehicle_plate,
                 d.created_at,
                 d.updated_at,
                 di.id AS item_id,
                 di.qr_token,
                 di.qr_url,
                 (SELECT count(*)::int FROM foodprint.delivery_approvals da WHERE da.delivery_id = d.id) AS approval_count,
                 (SELECT string_agg(il.lot_code || ':' || il.available_quantity::text, ',') FROM foodprint.ingredient_lots il WHERE il.delivery_item_id = di.id) AS lots_summary,
                 (SELECT count(*)::int FROM foodprint.inventory_transactions it JOIN foodprint.ingredient_lots il ON il.id = it.ingredient_lot_id WHERE il.delivery_item_id = di.id) AS inv_tx_count
               FROM foodprint.deliveries d
               JOIN foodprint.delivery_items di ON di.delivery_id = d.id
               WHERE d.id IN ($1, $2)
               ORDER BY d.delivery_no`,
              [legacyDel, v1Del],
            )
          ).rows;
        const beforeUpgrade = await readBaselineSnapshot();

        // Step 1: deploy enum-only migration first so PREPARING is committed separately
        await copyMigration(stageEnumMigration);
        await runPrisma(isolated.toString(), [
          "migrate",
          "deploy",
          "--config",
          config,
        ]);
        const enumValues = (
          await legacy.query<{ enumlabel: string }>(
            `SELECT e.enumlabel
             FROM pg_enum e
             JOIN pg_type t ON t.oid = e.enumtypid
             JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE n.nspname = 'foodprint' AND t.typname = 'delivery_status'
             ORDER BY e.enumsortorder`,
          )
        ).rows.map((row) => row.enumlabel);
        assert.ok(enumValues.includes("PREPARING"));

        // Verify preflight fails fast cleanly if a premature PREPARING row exists before workflow_version migration
        const prematureDel = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.deliveries(delivery_no,supply_request_id,school_id,supplier_id,creation_mode,creation_key,creation_fingerprint,traceability_version,status,created_by_user_id) VALUES ('DG-PREMATURE',NULL,$1,$2,'STANDALONE',$3,$4,NULL,'PREPARING',$5) RETURNING id",
            [school, supplier, randomUUID(), hex64(), supUser],
          )
        ).rows[0].id;
        const stageSql = await readFile(
          path.join(
            root,
            "prisma/migrations",
            stageSchemaMigration,
            "migration.sql",
          ),
          "utf8",
        );
        await assert.rejects(legacy.query(stageSql), (error) =>
          sqlState(error, "P0001"),
        );
        await legacy.query("ROLLBACK");
        await legacy.query("DELETE FROM foodprint.deliveries WHERE id = $1", [
          prematureDel,
        ]);

        // Step 2: verify supplier_order_stages at its own migration boundary.
        await copyMigration(stageSchemaMigration);
        await runPrisma(isolated.toString(), [
          "migrate",
          "deploy",
          "--config",
          config,
        ]);
        // Marker null preservation and complete baseline immutability
        const afterUpgrade = await readBaselineSnapshot();
        assert.deepEqual(afterUpgrade, beforeUpgrade);
        assert.deepEqual(
          afterUpgrade.map((row: Record<string, unknown>) => [
            row.id,
            row.item_id,
          ]),
          [
            [legacyDel, legacyItem],
            [v1Del, v1Item],
          ],
        );
        const markerRows = (
          await legacy.query<{ id: string; workflow_version: number | null }>(
            "SELECT id, workflow_version FROM foodprint.deliveries WHERE id IN ($1, $2)",
            [legacyDel, v1Del],
          )
        ).rows;
        assert.deepEqual(
          markerRows.map((row) => row.workflow_version),
          [null, null],
        );

        // Catalog checks: nullable column, CHECKs, 3 partial uniques, legacy uniques removed, FKs/nonuniques/QRs/header uniques kept
        const wfCol = (
          await legacy.query<{
            is_nullable: string;
            data_type: string;
            column_default: string | null;
          }>(
            `SELECT is_nullable, data_type, column_default
             FROM information_schema.columns
             WHERE table_schema = 'foodprint' AND table_name = 'deliveries' AND column_name = 'workflow_version'`,
          )
        ).rows[0];
        assert.deepEqual(wfCol, {
          is_nullable: "YES",
          data_type: "integer",
          column_default: null,
        });

        const checks = (
          await legacy.query<{ conname: string; convalidated: boolean }>(
            `SELECT conname, convalidated
             FROM pg_constraint
             WHERE conrelid = 'foodprint.deliveries'::regclass
               AND conname IN ('chk_delivery_traceability_version', 'chk_delivery_workflow_version')
             ORDER BY conname`,
          )
        ).rows;
        assert.deepEqual(checks, [
          { conname: "chk_delivery_traceability_version", convalidated: true },
          { conname: "chk_delivery_workflow_version", convalidated: true },
        ]);

        const partialIndexes = (
          await legacy.query<{ indexname: string; indexdef: string }>(
            `SELECT indexname, indexdef
             FROM pg_indexes
             WHERE schemaname = 'foodprint'
               AND tablename = 'delivery_items'
               AND indexname IN (
                 'uq_delivery_items_ingredient_source',
                 'uq_delivery_items_legacy_ingredient',
                 'uq_delivery_items_legacy_request_item'
               )
             ORDER BY indexname`,
          )
        ).rows;
        assert.equal(partialIndexes.length, 3);
        const byIndexName = Object.fromEntries(
          partialIndexes.map((row) => [row.indexname, row.indexdef]),
        );
        assert.match(
          byIndexName.uq_delivery_items_ingredient_source,
          /CREATE UNIQUE INDEX/i,
        );
        assert.match(
          byIndexName.uq_delivery_items_ingredient_source,
          /\(delivery_id, ingredient_id, source_facility_id\) WHERE \(?source_facility_id IS NOT NULL\)?/i,
        );
        assert.match(
          byIndexName.uq_delivery_items_legacy_ingredient,
          /CREATE UNIQUE INDEX/i,
        );
        assert.match(
          byIndexName.uq_delivery_items_legacy_ingredient,
          /\(delivery_id, ingredient_id\) WHERE \(?source_facility_id IS NULL\)?/i,
        );
        assert.match(
          byIndexName.uq_delivery_items_legacy_request_item,
          /CREATE UNIQUE INDEX/i,
        );
        assert.match(
          byIndexName.uq_delivery_items_legacy_request_item,
          /\(delivery_id, supply_request_item_id\) WHERE \(?source_facility_id IS NULL\)?/i,
        );

        const droppedFullUniques = (
          await legacy.query<{ name: string }>(
            `SELECT indexname AS name FROM pg_indexes
             WHERE schemaname = 'foodprint' AND indexname IN (
               'delivery_items_delivery_id_ingredient_id_key',
               'delivery_items_delivery_id_supply_request_item_id_key'
             )
             UNION ALL
             SELECT conname AS name FROM pg_constraint
             WHERE conrelid = 'foodprint.delivery_items'::regclass AND conname IN (
               'delivery_items_delivery_id_ingredient_id_key',
               'delivery_items_delivery_id_supply_request_item_id_key'
             )`,
          )
        ).rows;
        assert.deepEqual(droppedFullUniques, []);

        const retainedItemIndexes = (
          await legacy.query<{ indexname: string }>(
            `SELECT indexname
             FROM pg_indexes
             WHERE schemaname = 'foodprint'
               AND tablename = 'delivery_items'
               AND indexname IN (
                 'delivery_items_qr_token_key',
                 'idx_delivery_items_delivery',
                 'idx_delivery_items_request_item',
                 'idx_delivery_items_ingredient',
                 'idx_delivery_items_ingredient_entry',
                 'idx_delivery_items_source_facility'
               )
             ORDER BY indexname`,
          )
        ).rows.map((row) => row.indexname);
        assert.deepEqual(retainedItemIndexes, [
          "delivery_items_qr_token_key",
          "idx_delivery_items_delivery",
          "idx_delivery_items_ingredient",
          "idx_delivery_items_ingredient_entry",
          "idx_delivery_items_request_item",
          "idx_delivery_items_source_facility",
        ]);

        const itemForeignKeys = (
          await legacy.query<{ count: number; validated: boolean }>(
            `SELECT count(*)::int AS count, bool_and(convalidated) AS validated
             FROM pg_constraint
             WHERE conrelid = 'foodprint.delivery_items'::regclass AND contype = 'f'`,
          )
        ).rows[0];
        assert.deepEqual(itemForeignKeys, { count: 5, validated: true });

        const headerIndexes = (
          await legacy.query<{ indexname: string }>(
            `SELECT indexname
             FROM pg_indexes
             WHERE schemaname = 'foodprint'
               AND tablename = 'deliveries'
               AND indexname IN (
                 'uq_deliveries_supplier_no',
                 'uq_deliveries_request_mode',
                 'uq_deliveries_creation_idempotency'
               )
             ORDER BY indexname`,
          )
        ).rows.map((row) => row.indexname);
        assert.deepEqual(headerIndexes, [
          "uq_deliveries_creation_idempotency",
          "uq_deliveries_request_mode",
          "uq_deliveries_supplier_no",
        ]);

        // Status / metadata / marker CHECKs
        const badDeliveries: Array<[string, string, unknown[], string]> = [
          [
            "workflow_version = 2 missing traceability_version",
            "INSERT INTO foodprint.deliveries(delivery_no,supply_request_id,school_id,supplier_id,creation_mode,creation_key,creation_fingerprint,traceability_version,workflow_version,status,created_by_user_id) VALUES ('FP-DE-00002',NULL,$1,$2,'STANDALONE',$3,$4,NULL,2,'PREPARING',$5)",
            [school, supplier, randomUUID(), hex64(), supUser],
            "chk_delivery_traceability_version",
          ],
          [
            "workflow_version = NULL with PREPARING",
            "INSERT INTO foodprint.deliveries(delivery_no,supply_request_id,school_id,supplier_id,creation_mode,creation_key,creation_fingerprint,traceability_version,workflow_version,status,created_by_user_id,expected_arrival_at,vehicle_plate) VALUES ('FP-DE-00002',NULL,$1,$2,'STANDALONE',$3,$4,1,NULL,'PREPARING',$5,$6,'51A-10001')",
            [school, supplier, randomUUID(), hex64(), supUser, v1Arrival],
            "chk_delivery_traceability_version",
          ],
          [
            "workflow_version = 1 rejected",
            "INSERT INTO foodprint.deliveries(delivery_no,supply_request_id,school_id,supplier_id,creation_mode,creation_key,creation_fingerprint,traceability_version,workflow_version,status,created_by_user_id) VALUES ('FP-DE-00002',NULL,$1,$2,'STANDALONE',$3,$4,1,1,'PREPARING',$5)",
            [school, supplier, randomUUID(), hex64(), supUser],
            "chk_delivery_traceability_version",
          ],
          [
            "PREPARING with expected_arrival_at set rejected",
            "INSERT INTO foodprint.deliveries(delivery_no,supply_request_id,school_id,supplier_id,creation_mode,creation_key,creation_fingerprint,traceability_version,workflow_version,status,created_by_user_id,expected_arrival_at,vehicle_plate) VALUES ('FP-DE-00002',NULL,$1,$2,'STANDALONE',$3,$4,1,2,'PREPARING',$5,$6,NULL)",
            [school, supplier, randomUUID(), hex64(), supUser, v1Arrival],
            "chk_delivery_traceability_version",
          ],
          [
            "PREPARING with vehicle_plate set rejected",
            "INSERT INTO foodprint.deliveries(delivery_no,supply_request_id,school_id,supplier_id,creation_mode,creation_key,creation_fingerprint,traceability_version,workflow_version,status,created_by_user_id,expected_arrival_at,vehicle_plate) VALUES ('FP-DE-00002',NULL,$1,$2,'STANDALONE',$3,$4,1,2,'PREPARING',$5,NULL,'51A-10002')",
            [school, supplier, randomUUID(), hex64(), supUser],
            "chk_delivery_traceability_version",
          ],
          [
            "workflow_version = 2 IN_TRANSIT missing shipping metadata rejected",
            "INSERT INTO foodprint.deliveries(delivery_no,supply_request_id,school_id,supplier_id,creation_mode,creation_key,creation_fingerprint,traceability_version,workflow_version,status,created_by_user_id) VALUES ('FP-DE-00002',NULL,$1,$2,'STANDALONE',$3,$4,1,2,'IN_TRANSIT',$5)",
            [school, supplier, randomUUID(), hex64(), supUser],
            "chk_delivery_traceability_version",
          ],
          [
            "workflow_version = 2 CANCELLED half-populated metadata rejected",
            "INSERT INTO foodprint.deliveries(delivery_no,supply_request_id,school_id,supplier_id,creation_mode,creation_key,creation_fingerprint,traceability_version,workflow_version,status,created_by_user_id,expected_arrival_at,vehicle_plate) VALUES ('FP-DE-00002',NULL,$1,$2,'STANDALONE',$3,$4,1,2,'CANCELLED',$5,$6,NULL)",
            [school, supplier, randomUUID(), hex64(), supUser, v1Arrival],
            "chk_delivery_traceability_version",
          ],
        ];
        for (const [label, badSql, badParams, constraint] of badDeliveries) {
          await assert.rejects(
            legacy.query(badSql, badParams),
            (error) => sqlState(error, "23514", constraint),
            label,
          );
        }

        // Valid v2 PREPARING -> dispatch IN_TRANSIT, pre-dispatch CANCELLED, post-dispatch CANCELLED_MEAL
        const v2ReqDel = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.deliveries(delivery_no,supply_request_id,school_id,supplier_id,creation_mode,creation_key,creation_fingerprint,traceability_version,workflow_version,status,created_by_user_id) VALUES ('FP-DE-00002',$1,$2,$3,'REQUEST',$4,$5,1,2,'PREPARING',$6) RETURNING id",
            [srV2, school, supplier, randomUUID(), hex64(), supUser],
          )
        ).rows[0].id;
        await legacy.query(
          "UPDATE foodprint.deliveries SET status = 'IN_TRANSIT', expected_arrival_at = $2, vehicle_plate = '51D-20002' WHERE id = $1",
          [v2ReqDel, v1Arrival],
        );
        await legacy.query(
          "INSERT INTO foodprint.deliveries(delivery_no,supply_request_id,school_id,supplier_id,creation_mode,creation_key,creation_fingerprint,traceability_version,workflow_version,status,created_by_user_id) VALUES ('FP-DE-00003',NULL,$1,$2,'STANDALONE',$3,$4,1,2,'CANCELLED',$5)",
          [school, supplier, randomUUID(), hex64(), supUser],
        );
        await legacy.query(
          "INSERT INTO foodprint.deliveries(delivery_no,supply_request_id,school_id,supplier_id,creation_mode,creation_key,creation_fingerprint,traceability_version,workflow_version,status,created_by_user_id,expected_arrival_at,vehicle_plate) VALUES ('FP-DE-00004',NULL,$1,$2,'STANDALONE',$3,$4,1,2,'CANCELLED_MEAL',$5,$6,'51D-30003')",
          [school, supplier, randomUUID(), hex64(), supUser, v1Arrival],
        );

        // Partial unique invariants on delivery_items
        // Non-null source_facility_id: same (delivery, sri, ingredient) across facA + facB allowed; same facility + another ingredient allowed; duplicate (delivery, ingredient, facA) rejected
        for (const [
          sriId,
          ingId,
          entryId,
          facId,
          facCode,
          facName,
          ingName,
          qty,
        ] of [
          [
            sriV2a,
            ing1,
            entry1,
            facA,
            "SF-S1",
            "Trang trại S1",
            "Gạo ST25 Stage",
            "6.000",
          ],
          [
            sriV2a,
            ing1,
            entry1,
            facB,
            "SF-S2",
            "Trang trại S2",
            "Gạo ST25 Stage",
            "4.000",
          ],
          [
            sriV2b,
            ing2,
            entry2,
            facA,
            "SF-S1",
            "Trang trại S1",
            "Cà rốt Stage",
            "5.000",
          ],
        ] as const) {
          const qr = hex64();
          await legacy.query(
            "INSERT INTO foodprint.delivery_items(delivery_id,supply_request_item_id,ingredient_id,ingredient_entry_id,source_facility_id,source_facility_name_snapshot,source_facility_code_snapshot,ingredient_name_snapshot,qr_token,qr_url,actual_quantity,unit) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'kg')",
            [
              v2ReqDel,
              sriId,
              ingId,
              entryId,
              facId,
              facName,
              facCode,
              ingName,
              qr,
              `https://trace.example.test/public/trace/${qr}`,
              qty,
            ],
          );
        }
        const dupQr = hex64();
        await assert.rejects(
          legacy.query(
            "INSERT INTO foodprint.delivery_items(delivery_id,supply_request_item_id,ingredient_id,ingredient_entry_id,source_facility_id,source_facility_name_snapshot,source_facility_code_snapshot,ingredient_name_snapshot,qr_token,qr_url,actual_quantity,unit) VALUES ($1,$2,$3,$4,$5,'Trang trại S1','SF-S1','Gạo ST25 Stage',$6,$7,1.000,'kg')",
            [
              v2ReqDel,
              sriV2a,
              ing1,
              entry1,
              facA,
              dupQr,
              `https://trace.example.test/public/trace/${dupQr}`,
            ],
          ),
          (error) =>
            sqlState(error, "23505", "uq_delivery_items_ingredient_source"),
        );

        // Null source_facility_id: legacy two invariants stay enforced independently
        await assert.rejects(
          legacy.query(
            "INSERT INTO foodprint.delivery_items(delivery_id,supply_request_item_id,ingredient_id,ingredient_entry_id,actual_quantity,unit) VALUES ($1,$2,$3,$4,1.000,'kg')",
            [legacyDel, sriV1, ing1, entry1],
          ),
          (error) =>
            sqlState(error, "23505", "uq_delivery_items_legacy_ingredient"),
        );
        await assert.rejects(
          legacy.query(
            "INSERT INTO foodprint.delivery_items(delivery_id,supply_request_item_id,ingredient_id,ingredient_entry_id,actual_quantity,unit) VALUES ($1,$2,$3,$4,1.000,'kg')",
            [legacyDel, sriLegacy, ing2, entry2],
          ),
          (error) =>
            sqlState(error, "23505", "uq_delivery_items_legacy_request_item"),
        );

        // The current schema also includes migrations added after these stages.
        // Check parity only after rolling this isolated database forward to head.
        for (const subsequent of migrationNames.filter(
          (item) => item > stageSchemaMigration,
        )) {
          await copyMigration(subsequent);
        }
        await runPrisma(isolated.toString(), [
          "migrate",
          "deploy",
          "--config",
          config,
        ]);
        const completedMigrations = (
          await legacy.query<{ migration_name: string }>(
            `SELECT migration_name FROM foodprint._prisma_migrations
             WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
             ORDER BY migration_name`,
          )
        ).rows.map((row) => row.migration_name);
        assert.deepEqual(completedMigrations, migrationNames);
        assert.deepEqual(await readBaselineSnapshot(), beforeUpgrade);
        await runPrisma(isolated.toString(), [
          "migrate",
          "diff",
          "--from-config-datasource",
          "--to-schema",
          path.join(root, "prisma/schema.prisma"),
          "--exit-code",
          "--config",
          config,
        ]);
      } finally {
        await legacy.end();
        await rm(temporary, { recursive: true, force: true });
        await db.query(`DROP DATABASE "${name}"`);
      }
    },
  );

  await context.test(
    "supplier staff scoped usernames enforce the collision matrix after fresh migration replay",
    async () => {
      await verifySupplierStaffUsernameScope(db);
    },
  );

  await context.test(
    "supplier staff username migration upgrades without changing identity, grants or history, rolls back failed DDL and deploy replay is safe",
    async () => {
      const migration = "20261120000200_supplier_staff_username_scope";
      assert(
        migrationNames.includes(migration),
        "The versioned supplier staff username migration must exist",
      );
      const name = `foodprint_migration_test_usernames_${randomUUID().replaceAll("-", "")}`;
      await db.query(`CREATE DATABASE "${name}"`);
      recordLocalTestDatabase(name);
      const isolated = new URL(url);
      isolated.pathname = `/${name}`;
      const temporary = await mkdtemp(
        path.join(tmpdir(), "foodprint-staff-usernames-"),
      );
      const directory = path.join(temporary, "migrations");
      const config = path.join(temporary, "prisma.config.ts");
      const legacy = new Client({ connectionString: isolated.toString() });
      try {
        await mkdir(directory);
        await copyFile(
          path.join(root, "prisma/migrations/migration_lock.toml"),
          path.join(directory, "migration_lock.toml"),
        );
        const copyMigration = async (item: string) => {
          await mkdir(path.join(directory, item));
          await copyFile(
            path.join(root, "prisma/migrations", item, "migration.sql"),
            path.join(directory, item, "migration.sql"),
          );
        };
        for (const previous of migrationNames.filter(
          (item) => item < migration,
        )) {
          await copyMigration(previous);
        }
        await writeFile(
          config,
          `import { defineConfig } from ${JSON.stringify(path.join(root, "node_modules/prisma/config.js"))};\nexport default defineConfig({ schema: ${JSON.stringify(path.join(root, "prisma/schema.prisma"))}, migrations: { path: ${JSON.stringify(directory)} }, datasource: { url: process.env.DATABASE_URL } });\n`,
        );
        const deploy = () =>
          runPrisma(isolated.toString(), [
            "migrate",
            "deploy",
            "--config",
            config,
          ]);
        await deploy();
        await legacy.connect();
        await legacy.query(`
          INSERT INTO foodprint.roles(code,name,type) VALUES
            ('INGREDIENT_SUPPLIER_ADMIN','Preserved supplier admin','SUPPLIER'),
            ('INGREDIENT_SUPPLIER_STAFF','Preserved supplier staff','SUPPLIER')
          ON CONFLICT (code) DO NOTHING;
        `);
        const roles = (
          await legacy.query<{ id: string; code: string }>(
            "SELECT id,code FROM foodprint.roles WHERE code IN ('INGREDIENT_SUPPLIER_ADMIN','INGREDIENT_SUPPLIER_STAFF')",
          )
        ).rows;
        const adminRole = roles.find(
          (row) => row.code === "INGREDIENT_SUPPLIER_ADMIN",
        )!.id;
        const staffRole = roles.find(
          (row) => row.code === "INGREDIENT_SUPPLIER_STAFF",
        )!.id;
        const supplier = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.suppliers(name) VALUES ('Preserved username supplier') RETURNING id",
          )
        ).rows[0].id;
        const otherSupplier = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.suppliers(name) VALUES ('Other username supplier') RETURNING id",
          )
        ).rows[0].id;
        const admin = (
          await legacy.query<{ id: string }>(
            `INSERT INTO foodprint.users(role_id,role_code,supplier_id,username,email,password_hash,full_name,status,created_at,updated_at)
           VALUES ($1,'INGREDIENT_SUPPLIER_ADMIN',$2,'preserved-admin','preserved-admin@example.test','preserved-admin-hash','Preserved Admin','ACTIVE','2026-01-01T01:00:00Z','2026-01-02T02:00:00Z') RETURNING id`,
            [adminRole, supplier],
          )
        ).rows[0].id;
        const staff = (
          await legacy.query<{ id: string }>(
            `INSERT INTO foodprint.users(role_id,role_code,supplier_id,username,email,password_hash,full_name,status,phone,email_verified_at,last_login_at,created_at,updated_at)
           VALUES ($1,'INGREDIENT_SUPPLIER_STAFF',$2,'preserved-staff','preserved-staff@example.test','preserved-staff-hash','Preserved Staff','LOCKED','0123456789','2026-01-03T03:00:00Z','2026-01-04T04:00:00Z','2026-01-01T01:00:00Z','2026-01-05T05:00:00Z') RETURNING id`,
            [staffRole, supplier],
          )
        ).rows[0].id;
        const permission = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.permissions(code,name,module,action) VALUES ('username_fixture.view','Preserved grant','username_fixture','view') RETURNING id",
          )
        ).rows[0].id;
        await legacy.query(
          "INSERT INTO foodprint.role_permissions(role_id,permission_id) VALUES ($1,$2)",
          [staffRole, permission],
        );
        await legacy.query(
          "INSERT INTO foodprint.user_permission_denials(user_id,permission_id,supplier_id,disabled_by_user_id) VALUES ($1,$2,$3,$4)",
          [staff, permission, supplier, admin],
        );
        // A historical resource retains both creator/updater references to users.
        await legacy.query(
          "INSERT INTO foodprint.source_facilities(supplier_id,facility_code,name,created_by_user_id,updated_by_user_id) VALUES ($1,'FP-SF-00001','Preserved history',$2,$3)",
          [supplier, staff, admin],
        );
        const snapshot = async () => {
          const result: Record<string, unknown> = {};
          for (const table of [
            "users",
            "roles",
            "suppliers",
            "permissions",
            "role_permissions",
            "user_permission_denials",
            "source_facilities",
          ]) {
            result[table] = (
              await legacy.query<Record<string, unknown>>(
                `SELECT to_jsonb(snapshot_row) AS data FROM foodprint.${table} snapshot_row ORDER BY to_jsonb(snapshot_row)::text`,
              )
            ).rows;
          }
          return result;
        };
        const retainedCatalog = async () => ({
          constraints: (
            await legacy.query<{
              conname: string;
              contype: string;
              convalidated: boolean;
              definition: string;
            }>(
              `SELECT c.conname,c.contype,c.convalidated,pg_get_constraintdef(c.oid) AS definition
             FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
             WHERE n.nspname='foodprint' AND c.conname <> 'users_username_key'
             ORDER BY c.conrelid::regclass::text,c.conname`,
            )
          ).rows,
          indexes: (
            await legacy.query<{
              tablename: string;
              indexname: string;
              indexdef: string;
            }>(
              `SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='foodprint'
             AND indexname NOT IN ('users_username_key','uq_users_non_staff_username','uq_users_supplier_username')
             ORDER BY tablename,indexname`,
            )
          ).rows,
        });
        const before = await snapshot();
        const catalogBefore = await retainedCatalog();
        assert(
          catalogBefore.indexes.some(
            (index) => index.indexname === "uq_users_supplier_admin",
          ),
        );
        assert(
          catalogBefore.indexes.some(
            (index) => index.indexname === "uq_users_school_admin",
          ),
        );
        assert(
          catalogBefore.indexes.some(
            (index) => index.indexname === "uq_users_commune_officer",
          ),
        );
        assert(
          catalogBefore.constraints.some(
            (constraint) => constraint.conname === "users_role_id_code_fkey",
          ),
        );
        assert(
          catalogBefore.constraints.some(
            (constraint) =>
              constraint.conname === "chk_user_single_organization",
          ),
        );
        await assert.rejects(
          legacy.query(
            `INSERT INTO foodprint.users(role_id,role_code,supplier_id,username,email,password_hash,full_name,status)
             VALUES ($1,'INGREDIENT_SUPPLIER_STAFF',$2,'preserved-staff','before-upgrade@example.test','fixture-only','Before upgrade','ACTIVE')`,
            [staffRole, otherSupplier],
          ),
          (error) => sqlState(error, "23505", "users_username_key"),
        );
        const migrationSql = await readFile(
          path.join(root, "prisma/migrations", migration, "migration.sql"),
          "utf8",
        );
        assert.match(migrationSql, /BEGIN\s*;/i);
        assert.match(migrationSql, /COMMIT\s*;\s*$/i);
        const failBeforeCommit = migrationSql.replace(
          /COMMIT\s*;\s*$/i,
          "SELECT 1 / 0;\nCOMMIT;\n",
        );
        await assert.rejects(legacy.query(failBeforeCommit), (error) =>
          sqlState(error, "22012"),
        );
        await legacy.query("ROLLBACK");
        const rollbackConstraints = (
          await legacy.query<{ conname: string }>(
            "SELECT conname FROM pg_constraint WHERE conrelid='foodprint.users'::regclass AND conname='users_username_key'",
          )
        ).rows;
        assert.deepEqual(rollbackConstraints, [
          { conname: "users_username_key" },
        ]);
        assert.deepEqual(
          (
            await legacy.query(
              "SELECT indexname FROM pg_indexes WHERE schemaname='foodprint' AND indexname IN ('uq_users_non_staff_username','uq_users_supplier_username')",
            )
          ).rows,
          [],
        );
        assert.deepEqual(await snapshot(), before);
        assert.deepEqual(await retainedCatalog(), catalogBefore);

        await copyMigration(migration);
        await deploy();
        assert.deepEqual(await snapshot(), before);
        assert.deepEqual(await retainedCatalog(), catalogBefore);
        await verifySupplierStaffUsernameScope(legacy);
        assert.deepEqual(await snapshot(), before);
        const readHistory = async () =>
          (
            await legacy.query<MigrationHistoryRow>(
              `SELECT migration_name,checksum,finished_at,rolled_back_at FROM foodprint._prisma_migrations
           ORDER BY migration_name`,
            )
          ).rows;
        const deployedHistory = await readHistory();
        assert.equal(deployedHistory.at(-1)?.migration_name, migration);
        await deploy();
        assert.deepEqual(
          await readHistory(),
          deployedHistory,
          "Prisma deploy replay does not rerun completed DDL",
        );
        assert.deepEqual(await snapshot(), before);
        for (const subsequent of migrationNames.filter(
          (item) => item > migration,
        )) {
          await copyMigration(subsequent);
        }
        await deploy();
        await runPrisma(isolated.toString(), [
          "migrate",
          "diff",
          "--from-config-datasource",
          "--to-schema",
          path.join(root, "prisma/schema.prisma"),
          "--exit-code",
          "--config",
          config,
        ]);
      } finally {
        await legacy.end();
        await rm(temporary, { recursive: true, force: true });
        await db.query(`DROP DATABASE "${name}"`);
      }
    },
  );

  await context.test(
    "complaint_code migration has no functions/triggers and its column/sequence are superseded by complaints.code",
    async () => {
      const migration = "20261120000300_ingredient_feedback_complaint_code";
      assert(
        migrationNames.includes(migration),
        "Versioned complaint_code migration must exist",
      );
      const migrationSql = await readFile(
        path.join(root, "prisma/migrations", migration, "migration.sql"),
        "utf8",
      );
      assert.match(migrationSql, /BEGIN\s*;/i);
      assert.match(migrationSql, /COMMIT\s*;\s*$/i);
      assert.match(migrationSql, /LOCK\s+TABLE[\s\S]*ACCESS\s+EXCLUSIVE/i);
      assert.doesNotMatch(
        migrationSql,
        /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i,
      );
      assert.doesNotMatch(migrationSql, /CREATE\s+TRIGGER/i);
      assert.doesNotMatch(
        migrationSql,
        /SET\s+DEFAULT\s+nextval|ADD\s+COLUMN\s+complaint_code[\s\S]*DEFAULT/i,
      );

      // Sau complaint_supertype, mã nằm ở bảng cha `complaints.code` (Feistel do backend cấp);
      // cột complaint_code và sequence tuần tự cũ đã bị gỡ cùng bảng con cũ.
      const column = (
        await db.query<{
          type: string;
          not_null: boolean;
          default_value: string | null;
        }>(
          `SELECT format_type(a.atttypid, a.atttypmod) AS type,
                  a.attnotnull AS not_null,
                  pg_get_expr(d.adbin, d.adrelid) AS default_value
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           JOIN pg_attribute a ON a.attrelid = c.oid
           LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
           WHERE n.nspname = 'foodprint'
             AND c.relname = 'complaints'
             AND a.attname = 'code'
             AND a.attnum > 0 AND NOT a.attisdropped`,
        )
      ).rows[0];
      assert.deepEqual(column, {
        type: "character varying(25)",
        not_null: true,
        default_value: null,
      });
      assert.equal(
        (
          await db.query<{ name: string | null }>(
            "SELECT to_regclass('foodprint.ingredient_quality_feedback_complaint_code_seq')::text AS name",
          )
        ).rows[0].name,
        null,
      );
      assert.equal(
        (
          await db.query(
            "SELECT 1 FROM information_schema.columns WHERE table_schema='foodprint' AND table_name='ingredient_quality_feedback' AND column_name='complaint_code'",
          )
        ).rowCount,
        0,
      );
    },
  );

  await context.test(
    "ingredient feedback complaint code migration backfills deterministically (including tied created_at and >99999 without truncation), preserves legacy rows/timestamps, enforces constraints and continues sequence",
    async () => {
      const migration = "20261120000300_ingredient_feedback_complaint_code";
      const migrationSql = await readFile(
        path.join(root, "prisma/migrations", migration, "migration.sql"),
        "utf8",
      );
      const name = `foodprint_migration_test_complaint_codes_${randomUUID().replaceAll("-", "")}`;
      await db.query(`CREATE DATABASE "${name}"`);
      recordLocalTestDatabase(name);
      const isolated = new URL(url);
      isolated.pathname = `/${name}`;
      const temporary = await mkdtemp(
        path.join(tmpdir(), "foodprint-complaint-codes-"),
      );
      const directory = path.join(temporary, "migrations");
      const config = path.join(temporary, "prisma.config.ts");
      const legacy = new Client({ connectionString: isolated.toString() });
      const largeName = `foodprint_migration_test_complaint_large_${randomUUID().replaceAll("-", "")}`;
      const largeClient = new Client({
        connectionString: (() => {
          const u = new URL(url);
          u.pathname = `/${largeName}`;
          return u.toString();
        })(),
      });
      try {
        await mkdir(directory);
        await copyFile(
          path.join(root, "prisma/migrations/migration_lock.toml"),
          path.join(directory, "migration_lock.toml"),
        );
        const copyMigration = async (item: string) => {
          await mkdir(path.join(directory, item));
          await copyFile(
            path.join(root, "prisma/migrations", item, "migration.sql"),
            path.join(directory, item, "migration.sql"),
          );
        };
        for (const previous of migrationNames.filter(
          (item) => item < migration,
        )) {
          await copyMigration(previous);
        }
        await writeFile(
          config,
          `import { defineConfig } from ${JSON.stringify(path.join(root, "node_modules/prisma/config.js"))};\nexport default defineConfig({ schema: ${JSON.stringify(path.join(root, "prisma/schema.prisma"))}, migrations: { path: ${JSON.stringify(directory)} }, datasource: { url: process.env.DATABASE_URL } });\n`,
        );
        const deploy = () =>
          runPrisma(isolated.toString(), [
            "migrate",
            "deploy",
            "--config",
            config,
          ]);
        await deploy();
        await legacy.connect();

        // Confirm legacy schema does not have complaint_code or the new sequence yet.
        assert.equal(
          (
            await legacy.query<{ count: number }>(
              `SELECT count(*)::int AS count FROM information_schema.columns
               WHERE table_schema='foodprint' AND table_name='ingredient_quality_feedback' AND column_name='complaint_code'`,
            )
          ).rows[0].count,
          0,
        );
        assert.equal(
          (
            await legacy.query<{ name: string | null }>(
              "SELECT to_regclass('foodprint.ingredient_quality_feedback_complaint_code_seq')::text AS name",
            )
          ).rows[0].name,
          null,
        );

        const routinesBefore = (
          await legacy.query(
            "SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS arguments FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='foodprint' ORDER BY 1,2",
          )
        ).rows;
        const triggersBefore = (
          await legacy.query(
            "SELECT c.relname AS table_name, t.tgname AS name FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='foodprint' AND NOT t.tgisinternal ORDER BY 1,2",
          )
        ).rows;

        // Seed parent fixtures and legacy feedback rows with tied created_at inserted out of id order.
        await legacy.query(`
          INSERT INTO foodprint.roles(code,name,type) VALUES
            ('SCHOOL_MANAGEMENT_BOARD','Legacy BGH','SCHOOL'),
            ('INGREDIENT_SUPPLIER_ADMIN','Legacy Supplier Admin','SUPPLIER')
          ON CONFLICT (code) DO NOTHING;
        `);
        const schoolRole = (
          await legacy.query<{ id: string }>(
            "SELECT id FROM foodprint.roles WHERE code='SCHOOL_MANAGEMENT_BOARD'",
          )
        ).rows[0].id;
        const supRole = (
          await legacy.query<{ id: string }>(
            "SELECT id FROM foodprint.roles WHERE code='INGREDIENT_SUPPLIER_ADMIN'",
          )
        ).rows[0].id;
        const schoolId = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.schools(name,code) VALUES('Legacy School','SCH-LEG') RETURNING id",
          )
        ).rows[0].id;
        const supplierId = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.suppliers(name) VALUES('Legacy Supplier') RETURNING id",
          )
        ).rows[0].id;
        const schoolUserId = (
          await legacy.query<{ id: string }>(
            `INSERT INTO foodprint.users(role_id,role_code,school_id,username,email,password_hash,full_name,status)
             VALUES($1,'SCHOOL_MANAGEMENT_BOARD',$2,'legacy-bgh','legacy-bgh@example.test','legacy-hash','Legacy School User','ACTIVE') RETURNING id`,
            [schoolRole, schoolId],
          )
        ).rows[0].id;
        const supplierUserId = (
          await legacy.query<{ id: string }>(
            `INSERT INTO foodprint.users(role_id,role_code,supplier_id,username,email,password_hash,full_name,status)
             VALUES($1,'INGREDIENT_SUPPLIER_ADMIN',$2,'legacy-sup','legacy-sup@example.test','legacy-hash','Legacy Supplier User','ACTIVE') RETURNING id`,
            [supRole, supplierId],
          )
        ).rows[0].id;
        const ingredientId = (
          await legacy.query<{ id: string }>(
            "INSERT INTO foodprint.ingredients(supplier_id,name,default_unit) VALUES($1,'Legacy Rice','kg') RETURNING id",
            [supplierId],
          )
        ).rows[0].id;
        const deliveryId = (
          await legacy.query<{ id: string }>(
            `INSERT INTO foodprint.deliveries(delivery_no,supply_request_id,school_id,supplier_id,creation_mode,creation_key,creation_fingerprint,status,created_by_user_id)
             VALUES('FP-DE-90001',NULL,$1,$2,'STANDALONE',$3,$4,'CREATED',$5) RETURNING id`,
            [
              schoolId,
              supplierId,
              randomUUID(),
              "a".repeat(64),
              supplierUserId,
            ],
          )
        ).rows[0].id;
        const deliveryItemId = (
          await legacy.query<{ id: string }>(
            `INSERT INTO foodprint.delivery_items(delivery_id,ingredient_id,actual_quantity,unit)
             VALUES($1,$2,10.000,'kg') RETURNING id`,
            [deliveryId, ingredientId],
          )
        ).rows[0].id;
        const lotId = (
          await legacy.query<{ id: string }>(
            `INSERT INTO foodprint.ingredient_lots(delivery_item_id,lot_code,received_quantity,available_quantity,unit,status)
             VALUES($1,'LOT-LEG-01',10.000,10.000,'kg','AVAILABLE') RETURNING id`,
            [deliveryItemId],
          )
        ).rows[0].id;

        const idEarliest = "00000000-0000-4000-8000-000000000001";
        const idTieLow = "00000000-0000-4000-8000-00000000000a";
        const idTieHigh = "00000000-0000-4000-8000-00000000000c";

        // Insert idTieHigh BEFORE idTieLow with identical created_at to prove id ASC tie-breaking.
        await legacy.query(
          `INSERT INTO foodprint.ingredient_quality_feedback
             (id,delivery_id,ingredient_lot_id,submitted_by_user_id,title,description,status,supplier_response,responded_by_user_id,responded_at,created_at,updated_at)
           VALUES
             ($1,$4,$5,$6,'Legacy responded','Has response','RESPONDED','Đã tiếp nhận',$7,'2026-10-02T11:22:33.111222Z','2026-10-02T10:00:00.123456Z','2026-10-02T12:34:56.789123Z'),
             ($2,$4,NULL,$6,'Legacy earliest','Earliest feedback','SUBMITTED',NULL,NULL,NULL,'2026-10-01T08:00:00.123456Z','2026-10-01T09:10:11.654321Z'),
             ($3,$4,$5,$6,'Legacy tied low','Tied timestamp lower id','SUBMITTED',NULL,NULL,NULL,'2026-10-02T10:00:00.123456Z','2026-10-02T10:00:00.123456Z')`,
          [
            idTieHigh,
            idEarliest,
            idTieLow,
            deliveryId,
            lotId,
            schoolUserId,
            supplierUserId,
          ],
        );

        const before = (
          await legacy.query<{ row: unknown }>(
            "SELECT to_jsonb(f) AS row FROM foodprint.ingredient_quality_feedback f ORDER BY id",
          )
        ).rows;

        // Failed DDL rolls back completely without adding column or sequence or changing data.
        const failBeforeCommit = migrationSql.replace(
          /COMMIT\s*;\s*$/i,
          "SELECT 1 / 0;\nCOMMIT;\n",
        );
        await assert.rejects(legacy.query(failBeforeCommit), (error) =>
          sqlState(error, "22012"),
        );
        await legacy.query("ROLLBACK");
        assert.deepEqual(
          (
            await legacy.query<{ row: unknown }>(
              "SELECT to_jsonb(f) AS row FROM foodprint.ingredient_quality_feedback f ORDER BY id",
            )
          ).rows,
          before,
        );

        // Apply migration through Prisma deploy.
        await copyMigration(migration);
        await deploy();

        assert.deepEqual(
          (
            await legacy.query<{ row: unknown }>(
              "SELECT to_jsonb(f)-'complaint_code' AS row FROM foodprint.ingredient_quality_feedback f ORDER BY id",
            )
          ).rows,
          before,
        );

        const backfilled = (
          await legacy.query<{ id: string; complaint_code: string }>(
            "SELECT id, complaint_code FROM foodprint.ingredient_quality_feedback ORDER BY created_at ASC, id ASC",
          )
        ).rows;
        assert.deepEqual(backfilled, [
          { id: idEarliest, complaint_code: "FP-CP-00001" },
          { id: idTieLow, complaint_code: "FP-CP-00002" },
          { id: idTieHigh, complaint_code: "FP-CP-00003" },
        ]);

        // No new SQL functions or triggers added.
        assert.deepEqual(
          (
            await legacy.query(
              "SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS arguments FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='foodprint' ORDER BY 1,2",
            )
          ).rows,
          routinesBefore,
        );
        assert.deepEqual(
          (
            await legacy.query(
              "SELECT c.relname AS table_name, t.tgname AS name FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='foodprint' AND NOT t.tgisinternal ORDER BY 1,2",
            )
          ).rows,
          triggersBefore,
        );

        // Next sequence value after N=3 legacy rows is 4.
        assert.equal(
          (
            await legacy.query<{ value: string }>(
              "SELECT nextval('foodprint.ingredient_quality_feedback_complaint_code_seq') AS value",
            )
          ).rows[0].value,
          "4",
        );

        // Enforce NOT NULL / no default / unique / CHECK format + range / legacy response CHECK.
        await assert.rejects(
          legacy.query(
            `INSERT INTO foodprint.ingredient_quality_feedback(delivery_id,submitted_by_user_id,title,description)
             VALUES($1,$2,'Missing code','No default allowed')`,
            [deliveryId, schoolUserId],
          ),
          (error) => sqlState(error, "23502"),
        );
        await assert.rejects(
          legacy.query(
            `INSERT INTO foodprint.ingredient_quality_feedback(delivery_id,submitted_by_user_id,complaint_code,title,description)
             VALUES($1,$2,NULL,'Null code','Not null enforced')`,
            [deliveryId, schoolUserId],
          ),
          (error) => sqlState(error, "23502"),
        );
        await assert.rejects(
          legacy.query(
            `INSERT INTO foodprint.ingredient_quality_feedback(delivery_id,submitted_by_user_id,complaint_code,title,description)
             VALUES($1,$2,'FP-CP-00001','Duplicate code','Unique enforced')`,
            [deliveryId, schoolUserId],
          ),
          (error) =>
            sqlState(
              error,
              "23505",
              "ingredient_quality_feedback_complaint_code_key",
            ),
        );
        for (const badCode of [
          "",
          "FP-CP-00000",
          "FP-CP-0001",
          "FP-CP-000001",
          "FP-CP-010000",
          "fp-cp-00001",
          "FP-CP-abcde",
          "FP-CP-9223372036854775808",
          "FP-CP-00001 ",
          "FP-CP-00001\n",
        ]) {
          await assert.rejects(
            legacy.query(
              `INSERT INTO foodprint.ingredient_quality_feedback(delivery_id,submitted_by_user_id,complaint_code,title,description)
               VALUES($1,$2,$3,'Bad code','CHECK enforced')`,
              [deliveryId, schoolUserId, badCode],
            ),
            (error) =>
              sqlState(
                error,
                "23514",
                "ingredient_quality_feedback_complaint_code_format",
              ),
            `Expected format CHECK failure for ${JSON.stringify(badCode)}`,
          );
        }
        // Preserved chk_ingredient_feedback_response must still reject partial response tuple.
        await assert.rejects(
          legacy.query(
            `INSERT INTO foodprint.ingredient_quality_feedback(delivery_id,submitted_by_user_id,complaint_code,title,description,status,supplier_response)
             VALUES($1,$2,'FP-CP-00004','Bad response tuple','Missing actor/time','RESPONDED','Incomplete')`,
            [deliveryId, schoolUserId],
          ),
          (error) =>
            sqlState(error, "23514", "chk_ingredient_feedback_response"),
        );
        // Valid 6-digit (>=100000) and MAX_BIGINT codes succeed under CHECK and varchar(25).
        await legacy.query(
          `INSERT INTO foodprint.ingredient_quality_feedback(delivery_id,submitted_by_user_id,complaint_code,title,description)
           VALUES($1,$2,'FP-CP-100000','Six digits','Allowed'),($1,$2,'FP-CP-9223372036854775807','Max bigint','Allowed')`,
          [deliveryId, schoolUserId],
        );

        // Deploy replay idempotency and migrate diff parity against prisma/schema.prisma.
        const deployedHistory = (
          await legacy.query<MigrationHistoryRow>(
            "SELECT migration_name,checksum,finished_at,rolled_back_at FROM foodprint._prisma_migrations ORDER BY migration_name",
          )
        ).rows;
        assert.equal(deployedHistory.at(-1)?.migration_name, migration);
        await deploy();
        assert.deepEqual(
          (
            await legacy.query<MigrationHistoryRow>(
              "SELECT migration_name,checksum,finished_at,rolled_back_at FROM foodprint._prisma_migrations ORDER BY migration_name",
            )
          ).rows,
          deployedHistory,
        );
        // complaint_supertype dừng nếu bảng khiếu nại cũ còn dòng (Q27): dọn dữ liệu kiểm thử trước khi deploy tiếp.
        await legacy.query("DELETE FROM foodprint.ingredient_quality_feedback");
        for (const subsequent of migrationNames.filter(
          (item) => item > migration,
        )) {
          await copyMigration(subsequent);
        }
        await deploy();
        await runPrisma(isolated.toString(), [
          "migrate",
          "diff",
          "--from-config-datasource",
          "--to-schema",
          path.join(root, "prisma/schema.prisma"),
          "--exit-code",
          "--config",
          config,
        ]);

        // Prove actual backfill does not truncate >99999 rows in a dedicated clean legacy DB.
        await db.query(`CREATE DATABASE "${largeName}"`);
        recordLocalTestDatabase(largeName);
        await largeClient.connect();
        await largeClient.query(
          "CREATE SCHEMA IF NOT EXISTS foodprint; SET search_path = foodprint, public;",
        );
        for (const previous of migrationNames.filter(
          (item) => item < migration,
        )) {
          await largeClient.query(
            await readFile(
              path.join(root, "prisma/migrations", previous, "migration.sql"),
              "utf8",
            ),
          );
        }
        await largeClient.query("SET search_path = public;");
        await largeClient.query(`
          INSERT INTO foodprint.roles(code,name,type) VALUES
            ('SCHOOL_MANAGEMENT_BOARD','Large BGH','SCHOOL'),
            ('INGREDIENT_SUPPLIER_ADMIN','Large Supplier Admin','SUPPLIER')
          ON CONFLICT (code) DO NOTHING;
        `);
        const lRole = (
          await largeClient.query<{ id: string }>(
            "SELECT id FROM foodprint.roles WHERE code='SCHOOL_MANAGEMENT_BOARD'",
          )
        ).rows[0].id;
        const lSupRole = (
          await largeClient.query<{ id: string }>(
            "SELECT id FROM foodprint.roles WHERE code='INGREDIENT_SUPPLIER_ADMIN'",
          )
        ).rows[0].id;
        const lSchool = (
          await largeClient.query<{ id: string }>(
            "INSERT INTO foodprint.schools(name) VALUES('Large School') RETURNING id",
          )
        ).rows[0].id;
        const lSupplier = (
          await largeClient.query<{ id: string }>(
            "INSERT INTO foodprint.suppliers(name) VALUES('Large Supplier') RETURNING id",
          )
        ).rows[0].id;
        const lUser = (
          await largeClient.query<{ id: string }>(
            `INSERT INTO foodprint.users(role_id,role_code,school_id,username,email,password_hash,full_name,status)
             VALUES($1,'SCHOOL_MANAGEMENT_BOARD',$2,'large-bgh','large-bgh@example.test','h','Large User','ACTIVE') RETURNING id`,
            [lRole, lSchool],
          )
        ).rows[0].id;
        const lSupUser = (
          await largeClient.query<{ id: string }>(
            `INSERT INTO foodprint.users(role_id,role_code,supplier_id,username,email,password_hash,full_name,status)
             VALUES($1,'INGREDIENT_SUPPLIER_ADMIN',$2,'large-sup','large-sup@example.test','h','Large Sup','ACTIVE') RETURNING id`,
            [lSupRole, lSupplier],
          )
        ).rows[0].id;
        const lDelivery = (
          await largeClient.query<{ id: string }>(
            `INSERT INTO foodprint.deliveries(delivery_no,supply_request_id,school_id,supplier_id,creation_mode,creation_key,creation_fingerprint,status,created_by_user_id)
             VALUES('FP-DE-99999',NULL,$1,$2,'STANDALONE',$3,$4,'CREATED',$5) RETURNING id`,
            [lSchool, lSupplier, randomUUID(), "b".repeat(64), lSupUser],
          )
        ).rows[0].id;
        await largeClient.query(
          `INSERT INTO foodprint.ingredient_quality_feedback(delivery_id,submitted_by_user_id,title,description,created_at,updated_at)
           SELECT $1, $2, 'Row ' || g, 'Desc ' || g,
                  TIMESTAMPTZ '2026-01-01T00:00:00Z' + (g * interval '1 second'),
                  TIMESTAMPTZ '2026-01-01T00:00:00Z' + (g * interval '1 second')
           FROM generate_series(1, 100001) AS g`,
          [lDelivery, lUser],
        );
        await largeClient.query(migrationSql);
        const tailCodes = (
          await largeClient.query<{ complaint_code: string }>(
            `SELECT complaint_code FROM foodprint.ingredient_quality_feedback
             WHERE complaint_code IN ('FP-CP-00001','FP-CP-99999','FP-CP-100000','FP-CP-100001')
             ORDER BY created_at ASC, id ASC`,
          )
        ).rows.map((r) => r.complaint_code);
        assert.deepEqual(tailCodes, [
          "FP-CP-00001",
          "FP-CP-99999",
          "FP-CP-100000",
          "FP-CP-100001",
        ]);
        assert.equal(
          (
            await largeClient.query<{ value: string }>(
              "SELECT nextval('foodprint.ingredient_quality_feedback_complaint_code_seq') AS value",
            )
          ).rows[0].value,
          "100002",
        );
      } finally {
        await largeClient.end().catch(() => undefined);
        await db
          .query(`DROP DATABASE IF EXISTS "${largeName}"`)
          .catch(() => undefined);
        await legacy.end();
        await rm(temporary, { recursive: true, force: true });
        await db.query(`DROP DATABASE "${name}"`);
      }
    },
  );
});
