import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertOwnedTestDatabaseName,
  localTestDatabaseUrl,
  readLocalTestConfig,
  recordLocalTestDatabase,
  recordedLocalTestDatabases,
} from "./helpers/local-test-database";

const settings = {
  TEST_DB_HOST: "127.0.0.1",
  TEST_DB_PORT: "5433",
  TEST_DB_USER: "test_user",
  TEST_DB_PASSWORD: "local-only:@#%/ password",
};

void test("local runner encodes credentials and ignores application DATABASE_URL", () => {
  const config = readLocalTestConfig({
    ...settings,
    DATABASE_URL: "postgresql://unused.example/production",
  });
  const url = new URL(
    localTestDatabaseUrl(config, "foodprint_migration_test_example"),
  );
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "5433");
  assert.equal(decodeURIComponent(url.password), settings.TEST_DB_PASSWORD);
  assert.equal(url.searchParams.get("schema"), "foodprint");
});

void test("local runner rejects remote hosts, invalid ports and missing passwords", () => {
  for (const override of [
    { TEST_DB_HOST: "db.postgres.database.azure.com" },
    { TEST_DB_HOST: "127.0.0.1?host=remote" },
    { TEST_DB_PORT: "0" },
    { TEST_DB_PORT: "5433.5" },
    { TEST_DB_PORT: "65536" },
    { TEST_DB_USER: "" },
    { TEST_DB_PASSWORD: undefined },
    { TEST_DB_PASSWORD: "REPLACE_WITH_LOCAL_PASSWORD" },
    { TEST_REDIS_URL: "redis://remote.example:6379/0" },
  ])
    assert.throws(() => readLocalTestConfig({ ...settings, ...override }));
});

void test("cleanup name guard excludes control/member databases and SQL identifiers", () => {
  for (const name of [
    "postgres",
    "foodprint_db",
    "foodprint_migration_test",
    'foodprint_migration_test_x"; DROP DATABASE postgres;--',
    "other_test_123",
    "foodprint_migration_test_" + "a".repeat(64),
  ]) {
    assert.throws(() => assertOwnedTestDatabaseName(name));
  }
  assert.doesNotThrow(() =>
    assertOwnedTestDatabaseName("foodprint_authorization_legacy_example"),
  );
  assert.throws(() =>
    localTestDatabaseUrl(readLocalTestConfig(settings), "foodprint_db"),
  );
});

void test("per-run manifest records exact names, deduplicates and follows PostgreSQL identifier truncation", () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), "foodprint-registry-unit-"),
  );
  const manifest = path.join(directory, "manifest.jsonl");
  try {
    assert.deepEqual(recordedLocalTestDatabases(manifest), []);
    const name = "foodprint_migration_test_example";
    recordLocalTestDatabase(name, manifest);
    recordLocalTestDatabase(name, manifest);
    const longName = "foodprint_migration_test_complaints_" + "a".repeat(32);
    recordLocalTestDatabase(longName, manifest);
    assert.deepEqual(recordedLocalTestDatabases(manifest), [
      name,
      longName.slice(0, 63),
    ]);
    assert.equal(
      readFileSync(manifest, "utf8").includes(settings.TEST_DB_PASSWORD),
      false,
    );
    assert.throws(() => recordLocalTestDatabase("foodprint_db", manifest));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("cleanup refuses malformed or unsafe manifest content", () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), "foodprint-registry-unit-"),
  );
  const manifest = path.join(directory, "manifest.jsonl");
  try {
    for (const content of [
      '"foodprint_db"\n',
      '{"name":"anything"}\n',
      "not-json\n",
    ]) {
      writeFileSync(manifest, content);
      assert.throws(() => recordedLocalTestDatabases(manifest));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
