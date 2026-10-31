import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import {
  createEmailVerificationService,
  EmailVerificationRateLimitError,
  verificationFingerprint,
  type EmailVerificationRepository,
  type VerificationAccount,
} from "../src/modules/auth/email-verification.service";
import { createEmailVerificationController } from "../src/modules/auth/email-verification.controller";
import { createSignupService } from "../src/modules/auth/signup.service";
import { verificationMailer } from "../src/utils/verification-email";
import { createRedisEmailVerificationStore } from "../src/utils/email-verification-store";
import { readEmailConfig } from "../src/config/email";
import { createCsrfProtection } from "../src/middlewares/csrf.middleware";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import { HttpError } from "../src/utils/http-error";
import { memoryEmailVerification } from "./helpers/email-verification";
import { startHttp } from "./helpers/http";

process.env.JWT_SECRET = "foodprint-email-verification-unit-only";
const status = (code: number) => (error: unknown) =>
  error instanceof HttpError && error.statusCode === code;
function fixture() {
  let now = Date.now();
  const { store, records } = memoryEmailVerification(() => now);
  const user: VerificationAccount = {
    id: randomUUID(),
    email: "applicant@example.test",
    emailVerifiedAt: null,
    status: "UNVERIFIED",
    roleCode: "SCHOOL_ADMINISTRATION",
  };
  let code = "",
    calls = 0;
  const repository: EmailVerificationRepository = {
    find: (email) => Promise.resolve(email === user.email ? user : null),
    markVerified: (id, email) => {
      calls++;
      if (
        id !== user.id ||
        email !== user.email ||
        user.emailVerifiedAt ||
        user.status !== "UNVERIFIED"
      )
        return Promise.resolve(false);
      user.emailVerifiedAt = new Date(now);
      return Promise.resolve(true);
    },
  };
  const mailer = {
    assertConfigured() {},
    send: (_email: string, value: string) => {
      code = value;
      return Promise.resolve();
    },
  };
  const service = createEmailVerificationService(
    store,
    mailer,
    repository,
    () => now,
  );
  return {
    service,
    store,
    records,
    repository,
    mailer,
    user,
    get code() {
      return code;
    },
    get writes() {
      return calls;
    },
    advance: (seconds: number) => {
      now += seconds * 1000;
    },
  };
}
void test("email codes are HMAC-only, expire, are consumed once and never activate the account", async () => {
  const f = fixture();
  assert(await f.service.request(f.user.email, "127.0.0.1"));
  assert.match(f.code, /^[0-9]{6}$/);
  const record = f.records.get(
    verificationFingerprint("email:" + f.user.email),
  );
  assert(record);
  assert.deepEqual(Object.keys(record).sort(), [
    "attempts",
    "codeHash",
    "expiresAt",
    "id",
    "userId",
  ]);
  assert.match(record.codeHash, /^[a-f0-9]{64}$/);
  await f.service.verify(f.user.email, f.code);
  assert(f.user.emailVerifiedAt);
  assert.equal(f.user.status, "UNVERIFIED");
  assert.equal(f.writes, 1);
  await assert.rejects(
    () => f.service.verify(f.user.email, f.code),
    status(400),
  );
  assert.equal(f.writes, 1);
  const expired = fixture();
  await expired.service.request(expired.user.email);
  expired.advance(601);
  await assert.rejects(
    () => expired.service.verify(expired.user.email, expired.code),
    status(400),
  );
  assert.equal(expired.writes, 0);
});
void test("wrong guesses lock a code after five attempts; resend invalidates the previous code and keeps hourly limits", async () => {
  const f = fixture();
  await f.service.request(f.user.email);
  const first = f.code;
  await assert.rejects(
    () => f.service.request(f.user.email),
    (error) =>
      error instanceof EmailVerificationRateLimitError &&
      error.retryAfterSeconds > 0,
  );
  const wrong = first === "000000" ? "111111" : "000000";
  for (let n = 0; n < 5; n++)
    await assert.rejects(
      () => f.service.verify(f.user.email, wrong),
      status(400),
    );
  await assert.rejects(
    () => f.service.verify(f.user.email, first),
    status(400),
  );
  assert.equal(f.writes, 0);
  f.advance(61);
  await f.service.request(f.user.email);
  assert.equal(f.records.size, 1);
  for (let n = 0; n < 3; n++) {
    f.advance(61);
    await f.service.request(f.user.email);
  }
  f.advance(61);
  await assert.rejects(() => f.service.request(f.user.email), status(429));
});
void test("unknown/verified accounts have the same request contract and IP/email rate budgets; changed email/status cannot be verified", async () => {
  const f = fixture();
  assert.equal(await f.service.request("unknown@example.test"), false);
  await assert.rejects(
    () => f.service.request("unknown@example.test"),
    status(429),
  );
  await f.service.request(f.user.email);
  f.user.email = "changed@example.test";
  await assert.rejects(
    () => f.service.verify("applicant@example.test", f.code),
    status(400),
  );
  assert.equal(f.user.emailVerifiedAt, null);
  const locked = fixture();
  await locked.service.request(locked.user.email);
  locked.user.status = "LOCKED";
  await assert.rejects(
    () => locked.service.verify(locked.user.email, locked.code),
    status(400),
  );
  assert.equal(locked.user.emailVerifiedAt, null);
  const budget = fixture();
  for (let i = 0; i < 20; i++)
    await budget.service.request(`unknown${i}@example.test`);
  await assert.rejects(
    () => budget.service.request("last@example.test"),
    status(429),
  );
});
void test("provider and Redis failures fail closed, discard only their challenge and never leak raw errors", async () => {
  const f = fixture();
  f.mailer.send = () => Promise.reject(new Error("provider-private-secret"));
  await assert.rejects(
    () => f.service.request(f.user.email),
    (error) =>
      status(503)(error) &&
      error instanceof Error &&
      !error.message.includes("provider-private-secret"),
  );
  assert.equal(f.records.size, 0);
  assert.equal(f.writes, 0);
  const store = createRedisEmailVerificationStore({
    isReady: false,
    sendCommand: () => Promise.reject(new Error("private-redis-url")),
  });
  await assert.rejects(() => store.get("a".repeat(64)), status(503));
  assert.throws(() =>
    createRedisEmailVerificationStore(undefined, "foodprint:auth:"),
  );
  const broken = createRedisEmailVerificationStore({
    isReady: true,
    sendCommand: () => Promise.resolve("invalid JSON"),
  });
  await assert.rejects(() => broken.get("a".repeat(64)), status(503));
});
void test("signup preserves the committed account and reports email failure instead of asking the client to register twice", async (context) => {
  context.mock.method(console, "error", () => undefined);
  let persisted = 0;
  const signup = createSignupService(
    (input) => {
      persisted++;
      return Promise.resolve({
        user: {
          id: randomUUID(),
          username: input.username,
          fullName: input.fullName,
          status: "UNVERIFIED",
        },
        onboardingRequired: true,
      });
    },
    { request: () => Promise.reject(new HttpError(503, "Resend unavailable")) },
  );
  const result = await signup.signup({
    username: "applicant",
    email: "a@example.test",
    password: "Food123!",
    fullName: "Applicant",
    requestType: "SCHOOL",
    phone: null,
  });
  assert.equal(persisted, 1);
  assert.equal(result.emailVerificationRequired, true);
  assert.equal(result.verificationEmailSent, false);
  assert.equal(result.user.status, "UNVERIFIED");
});
void test("Resend adapter sends a text code with a timeout/idempotency key and sanitizes SDK errors", async (context) => {
  assert.throws(() => readEmailConfig({}), status(503));
  const before = [process.env.RESEND_API_KEY, process.env.RESEND_FROM];
  context.after(() =>
    ["RESEND_API_KEY", "RESEND_FROM"].forEach((key, i) => {
      const value = before[i];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }),
  );
  process.env.RESEND_API_KEY = "re_unit_test";
  process.env.RESEND_FROM = "FoodPrint <no-reply@foodprint.example.com>";
  let fail = false;
  context.mock.method(
    globalThis,
    "fetch",
    (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      assert.equal(url, "https://api.resend.com/emails");
      const headers = new Headers(init?.headers);
      assert.equal(
        headers.get("Idempotency-Key"),
        "email-verification/test-nonce",
      );
      assert(init?.signal);
      assert.equal(typeof init?.body, "string");
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      assert(String(body.text).includes("012345"));
      assert.equal(body.html, undefined);
      return Promise.resolve(
        new Response(
          JSON.stringify(
            fail
              ? { name: "validation_error", message: "private-provider-error" }
              : { id: "test-email-id" },
          ),
          {
            status: fail ? 400 : 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    },
  );
  await verificationMailer.send(
    "recipient@example.test",
    "012345",
    "test-nonce",
  );
  fail = true;
  await assert.rejects(
    () =>
      verificationMailer.send("recipient@example.test", "012345", "test-nonce"),
    (error) =>
      status(503)(error) &&
      error instanceof Error &&
      !error.message.includes("private-provider-error"),
  );
});
void test("public email HTTP endpoints require CSRF, normalize email, hide codes and return Retry-After", async (context) => {
  const f = fixture(),
    controller = createEmailVerificationController(f.service);
  const app = express();
  app.use(createCsrfProtection("http://localhost:3001"));
  app.use(express.json());
  app.post("/request", controller.request);
  app.post("/verify", controller.verify);
  app.use(globalErrorHandler);
  context.mock.method(console, "error", () => undefined);
  const http = await startHttp(app);
  context.after(() => http.close());
  const headers = {
    "Content-Type": "application/json",
    "X-CSRF-Protection": "1",
  };
  assert.equal(
    (
      await http.request("/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: f.user.email }),
      })
    ).status,
    403,
  );
  const response = await http.request("/request", {
    method: "POST",
    headers,
    body: JSON.stringify({ email: " APPLICANT@EXAMPLE.TEST " }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual((response.body as { data: unknown }).data, {
    expiresIn: 600,
    resendAfter: 60,
  });
  const limited = await http.request("/request", {
    method: "POST",
    headers,
    body: JSON.stringify({ email: f.user.email }),
  });
  assert.equal(limited.status, 429);
  assert(Number(limited.headers.get("retry-after")) > 0);
  assert.equal(
    (
      await http.request("/verify", {
        method: "POST",
        headers,
        body: JSON.stringify({ email: f.user.email, code: 123456 }),
      })
    ).status,
    400,
  );
  const verify = await http.request("/verify", {
    method: "POST",
    headers,
    body: JSON.stringify({ email: f.user.email, code: f.code }),
  });
  assert.equal(verify.status, 200);
  assert.deepEqual(verify.headers.getSetCookie(), []);
  assert.equal(f.user.status, "UNVERIFIED");
});
