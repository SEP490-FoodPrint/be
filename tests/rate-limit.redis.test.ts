import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { test } from "node:test";
import { ipKeyGenerator } from "express-rate-limit";
import { createApp } from "../src/app";
import {
  connectRedis,
  createRedisRateLimitStore,
  disconnectRedis,
  redis,
} from "../src/config/redis";
import { createApiRateLimiter } from "../src/middlewares/rate-limit.middleware";
import { startHttp } from "./helpers/http";

process.env.NODE_ENV = "test";

void test("Redis-backed rate limiting on the existing local Docker service", async (context) => {
  await connectRedis();
  const scope = `test-${randomUUID()}`;
  const key = ipKeyGenerator("127.0.0.1");
  const stores: ReturnType<typeof createRedisRateLimitStore>[] = [];
  const servers: Awaited<ReturnType<typeof startHttp>>[] = [];

  context.after(async () => {
    for (const server of servers) await server.close();
    try {
      for (const store of stores) {
        await store.resetKey(key);
        await store.resetKey("ttl-probe");
      }
    } finally {
      await disconnectRedis();
    }
  });

  async function application(namespace: string, windowMs = 60_000) {
    const store = createRedisRateLimitStore(namespace);
    stores.push(store);
    const server = await startHttp(
      createApp(createApiRateLimiter(store, { windowMs, limit: 2 })),
    );
    servers.push(server);
    return { store, server };
  }

  await context.test(
    "separate application instances share Redis counters and TTL",
    async () => {
      const first = await application(scope);
      const second = await application(scope);
      assert.equal((await first.server.request("/api/missing")).status, 404);
      assert.equal((await second.server.request("/api/missing")).status, 404);
      assert.equal((await first.server.request("/api/missing")).status, 429);
      const ttl = await redis.pTTL(first.store.prefixKey(key));
      assert(ttl > 0 && ttl <= 60_000);
      const restarted = await application(scope);
      assert.equal(
        (await restarted.server.request("/api/missing")).status,
        429,
      );
    },
  );

  await context.test(
    "another namespace keeps an independent policy counter",
    async () => {
      const isolated = await application(`${scope}:isolated`);
      assert.equal((await isolated.server.request("/api/missing")).status, 404);
    },
  );

  await context.test(
    "health and preflight do not create counter keys",
    async () => {
      const health = await application(`${scope}:health`);
      assert.equal((await health.server.request("/api/health")).status, 200);
      assert.equal(
        (await health.server.request("/api/health/", { method: "HEAD" }))
          .status,
        200,
      );
      assert.equal(
        (await health.server.request("/api/missing", { method: "OPTIONS" }))
          .status,
        204,
      );
      assert.equal(await redis.exists(health.store.prefixKey(key)), 0);
    },
  );

  await context.test(
    "Redis expires the test counter and starts a new window",
    async () => {
      const ttl = await application(`${scope}:ttl`, 1000);
      assert.equal((await ttl.store.increment("ttl-probe")).totalHits, 1);
      await setTimeout(1100);
      assert.equal((await ttl.store.increment("ttl-probe")).totalHits, 1);
    },
  );

  await context.test(
    "an unavailable Redis client returns 503 without memory fallback",
    async (subtest) => {
      subtest.mock.method(console, "error", () => undefined);
      const offline = redis.duplicate();
      const store = createRedisRateLimitStore(`${scope}:offline`, offline);
      const server = await startHttp(
        createApp(createApiRateLimiter(store, { windowMs: 60_000, limit: 2 })),
      );
      servers.push(server);
      const response = await server.request("/api/missing");
      assert.equal(response.status, 503);
      assert.deepEqual(response.body, {
        success: false,
        statusCode: 503,
        message: "Dịch vụ giới hạn yêu cầu tạm thời không khả dụng.",
      });
    },
  );
});
