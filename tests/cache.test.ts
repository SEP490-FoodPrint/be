import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCacheKey,
  CacheInvalidationError,
  createCache,
  type JsonValue,
} from "../src/utils/cache";
import { FakeCacheClient } from "./helpers/cache-client";

const isString = (value: unknown): value is string => typeof value === "string";
const key = buildCacheKey("lookup:list", { organizationId: "test", page: 1 });

function fixture(client = new FakeCacheClient()) {
  return { client, cache: createCache(client) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

void test("cache keys normalize nested objects and distinguish scopes and query parameters", () => {
  const first = buildCacheKey("lookup:list", {
    organizationId: "one",
    filter: { b: 2, a: 1 },
    order: ["a", "b"],
  });
  assert.equal(
    first,
    buildCacheKey("lookup:list", {
      order: ["a", "b"],
      filter: { a: 1, b: 2 },
      organizationId: "one",
    }),
  );
  assert.match(first, /^foodprint:cache:v1:lookup:list:[a-f0-9]{64}$/);
  for (const params of [
    { organizationId: "two", filter: { a: 1, b: 2 }, order: ["a", "b"] },
    { organizationId: "one", filter: { a: 2, b: 2 }, order: ["a", "b"] },
    { organizationId: "one", filter: { a: 1, b: 2 }, order: ["b", "a"] },
  ]) {
    assert.notEqual(first, buildCacheKey("lookup:list", params));
  }
  assert.notEqual(
    first,
    buildCacheKey("lookup:detail", { organizationId: "one" }),
  );
});

void test("key generation rejects invalid resources and lossy or circular JSON parameters", () => {
  for (const resource of ["", "lookup list", "*", "lookup/other"]) {
    assert.throws(() => buildCacheKey(resource, {}), TypeError);
  }
  const circular: { self?: JsonValue } = {};
  circular.self = circular;
  for (const parameters of [NaN, Infinity, circular]) {
    assert.throws(() => buildCacheKey("lookup", parameters), TypeError);
  }
  // Exercise runtime callers that bypass the TypeScript JSON-only contract.
  for (const parameters of [new Date(), { missing: undefined }, 1n]) {
    assert.throws(
      () => buildCacheKey("lookup", parameters as unknown as JsonValue),
      TypeError,
    );
  }
});

void test("cache miss loads once, stores a TTL, and later hits skip the loader", async () => {
  const { cache, client } = fixture();
  let loads = 0;
  const options = {
    key,
    ttlSeconds: 60,
    isValid: isString,
    load: () => Promise.resolve(`value-${++loads}`),
  };
  assert.equal(await cache.getOrSet(options), "value-1");
  assert.equal(client.entries.get(key)?.expiresAt, 60_000);
  client.now = 30_000;
  assert.equal(await cache.getOrSet(options), "value-1");
  assert.equal(client.entries.get(key)?.expiresAt, 60_000);
  assert.equal(loads, 1);
  assert.equal(client.writes, 1);
});

void test("DTO interfaces keep their types and are validated on cache hits", async () => {
  interface LookupDto {
    labels: readonly string[];
    count: number;
  }
  const isDto = (value: unknown): value is LookupDto =>
    typeof value === "object" &&
    value !== null &&
    "labels" in value &&
    Array.isArray(value.labels) &&
    value.labels.every((item: unknown) => typeof item === "string") &&
    "count" in value &&
    typeof value.count === "number";
  const { cache } = fixture();
  let loads = 0;
  const options = {
    key,
    ttlSeconds: 60,
    isValid: isDto,
    load: (): Promise<LookupDto> => {
      loads += 1;
      return Promise.resolve({ labels: ["one", "two"], count: 2 });
    },
  };
  assert.deepEqual(await cache.getOrSet(options), {
    labels: ["one", "two"],
    count: 2,
  });
  const cached: LookupDto = await cache.getOrSet(options);
  assert.deepEqual(cached.labels, ["one", "two"]);
  assert.equal(loads, 1);
});

void test("null, false, zero, empty strings, arrays, and objects are cache hits", async () => {
  for (const expected of [null, false, 0, "", [], {}]) {
    const { cache } = fixture();
    let loads = 0;
    const options = {
      key,
      ttlSeconds: 60,
      isValid: (value: unknown): value is JsonValue =>
        JSON.stringify(value) === JSON.stringify(expected),
      load: () => {
        loads += 1;
        return Promise.resolve(expected);
      },
    };
    assert.deepEqual(await cache.getOrSet(options), expected);
    assert.deepEqual(await cache.getOrSet(options), expected);
    assert.equal(loads, 1);
  }
});

void test("TTL expiry reloads the source", async () => {
  const { cache, client } = fixture();
  let loads = 0;
  const options = {
    key,
    ttlSeconds: 1,
    isValid: isString,
    load: () => Promise.resolve(`value-${++loads}`),
  };
  await cache.getOrSet(options);
  client.now = 1001;
  assert.equal(await cache.getOrSet(options), "value-2");
  assert.equal(loads, 2);
});

void test("concurrent misses share one loader within a cache instance", async () => {
  const { cache, client } = fixture();
  const started = deferred<void>();
  const source = deferred<string>();
  let loads = 0;
  const options = {
    key,
    ttlSeconds: 60,
    isValid: isString,
    load: () => {
      loads += 1;
      started.resolve();
      return source.promise;
    },
  };
  const pending = Array.from({ length: 20 }, () => cache.getOrSet(options));
  await started.promise;
  assert.equal(loads, 1);
  source.resolve("shared");
  assert.deepEqual(
    await Promise.all(pending),
    Array<string>(20).fill("shared"),
  );
  assert.equal(client.writes, 1);
});

void test("different keys can load independently", async () => {
  const { cache } = fixture();
  const started = deferred<void>();
  const source = deferred<string>();
  const first = cache.getOrSet({
    key,
    ttlSeconds: 60,
    isValid: isString,
    load: () => {
      started.resolve();
      return source.promise;
    },
  });
  await started.promise;
  const other = await cache.getOrSet({
    key: buildCacheKey("lookup:list", { organizationId: "other" }),
    ttlSeconds: 60,
    isValid: isString,
    load: () => Promise.resolve("other"),
  });
  assert.equal(other, "other");
  source.resolve("first");
  assert.equal(await first, "first");
});

void test("concurrent callers cannot reuse a key for incompatible result types", async () => {
  const { cache } = fixture();
  const source = deferred<string>();
  const options = {
    key,
    ttlSeconds: 60,
    isValid: isString,
    load: () => source.promise,
  };
  const first = cache.getOrSet(options);
  const incompatible = cache.getOrSet({
    key,
    ttlSeconds: 60,
    isValid: (value: unknown): value is number => typeof value === "number",
    load: () =>
      Promise.reject(new Error("must not load for an incompatible key")),
  });
  const rejected = assert.rejects(incompatible, /các kiểu dữ liệu khác nhau/);
  source.resolve("shared");
  assert.equal(await first, "shared");
  await rejected;
});

void test("loader errors reach all waiters and a later request can retry", async () => {
  const { cache, client } = fixture();
  const source = deferred<string>();
  const error = new Error("source query failed");
  const options = {
    key,
    ttlSeconds: 60,
    isValid: isString,
    load: () => source.promise,
  };
  const results = Promise.allSettled([
    cache.getOrSet(options),
    cache.getOrSet(options),
  ]);
  source.reject(error);
  for (const result of await results) {
    assert.equal(result.status, "rejected");
    if (result.status === "rejected") assert.equal(result.reason, error);
  }
  assert.equal(client.writes, 0);
  assert.equal(
    await cache.getOrSet({
      ...options,
      load: () => Promise.resolve("recovered"),
    }),
    "recovered",
  );
});

void test("corrupt JSON and wrong cached shapes reload and replace the entry", async (context) => {
  context.mock.method(console, "warn", () => undefined);
  for (const raw of ["{broken", "42", "null", '{"unexpected":true}']) {
    const { cache, client } = fixture();
    await client.set(key, raw, { expiration: { type: "EX", value: 60 } });
    assert.equal(
      await cache.getOrSet({
        key,
        ttlSeconds: 60,
        isValid: isString,
        load: () => Promise.resolve("fresh"),
      }),
      "fresh",
    );
    assert.equal(await client.get(key), '"fresh"');
  }
});

void test("read/write failures and an offline client return source data without a memory cache", async (context) => {
  const warnings = context.mock.method(console, "warn", () => undefined);
  for (const mode of ["read", "write", "offline"]) {
    const client = new FakeCacheClient();
    client.failGet = mode === "read";
    client.failSet = mode === "read" || mode === "write";
    client.isReady = mode !== "offline";
    const cache = createCache(client);
    let loads = 0;
    const options = {
      key,
      ttlSeconds: 60,
      isValid: isString,
      load: () => Promise.resolve(`fresh-${++loads}`),
    };
    assert.equal(await cache.getOrSet(options), "fresh-1");
    assert.equal(await cache.getOrSet(options), "fresh-2");
  }
  assert(warnings.mock.callCount() > 0);
  assert(!JSON.stringify(warnings.mock.calls).includes("private Redis"));
});

void test("unsupported JSON values are returned but not stored", async (context) => {
  context.mock.method(console, "warn", () => undefined);
  const { cache, client } = fixture();
  const value = await cache.getOrSet({
    key,
    ttlSeconds: 60,
    isValid: (entry: unknown): entry is number => typeof entry === "number",
    load: () => Promise.resolve(NaN),
  });
  assert(Number.isNaN(value));
  assert.equal(client.writes, 0);
});

void test("invalid TTLs, foreign keys, and invalid loader output are rejected", async () => {
  const { cache, client } = fixture();
  const options = {
    key,
    ttlSeconds: 60,
    isValid: isString,
    load: () => Promise.resolve("value"),
  };
  for (const ttlSeconds of [
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    await assert.rejects(cache.getOrSet({ ...options, ttlSeconds }), TypeError);
  }
  for (const invalidKey of [
    "",
    "foodprint:rate-limit:api:127.0.0.1",
    "foodprint:cache:v1:*",
  ]) {
    await assert.rejects(
      cache.getOrSet({ ...options, key: invalidKey }),
      TypeError,
    );
    await assert.rejects(cache.invalidate(key, invalidKey), TypeError);
  }
  assert.equal(client.reads, 0);
  assert.equal(client.deleted.length, 0);
  await assert.rejects(
    cache.getOrSet({
      ...options,
      isValid: (_value: unknown): _value is string => false,
    }),
    /Kết quả load/,
  );
  assert.equal(client.writes, 0);
});

void test("invalidation deletes only exact cache keys and permits a fresh load", async () => {
  const { cache, client } = fixture();
  const other = buildCacheKey("lookup:list", { organizationId: "other" });
  const options = {
    key,
    ttlSeconds: 60,
    isValid: isString,
    load: () => Promise.resolve("old"),
  };
  await cache.getOrSet(options);
  await cache.getOrSet({ ...options, key: other });
  await cache.invalidate(key, key);
  assert.deepEqual(client.deleted, [[key]]);
  assert.equal(await client.get(key), null);
  assert.equal(await client.get(other), '"old"');
  assert.equal(
    await cache.getOrSet({ ...options, load: () => Promise.resolve("fresh") }),
    "fresh",
  );
  await cache.invalidate();
  assert.equal(client.deleted.length, 1);
});

void test("invalidation failures are explicit and do not expose Redis error details", async () => {
  for (const mode of ["offline", "delete"]) {
    const { cache, client } = fixture();
    client.isReady = mode !== "offline";
    client.failDel = mode === "delete";
    await assert.rejects(cache.invalidate(key), (error: unknown) => {
      assert(error instanceof CacheInvalidationError);
      assert(!error.message.includes("private Redis"));
      return true;
    });
  }
});

void test("invalidation prevents an earlier local loader from repopulating stale data", async () => {
  const { cache, client } = fixture();
  const started = deferred<void>();
  const source = deferred<string>();
  const options = { key, ttlSeconds: 60, isValid: isString };
  const old = cache.getOrSet({
    ...options,
    load: () => {
      started.resolve();
      return source.promise;
    },
  });
  await started.promise;
  await cache.invalidate(key);
  assert.equal(
    await cache.getOrSet({ ...options, load: () => Promise.resolve("fresh") }),
    "fresh",
  );
  source.resolve("old");
  assert.equal(await old, "old");
  assert.equal(await client.get(key), '"fresh"');
});

void test("an old loader finishing cannot remove a newer in-flight load", async () => {
  const { cache } = fixture();
  const oldStarted = deferred<void>();
  const freshStarted = deferred<void>();
  const oldSource = deferred<string>();
  const freshSource = deferred<string>();
  const options = { key, ttlSeconds: 60, isValid: isString };
  const old = cache.getOrSet({
    ...options,
    load: () => {
      oldStarted.resolve();
      return oldSource.promise;
    },
  });
  await oldStarted.promise;
  await cache.invalidate(key);
  const fresh = cache.getOrSet({
    ...options,
    load: () => {
      freshStarted.resolve();
      return freshSource.promise;
    },
  });
  await freshStarted.promise;
  oldSource.resolve("old");
  await old;
  const joined = cache.getOrSet({
    ...options,
    load: () => Promise.reject(new Error("must join fresh loader")),
  });
  freshSource.resolve("fresh");
  assert.deepEqual(await Promise.all([fresh, joined]), ["fresh", "fresh"]);
});
