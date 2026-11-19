import dotenv from "dotenv";
import path from "node:path";
import { HttpError } from "../utils/http-error";

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

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function readPublicTraceOrigin(
  source: NodeJS.ProcessEnv = process.env,
): string {
  const raw = source.PUBLIC_TRACE_ORIGIN?.trim();
  if (!raw) {
    throw new Error("Thieu PUBLIC_TRACE_ORIGIN hop le");
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    throw new Error("PUBLIC_TRACE_ORIGIN phai la origin URL hop le");
  }

  if (
    target.username !== "" ||
    target.password !== "" ||
    raw.includes("?") ||
    raw.includes("#") ||
    target.search !== "" ||
    target.hash !== "" ||
    target.pathname !== "/"
  ) {
    throw new Error(
      "PUBLIC_TRACE_ORIGIN chi duoc chua scheme, host va port; khong credentials, path, query hoac hash",
    );
  }

  const isProduction = source.NODE_ENV?.trim() === "production";
  if (isProduction) {
    if (target.protocol !== "https:") {
      throw new Error("PUBLIC_TRACE_ORIGIN bat buoc HTTPS trong production");
    }
    return target.origin;
  }

  if (target.protocol === "https:") {
    return target.origin;
  }
  if (target.protocol === "http:" && LOOPBACK_HOSTS.has(target.hostname)) {
    return target.origin;
  }

  throw new Error(
    "PUBLIC_TRACE_ORIGIN chi cho phep HTTPS hoac HTTP loopback trong moi truong dev",
  );
}

const BUSINESS_CODE_KEY_PATTERN = /^[0-9a-f]{64}$/i;
export const BUSINESS_CODE_UNAVAILABLE_MESSAGE =
  "Không thể cấp mã nghiệp vụ. Vui lòng thử lại sau.";

/**
 * Khóa Feistel cho mã nghiệp vụ FP-XX-NNNNN (32 byte, 64 ký tự hex).
 * Đọc tại thời điểm cấp mã; thiếu hoặc sai định dạng thì từ chối cấp mã, không dùng khóa mặc định.
 * Không bao giờ log hoặc trả giá trị khóa.
 */
export function readBusinessCodeKey(
  source: NodeJS.ProcessEnv = process.env,
): Buffer {
  const raw = source.BUSINESS_CODE_KEY?.trim();
  if (!raw || !BUSINESS_CODE_KEY_PATTERN.test(raw)) {
    console.error(
      raw
        ? "BUSINESS_CODE_KEY sai định dạng: cần đúng 64 ký tự hex."
        : "Thiếu BUSINESS_CODE_KEY: không thể cấp mã nghiệp vụ.",
    );
    throw new HttpError(503, BUSINESS_CODE_UNAVAILABLE_MESSAGE);
  }
  return Buffer.from(raw, "hex");
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
