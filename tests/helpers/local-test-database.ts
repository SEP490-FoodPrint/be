import { appendFileSync, existsSync, readFileSync } from "node:fs";

export const localTestControlDatabase = "foodprint_migration_test";
const generatedName =
  /^foodprint_(?:migration_test|authorization_test|authorization_legacy)_[a-z0-9_]+$/;

export function readLocalTestConfig(source: NodeJS.ProcessEnv) {
  const host = source.TEST_DB_HOST ?? "127.0.0.1";
  const port = Number(source.TEST_DB_PORT ?? "5433");
  const user = source.TEST_DB_USER;
  const password = source.TEST_DB_PASSWORD;
  if (
    !["127.0.0.1", "localhost", "::1"].includes(host) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !user?.trim() ||
    password === undefined ||
    password === "REPLACE_WITH_LOCAL_PASSWORD"
  ) {
    throw new Error(
      "Điền cấu hình PostgreSQL local trong .env.test.local; chỉ nhận loopback.",
    );
  }
  const redis = new URL(source.TEST_REDIS_URL ?? "redis://127.0.0.1:6379/0");
  if (
    !["redis:", "rediss:"].includes(redis.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(redis.hostname)
  )
    throw new Error("TEST_REDIS_URL phải trỏ Redis local.");
  return { host, port, user, password, redisUrl: redis.toString() };
}

export function localTestDatabaseUrl(
  config: ReturnType<typeof readLocalTestConfig>,
  database: string,
): string {
  if (database !== "postgres" && database !== localTestControlDatabase) {
    assertOwnedTestDatabaseName(database);
  }
  const url = new URL("postgresql://127.0.0.1");
  url.hostname = config.host === "::1" ? "[::1]" : config.host;
  url.port = String(config.port);
  url.username = encodeURIComponent(config.user);
  url.password = encodeURIComponent(config.password);
  url.pathname = "/" + database;
  url.searchParams.set("schema", "foodprint");
  return url.toString();
}

export function assertOwnedTestDatabaseName(name: string): void {
  if (name.length > 63 || !generatedName.test(name))
    throw new Error(
      "Chỉ được dọn database thử có tên do harness sinh trong lần chạy hiện tại.",
    );
}

/** A no-op in existing CI; the local runner sets a private manifest per run. */
export function recordLocalTestDatabase(
  name: string,
  manifest = process.env.LOCAL_TEST_DATABASE_MANIFEST,
): void {
  if (!manifest) return;
  if (!generatedName.test(name))
    throw new Error("Tên database do harness sinh không hợp lệ.");
  // Existing fixture names are ASCII; PostgreSQL truncates identifiers to 63 bytes.
  const actualName = name.slice(0, 63);
  assertOwnedTestDatabaseName(actualName);
  appendFileSync(manifest, JSON.stringify(actualName) + "\n", { mode: 0o600 });
}

export function recordedLocalTestDatabases(manifest: string): string[] {
  if (!existsSync(manifest)) return [];
  const names = readFileSync(manifest, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const name: unknown = JSON.parse(line);
      if (typeof name !== "string")
        throw new Error("Manifest database thử không hợp lệ.");
      assertOwnedTestDatabaseName(name);
      return name;
    });
  return [...new Set(names)];
}
