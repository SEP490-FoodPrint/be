import { testAdmin } from "./helpers/authorization";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { connectRedis, disconnectRedis, redis } from "../src/config/redis";
import { createRedisAuthSessionStore } from "../src/utils/auth-session-store";
import {
  createAuthSessions,
  hashRefreshToken,
} from "../src/utils/auth-sessions";
import { HttpError } from "../src/utils/http-error";
import { verifyToken } from "../src/utils/jwt";

void test("auth session storage on local Redis uses isolated keys and atomic rotation", async (context) => {
  await connectRedis();
  const prefix = `foodprint:auth:test-${randomUUID()}:`;
  const store = createRedisAuthSessionStore(redis, prefix);
  const sessions = createAuthSessions(store);
  const keys = new Set<string>();
  context.after(async () => {
    try {
      if (keys.size) await redis.del([...keys]);
    } finally {
      await disconnectRedis();
    }
  });
  async function issue() {
    const token = await sessions.issue(testAdmin.id);
    keys.add(prefix + token.refreshToken.slice(0, 32));
    return token;
  }
  await context.test(
    "Redis stores only a hash and rotation preserves the original expiry",
    async () => {
      const first = await issue();
      const id = first.refreshToken.slice(0, 32);
      const key = prefix + id;
      const raw = await redis.get(key);
      assert(raw);
      assert(!raw.includes(first.refreshToken));
      assert(raw.includes(hashRefreshToken(first.refreshToken)));
      const ttl = await redis.pTTL(key);
      assert(ttl > 0 && ttl <= 604800000);
      const second = await sessions.refresh(first.refreshToken, () =>
        Promise.resolve(testAdmin),
      );
      assert.notEqual(second.refreshToken, first.refreshToken);
      assert((await redis.pTTL(key)) <= ttl);
      await assert.rejects(
        () =>
          sessions.refresh(first.refreshToken, () =>
            Promise.resolve(testAdmin),
          ),
        (error: unknown) =>
          error instanceof HttpError && error.statusCode === 401,
      );
      assert.equal(await redis.exists(key), 0);
    },
  );
  await context.test(
    "concurrent refresh revokes the family and does not touch another session",
    async () => {
      const first = await issue();
      const another = await issue();
      const results = await Promise.allSettled([
        sessions.refresh(first.refreshToken, () => Promise.resolve(testAdmin)),
        sessions.refresh(first.refreshToken, () => Promise.resolve(testAdmin)),
      ]);
      assert.equal(
        results.filter((result) => result.status === "fulfilled").length,
        1,
      );
      await assert.rejects(
        () => sessions.assertAccess(verifyToken(first.accessToken)),
        (error: unknown) =>
          error instanceof HttpError && error.statusCode === 401,
      );
      await sessions.assertAccess(verifyToken(another.accessToken));
      await sessions.refresh(another.refreshToken, () =>
        Promise.resolve(testAdmin),
      );
      await sessions.logout(another.refreshToken);
      assert.equal(
        await redis.exists(prefix + another.refreshToken.slice(0, 32)),
        0,
      );
    },
  );
  await context.test("expiry is enforced by Redis itself", async () => {
    const id = randomUUID().replaceAll("-", "");
    keys.add(prefix + id);
    const expiresAt = Math.floor(Date.now() / 1000) + 1;
    assert(
      await store.create(id, {
        userId: testAdmin.id,
        tokenHash: "a".repeat(64),
        expiresAt,
      }),
    );
    await setTimeout(1100);
    assert.equal(await store.get(id), null);
  });
  await context.test(
    "user revocation rejects legacy and current sessions, preserves other users and permits new logins",
    async () => {
      const old = await issue();
      const id = old.refreshToken.slice(0, 32);
      const record = await store.get(id);
      assert(record);
      delete record.generation;
      await redis.set(prefix + id, JSON.stringify(record), {
        EXAT: record.expiresAt,
      });
      const second = await issue();
      const otherId = randomUUID();
      const other = await sessions.issue(otherId);
      keys.add(prefix + other.refreshToken.slice(0, 32));
      keys.add(prefix + "user:" + testAdmin.id);
      await sessions.assertAccess(verifyToken(old.accessToken));
      await sessions.revokeUser(testAdmin.id);
      for (const token of [old, second]) {
        await assert.rejects(
          () => sessions.assertAccess(verifyToken(token.accessToken)),
          (error: unknown) =>
            error instanceof HttpError && error.statusCode === 401,
        );
        await assert.rejects(
          () =>
            sessions.refresh(token.refreshToken, () =>
              Promise.resolve(testAdmin),
            ),
          (error: unknown) =>
            error instanceof HttpError && error.statusCode === 401,
        );
      }
      await sessions.assertAccess(verifyToken(other.accessToken));
      const next = await issue();
      await sessions.assertAccess(verifyToken(next.accessToken));
    },
  );
});
