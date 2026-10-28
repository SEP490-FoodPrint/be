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
    throw new Error(`${name} phai la so nguyen duong khong qua ${maximum}`);
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
    throw new Error("REDIS_URL khong hop le");
  }
  if (
    !["redis:", "rediss:"].includes(target.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
  ) {
    throw new Error("Chi cho phep ket noi Redis local");
  }
  if (target.pathname && !/^\/\d*$/.test(target.pathname)) {
    throw new Error("Database index trong REDIS_URL khong hop le");
  }
  return value;
}

export function requireDatabaseUrl(): string {
  let value = process.env.DATABASE_URL;

  // Tu dong tao DATABASE_URL tu cac bien DB_* neu chua co
  if (!value && process.env.DB_HOST) {
    const user = process.env.DB_USER || "postgres";
    const rawPass = process.env.DB_PASSWORD || process.env.DB_PASS || "";
    const password = encodeURIComponent(rawPass);
    const host = process.env.DB_HOST || "localhost";
    const port = process.env.DB_PORT || "5432";
    const dbName = process.env.DB_NAME || "foodprint_db";
    const schema = process.env.DB_SCHEMA || "public";
    const isAzure = host.includes("azure.com");
    const sslParam = isAzure ? "&uselibpqcompat=true&sslmode=require" : "";
    value = `postgresql://${user}:${password}@${host}:${port}/${dbName}?schema=${schema}${sslParam}`;
    process.env.DATABASE_URL = value;
  }

  if (!value)
    throw new Error("Thieu DATABASE_URL hoac thong tin DB trong .env");

  let target: URL;
  try {
    target = new URL(value);
  } catch {
    throw new Error("DATABASE_URL khong hop le");
  }

  if (!["postgresql:", "postgres:"].includes(target.protocol)) {
    throw new Error("DATABASE_URL phai la PostgreSQL URL");
  }

  const isAllowedHost =
    ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
    target.hostname.endsWith(".postgres.database.azure.com") ||
    target.hostname.includes("azure.com");

  if (!isAllowedHost) {
    throw new Error(
      "Chi cho phep ket noi PostgreSQL local hoac Azure Database",
    );
  }

  if (target.pathname.length <= 1) {
    throw new Error("DATABASE_URL phai chi ro database name");
  }

  return value;
}
