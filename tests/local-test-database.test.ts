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

void test("authorization group runs isolated children sequentially with shared environment and propagates failure", async () => {
  const { runSuite, localTestSuites } =
    await import("./helpers/run-local-tests.js");
  const { EventEmitter } = await import("node:events");
  type Spawn = typeof import("node:child_process").spawn;
  assert.deepEqual(localTestSuites.authorization, [
    "tests/authorization.integration.test.ts",
    "tests/supplier-onboarding.integration.test.ts",
  ]);
  const env = { LOCAL_TEST_DATABASE_MANIFEST: "/tmp/invocation-only-manifest" };
  for (const failure of [0, 7, null]) {
    const launched: string[] = [];
    let active = false;
    const launch = ((
      _command: string,
      args: string[],
      options: { env: unknown },
    ) => {
      assert.equal(active, false, "child processes must not overlap");
      assert.equal(options.env, env);
      launched.push(args.at(-1)!);
      active = true;
      const child = new EventEmitter();
      queueMicrotask(() => {
        active = false;
        child.emit("close", failure, failure === null ? "SIGTERM" : null);
      });
      return child;
    }) as unknown as Spawn;
    const result = await runSuite("authorization", env, () => {}, launch);
    assert.equal(result, failure === null ? 1 : failure);
    assert.equal(launched.length, failure === 0 ? 2 : 1);
  }
});

void test("CREATE is recorded only after success and cleanup checks exact names and ownership", async () => {
  const { createRecordedDatabase, cleanupRun } =
    await import("./helpers/run-local-tests.js");
  const directory = mkdtempSync(
    path.join(tmpdir(), "foodprint-registry-dispatch-"),
  );
  const manifest = path.join(directory, "manifest.jsonl");
  const name = "foodprint_migration_test_dispatch";
  type Admin = Parameters<typeof cleanupRun>[0];
  const statements: { sql: string; values?: unknown[] }[] = [];
  let owner = "unit-owner";
  const admin = {
    query(sql: string, values?: unknown[]) {
      statements.push({ sql, values });
      return Promise.resolve({
        rows: sql.startsWith("SELECT") ? [{ owner }] : [],
      });
    },
  } as unknown as Admin;
  try {
    await assert.rejects(() =>
      createRecordedDatabase(
        {
          query: () => Promise.reject(new Error("create refused")),
        } as unknown as Admin,
        name,
        manifest,
      ),
    );
    assert.deepEqual(recordedLocalTestDatabases(manifest), []);
    await createRecordedDatabase(admin, name, manifest);
    assert.deepEqual(recordedLocalTestDatabases(manifest), [name]);
    owner = "someone-else";
    await assert.rejects(
      () => cleanupRun(admin, manifest, "unit-owner"),
      /Owner/,
    );
    assert.equal(
      statements.some(({ sql }) => sql.startsWith("DROP")),
      false,
    );
    owner = "unit-owner";
    await cleanupRun(admin, manifest, owner);
    assert.deepEqual(
      statements
        .filter(({ sql }) => sql.startsWith("SELECT"))
        .map(({ values }) => values),
      [[name], [name]],
    );
    assert.deepEqual(
      statements
        .filter(({ sql }) => sql.startsWith("DROP"))
        .map(({ sql }) => sql),
      [`DROP DATABASE "${name}" WITH (FORCE)`],
    );
    assert.equal(
      statements.some(({ sql }) => /LIKE|datname\s*~/.test(sql)),
      false,
    );
    writeFileSync(manifest, '"foodprint_db"\n');
    const before = statements.length;
    await assert.rejects(() => cleanupRun(admin, manifest, owner));
    assert.equal(statements.length, before);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
