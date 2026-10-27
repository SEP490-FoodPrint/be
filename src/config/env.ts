import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export interface RateLimitConfig {
  windowMs: number;
  limit: number;
}

function positiveInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) {
    throw new Error(`${name} phải là số nguyên dương không quá ${maximum}`);
  }
  return number;
}

export function readRateLimitConfig(
  source: NodeJS.ProcessEnv = process.env,
): RateLimitConfig {
  return {
    windowMs: positiveInteger(
      "RATE_LIMIT_WINDOW_MS",
      source.RATE_LIMIT_WINDOW_MS,
      60_000,
      2_147_483_647,
    ),
    limit: positiveInteger("RATE_LIMIT_MAX", source.RATE_LIMIT_MAX, 300),
  };
}

export function requireRedisUrl(): string {
  const value = process.env.REDIS_URL || "redis://127.0.0.1:6379/0";
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    throw new Error("REDIS_URL không hợp lệ");
  }
  if (
    !["redis:", "rediss:"].includes(target.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
  ) {
    throw new Error("Chỉ cho phép kết nối Redis local");
  }
  if (target.pathname && !/^\/\d*$/.test(target.pathname)) {
    throw new Error("Database index trong REDIS_URL không hợp lệ");
  }
  return value;
}

export function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("Thiếu DATABASE_URL trong .env");

  let target: URL;
  try {
    target = new URL(value);
  } catch {
    throw new Error("DATABASE_URL không hợp lệ");
  }

  if (!["postgresql:", "postgres:"].includes(target.protocol)) {
    throw new Error("DATABASE_URL phải là PostgreSQL URL");
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) {
    throw new Error("Chỉ cho phép kết nối PostgreSQL local");
  }
  if (target.pathname.length <= 1) {
    throw new Error("DATABASE_URL phải chỉ rõ database local");
  }

  return value;
}
