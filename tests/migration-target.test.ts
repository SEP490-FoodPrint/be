import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { assertLocalMigrationTarget } from "../src/utils/migration-target";

void test("development migration targets accept local PostgreSQL only", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    for (const protocol of ["postgres:", "postgresql:"]) {
      assert.doesNotThrow(() =>
        assertLocalMigrationTarget(
          `${protocol}//test@${host}:5432/foodprint?schema=foodprint`,
        ),
      );
    }
  }
  for (const target of [
    "invalid",
    "http://localhost/foodprint",
    "postgresql://localhost/",
    "postgresql://test@server.postgres.database.azure.com/foodprint",
    "postgresql://test@other-server/foodprint",
    "postgresql://localhost.evil/foodprint",
    "postgresql://localhost/foodprint?host=remote-server",
    "postgresql://localhost/foodprint?hostaddr=203.0.113.1",
    "postgresql://localhost/foodprint?service=remote",
  ])
    assert.throws(() => assertLocalMigrationTarget(target));
});

void test("the development migration command refuses Azure before invoking Prisma", async () => {
  const root = path.resolve(__dirname, "..");
  await assert.rejects(
    () =>
      promisify(execFile)(
        process.execPath,
        [
          "--require",
          "tsx/cjs",
          "src/scripts/migrate-local.ts",
          "--create-only",
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            DATABASE_URL:
              "postgresql://migration_test@not-contacted.postgres.database.azure.com/foodprint",
          },
        },
      ),
    (error: unknown) => {
      assert(
        error !== null &&
          typeof error === "object" &&
          "stderr" in error &&
          typeof error.stderr === "string",
      );
      assert.match(
        error.stderr,
        /Migration development chỉ được chạy trên PostgreSQL local/,
      );
      assert(!error.stderr.includes("Loaded Prisma config"));
      return true;
    },
  );
});
