import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  assertAzureMigrationTarget,
  pendingDeploymentMigrations,
  type MigrationFile,
  type MigrationHistoryRow,
} from "../src/utils/migration-deployment";

const host = "migration-test.postgres.database.azure.com";
const url = `postgresql://test:test-only@${host}:5432/foodprint_db?schema=foodprint&sslmode=require`;
const files: MigrationFile[] = [
  { name: "0_init", checksum: "a".repeat(64) },
  { name: "20261029000100_change", checksum: "b".repeat(64) },
];
const applied = (index: number): MigrationHistoryRow => ({
  migration_name: files[index].name,
  checksum: files[index].checksum,
  finished_at: new Date("2026-10-29T00:00:00Z"),
  rolled_back_at: null,
});

void test("Azure deployment requires the approved host, database, schema and SSL", () => {
  for (const ssl of ["require", "verify-ca", "verify-full"]) {
    assert.doesNotThrow(() =>
      assertAzureMigrationTarget(
        url.replace("sslmode=require", `sslmode=${ssl}`),
        host,
      ),
    );
  }
  for (const [value, expected] of [
    [undefined, host],
    [url, undefined],
    ["invalid", host],
    [url, "other.postgres.database.azure.com"],
    [url, "migration-test.azure.com.evil"],
    [url.replace(host, "127.0.0.1"), host],
    [url.replace("postgresql:", "http:"), host],
    [url.replace(":5432", ":5433"), host],
    [url.replace("test:test-only@", ""), host],
    [url.replace("/foodprint_db", "/other"), host],
    [url.replace("schema=foodprint", "schema=public"), host],
    [url.replace("&sslmode=require", ""), host],
    [url.replace("sslmode=require", "sslmode=disable"), host],
    [url + "&schema=public", host],
    [url + "&sslmode=disable", host],
    [url + "&host=remote", host],
    [url + "&hostaddr=203.0.113.1", host],
    [url + "&service=remote", host],
  ]) {
    assert.throws(() => assertAzureMigrationTarget(value, expected));
  }
});

void test("deployment identifies pending migrations and accepts an up-to-date history", () => {
  assert.deepEqual(pendingDeploymentMigrations(files, [applied(0)]), [
    files[1].name,
  ]);
  assert.deepEqual(
    pendingDeploymentMigrations(files, [applied(1), applied(0)]),
    [],
  );
});

void test("deployment refuses a missing baseline and unfinished migrations", () => {
  for (const history of [
    [],
    [applied(1)],
    [{ ...applied(0), finished_at: null }],
    [applied(0), { ...applied(1), finished_at: null }],
  ]) {
    assert.throws(() => pendingDeploymentMigrations(files, history));
  }
  assert.throws(() => pendingDeploymentMigrations([], [applied(0)]));
});

void test("restoring the applied homeroom migration leaves only the academic year pending without weakening checksum checks", () => {
  const homeroom = {
    name: "20261107000100_class_homeroom_assignments",
    checksum:
      "b1fe455a26a60267d045f2602e61dbdeb9a37ec6367909963f423604cb146f5e",
  };
  const academicYear = {
    name: "20261107000100_school_academic_year",
    checksum: "d".repeat(64),
  };
  const history = [
    applied(0),
    applied(1),
    {
      migration_name: homeroom.name,
      checksum: homeroom.checksum,
      finished_at: new Date("2026-11-06T17:49:59Z"),
      rolled_back_at: null,
    },
  ];
  assert.throws(() =>
    pendingDeploymentMigrations([...files, academicYear], history),
  );
  assert.deepEqual(
    pendingDeploymentMigrations([...files, homeroom, academicYear], history),
    [academicYear.name],
  );
  assert.throws(() =>
    pendingDeploymentMigrations(
      [...files, { ...homeroom, checksum: "changed" }, academicYear],
      history,
    ),
  );
});

void test("deployment rejects modified, missing, duplicate or out-of-order applied SQL", () => {
  assert.throws(() =>
    pendingDeploymentMigrations(files, [
      { ...applied(0), checksum: "changed" },
    ]),
  );
  assert.throws(() =>
    pendingDeploymentMigrations(files.slice(0, 1), [applied(0), applied(1)]),
  );
  assert.throws(() =>
    pendingDeploymentMigrations(files, [applied(0), applied(0)]),
  );
  const inserted = { name: "20261028000100_earlier", checksum: "c".repeat(64) };
  assert.throws(() =>
    pendingDeploymentMigrations(
      [files[0], inserted, files[1]],
      [applied(0), applied(1)],
    ),
  );
});

void test("an explicitly rolled-back attempt may be retried without hiding active failures", () => {
  const rolledBack = {
    ...applied(1),
    checksum: "old-failed-attempt",
    finished_at: null,
    rolled_back_at: new Date("2026-10-29T00:00:01Z"),
  };
  assert.deepEqual(
    pendingDeploymentMigrations(files, [applied(0), rolledBack]),
    [files[1].name],
  );
  assert.deepEqual(
    pendingDeploymentMigrations(files, [applied(0), rolledBack, applied(1)]),
    [],
  );
  assert.throws(() =>
    pendingDeploymentMigrations(files, [
      applied(0),
      rolledBack,
      { ...applied(1), finished_at: null },
    ]),
  );
});

void test("the deployment CLI refuses a mismatched target before connecting and keeps credentials out of errors", async () => {
  await assert.rejects(
    () =>
      promisify(execFile)(
        process.execPath,
        ["--require", "tsx/cjs", "src/scripts/check-migration-deployment.ts"],
        {
          cwd: path.resolve(__dirname, ".."),
          env: {
            ...process.env,
            DATABASE_URL: url,
            AZURE_DATABASE_HOST: "different.postgres.database.azure.com",
          },
          timeout: 10_000,
        },
      ),
    (error: unknown) => {
      assert(
        error !== null &&
          typeof error === "object" &&
          "stderr" in error &&
          typeof error.stderr === "string",
      );
      assert.match(error.stderr, /Đích triển khai phải khớp/);
      assert(!error.stderr.includes("test-only"));
      assert(!error.stderr.includes(host));
      return true;
    },
  );
});
