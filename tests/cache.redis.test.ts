import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { connectRedis, disconnectRedis, redis } from "../src/config/redis";
import { buildCacheKey, createCache } from "../src/utils/cache";

const isString = (value: unknown): value is string => typeof value === "string";

void test("query cache on the existing local Docker Redis", async (context) => {
  await connectRedis();
  const resource = `test-${randomUUID()}`;
  const keys = new Set<string>();
  const cache = createCache(redis);
  function testKey(name: string) {
    const key = buildCacheKey(resource, { name });
    keys.add(key);
    return key;
  }
  context.after(async () => {
    try {
      await cache.invalidate(...keys);
    } finally {
      await disconnectRedis();
    }
  });

  await context.test(
    "separate helper instances reuse the stored JSON without loading again",
    async () => {
      const key = testKey("shared");
      const options = {
        key,
        ttlSeconds: 60,
        isValid: isString,
        load: () => Promise.resolve("from-source"),
      };
      assert.equal(await cache.getOrSet(options), "from-source");
      const another = createCache(redis);
      assert.equal(
        await another.getOrSet({
          ...options,
          load: () => Promise.reject(new Error("unexpected source query")),
        }),
        "from-source",
      );
      assert.equal(await redis.get(key), '"from-source"');
      const ttl = await redis.pTTL(key);
      assert(ttl > 0 && ttl <= 60_000);
    },
  );

  await context.test(
    "Redis expires entries and the next request refreshes the value",
    async () => {
      const key = testKey("ttl");
      let loads = 0;
      const options = {
        key,
        ttlSeconds: 1,
        isValid: isString,
        load: () => Promise.resolve(`value-${++loads}`),
      };
      assert.equal(await cache.getOrSet(options), "value-1");
      await setTimeout(1100);
      assert.equal(await cache.getOrSet(options), "value-2");
      assert.equal(loads, 2);
    },
  );

  await context.test(
    "invalidation removes selected test keys and preserves another entry",
    async () => {
      const key = testKey("invalidate");
      const second = testKey("invalidate-second");
      const untouched = testKey("untouched");
      const options = {
        key,
        ttlSeconds: 60,
        isValid: isString,
        load: () => Promise.resolve("old"),
      };
      for (const entry of [key, second, untouched])
        await cache.getOrSet({ ...options, key: entry });
      await cache.invalidate(key, second);
      assert.equal(await redis.exists([key, second]), 0);
      assert.equal(await redis.get(untouched), '"old"');
      assert.equal(
        await cache.getOrSet({
          ...options,
          load: () => Promise.resolve("fresh"),
        }),
        "fresh",
      );
    },
  );

  await context.test(
    "malformed cached JSON is replaced with a validated value",
    async (subtest) => {
      subtest.mock.method(console, "warn", () => undefined);
      const key = testKey("corrupt");
      await redis.set(key, "{broken", {
        expiration: { type: "EX", value: 60 },
      });
      assert.equal(
        await cache.getOrSet({
          key,
          ttlSeconds: 60,
          isValid: isString,
          load: () => Promise.resolve("valid"),
        }),
        "valid",
      );
      assert.equal(await redis.get(key), '"valid"');
    },
  );
});
