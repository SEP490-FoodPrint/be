import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { MemoryStore } from "express-rate-limit";
import { createApp } from "../src/app";
import {
  readRateLimitConfig,
  requireRedisUrl,
  type RateLimitConfig,
} from "../src/config/env";
import { createApiRateLimiter } from "../src/middlewares/rate-limit.middleware";
import { startHttp } from "./helpers/http";

process.env.NODE_ENV = "test";

async function fixture(
  context: TestContext,
  config: RateLimitConfig = { windowMs: 60_000, limit: 2 },
) {
  const store = new MemoryStore();
  const http = await startHttp(createApp(createApiRateLimiter(store, config)));
  context.after(async () => {
    await http.close();
    store.shutdown();
  });
  return http;
}

void test("defaults are 300 requests per minute and valid environment overrides work", () => {
  assert.deepEqual(readRateLimitConfig({}), { windowMs: 60_000, limit: 300 });
  assert.deepEqual(
    readRateLimitConfig({
      RATE_LIMIT_WINDOW_MS: "120000",
      RATE_LIMIT_MAX: "10",
    }),
    { windowMs: 120_000, limit: 10 },
  );
});

void test("invalid environment limits fail instead of disabling rate limiting", () => {
  for (const value of [
    "",
    "0",
    "-1",
    "1.5",
    "abc",
    "Infinity",
    "9007199254740992",
  ]) {
    assert.throws(
      () => readRateLimitConfig({ RATE_LIMIT_MAX: value }),
      /RATE_LIMIT_MAX/,
    );
    assert.throws(
      () => readRateLimitConfig({ RATE_LIMIT_WINDOW_MS: value }),
      /RATE_LIMIT_WINDOW_MS/,
    );
  }
  assert.throws(
    () => readRateLimitConfig({ RATE_LIMIT_WINDOW_MS: "2147483648" }),
    /RATE_LIMIT_WINDOW_MS/,
  );
});

void test("Redis configuration accepts local URLs and rejects remote targets", () => {
  const original = process.env.REDIS_URL;
  try {
    delete process.env.REDIS_URL;
    assert.equal(requireRedisUrl(), "redis://127.0.0.1:6379/0");
    process.env.REDIS_URL = "redis://localhost:6379/1";
    assert.equal(requireRedisUrl(), process.env.REDIS_URL);
    for (const value of [
      "invalid",
      "redis://remote.invalid:6379/0",
      "http://localhost",
      "redis://localhost/-1",
    ]) {
      process.env.REDIS_URL = value;
      assert.throws(requireRedisUrl);
    }
  } finally {
    if (original === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = original;
  }
});

void test("the request after the quota receives 429 and standard headers", async (context) => {
  const http = await fixture(context);
  assert.equal((await http.request("/api/missing")).status, 404);
  const allowed = await http.request("/api/missing");
  assert.equal(allowed.status, 404);
  assert(allowed.headers.has("ratelimit"));
  assert(allowed.headers.has("ratelimit-policy"));
  assert.equal(allowed.headers.get("x-ratelimit-limit"), null);

  const blocked = await http.request("/api/missing");
  assert.equal(blocked.status, 429);
  assert(Number(blocked.headers.get("retry-after")) > 0);
  assert.deepEqual(blocked.body, {
    success: false,
    statusCode: 429,
    message: "Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.",
  });
});

void test("health GET/HEAD, trailing slash, and CORS preflight do not consume quota", async (context) => {
  const http = await fixture(context, { windowMs: 60_000, limit: 1 });
  for (const method of ["GET", "HEAD"]) {
    for (const path of ["/api/health", "/api/health/"]) {
      const response = await http.request(path, { method });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("ratelimit"), null);
    }
  }
  assert.equal(
    (await http.request("/api/missing", { method: "OPTIONS" })).status,
    204,
  );
  assert.equal((await http.request("/api/missing")).status, 404);
  assert.equal((await http.request("/api/missing")).status, 429);
  assert.equal((await http.request("/api/health")).status, 200);
});

void test("the limiter runs before JSON parsing and does not affect paths outside /api", async (context) => {
  const http = await fixture(context, { windowMs: 60_000, limit: 1 });
  assert.equal((await http.request("/api/missing")).status, 404);
  const malformed = await http.request("/api/missing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{invalid",
  });
  assert.equal(malformed.status, 429);
  assert.equal((await http.request("/outside-api")).status, 404);
  assert.equal((await http.request("/outside-api")).status, 404);
});

void test("the next window restores the quota using a controlled clock", async (context) => {
  const now = Date.now();
  context.mock.timers.enable({ apis: ["Date"], now });
  const http = await fixture(context, { windowMs: 60_000, limit: 1 });
  assert.equal((await http.request("/api/missing")).status, 404);
  assert.equal((await http.request("/api/missing")).status, 429);
  context.mock.timers.tick(60_001);
  assert.equal((await http.request("/api/missing")).status, 404);
});

void test("independent stores do not share counters", async (context) => {
  const first = await fixture(context, { windowMs: 60_000, limit: 1 });
  const second = await fixture(context, { windowMs: 60_000, limit: 1 });
  assert.equal((await first.request("/api/missing")).status, 404);
  assert.equal((await first.request("/api/missing")).status, 429);
  assert.equal((await second.request("/api/missing")).status, 404);
});

void test("changing X-Forwarded-For cannot bypass the limit with trust proxy disabled", async (context) => {
  context.mock.method(console, "error", () => undefined);
  const http = await fixture(context, { windowMs: 60_000, limit: 1 });
  assert.equal(
    (
      await http.request("/api/missing", {
        headers: { "x-forwarded-for": "192.0.2.1" },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await http.request("/api/missing", {
        headers: { "x-forwarded-for": "192.0.2.2" },
      })
    ).status,
    429,
  );
});
