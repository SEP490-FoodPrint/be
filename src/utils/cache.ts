import { createHash } from "node:crypto";
import { redis } from "../config/redis";

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface CacheClient {
  readonly isReady: boolean;
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    options: { expiration: { type: "EX"; value: number } },
  ): Promise<unknown>;
  del(keys: string[]): Promise<number>;
}

export interface CacheOptions<T> {
  key: string;
  ttlSeconds: number;
  load: () => Promise<T>;
  isValid: (value: unknown) => value is T;
}

const CACHE_PREFIX = "foodprint:cache:v1:";
const RESOURCE_PATTERN = /^[a-z0-9][a-z0-9:_-]*$/i;
const KEY_PATTERN = /^foodprint:cache:v1:[a-z0-9][a-z0-9:_-]*:[a-f0-9]{64}$/i;

// Reject values JSON would silently change, such as Date, undefined, and NaN.
function serializeJson(value: unknown, ancestors = new Set<object>()): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError("Cache chỉ hỗ trợ dữ liệu JSON thuần.");
  }
  if (ancestors.has(value)) {
    throw new TypeError("Dữ liệu cache không được chứa tham chiếu vòng.");
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    throw new TypeError("Chuyển dữ liệu cache thành JSON DTO trước khi lưu.");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${Array.from(value as unknown[], (item) =>
        serializeJson(item, ancestors),
      ).join(",")}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([first], [second]) => (first < second ? -1 : first > second ? 1 : 0),
    );
    return `{${entries
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${serializeJson(item, ancestors)}`,
      )
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

/** Include organization/user scope and every normalized query parameter. */
export function buildCacheKey(resource: string, parameters: JsonValue): string {
  if (!RESOURCE_PATTERN.test(resource)) {
    throw new TypeError("Tên resource cache không hợp lệ.");
  }
  const hash = createHash("sha256")
    .update(serializeJson(parameters))
    .digest("hex");
  return `${CACHE_PREFIX}${resource}:${hash}`;
}

function assertCacheKey(key: string): void {
  if (!KEY_PATTERN.test(key)) {
    throw new TypeError("Cache key phải được tạo bằng buildCacheKey.");
  }
}

export class CacheInvalidationError extends Error {
  constructor() {
    super(
      "Không thể xóa cache Redis; dữ liệu cache có thể cũ đến khi hết TTL.",
    );
    this.name = "CacheInvalidationError";
  }
}

/** Reuse one instance per process so concurrent loads of a key are shared. */
export function createCache(client: CacheClient) {
  const inFlight = new Map<string, Promise<unknown>>();

  async function readOrLoad<T>(
    { key, ttlSeconds, load, isValid }: CacheOptions<T>,
    isCurrent: () => boolean,
  ): Promise<T> {
    if (client.isReady) {
      try {
        const raw = await client.get(key);
        if (raw !== null) {
          const value: unknown = JSON.parse(raw);
          if (isValid(value)) return value;
          throw new TypeError("Dữ liệu cache không khớp kiểu yêu cầu.");
        }
      } catch {
        console.warn("Cache: bỏ qua lỗi đọc hoặc dữ liệu không hợp lệ.");
      }
    }

    // Loader errors propagate to the service and are never cached.
    const value = await load();
    if (!isValid(value)) {
      throw new TypeError("Kết quả load không khớp kiểu dữ liệu cache.");
    }
    if (isCurrent() && client.isReady) {
      try {
        await client.set(key, serializeJson(value), {
          expiration: { type: "EX", value: ttlSeconds },
        });
      } catch {
        console.warn("Cache: bỏ qua lỗi ghi hoặc dữ liệu không hỗ trợ JSON.");
      }
    }
    return value;
  }

  async function getOrSet<T>(options: CacheOptions<T>): Promise<T> {
    const { key, ttlSeconds, isValid } = options;
    assertCacheKey(key);
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new TypeError("ttlSeconds phải là số nguyên dương an toàn.");
    }

    const existing = inFlight.get(key);
    if (existing) {
      const value = await existing;
      if (!isValid(value)) {
        throw new TypeError(
          "Không dùng cùng cache key cho các kiểu dữ liệu khác nhau.",
        );
      }
      return value;
    }

    const pending: Promise<T> = readOrLoad(
      options,
      () => inFlight.get(key) === pending,
    );
    inFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      if (inFlight.get(key) === pending) inFlight.delete(key);
    }
  }

  /** Call after the database transaction commits; only exact cache keys are removed. */
  async function invalidate(...keys: string[]): Promise<void> {
    for (const key of keys) assertCacheKey(key);
    if (keys.length === 0) return;
    // A loader started before invalidation must not refill this process's cache.
    for (const key of keys) inFlight.delete(key);
    try {
      if (!client.isReady) throw new CacheInvalidationError();
      await client.del([...new Set(keys)]);
    } catch {
      throw new CacheInvalidationError();
    }
  }

  return { getOrSet, invalidate };
}

export const cache = createCache(redis);
