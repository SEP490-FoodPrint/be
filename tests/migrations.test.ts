import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
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
      await runPrisma(url, ["migrate", "deploy"]);
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
    "School profile adoption preserves provisioned data and refuses ambiguous address columns",
    async () => {
      const name = `foodprint_migration_test_school_${randomUUID().replaceAll("-", "")}`;
      await db.query(`CREATE DATABASE "${name}"`);
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
});
