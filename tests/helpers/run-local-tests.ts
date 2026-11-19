import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import {
  assertOwnedTestDatabaseName,
  localTestControlDatabase,
  localTestDatabaseUrl,
  readLocalTestConfig,
  recordLocalTestDatabase,
  recordedLocalTestDatabases,
} from "./local-test-database";

const root = path.resolve(__dirname, "../..");
export const localTestSuites = {
  migrations: ["tests/migrations.test.ts"],
  authorization: [
    "tests/authorization.integration.test.ts",
    "tests/supplier-onboarding.integration.test.ts",
  ],
  lifecycle: ["tests/account-lifecycle.integration.test.ts"],
  "supplier-orders": ["tests/supplier-order-creation.integration.test.ts"],
} as const;
const files = localTestSuites;
type Suite = keyof typeof files | "unit";

export async function cleanupRun(
  admin: Client,
  manifest: string,
  expectedOwner: string,
) {
  // Names are recorded only AFTER CREATE succeeds. Never scan/delete by prefix.
  const names = recordedLocalTestDatabases(manifest).reverse();
  let dropped = 0;
  for (const name of names) {
    const existing = (
      await admin.query<{ owner: string }>(
        "SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1",
        [name],
      )
    ).rows[0];
    if (!existing) continue;
    if (existing.owner !== expectedOwner)
      throw new Error("Owner database thử đã đổi; dừng dọn tự động.");
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    dropped++;
  }
  console.log(
    `Đã kiểm tra/dọn ${names.length} database thuộc lần chạy này (${dropped} database do runner dọn).`,
  );
}

export async function createRecordedDatabase(
  admin: Client,
  name: string,
  manifest: string,
) {
  // Validate before interpolating; never register an unsuccessful CREATE.
  assertOwnedTestDatabaseName(name);
  await admin.query(`CREATE DATABASE "${name}"`);
  recordLocalTestDatabase(name, manifest);
}

export async function runSuite(
  suite: Suite,
  env: NodeJS.ProcessEnv,
  onChild: (child: ChildProcess | undefined) => void,
  launch: typeof spawn = spawn,
) {
  const commands =
    suite === "unit"
      ? [["run", "test:unit"]]
      : files[suite].map((file) => ["--import", "tsx", "--test", file]);
  for (const args of commands) {
    console.log(`Chạy test local: ${suite} (${args.at(-1)})`);
    const code = await new Promise<number>((resolve, reject) => {
      const child = launch(suite === "unit" ? "npm" : process.execPath, args, {
        cwd: root,
        env,
        stdio: "inherit",
      });
      onChild(child);
      child.once("error", reject);
      child.once("close", (status) => {
        onChild(undefined);
        resolve(status ?? 1);
      });
    });
    if (code !== 0) return code;
  }
  return 0;
}

async function main() {
  const mode = process.argv[2] ?? "all";
  if (
    process.argv.length > 3 ||
    !["all", "check", "unit", ...Object.keys(files)].includes(mode)
  ) {
    throw new Error(
      "Dùng test:local -- [check|unit|migrations|authorization|lifecycle|supplier-orders|all].",
    );
  }
  if (mode === "unit") {
    process.exitCode = await runSuite("unit", process.env, () => {});
    return;
  }
  const envFile = path.join(root, ".env.test.local");
  if (!existsSync(envFile))
    throw new Error(
      "Tạo .env.test.local theo .env.test.example trước khi chạy.",
    );
  process.loadEnvFile(envFile);
  const config = readLocalTestConfig(process.env);
  const admin = new Client({
    connectionString: localTestDatabaseUrl(config, "postgres"),
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
    ssl: false,
  });
  let temporaryDirectory: string | undefined;
  let manifest: string | undefined;
  let child: ChildProcess | undefined;
  let interrupted = false;
  const stop = () => {
    interrupted = true;
    child?.kill("SIGTERM");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    await admin.connect();
    const info = (
      await admin.query<{ version: string; can_create: boolean }>(
        "SELECT current_setting('server_version') AS version, (SELECT rolcreatedb OR rolsuper FROM pg_roles WHERE rolname=current_user) AS can_create",
      )
    ).rows[0];
    if (!info.can_create)
      throw new Error(
        "User PostgreSQL local cần quyền CREATEDB để chạy test cô lập.",
      );
    const exists = (
      await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [
        localTestControlDatabase,
      ])
    ).rowCount;
    if (!exists)
      await admin.query(`CREATE DATABASE "${localTestControlDatabase}"`);
    console.log(
      `PostgreSQL local ${config.host}:${config.port}, version ${info.version}, database ${localTestControlDatabase}.`,
    );
    if (mode === "check") return;

    temporaryDirectory = mkdtempSync(
      path.join(tmpdir(), "foodprint-local-tests-"),
    );
    manifest = path.join(temporaryDirectory, "created-databases.jsonl");
    const name = "foodprint_migration_test_" + randomUUID().replaceAll("-", "");
    await createRecordedDatabase(admin, name, manifest);
    const target = localTestDatabaseUrl(config, name);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: target,
      MIGRATION_TEST_DATABASE_URL: target,
      REDIS_URL: config.redisUrl,
      LOCAL_TEST_DATABASE_MANIFEST: manifest,
      // Khóa Feistel chỉ dùng cho test (giống CI) khi .env.test.local để trống.
      BUSINESS_CODE_KEY:
        process.env.BUSINESS_CODE_KEY ||
        "0f1e2d3c4b5a69788796a5b4c3d2e1f00112233445566778899aabbccddeeff0",
    };
    const suites: Suite[] =
      mode === "all"
        ? ["unit", ...(Object.keys(files) as (keyof typeof files)[])]
        : [mode as keyof typeof files];
    for (const suite of suites) {
      if (interrupted) {
        process.exitCode = 130;
        break;
      }
      const code = await runSuite(suite, env, (value) => {
        child = value;
      });
      if (code !== 0) {
        process.exitCode = interrupted ? 130 : code;
        break;
      }
    }
  } finally {
    try {
      if (manifest) {
        await cleanupRun(admin, manifest, config.user);
      }
      if (temporaryDirectory)
        rmSync(temporaryDirectory, { recursive: true, force: true });
    } finally {
      await admin.end();
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      if (interrupted) process.exitCode = 130;
    }
  }
}

if (require.main === module) {
  void main().catch(() => {
    // Driver/spawn errors can contain URLs, passwords or environment values.
    console.error(
      "Không chạy xong test local. Kiểm tra .env.test.local, kết nối/quyền CREATEDB và output test phía trên; không dùng database ứng dụng.",
    );
    process.exitCode = 1;
  });
}
