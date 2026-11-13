import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { Client } from "pg";
import { assertLocalMigrationTarget } from "../../src/utils/migration-target";

const execute = promisify(execFile);
const root = path.resolve(__dirname, "../..");

export function disposableLifecycleTarget(connectionString: string): URL {
  const target = assertLocalMigrationTarget(connectionString);
  if (!/^\/foodprint_migration_test(?:_[a-z0-9_]+)?$/.test(target.pathname)) {
    throw new Error(
      "Cần chọn instance PostgreSQL local dành riêng cho kiểm thử",
    );
  }
  return target;
}

/** Only a database created by this invocation is eligible for cleanup. */
export async function createLifecycleTestDatabase(connectionString: string) {
  const target = disposableLifecycleTarget(connectionString);
  const name = `foodprint_authorization_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString });
  let created = false;
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    const isolated = new URL(target);
    isolated.pathname = `/${name}`;
    try {
      await execute(
        process.execPath,
        [
          path.join(root, "node_modules/prisma/build/index.js"),
          "migrate",
          "deploy",
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            NODE_ENV: "test",
            DATABASE_URL: isolated.toString(),
            PRISMA_HIDE_UPDATE_MESSAGE: "1",
          },
          timeout: 60_000,
        },
      );
    } catch {
      // Keep database credentials and driver diagnostics out of test output.
      throw new Error(
        "Không thể triển khai migration vào database kiểm thử tạm",
      );
    }
    let closed = false;
    return {
      url: isolated.toString(),
      async cleanup() {
        if (closed) return;
        // The name is generated locally, never accepted from caller input.
        await admin.query(`DROP DATABASE "${name}"`);
        closed = true;
        await admin.end();
      },
    };
  } catch (error) {
    try {
      if (created) await admin.query(`DROP DATABASE "${name}"`);
    } finally {
      await admin.end();
    }
    throw error;
  }
}

/** Deterministic rendezvous for tests, without timing-based sleeps. */
export function createBarrier(participants: number) {
  if (!Number.isSafeInteger(participants) || participants < 1) {
    throw new Error("Số participant không hợp lệ");
  }
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    async wait(): Promise<void> {
      arrived += 1;
      if (arrived > participants)
        throw new Error("Barrier đã được sử dụng hết");
      if (arrived === participants) release();
      await gate;
    },
  };
}
