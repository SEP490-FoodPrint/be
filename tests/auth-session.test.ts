import { testAdmin } from "./helpers/authorization";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import express from "express";
import bcrypt from "bcryptjs";
import { MemoryStore } from "express-rate-limit";
import { parse } from "cookie";
import { createApp } from "../src/app";
import { readAuthConfig } from "../src/config/auth";
import {
  createAuthenticate,
  createSessionAuthenticate,
} from "../src/middlewares/auth.middleware";
import { createApiRateLimiter } from "../src/middlewares/rate-limit.middleware";
import type { AuthServices } from "../src/modules/auth/auth.routes";
import { createSignupService } from "../src/modules/auth/signup.service";
import { validateSignup } from "../src/modules/auth/signup.validation";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  setAuthCookies,
} from "../src/utils/auth-cookies";
import { createRedisAuthSessionStore } from "../src/utils/auth-session-store";
import {
  createAuthSessions,
  hashRefreshToken,
} from "../src/utils/auth-sessions";
import { HttpError } from "../src/utils/http-error";
import { signToken, verifyToken } from "../src/utils/jwt";
import { memorySessions } from "./helpers/auth-sessions";
import { startHttp } from "./helpers/http";
import {
  sessionUserFromIdentity,
  requireSessionUser,
} from "../src/utils/session-identity";
import { principalFromIdentity } from "../src/utils/authorization";
import { requirePermission } from "../src/middlewares/permission.middleware";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import {
  validateProfileUpdate,
  type PersonalProfileUpdate,
} from "../src/modules/auth/profile.validation";
import type { SessionUser } from "../src/types/session-user";

process.env.NODE_ENV = "test";

const signupBody = {
  username: "school_applicant",
  email: "School@Example.test",
  password: "Food123!",
  fullName: "Nguyễn Văn A",
  requestType: "SCHOOL",
};
const errorStatus = (status: number) => (error: unknown) =>
  error instanceof HttpError && error.statusCode === status;
const csrfHeaders = {
  "Content-Type": "application/json",
  "X-CSRF-Protection": "1",
};
function cookieHeader(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}

async function authApi(context: TestContext) {
  const { store, records } = memorySessions();
  const sessions = createAuthSessions(store);
  let user: SessionUser = {
    ...testAdmin,
    email: "admin@example.test",
    phone: null,
    status: "ACTIVE",
    onboardingRequired: false,
    registrationRequest: null,
    emailVerifiedAt: null,
  };
  const profileUpdates: { id: string; data: PersonalProfileUpdate }[] = [];
  const services: AuthServices = {
    profile: {
      update(principal, data) {
        profileUpdates.push({ id: principal.id, data });
        user = { ...user, ...data };
        return Promise.resolve(user);
      },
    },
    session: {
      async login(identifier, password, previousRefreshToken) {
        if (identifier !== "admin" || password !== "correct-password")
          throw new HttpError(401, "Sai thông tin đăng nhập");
        if (previousRefreshToken) await sessions.logout(previousRefreshToken);
        return { ...(await sessions.issue(testAdmin.id)), user };
      },
      refresh: (token) => sessions.refresh(token, () => Promise.resolve(user)),
      logout: (refresh, access) => sessions.logout(refresh, access),
      currentUser: () => Promise.resolve(user),
    },
    signup: {
      signup: () =>
        Promise.resolve({
          user: {
            id: testAdmin.id,
            username: "applicant",
            fullName: "Applicant",
            status: "UNVERIFIED",
          },
          onboardingRequired: true,
          emailVerificationRequired: true,
          verificationEmailSent: true,
        }),
    },
  };
  services.sessionAuthenticate = createSessionAuthenticate(
    () => Promise.resolve(user),
    (payload) => sessions.assertAccess(payload),
  );
  const limiter = new MemoryStore();
  const authenticate = createAuthenticate(
    () => Promise.resolve(testAdmin),
    (payload) => sessions.assertAccess(payload),
  );
  const http = await startHttp(
    createApp(
      createApiRateLimiter(limiter, { windowMs: 60000, limit: 500 }),
      authenticate,
      services,
    ),
  );
  context.mock.method(console, "error", () => undefined);
  context.after(async () => {
    await http.close();
    limiter.shutdown();
  });
  return { http, sessions, records, profileUpdates };
}

void test("auth config has bounded access/refresh lifetimes and a single exact frontend origin", () => {
  assert.deepEqual(readAuthConfig({}), {
    accessTtlSeconds: 900,
    refreshTtlSeconds: 604800,
    secureCookies: false,
    clientOrigin: "http://localhost:3001",
  });
  assert.equal(readAuthConfig({ NODE_ENV: "production" }).secureCookies, true);
  for (const config of [
    { AUTH_ACCESS_TTL_SECONDS: "0" },
    { AUTH_ACCESS_TTL_SECONDS: "3601" },
    { AUTH_REFRESH_TTL_SECONDS: "2592001" },
    { AUTH_ACCESS_TTL_SECONDS: "900", AUTH_REFRESH_TTL_SECONDS: "900" },
    { CLIENT_URL: "https://example.test/path" },
    { CLIENT_URL: "https://user:password@example.test" },
  ])
    assert.throws(() => readAuthConfig(config));
});

void test("signup validates account fields and rejects role/status assignment, weak passwords and premature profile input", () => {
  const input = validateSignup(signupBody);
  assert.equal(input.email, "school@example.test");
  assert.equal(input.requestType, "SCHOOL");
  for (const body of [
    { ...signupBody, roleId: testAdmin.roleId },
    { ...signupBody, status: "ACTIVE" },
    { ...signupBody, schoolId: testAdmin.id },
    { ...signupBody, requestType: "SYSTEM" },
    { ...signupBody, requestType: "AUTHORITY" },
    { ...signupBody, username: "a@b.test" },
    { ...signupBody, email: "bad email" },
    { ...signupBody, password: "short" },
    { ...signupBody, password: "á".repeat(37) },
    { ...signupBody, profileData: {} },
    { ...signupBody, supportingDocuments: [] },
  ])
    assert.throws(() => validateSignup(body), errorStatus(400));
});

void test("signup hashes passwords before persistence and sanitizes conflicts and database failures", async () => {
  const service = createSignupService(
    async (input) => {
      assert(!("password" in input));
      assert(await bcrypt.compare(signupBody.password, input.passwordHash));
      assert.equal(bcrypt.getRounds(input.passwordHash), 12);
      return {
        user: {
          id: testAdmin.id,
          username: input.username,
          fullName: input.fullName,
          status: "UNVERIFIED",
        },
        onboardingRequired: true,
      };
    },
    { request: () => Promise.resolve(true) },
  );
  const result = await service.signup(validateSignup(signupBody));
  assert.equal(result.user.status, "UNVERIFIED");
  assert(!JSON.stringify(result).includes(signupBody.password));
  for (const [failure, expected] of [
    [Object.assign(new Error("Unique violation"), { code: "P2002" }), 409],
    [new Error("postgresql://private:secret@localhost/db"), 503],
  ] as const) {
    await assert.rejects(
      () =>
        createSignupService(() => Promise.reject(failure)).signup(
          validateSignup(signupBody),
        ),
      errorStatus(expected),
    );
  }
});

void test("session records contain only refresh hashes, rotate at a fixed absolute expiry and revoke old-token reuse", async () => {
  let now = Date.now();
  const { store, records } = memorySessions(() => now);
  const sessions = createAuthSessions(store, () => now);
  const first = await sessions.issue(testAdmin.id);
  const sid = first.refreshToken.slice(0, 32);
  const original = records.get(sid);
  assert(original);
  assert.equal(original.tokenHash, hashRefreshToken(first.refreshToken));
  assert(!JSON.stringify(original).includes(first.refreshToken));
  const claims = verifyToken(first.accessToken);
  assert.equal(claims.sub, testAdmin.id);
  assert.equal(claims.sid, sid);
  assert(!("role" in claims));
  await sessions.assertAccess(claims);
  now += 60000;
  const second = await sessions.refresh(first.refreshToken, () =>
    Promise.resolve(testAdmin),
  );
  assert.notEqual(second.refreshToken, first.refreshToken);
  assert.equal(records.get(sid)?.expiresAt, original.expiresAt);
  assert(second.refreshTtlSeconds < first.refreshTtlSeconds);
  await sessions.assertAccess(claims);
  await assert.rejects(
    () =>
      sessions.refresh(first.refreshToken, () => Promise.resolve(testAdmin)),
    errorStatus(401),
  );
  await assert.rejects(
    () => sessions.assertAccess(verifyToken(second.accessToken)),
    errorStatus(401),
  );
});

void test("concurrent refresh has one winner and reuse revokes that entire session family", async () => {
  const { store, records } = memorySessions();
  const sessions = createAuthSessions(store);
  const first = await sessions.issue(testAdmin.id);
  const results = await Promise.allSettled([
    sessions.refresh(first.refreshToken, () => Promise.resolve(testAdmin)),
    sessions.refresh(first.refreshToken, () => Promise.resolve(testAdmin)),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    1,
  );
  assert.equal(records.size, 0);
});

void test("logout affects one session, rejects legacy tokens, and expired/locked sessions cannot refresh", async () => {
  let now = Date.now();
  const { store } = memorySessions(() => now);
  const sessions = createAuthSessions(store, () => now);
  const first = await sessions.issue(testAdmin.id);
  const second = await sessions.issue(testAdmin.id);
  await sessions.logout(first.refreshToken);
  await assert.rejects(
    () => sessions.assertAccess(verifyToken(first.accessToken)),
    errorStatus(401),
  );
  await sessions.assertAccess(verifyToken(second.accessToken));
  await assert.rejects(
    () => sessions.assertAccess(verifyToken(signToken({ sub: testAdmin.id }))),
    errorStatus(401),
  );
  await assert.rejects(
    () =>
      sessions.refresh(second.refreshToken, () =>
        Promise.reject(new HttpError(403, "Locked")),
      ),
    errorStatus(403),
  );
  await assert.rejects(
    () => sessions.assertAccess(verifyToken(second.accessToken)),
    errorStatus(401),
  );
  const third = await sessions.issue(testAdmin.id);
  now += 604801000;
  await assert.rejects(
    () =>
      sessions.refresh(third.refreshToken, () => Promise.resolve(testAdmin)),
    errorStatus(401),
  );
});

void test("Redis auth storage fails closed on offline/corrupt data and refuses unrelated namespaces", async () => {
  const offline = createRedisAuthSessionStore({
    isReady: false,
    sendCommand: () => Promise.resolve(null),
  });
  await assert.rejects(
    () => createAuthSessions(offline).issue(testAdmin.id),
    errorStatus(503),
  );
  const corrupt = createRedisAuthSessionStore({
    isReady: true,
    sendCommand: () => Promise.resolve('{"tokenHash":"private"}'),
  });
  await assert.rejects(() => corrupt.get("a".repeat(32)), errorStatus(503));
  assert.throws(() =>
    createRedisAuthSessionStore(
      { isReady: false, sendCommand: () => Promise.resolve(null) },
      "foodprint:cache:",
    ),
  );
});

void test("HTTP login uses HttpOnly cookies, no body tokens, and refresh/logout enforce live sessions", async (context) => {
  const { http } = await authApi(context);
  const response = await http.request("/api/auth/login", {
    method: "POST",
    headers: csrfHeaders,
    body: JSON.stringify({ identifier: "admin", password: "correct-password" }),
  });
  assert.equal(response.status, 200);
  const set = response.headers.getSetCookie();
  assert.equal(set.length, 2);
  assert(
    set.every(
      (cookie) =>
        cookie.includes("HttpOnly") &&
        cookie.includes("SameSite=Lax") &&
        !cookie.includes("Domain="),
    ),
  );
  assert(
    set
      .find((cookie) => cookie.startsWith(ACCESS_COOKIE + "="))
      ?.includes("Path=/api;"),
  );
  assert(
    set
      .find((cookie) => cookie.startsWith(REFRESH_COOKIE + "="))
      ?.includes("Path=/api/auth;"),
  );
  assert(!JSON.stringify(response.body).includes("accessToken"));
  assert(!JSON.stringify(response.body).includes("refreshToken"));
  assert.equal(response.headers.get("cache-control"), "no-store");
  const firstCookies = cookieHeader(response.headers);
  assert.equal(
    (await http.request("/api/auth/me", { headers: { Cookie: firstCookies } }))
      .status,
    200,
  );
  const refresh = await http.request("/api/auth/refresh", {
    method: "POST",
    headers: { ...csrfHeaders, Cookie: firstCookies },
  });
  assert.equal(refresh.status, 200);
  const nextCookies = cookieHeader(refresh.headers);
  assert.notEqual(
    parse(nextCookies)[REFRESH_COOKIE],
    parse(firstCookies)[REFRESH_COOKIE],
  );
  const logout = await http.request("/api/auth/logout", {
    method: "POST",
    headers: { ...csrfHeaders, Cookie: firstCookies },
  });
  assert.equal(logout.status, 200);
  assert(
    logout.headers
      .getSetCookie()
      .every((cookie) => cookie.includes("Expires=Thu, 01 Jan 1970")),
  );
  assert.equal(
    (await http.request("/api/auth/me", { headers: { Cookie: nextCookies } }))
      .status,
    401,
  );
  assert.equal(
    (
      await http.request("/api/auth/refresh", {
        method: "POST",
        headers: { ...csrfHeaders, Cookie: nextCookies },
      })
    ).status,
    401,
  );
});

void test("HTTP rejects CSRF, untrusted origins and duplicate auth cookies; signup creates no session", async (context) => {
  const { http, records } = await authApi(context);
  for (const headers of [
    { "Content-Type": "application/json" },
    { ...csrfHeaders, Origin: "https://attacker.example" },
  ]) {
    assert.equal(
      (
        await http.request("/api/auth/login", {
          method: "POST",
          headers,
          body: JSON.stringify({
            identifier: "admin",
            password: "correct-password",
          }),
        })
      ).status,
      403,
    );
  }
  assert.equal(
    (
      await http.request("/api/auth/me", {
        headers: { Cookie: `${ACCESS_COOKIE}=one; ${ACCESS_COOKIE}=two` },
      })
    ).status,
    401,
  );
  const response = await http.request("/api/auth/signup", {
    method: "POST",
    headers: csrfHeaders,
    body: JSON.stringify(signupBody),
  });
  assert.equal(response.status, 201);
  assert.deepEqual(response.headers.getSetCookie(), []);
  assert.equal(records.size, 0);
});

void test("production cookies are Secure and refresh credentials cannot be used as access tokens", async (context) => {
  const { store } = memorySessions();
  const tokens = await createAuthSessions(store).issue(testAdmin.id);
  const app = express();
  app.get("/cookies", (_req, res) => {
    setAuthCookies(res, tokens, readAuthConfig({ NODE_ENV: "production" }));
    res.sendStatus(204);
  });
  const http = await startHttp(app);
  context.after(() => http.close());
  const response = await http.request("/cookies");
  assert(
    response.headers
      .getSetCookie()
      .every((cookie) =>
        cookie.split(";").some((part) => part.trim() === "Secure"),
      ),
  );
  assert.throws(() => verifyToken(tokens.refreshToken));
});

void test("personal profile validation normalizes partial updates and allows clearing only the optional phone", () => {
  assert.deepEqual(validateProfileUpdate({ fullName: "  Nguyễn Văn A  " }), {
    fullName: "Nguyễn Văn A",
  });
  assert.deepEqual(validateProfileUpdate({ phone: " +84 901 234 567 " }), {
    phone: "+84 901 234 567",
  });
  for (const phone of [null, "", "   "])
    assert.deepEqual(validateProfileUpdate({ phone }), { phone: null });
  assert.deepEqual(
    validateProfileUpdate({ fullName: "A", phone: "0901234567" }),
    { fullName: "A", phone: "0901234567" },
  );
});

void test("personal profile rejects empty/invalid bodies and all identity, organization, permission and credential changes", () => {
  for (const body of [
    null,
    [],
    "name",
    {},
    { fullName: null },
    { fullName: "  " },
    { fullName: 1 },
    { fullName: "A".repeat(256) },
    { phone: 123 },
    { phone: {} },
    { phone: "0".repeat(31) },
    ...[
      "id",
      "username",
      "email",
      "password",
      "passwordHash",
      "role",
      "roleId",
      "roleCode",
      "permissions",
      "status",
      "schoolId",
      "supplierId",
      "communeFoodSafetyUnitId",
      "emailVerifiedAt",
      "avatarUrl",
    ].map((key) => ({ fullName: "Valid", [key]: "not allowed" })),
  ])
    assert.throws(() => validateProfileUpdate(body), errorStatus(400));
});

void test("PATCH /auth/me requires a live cookie and CSRF, updates only self and keeps the partial-update contract", async (context) => {
  const { http, sessions, profileUpdates } = await authApi(context);
  const tokens = await sessions.issue(testAdmin.id);
  const headers = {
    ...csrfHeaders,
    Cookie: `${ACCESS_COOKIE}=${tokens.accessToken}`,
  };
  const patch = (
    body: unknown,
    requestHeaders: Record<string, string> = headers,
  ) =>
    http.request("/api/auth/me", {
      method: "PATCH",
      headers: requestHeaders,
      body: JSON.stringify(body),
    });
  assert.equal((await patch({ fullName: "A" }, csrfHeaders)).status, 401);
  assert.equal(
    (
      await patch(
        { fullName: "A" },
        { "Content-Type": "application/json", Cookie: headers.Cookie },
      )
    ).status,
    403,
  );
  assert.equal(profileUpdates.length, 0);
  const updated = await patch({
    fullName: "  New Name  ",
    phone: " 0901234567 ",
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.headers.get("cache-control"), "no-store");
  assert.deepEqual(updated.headers.getSetCookie(), []);
  const user = (updated.body as { data: SessionUser }).data;
  assert.equal(user.id, testAdmin.id);
  assert.equal(user.fullName, "New Name");
  assert.equal(user.phone, "0901234567");
  assert.equal(user.email, "admin@example.test");
  assert.deepEqual(profileUpdates, [
    { id: testAdmin.id, data: { fullName: "New Name", phone: "0901234567" } },
  ]);
  assert.equal(
    (
      await patch({
        id: "00000000-0000-4000-8000-000000000003",
        fullName: "Forbidden",
      })
    ).status,
    400,
  );
  assert.equal(profileUpdates.length, 1);
  const cleared = await patch({ phone: null });
  assert.equal(cleared.status, 200);
  const current = (
    await http.request("/api/auth/me", { headers: { Cookie: headers.Cookie } })
  ).body as { data: SessionUser };
  assert.equal(current.data.fullName, "New Name");
  assert.equal(current.data.phone, null);
  await sessions.logout(undefined, tokens.accessToken);
  assert.equal((await patch({ fullName: "Revoked" })).status, 401);
  assert.equal(profileUpdates.length, 2);
});

void test("a malformed old refresh cookie does not prevent a successful new login", async (context) => {
  const { http } = await authApi(context);
  const response = await http.request("/api/auth/login", {
    method: "POST",
    headers: { ...csrfHeaders, Cookie: `${REFRESH_COOKIE}=invalid-old-value` },
    body: JSON.stringify({ identifier: "admin", password: "correct-password" }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.getSetCookie().length, 2);
});

type SessionIdentity = NonNullable<
  Parameters<typeof sessionUserFromIdentity>[0]
>;
function unverifiedIdentity(): SessionIdentity {
  return {
    id: testAdmin.id,
    username: "new_school_admin",
    email: "new-school@example.test",
    phone: null,
    fullName: "New Applicant",
    status: "UNVERIFIED",
    emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    roleId: testAdmin.roleId,
    schoolId: null,
    supplierId: null,
    communeFoodSafetyUnitId: null,
    Role: {
      code: "SCHOOL_ADMINISTRATION",
      type: "SCHOOL",
      rolePermissions: [{ permission: { code: "menu.view", isActive: true } }],
    },
    permissionDenials: [],
    RegistrationRequestAsApplicantUser: null,
  };
}

void test("UNVERIFIED school/supplier admins receive onboarding identity without business permissions", () => {
  const unconfirmed = unverifiedIdentity();
  unconfirmed.emailVerifiedAt = null;
  assert.throws(() => sessionUserFromIdentity(unconfirmed), errorStatus(403));
  for (const role of [
    { code: "SCHOOL_ADMINISTRATION", type: "SCHOOL" },
    { code: "INGREDIENT_SUPPLIER_ADMIN", type: "SUPPLIER" },
  ] as const) {
    const identity = unverifiedIdentity();
    identity.Role = { ...identity.Role, ...role };
    const user = sessionUserFromIdentity(identity);
    assert.equal(user.status, "UNVERIFIED");
    assert.equal(user.onboardingRequired, true);
    assert.equal(user.registrationRequest, null);
    assert(!("permissions" in user));
    assert.throws(() => principalFromIdentity(identity), errorStatus(403));
  }
  const locked = unverifiedIdentity();
  locked.status = "LOCKED";
  assert.throws(() => sessionUserFromIdentity(locked), errorStatus(403));
  const wrongRole = unverifiedIdentity();
  wrongRole.Role.code = "SYSTEM_ADMIN";
  wrongRole.Role.type = "SYSTEM";
  assert.throws(() => sessionUserFromIdentity(wrongRole), errorStatus(403));
  const crossOrganization = unverifiedIdentity();
  crossOrganization.supplierId = testAdmin.id;
  assert.throws(
    () => sessionUserFromIdentity(crossOrganization),
    errorStatus(403),
  );
});

void test("onboarding cookie reaches self endpoints but business access starts only after ACTIVE with valid organization", async (context) => {
  const identity = unverifiedIdentity();
  const { store } = memorySessions();
  const sessions = createAuthSessions(store);
  const tokens = await sessions.issue(identity.id);
  const check = (payload: Parameters<typeof sessions.assertAccess>[0]) =>
    sessions.assertAccess(payload);
  const app = express();
  app.get(
    "/self",
    createSessionAuthenticate(
      () => Promise.resolve(sessionUserFromIdentity(identity)),
      check,
    ),
    (req, res) => res.json(requireSessionUser(req)),
  );
  app.get(
    "/business",
    createAuthenticate(
      () => Promise.resolve(principalFromIdentity(identity)),
      check,
    ),
    requirePermission("menu.view"),
    (_req, res) => res.sendStatus(204),
  );
  app.use(globalErrorHandler);
  context.mock.method(console, "error", () => undefined);
  const http = await startHttp(app);
  context.after(() => http.close());
  const headers = { Cookie: `${ACCESS_COOKIE}=${tokens.accessToken}` };
  assert.equal((await http.request("/self", { headers })).status, 200);
  assert.equal((await http.request("/business", { headers })).status, 403);
  identity.status = "ACTIVE";
  assert.equal(
    (await http.request("/business", { headers })).status,
    403,
    "ACTIVE without organization is still invalid",
  );
  identity.schoolId = testAdmin.roleId;
  assert.equal((await http.request("/business", { headers })).status, 204);
  const self = await http.request("/self", { headers });
  assert.equal(self.status, 200);
});
