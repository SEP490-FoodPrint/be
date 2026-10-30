import { spawnSync } from "node:child_process";
import path from "node:path";
import { requireDatabaseUrl } from "../config/env";
import { assertLocalMigrationTarget } from "../utils/migration-target";

function main(): void {
  try {
    const connectionString = requireDatabaseUrl();
    assertLocalMigrationTarget(connectionString);
    const args = process.argv.slice(2);
    if (args.some((arg) => /^--(?:config|url)(?:=|$)/.test(arg))) {
      throw new Error(
        "Không hỗ trợ ghi đè config hoặc URL trong lệnh migration local",
      );
    }
    const root = path.resolve(__dirname, "../..");
    const result = spawnSync(
      process.execPath,
      [
        path.join(root, "node_modules/prisma/build/index.js"),
        "migrate",
        "dev",
        "--config",
        path.join(root, "prisma.config.ts"),
        ...args,
      ],
      {
        cwd: root,
        env: { ...process.env, DATABASE_URL: connectionString },
        stdio: "inherit",
      },
    );
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Không thể chạy migration local",
    );
    process.exitCode = 1;
  }
}

main();
