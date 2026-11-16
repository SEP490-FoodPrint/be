import {
  createSessionService,
  toSessionUserResponseDTO,
} from "../src/modules/auth/session.service";
import type { PrismaClient } from "../src/generated/prisma/client";
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
import { validateProfileUpdate } from "../src/modules/auth/profile.validation";
import type { SessionUser } from "../src/types/session-user";
import { ROLES } from "../src/constants/roles";
import { validateLogin } from "../src/modules/auth/session.validation";

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

async function authApi(context: TestContext, withRegistration = false) {
  const { store, records } = memorySessions();
  const sessions = createAuthSessions(store);
  let user: SessionUser = {
    ...testAdmin,
    email: "admin@example.test",
    phone: null,
    status: "ACTIVE",
    onboardingRequired: false,
    registrationRequest: withRegistration
      ? {
          id: "00000000-0000-4000-8000-000000000101",
          registrationNumber: 1n,
          status: "PENDING",
          submittedAt: new Date("2026-11-01T00:00:00.000Z"),
          rejectionReason: null,
        }
      : null,
    emailVerifiedAt: null,
  };
  const profileUpdates: {
    id: string;
    data: ReturnType<typeof validateProfileUpdate>;
  }[] = [];
  const services: AuthServices = {
    profile: {
      update(principal, data) {
        profileUpdates.push({ id: principal.id, data });
        user = { ...user, ...data };
        return Promise.resolve(toSessionUserResponseDTO(user));
      },
    },
    session: {
      async login({ identifier, password }, previousRefreshToken) {
        if (
          identifier !== "admin@example.test" ||
          password !== "correct-password"
        )
          throw new HttpError(401, "Sai thông tin đăng nhập");
        if (previousRefreshToken) await sessions.logout(previousRefreshToken);
        return {
          ...(await sessions.issue(testAdmin.id)),
          user: toSessionUserResponseDTO(user),
        };
      },
      refresh: (token) =>
        sessions.refresh(token, () =>
          Promise.resolve(toSessionUserResponseDTO(user)),
        ),
      getProfile: toSessionUserResponseDTO,
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
    body: JSON.stringify({
      identifier: "admin@example.test",
      password: "correct-password",
    }),
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
            identifier: "admin@example.test",
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
    body: JSON.stringify({
      identifier: "admin@example.test",
      password: "correct-password",
    }),
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

type LoginAccount = { identity: SessionIdentity; passwordHash: string };
type LoginQuery = {
  where: {
    id?: string;
    email?: string;
    OR?: { username?: string; email?: string }[];
  };
  select: Record<string, unknown>;
  take?: number;
};

function emailLoginFixture(accounts: LoginAccount[], beforeLock?: () => void) {
  const { store, records } = memorySessions();
  const lookups: LoginQuery[] = [];
  const lockedReads: LoginQuery[] = [];
  let locks = 0;
  let legacyLookups = 0;
  const matchesEmail = (account: LoginAccount, email: string) =>
    account.identity.email.toLowerCase() === email.toLowerCase();
  const project = (account: LoginAccount | undefined, query: LoginQuery) => {
    if (!account) return null;
    if (query.select.passwordHash)
      return {
        ...(query.select.id ? { id: account.identity.id } : {}),
        passwordHash: account.passwordHash,
      };
    return account.identity;
  };
  const client = {
    user: {
      findUnique(query: LoginQuery) {
        if (query.where.email !== undefined) lookups.push(query);
        const account = accounts.find((entry) =>
          query.where.email !== undefined
            ? matchesEmail(entry, query.where.email)
            : entry.identity.id === query.where.id,
        );
        return Promise.resolve(project(account, query));
      },
      findFirst(query: LoginQuery) {
        lockedReads.push(query);
        const account = accounts.find(
          (entry) =>
            entry.identity.id === query.where.id &&
            query.where.email !== undefined &&
            matchesEmail(entry, query.where.email),
        );
        return Promise.resolve(project(account, query));
      },
      // Model the previous query faithfully so policy regressions fail on
      // authentication behavior, rather than on an absent mock operation.
      findMany(query: LoginQuery) {
        legacyLookups++;
        const candidates = accounts.filter((account) =>
          query.where.OR?.some(
            (clause) =>
              (clause.username !== undefined &&
                clause.username === account.identity.username) ||
              (clause.email !== undefined &&
                matchesEmail(account, clause.email)),
          ),
        );
        return Promise.resolve(
          candidates.slice(0, query.take).map((entry) => project(entry, query)),
        );
      },
    },
    $queryRaw() {
      if (locks++ === 0) beforeLock?.();
      return Promise.resolve([]);
    },
    $transaction(operation: (tx: unknown) => unknown) {
      return operation(client);
    },
  } as unknown as PrismaClient;
  return {
    service: createSessionService(
      () => Promise.resolve(client),
      createAuthSessions(store),
    ),
    records,
    lookups,
    lockedReads,
    legacyLookups: () => legacyLookups,
  };
}

function activeLoginAccount(
  role: (typeof ROLES)[keyof typeof ROLES],
  passwordHash: string,
  number = 1,
): LoginAccount {
  const identity = unverifiedIdentity();
  identity.id = `00000000-0000-4000-8000-${String(1000 + number).padStart(12, "0")}`;
  identity.username = `login_user_${number}`;
  identity.email = `login-${number}@example.test`;
  identity.status = "ACTIVE";
  identity.emailVerifiedAt = null;
  const kind =
    role === ROLES.SYSTEM_ADMIN
      ? "SYSTEM"
      : role.startsWith("INGREDIENT_SUPPLIER_")
        ? "SUPPLIER"
        : role === ROLES.COMMUNE_FOOD_SAFETY_OFFICER
          ? "AUTHORITY"
          : "SCHOOL";
  identity.Role = { ...identity.Role, code: role, type: kind };
  identity.schoolId = kind === "SCHOOL" ? testAdmin.roleId : null;
  identity.supplierId = kind === "SUPPLIER" ? testAdmin.roleId : null;
  identity.communeFoodSafetyUnitId =
    kind === "AUTHORITY" ? testAdmin.roleId : null;
  return { identity, passwordHash };
}

void test("email-only login normalizes identifiers and preserves the legacy password validation contract", () => {
  assert.deepEqual(
    validateLogin({ identifier: "  OWNER@Example.test  ", password: " a " }),
    { identifier: "owner@example.test", password: " a " },
  );
  assert.equal(
    validateLogin({ identifier: "not-an-email", password: "x" }).identifier,
    "not-an-email",
  );
  assert.equal(
    validateLogin({ identifier: "staff", password: "é".repeat(36) }).password,
    "é".repeat(36),
  );
  for (const body of [
    {},
    { identifier: "", password: "x" },
    { identifier: "  ", password: "x" },
    { identifier: "x".repeat(321), password: "x" },
    { identifier: 1, password: "x" },
    { identifier: "a@example.test" },
    { identifier: "a@example.test", password: "" },
    { identifier: "a@example.test", password: "é".repeat(37) },
    { identifier: "a@example.test", password: 1 },
    { identifier: "a@example.test", password: "x", email: "a@example.test" },
    { identifier: "a@example.test", password: "x", username: "staff" },
    { identifier: "a@example.test", password: "x", supplierId: testAdmin.id },
    { identifier: "a@example.test", password: "x", role: "SYSTEM_ADMIN" },
    { identifier: "a@example.test", password: "x", orgType: "SYSTEM" },
  ])
    assert.throws(() => validateLogin(body), errorStatus(400));
});

void test("email-only login authenticates every role by normalized email and never by unmatched username", async (context) => {
  const password = " Legacy password! ";
  const passwordHash = await bcrypt.hash(password, 4);
  for (const [index, role] of Object.values(ROLES).entries()) {
    await context.test(role, async () => {
      const account = activeLoginAccount(role, passwordHash, index + 1);
      const fixture = emailLoginFixture([account]);
      const result = await fixture.service.login(
        validateLogin({
          identifier: ` ${account.identity.email.toUpperCase()} `,
          password,
        }),
      );
      assert.equal(result.user.id, account.identity.id);
      assert.equal(result.user.role, role);
      assert.equal(result.user.status, "ACTIVE");
      assert.equal(result.user.onboardingRequired, false);
      assert.equal(result.user.emailVerifiedAt, null);
      assert.equal(verifyToken(result.accessToken).sub, account.identity.id);
      await assert.rejects(
        () =>
          fixture.service.login(
            validateLogin({ identifier: account.identity.username, password }),
          ),
        errorStatus(401),
        "A correct password must not allow username authentication",
      );
      assert.equal(fixture.lookups.length, 2);
      assert.deepEqual(fixture.lookups[0].where, {
        email: account.identity.email,
      });
      assert.deepEqual(fixture.lookups[0].select, {
        id: true,
        passwordHash: true,
      });
      assert.deepEqual(fixture.lockedReads[0].where, {
        id: account.identity.id,
        email: account.identity.email,
      });
      assert.equal(fixture.legacyLookups(), 0);
      assert.equal(fixture.records.size, 1);
    });
  }
});

void test("email-only login uses one dummy comparison for unknown email or username and the same failure for a wrong password", async (context) => {
  const passwordHash = await bcrypt.hash("correct-password", 4);
  const account = activeLoginAccount(ROLES.SCHOOL_ADMINISTRATION, passwordHash);
  const fixture = emailLoginFixture([account]);
  const comparisons = context.mock.method(bcrypt, "compare");
  for (const identifier of [
    "unknown@example.test",
    account.identity.username,
    account.identity.email,
  ]) {
    await assert.rejects(
      () =>
        fixture.service.login(validateLogin({ identifier, password: "wrong" })),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 401 &&
        error.message === "Email hoặc mật khẩu không đúng",
    );
  }
  assert.equal(comparisons.mock.callCount(), 3);
  const hashes = comparisons.mock.calls.map((call) => call.arguments[1]);
  assert.equal(hashes[0], hashes[1]);
  assert.notEqual(hashes[0], passwordHash);
  assert.equal(hashes[2], passwordHash);
  assert.equal(fixture.records.size, 0);
  assert.equal(fixture.lockedReads.length, 0);
});

void test("email-only login resolves email and username cross-field collisions exclusively to the email owner", async () => {
  const passwordA = "Owner-A123!";
  const passwordB = "Owner-B456!";
  const ownerA = activeLoginAccount(
    ROLES.INGREDIENT_SUPPLIER_STAFF,
    await bcrypt.hash(passwordA, 4),
    1,
  );
  const ownerB = activeLoginAccount(
    ROLES.SCHOOL_KITCHEN_STAFF,
    await bcrypt.hash(passwordB, 4),
    2,
  );
  ownerB.identity.username = ownerA.identity.email;
  ownerA.identity.username = ownerB.identity.email;
  const fixture = emailLoginFixture([ownerA, ownerB]);
  const first = await fixture.service.login(
    validateLogin({
      identifier: ownerB.identity.username,
      password: passwordA,
    }),
  );
  assert.equal(first.user.id, ownerA.identity.id);
  const second = await fixture.service.login(
    validateLogin({
      identifier: ownerA.identity.username,
      password: passwordB,
    }),
  );
  assert.equal(second.user.id, ownerB.identity.id);
  for (const [identifier, password] of [
    [ownerA.identity.email, passwordB],
    [ownerB.identity.email, passwordA],
  ])
    await assert.rejects(
      () => fixture.service.login(validateLogin({ identifier, password })),
      errorStatus(401),
    );
  assert.equal(fixture.records.size, 2);
  assert.equal(fixture.legacyLookups(), 0);
});

void test("email-only login rejects credentials changed between lookup and the User lock before issuing a session", async (context) => {
  const password = "Owner-A123!";
  const passwordHash = await bcrypt.hash(password, 4);
  const replacement = await bcrypt.hash("New-password-456!", 4);
  for (const change of ["email", "passwordHash"] as const) {
    await context.test(change, async () => {
      const account = activeLoginAccount(
        ROLES.SCHOOL_ADMINISTRATION,
        passwordHash,
      );
      const originalEmail = account.identity.email;
      const fixture = emailLoginFixture([account], () => {
        if (change === "email") account.identity.email = "changed@example.test";
        else account.passwordHash = replacement;
      });
      await assert.rejects(
        () =>
          fixture.service.login(
            validateLogin({ identifier: originalEmail, password }),
          ),
        errorStatus(401),
      );
      assert.equal(fixture.records.size, 0);
    });
  }
});

void test("email-only login loads current role, membership and permissions after the User lock", async () => {
  const password = "Owner-A123!";
  const account = activeLoginAccount(
    ROLES.SCHOOL_ADMINISTRATION,
    await bcrypt.hash(password, 4),
  );
  const currentSupplierId = "00000000-0000-4000-8000-000000004321";
  const fixture = emailLoginFixture([account], () => {
    account.identity.Role.code = ROLES.INGREDIENT_SUPPLIER_STAFF;
    account.identity.Role.type = "SUPPLIER";
    account.identity.Role.rolePermissions = [
      { permission: { code: "delivery.manage", isActive: true } },
      { permission: { code: "dashboard.view", isActive: true } },
    ];
    account.identity.schoolId = null;
    account.identity.supplierId = currentSupplierId;
    account.identity.permissionDenials = [
      {
        supplierId: currentSupplierId,
        schoolId: null,
        communeFoodSafetyUnitId: null,
        permission: { code: "delivery.manage" },
      },
    ];
  });
  const result = await fixture.service.login(
    validateLogin({ identifier: account.identity.email, password }),
  );
  assert.equal(result.user.role, ROLES.INGREDIENT_SUPPLIER_STAFF);
  assert.equal(result.user.orgType, "SUPPLIER");
  assert.equal(result.user.schoolId, null);
  assert.equal(result.user.supplierId, currentSupplierId);
  assert.equal(result.user.status, "ACTIVE");
  if (result.user.status === "ACTIVE")
    assert.deepEqual(result.user.permissions, ["dashboard.view"]);
});

void test("email-only login preserves status and verified-admin onboarding checks when identity changes under the lock", async (context) => {
  const password = "Owner-A123!";
  const passwordHash = await bcrypt.hash(password, 4);
  for (const status of ["LOCKED", "INACTIVE", "DEACTIVATED"] as const) {
    await context.test(status, async () => {
      const account = activeLoginAccount(
        ROLES.INGREDIENT_SUPPLIER_STAFF,
        passwordHash,
      );
      const fixture = emailLoginFixture([account], () => {
        account.identity.status = status;
      });
      await assert.rejects(
        () =>
          fixture.service.login(
            validateLogin({ identifier: account.identity.email, password }),
          ),
        errorStatus(403),
      );
      assert.equal(fixture.records.size, 0);
    });
  }
  for (const role of [
    ROLES.SCHOOL_ADMINISTRATION,
    ROLES.INGREDIENT_SUPPLIER_ADMIN,
  ]) {
    await context.test(`verified onboarding ${role}`, async () => {
      const account = activeLoginAccount(role, passwordHash);
      const fixture = emailLoginFixture([account], () => {
        account.identity.status = "UNVERIFIED";
        account.identity.schoolId = null;
        account.identity.supplierId = null;
        account.identity.emailVerifiedAt = new Date("2026-01-01T00:00:00Z");
      });
      const result = await fixture.service.login(
        validateLogin({ identifier: account.identity.email, password }),
      );
      assert.equal(result.user.status, "UNVERIFIED");
      assert.equal(result.user.onboardingRequired, true);
      assert(!("permissions" in result.user));
    });
  }
  for (const state of [
    "unverified-admin",
    "unverified-staff",
    "invalid-membership",
  ] as const) {
    await context.test(state, async () => {
      const account = activeLoginAccount(
        ROLES.INGREDIENT_SUPPLIER_STAFF,
        passwordHash,
      );
      const fixture = emailLoginFixture([account], () => {
        if (state === "invalid-membership") {
          account.identity.schoolId = testAdmin.id;
        } else {
          account.identity.status = "UNVERIFIED";
          if (state === "unverified-admin") {
            account.identity.Role.code = ROLES.INGREDIENT_SUPPLIER_ADMIN;
            account.identity.supplierId = null;
          } else {
            account.identity.emailVerifiedAt = new Date("2026-01-01T00:00:00Z");
          }
        }
      });
      await assert.rejects(
        () =>
          fixture.service.login(
            validateLogin({ identifier: account.identity.email, password }),
          ),
        errorStatus(403),
      );
      assert.equal(fixture.records.size, 0);
    });
  }
});

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

void test("existing sessions recheck account status for school, supplier and commune officer", async (context) => {
  const { store } = memorySessions();
  const sessions = createAuthSessions(store);
  const identity = unverifiedIdentity();
  identity.status = "ACTIVE";
  const check = (payload: Parameters<typeof sessions.assertAccess>[0]) =>
    sessions.assertAccess(payload);
  const app = express();
  app.get(
    "/self",
    createSessionAuthenticate(
      () => Promise.resolve(sessionUserFromIdentity(identity)),
      check,
    ),
    (_req, res) => res.sendStatus(204),
  );
  app.get(
    "/business",
    createAuthenticate(
      () => Promise.resolve(principalFromIdentity(identity)),
      check,
    ),
    (_req, res) => res.sendStatus(204),
  );
  app.use(globalErrorHandler);
  context.mock.method(console, "error", () => undefined);
  const http = await startHttp(app);
  context.after(() => http.close());
  for (const kind of ["SCHOOL", "SUPPLIER", "AUTHORITY"] as const) {
    identity.status = "ACTIVE";
    identity.schoolId = kind === "SCHOOL" ? testAdmin.roleId : null;
    identity.supplierId = kind === "SUPPLIER" ? testAdmin.roleId : null;
    identity.communeFoodSafetyUnitId =
      kind === "AUTHORITY" ? testAdmin.roleId : null;
    identity.Role.type = kind;
    identity.Role.code =
      kind === "SCHOOL"
        ? "SCHOOL_ADMINISTRATION"
        : kind === "SUPPLIER"
          ? "INGREDIENT_SUPPLIER_ADMIN"
          : "COMMUNE_FOOD_SAFETY_OFFICER";
    const tokens = await sessions.issue(identity.id);
    const headers = { Cookie: `${ACCESS_COOKIE}=${tokens.accessToken}` };
    assert.equal((await http.request("/self", { headers })).status, 204);
    assert.equal((await http.request("/business", { headers })).status, 204);
    identity.status = "DEACTIVATED";
    assert.equal((await http.request("/self", { headers })).status, 403);
    assert.equal((await http.request("/business", { headers })).status, 403);
    await assert.rejects(
      () =>
        sessions.refresh(tokens.refreshToken, () =>
          Promise.resolve(sessionUserFromIdentity(identity)),
        ),
      errorStatus(403),
    );
  }
});

void test("login, refresh and current user recheck live account status", async () => {
  const identity = unverifiedIdentity();
  identity.status = "ACTIVE";
  identity.schoolId = testAdmin.roleId;
  const passwordHash = await bcrypt.hash("correct-password", 4);
  const { service } = emailLoginFixture([{ identity, passwordHash }]);
  const login = await service.login({
    identifier: identity.email,
    password: "correct-password",
  });
  assert.equal(login.user.status, "ACTIVE");
  Object.assign(identity, {
    School: { intakeState: "PAUSED" },
  });
  const pausedLogin = await service.login({
    identifier: identity.email,
    password: "correct-password",
  });
  assert.equal(pausedLogin.user.status, "ACTIVE");
  assert.equal(
    (await service.refresh(pausedLogin.refreshToken)).user.status,
    "ACTIVE",
  );
  assert.equal((await service.currentUser(identity.id)).status, "ACTIVE");
  identity.status = "DEACTIVATED";
  await assert.rejects(
    () =>
      service.login({
        identifier: identity.email,
        password: "correct-password",
      }),
    errorStatus(403),
  );
  await assert.rejects(
    () => service.refresh(login.refreshToken),
    errorStatus(403),
  );
  await assert.rejects(
    () => service.currentUser(identity.id),
    errorStatus(403),
  );
});

void test("session responses expose the same registration code without bigint across login, refresh and profile edits", async (context) => {
  const { http } = await authApi(context, true);
  const login = await http.request("/api/auth/login", {
    method: "POST",
    headers: csrfHeaders,
    body: JSON.stringify({
      identifier: "admin@example.test",
      password: "correct-password",
    }),
  });
  assert.equal(login.status, 200);
  let cookies = cookieHeader(login.headers);
  const summary = (body: unknown, nestedUser: boolean) => {
    assert(body && typeof body === "object" && "data" in body);
    let data = body.data as Record<string, unknown>;
    if (nestedUser) data = data.user as Record<string, unknown>;
    assert.deepEqual(data.registrationRequest, {
      id: "00000000-0000-4000-8000-000000000101",
      registrationID: "FP-REG-00001",
      status: "PENDING",
      submittedAt: "2026-11-01T00:00:00.000Z",
      rejectionReason: null,
    });
    assert(!JSON.stringify(body).includes("registrationNumber"));
  };
  summary(login.body, true);
  const me = await http.request("/api/auth/me", {
    headers: { Cookie: cookies },
  });
  assert.equal(me.status, 200);
  summary(me.body, false);
  const updated = await http.request("/api/auth/me", {
    method: "PATCH",
    headers: { ...csrfHeaders, Cookie: cookies },
    body: JSON.stringify({ phone: "0901234567" }),
  });
  assert.equal(updated.status, 200);
  summary(updated.body, false);
  const refresh = await http.request("/api/auth/refresh", {
    method: "POST",
    headers: { ...csrfHeaders, Cookie: cookies },
  });
  assert.equal(refresh.status, 200);
  cookies = cookieHeader(refresh.headers);
  summary(refresh.body, true);
  const after = await http.request("/api/auth/me", {
    headers: { Cookie: cookies },
  });
  summary(after.body, false);
});
