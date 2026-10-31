import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import { MemoryStore } from "express-rate-limit";
import { createApp } from "../src/app";
import { createSessionAuthenticate } from "../src/middlewares/auth.middleware";
import { createApiRateLimiter } from "../src/middlewares/rate-limit.middleware";
import {
  createPasswordService,
  passwordFingerprint,
  type PasswordAccount,
  type PasswordRepository,
} from "../src/modules/auth/password.service";
import {
  validateChangePassword,
  validateVerifyCurrentPassword,
  validateForgotPassword,
  validatePasswordCode,
  validateResetPassword,
  validateNewPassword,
} from "../src/modules/auth/password.validation";
import { sessionService } from "../src/modules/auth/session.service";
import { signupService } from "../src/modules/auth/signup.service";
import { validateSignup } from "../src/modules/auth/signup.validation";
import { createAuthSessions } from "../src/utils/auth-sessions";
import { HttpError } from "../src/utils/http-error";
import {
  createRedisPasswordResetStore,
  type PasswordResetGrant,
  type PasswordResetGrants,
} from "../src/utils/password-reset-store";
import { passwordResetMailer } from "../src/utils/password-reset-email";
import { verifyToken } from "../src/utils/jwt";
import type { SessionUser } from "../src/types/session-user";
import { memoryEmailVerification } from "./helpers/email-verification";
import { memorySessions } from "./helpers/auth-sessions";
import { testAdmin } from "./helpers/authorization";
import { startHttp } from "./helpers/http";

process.env.JWT_SECRET = "foodprint-password-unit-test-only";
const oldPassword = "current valid password";
const newPassword = "Food123!";
const status = (code: number) => (error: unknown) =>
  error instanceof HttpError && error.statusCode === code;
const sessionUser: SessionUser = {
  ...testAdmin,
  email: "owner@example.test",
  phone: null,
  status: "ACTIVE",
  onboardingRequired: false,
  registrationRequest: null,
  emailVerifiedAt: null,
};
async function fixture() {
  let now = Date.now(),
    code = "",
    sent = 0,
    writes = 0,
    changes = 0;
  const clock = () => now;
  const { store: codes, records } = memoryEmailVerification(clock);
  const { store: sessionStore } = memorySessions(clock);
  const sessions = createAuthSessions(sessionStore, clock);
  const account: PasswordAccount = {
    id: testAdmin.id,
    email: sessionUser.email,
    passwordHash: await bcrypt.hash(oldPassword, 4),
    status: "ACTIVE",
  };
  const grantsMap = new Map<string, PasswordResetGrant>();
  const grants: PasswordResetGrants = {
    issue(token, grant) {
      grantsMap.set(token, structuredClone(grant));
      return Promise.resolve();
    },
    consume(token) {
      const grant = grantsMap.get(token);
      grantsMap.delete(token);
      return Promise.resolve(grant ?? null);
    },
    limitChange() {
      return Promise.resolve(++changes > 5 ? 900 : 0);
    },
  };
  const repository: PasswordRepository = {
    find: (email) =>
      Promise.resolve(
        email.toLowerCase() === account.email.toLowerCase()
          ? { ...account }
          : null,
      ),
    async replace(id, verifyAndHash) {
      assert.equal(id, account.id);
      const hash = await verifyAndHash({ ...account });
      await sessions.revokeUser(id);
      account.passwordHash = hash;
      writes++;
    },
  };
  const mailer = {
    assertConfigured() {},
    send(_email: string, value: string) {
      code = value;
      sent++;
      return Promise.resolve();
    },
  };
  const service = createPasswordService(
    codes,
    grants,
    mailer,
    repository,
    clock,
  );
  return {
    service,
    codes,
    records,
    grants,
    grantsMap,
    repository,
    mailer,
    account,
    sessions,
    get code() {
      return code;
    },
    get sent() {
      return sent;
    },
    get writes() {
      return writes;
    },
    advance(seconds: number) {
      now += seconds * 1000;
    },
  };
}

void test("signup, change and reset enforce eight characters with lowercase, uppercase, digits and punctuation or symbols", () => {
  const signup = (password: unknown) =>
    validateSignup({
      username: "password_policy_test",
      email: "owner@example.test",
      fullName: "Password policy test",
      requestType: "SCHOOL",
      password,
    });
  for (const password of [
    "Food123!",
    "ĐồĂn123!",
    " Food123! ",
    "Aa1!" + "a".repeat(68),
    "Aa1!" + "á".repeat(34),
  ]) {
    assert.equal(validateNewPassword(password), password);
    assert.equal(signup(password).password, password);
    assert.equal(
      validateChangePassword({
        currentPassword: "legacy",
        newPassword: password,
      }).newPassword,
      password,
    );
    assert.equal(
      validateResetPassword({
        resetToken: "a".repeat(43),
        newPassword: password,
      }).newPassword,
      password,
    );
  }
  for (const password of [
    "Abcd1!x", // Seven characters, even with every required category.
    "password1!", // No uppercase letter.
    "PASSWORD1!", // No lowercase letter.
    "Password!", // No digit.
    "Password1", // No special character.
    "Password1 ", // Whitespace does not replace punctuation or symbols.
    "ĐồĂn1234", // Accented letters do not count as special characters.
    "Aa1!" + "a".repeat(69),
    "Aa1!" + "á".repeat(35),
  ]) {
    assert.throws(() => signup(password), status(400));
    assert.throws(
      () =>
        validateChangePassword({
          currentPassword: "legacy",
          newPassword: password,
        }),
      status(400),
    );
    assert.throws(
      () =>
        validateResetPassword({
          resetToken: "a".repeat(43),
          newPassword: password,
        }),
      status(400),
    );
  }
});
void test("password inputs normalize email, preserve password whitespace and reject weak/oversized/extra fields", () => {
  assert.deepEqual(validateForgotPassword({ email: " Owner@Example.test " }), {
    email: "owner@example.test",
  });
  assert.equal(
    validatePasswordCode({ email: "owner@example.test", code: "012345" }).code,
    "012345",
  );
  assert.equal(
    validateChangePassword({ currentPassword: " old ", newPassword })
      .currentPassword,
    " old ",
  );
  for (const body of [
    { email: "invalid" },
    { email: sessionUser.email, userId: testAdmin.id },
  ])
    assert.throws(() => validateForgotPassword(body), status(400));
  for (const code of [123456, "12345", "1234567", " 123456", "１２３４５６"])
    assert.throws(
      () => validatePasswordCode({ email: sessionUser.email, code }),
      status(400),
    );
  for (const password of ["short", "á".repeat(37), null])
    assert.throws(
      () =>
        validateChangePassword({
          currentPassword: oldPassword,
          newPassword: password,
        }),
      status(400),
    );
  assert.throws(
    () => validateChangePassword({ currentPassword: "", newPassword }),
    status(400),
  );
  assert.throws(
    () => validateResetPassword({ resetToken: "invalid", newPassword }),
    status(400),
  );
  assert.throws(
    () =>
      validateChangePassword({
        currentPassword: oldPassword,
        newPassword,
        userId: randomUUID(),
      }),
    status(400),
  );
});
void test("forgot password verifies a purpose-bound HMAC code before issuing a short one-use reset grant", async () => {
  const f = await fixture();
  const first = await f.sessions.issue(f.account.id);
  const other = await f.sessions.issue(f.account.id);
  await f.service.request(f.account.email);
  assert.match(f.code, /^[0-9]{6}$/);
  const stored = [...f.records.values()][0];
  assert(
    stored &&
      stored.codeHash !== f.code &&
      !JSON.stringify(stored).includes(f.account.email),
  );
  const result = await f.service.verify(f.account.email, f.code);
  assert.equal(result.expiresIn, 300);
  assert.match(result.resetToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(f.writes, 0);
  await assert.rejects(
    () => f.service.verify(f.account.email, f.code),
    status(400),
  );
  await f.service.reset(result.resetToken, newPassword);
  assert.equal(f.writes, 1);
  assert.equal(f.account.status, "ACTIVE");
  assert(await bcrypt.compare(newPassword, f.account.passwordHash));
  assert.equal(bcrypt.getRounds(f.account.passwordHash), 12);
  for (const token of [first, other]) {
    await assert.rejects(
      () => f.sessions.assertAccess(verifyToken(token.accessToken)),
      status(401),
    );
    await assert.rejects(
      () =>
        f.sessions.refresh(token.refreshToken, () =>
          Promise.resolve(sessionUser),
        ),
      status(401),
    );
  }
  await assert.rejects(
    () => f.service.reset(result.resetToken, "Another123!"),
    status(400),
  );
  const fresh = await f.sessions.issue(f.account.id);
  await f.sessions.assertAccess(verifyToken(fresh.accessToken));
});
void test("wrong codes lock after five attempts, expire and resend replaces the original challenge", async () => {
  const f = await fixture();
  await f.service.request(f.account.email);
  const original = [...f.records.values()][0];
  const wrong = f.code === "000000" ? "111111" : "000000";
  for (let n = 0; n < 5; n++)
    await assert.rejects(
      () => f.service.verify(f.account.email, wrong),
      status(400),
    );
  await assert.rejects(
    () => f.service.verify(f.account.email, f.code),
    status(400),
  );
  f.advance(61);
  await f.service.request(f.account.email);
  assert.notEqual([...f.records.values()][0].id, original.id);
  f.advance(601);
  await assert.rejects(
    () => f.service.verify(f.account.email, f.code),
    status(400),
  );
  assert.equal(f.writes, 0);
});
void test("unknown/locked accounts share request limits and receive no email; recovery never activates or verifies an account", async () => {
  const f = await fixture();
  await f.service.request("unknown@example.test");
  await assert.rejects(
    () => f.service.request("unknown@example.test"),
    status(429),
  );
  f.account.status = "LOCKED";
  await f.service.request(f.account.email);
  assert.equal(f.sent, 0);
  f.advance(61);
  f.account.status = "UNVERIFIED";
  await f.service.request(f.account.email);
  const grant = await f.service.verify(f.account.email, f.code);
  await f.service.reset(grant.resetToken, newPassword);
  assert.equal(f.account.status, "UNVERIFIED");
});
void test("reset grants expire and are bound to the email, account status and current password", async () => {
  for (const mutate of [
    (f: Awaited<ReturnType<typeof fixture>>) => f.advance(301),
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.account.email = "changed@example.test";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.account.status = "LOCKED";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.account.passwordHash = "changed";
    },
  ]) {
    const f = await fixture();
    await f.service.request(f.account.email);
    const grant = await f.service.verify(f.account.email, f.code);
    mutate(f);
    await assert.rejects(
      () => f.service.reset(grant.resetToken, newPassword),
      status(400),
    );
    assert.equal(f.writes, 0);
  }
});
void test("change password checks the current password and rejects reuse before any write or session revocation", async () => {
  const f = await fixture();
  const session = await f.sessions.issue(f.account.id);
  await assert.rejects(
    () => f.service.change(sessionUser, "wrong password", newPassword),
    status(400),
  );
  await assert.rejects(
    () => f.service.change(sessionUser, oldPassword, oldPassword),
    status(400),
  );
  assert.equal(f.writes, 0);
  await f.sessions.assertAccess(verifyToken(session.accessToken));
  await f.service.request(f.account.email);
  const grant = await f.service.verify(f.account.email, f.code);
  await f.service.change(sessionUser, oldPassword, newPassword);
  await assert.rejects(
    () => f.service.reset(grant.resetToken, "Another123!"),
    status(400),
  );
  await assert.rejects(
    () => f.sessions.assertAccess(verifyToken(session.accessToken)),
    status(401),
  );
  assert.equal(f.writes, 1);
});
void test("a consumed reset token cannot win twice under concurrent submissions", async () => {
  const f = await fixture();
  await f.service.request(f.account.email);
  const grant = await f.service.verify(f.account.email, f.code);
  const results = await Promise.allSettled([
    f.service.reset(grant.resetToken, newPassword),
    f.service.reset(grant.resetToken, "Different123!"),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.writes, 1);
});
void test("legacy mixed-case email can recover and password-change guesses are capped independently of email challenges", async () => {
  const f = await fixture();
  f.account.email = "Owner@Example.test";
  await f.service.request("owner@example.test");
  const grant = await f.service.verify("owner@example.test", f.code);
  await f.service.reset(grant.resetToken, newPassword);
  for (let attempt = 0; attempt < 5; attempt++)
    await assert.rejects(
      () => f.service.change(sessionUser, "wrong password", "Different123!"),
      status(400),
    );
  await assert.rejects(
    () => f.service.change(sessionUser, newPassword, "Different123!"),
    status(429),
  );
  assert.equal(f.writes, 1);
});
void test("mail failure discards only its challenge; Redis failure never falls back or changes a password", async () => {
  const f = await fixture();
  f.mailer.send = () => Promise.reject(new Error("provider secret"));
  await assert.rejects(() => f.service.request(f.account.email), status(503));
  assert.equal(f.records.size, 0);
  await assert.rejects(() => f.service.request(f.account.email), status(429));
  const offline = createRedisPasswordResetStore({
    isReady: false,
    sendCommand: () => Promise.reject(new Error("secret URL")),
  });
  const service = createPasswordService(
    offline.codes,
    offline.grants,
    f.mailer,
    f.repository,
  );
  await assert.rejects(
    () => service.change(sessionUser, oldPassword, newPassword),
    status(503),
  );
  await assert.rejects(
    () => service.reset("a".repeat(43), newPassword),
    status(503),
  );
  assert.equal(f.writes, 0);
});
void test("password endpoints require CSRF, authenticate changes, keep generic responses and clear cookies after replacement", async (context) => {
  const f = await fixture();
  const limiter = new MemoryStore();
  const http = await startHttp(
    createApp(
      createApiRateLimiter(limiter, { limit: 500, windowMs: 60000 }),
      undefined,
      {
        session: sessionService,
        signup: signupService,
        password: f.service,
        sessionAuthenticate: createSessionAuthenticate(
          () => Promise.resolve(sessionUser),
          (payload) => f.sessions.assertAccess(payload),
        ),
      },
    ),
  );
  context.mock.method(console, "error", () => undefined);
  context.after(async () => {
    await http.close();
    limiter.shutdown();
  });
  const csrf = { "Content-Type": "application/json", "X-CSRF-Protection": "1" };
  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = csrf,
  ) =>
    http.request("/api/auth/" + path, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await post(
        "forgot-password",
        { email: f.account.email },
        { "Content-Type": "application/json", "X-CSRF-Protection": "" },
      )
    ).status,
    403,
  );
  const unknown = await post("forgot-password", {
    email: "unknown@example.test",
  });
  const known = await post("forgot-password", { email: f.account.email });
  assert.equal(known.status, 200);
  assert.deepEqual(known.body, unknown.body);
  assert.equal(known.headers.get("Cache-Control"), "no-store");
  const limited = await post("forgot-password", { email: f.account.email });
  assert.equal(limited.status, 429);
  assert(Number(limited.headers.get("Retry-After")) > 0);
  assert.equal(
    limited.headers.get("Access-Control-Expose-Headers"),
    "Retry-After",
  );
  assert.equal(
    (
      await post("change-password", {
        currentPassword: oldPassword,
        newPassword,
      })
    ).status,
    401,
  );
  const valid = await post("forgot-password/verify", {
    email: f.account.email,
    code: f.code,
  });
  assert.equal(valid.status, 200);
  assert.equal(valid.headers.getSetCookie().length, 0);
  assert.equal(f.writes, 0);
  // The controller returns only the reset grant, never a login session.
  assert(valid.body && typeof valid.body === "object" && "data" in valid.body);
  const data = valid.body.data as { resetToken: string };
  assert.equal(
    (await post("reset-password", { resetToken: data.resetToken, newPassword }))
      .status,
    200,
  );
  const tokens = await f.sessions.issue(f.account.id);
  const verifiedCurrent = await post(
    "change-password/verify",
    { currentPassword: newPassword },
    { ...csrf, Authorization: "Bearer " + tokens.accessToken },
  );
  assert.equal(verifiedCurrent.status, 200);
  assert.equal(verifiedCurrent.headers.getSetCookie().length, 0);
  assert.equal(f.writes, 1);
  const changed = await post(
    "change-password",
    { currentPassword: newPassword, newPassword: "NextFood123!" },
    { ...csrf, Authorization: "Bearer " + tokens.accessToken },
  );
  assert.equal(changed.status, 200);
  assert.equal(changed.headers.getSetCookie().length, 2);
  assert(
    changed.headers
      .getSetCookie()
      .every((cookie) => cookie.includes("Expires=Thu, 01 Jan 1970")),
  );
});
void test("password reset email uses a separate purpose and idempotency key and hides provider errors", async (context) => {
  let fail = false;
  context.mock.method(globalThis, "fetch", ((_input, init) => {
    const raw = init?.body;
    assert(typeof raw === "string");
    const body: unknown = JSON.parse(raw);
    assert(
      body && typeof body === "object" && "subject" in body && "text" in body,
    );
    assert.equal(body.subject, "Mã đặt lại mật khẩu FoodPrint");
    assert(String(body.text).includes("012345"));
    assert.equal(
      new Headers(init?.headers).get("idempotency-key"),
      "password-reset/challenge",
    );
    if (fail)
      return Promise.resolve(
        new Response(
          JSON.stringify({
            name: "validation_error",
            message: "private provider details",
          }),
          { status: 422, headers: { "Content-Type": "application/json" } },
        ),
      );
    return Promise.resolve(
      new Response(JSON.stringify({ id: "mail_test" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch);
  const previousKey = process.env.RESEND_API_KEY,
    previousFrom = process.env.RESEND_FROM;
  process.env.RESEND_API_KEY = "re_unit_test_only";
  process.env.RESEND_FROM = "FoodPrint <no-reply@example.test>";
  context.after(() => {
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
    if (previousFrom === undefined) delete process.env.RESEND_FROM;
    else process.env.RESEND_FROM = previousFrom;
  });
  await passwordResetMailer.send("owner@example.test", "012345", "challenge");
  fail = true;
  await assert.rejects(
    () => passwordResetMailer.send("owner@example.test", "012345", "challenge"),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 503 &&
      !error.message.includes("private provider details"),
  );
  assert.notEqual(
    passwordFingerprint("email", "owner@example.test"),
    passwordFingerprint("ip", "owner@example.test"),
  );
});

void test("checking the current password is read-only and shares brute-force limits", async () => {
  const f = await fixture();
  const session = await f.sessions.issue(f.account.id);
  const hash = f.account.passwordHash;
  await f.service.verifyCurrent(sessionUser, oldPassword);
  await assert.rejects(
    () => f.service.verifyCurrent(sessionUser, "wrong"),
    status(400),
  );
  assert.equal(f.writes, 0);
  assert.equal(f.account.passwordHash, hash);
  await f.sessions.assertAccess(verifyToken(session.accessToken));
  for (let i = 0; i < 3; i++)
    await assert.rejects(
      () => f.service.verifyCurrent(sessionUser, "wrong"),
      status(400),
    );
  await assert.rejects(
    () => f.service.verifyCurrent(sessionUser, oldPassword),
    status(429),
  );
  await assert.rejects(
    () => f.service.change(sessionUser, oldPassword, newPassword),
    status(429),
  );
  assert.equal(f.writes, 0);
});
void test("verification is bound to the signed-in identity and final change rechecks the current hash", async () => {
  const f = await fixture();
  await assert.rejects(
    () =>
      f.service.verifyCurrent(
        { ...sessionUser, id: randomUUID() },
        oldPassword,
      ),
    status(403),
  );
  await f.service.verifyCurrent(sessionUser, oldPassword);
  f.account.passwordHash = await bcrypt.hash("ChangedElsewhere123!", 4);
  await assert.rejects(
    () => f.service.change(sessionUser, oldPassword, newPassword),
    status(400),
  );
  assert.equal(f.writes, 0);
  f.account.status = "LOCKED";
  await assert.rejects(
    () => f.service.verifyCurrent(sessionUser, "ChangedElsewhere123!"),
    status(403),
  );
});
void test("current-password verification accepts legacy passwords and refuses unknown identity fields", () => {
  assert.deepEqual(
    validateVerifyCurrentPassword({ currentPassword: " legacy password " }),
    { currentPassword: " legacy password " },
  );
  for (const body of [
    {},
    { currentPassword: "" },
    { currentPassword: "🙂".repeat(19) },
    { currentPassword: "old", userId: randomUUID() },
  ])
    assert.throws(() => validateVerifyCurrentPassword(body), status(400));
});
