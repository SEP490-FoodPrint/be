import assert from "node:assert/strict";
import test from "node:test";
import { MemoryStore } from "express-rate-limit";
import { createApp } from "../src/app";
import { ROLES } from "../src/constants/roles";
import type { PrismaClient } from "../src/generated/prisma/client";
import { createApiRateLimiter } from "../src/middlewares/rate-limit.middleware";
import { emailSetupRepository } from "../src/modules/auth/email-setup.repository";
import { createEmailSetupService } from "../src/modules/auth/email-setup.service";
import { validateEmailSetupVerify } from "../src/modules/auth/email-setup.validation";
import { pendingOfficer } from "../src/modules/auth/session.repository";
import { toSessionUserResponseDTO } from "../src/modules/auth/session.service";
import {
  authorityOfficerRepository,
  type AuthorityOfficerRepository,
  type AuthorityOfficerRow,
} from "../src/modules/authority-officer/authority-officer.repository";
import { createAuthorityOfficerService } from "../src/modules/authority-officer/authority-officer.service";
import {
  validateAuthorityOfficerCreate,
  validateAuthorityOfficerListQuery,
} from "../src/modules/authority-officer/authority-officer.validation";
import type { AuthPrincipal } from "../src/types/auth";
import type { SessionUser } from "../src/types/session-user";
import { createAuthSessions } from "../src/utils/auth-sessions";
import { sessionUserFromIdentity } from "../src/utils/session-identity";
import { memorySessions } from "./helpers/auth-sessions";
import { memoryEmailVerification } from "./helpers/email-verification";
import { startHttp } from "./helpers/http";

// specs/authority-officer-accounts PR B: tài khoản ATTP và email lần đầu.
const userId = "41000000-0000-4000-8000-000000000001";
const unitId = "41000000-0000-4000-8000-000000000002";
const wardId = "41000000-0000-4000-8000-000000000003";
const roleId = "41000000-0000-4000-8000-000000000004";
const ward = {
  id: wardId,
  code: "W1",
  name: "Phường 1",
  level: 2,
  isActive: true,
};
const admin: AuthPrincipal = {
  id: "41000000-0000-4000-8000-000000000010",
  username: "admin",
  fullName: "Admin",
  roleId,
  role: "SYSTEM_ADMIN",
  orgType: "SYSTEM",
  schoolId: null,
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: ["authority.manage"],
};
const body = validateAuthorityOfficerCreate({
  locationId: wardId,
  username: " ATTP.W1 ",
  password: "Officer-123!",
  fullName: "Cán bộ",
});

type Unit = { id: string; status: "ACTIVE" | "INACTIVE" };
function harness(
  options: {
    unit?: Unit | null;
    hasOfficer?: boolean;
    usernameTaken?: boolean;
    codeTaken?: boolean;
    ward?: typeof ward | null;
    actor?: AuthPrincipal;
  } = {},
) {
  const calls: string[] = [];
  const unit = options.unit ?? null;
  const row: AuthorityOfficerRow = {
    id: userId,
    username: body.username,
    fullName: body.fullName,
    email: null,
    phone: null,
    status: "UNVERIFIED",
    emailVerifiedAt: null,
    createdAt: new Date("2026-11-24T00:00:00.000Z"),
    communeFoodSafetyUnit: {
      id: unitId,
      code: "ATTP-W1",
      name: "Đơn vị ATTP Phường 1",
      status: "ACTIVE",
      location: ward,
    },
  };
  const actor = options.actor ?? admin;
  const tx = {
    user: {
      findUnique: () =>
        Promise.resolve({
          ...actor,
          status: "ACTIVE",
          Role: {
            code: actor.role,
            type: actor.orgType,
            rolePermissions: actor.permissions.map((code) => ({
              permission: { code, isActive: true },
            })),
          },
          permissionDenials: [],
        }),
    },
  };
  const client = {
    ...tx,
    $transaction: (operation: (value: unknown) => unknown) => operation(tx),
  } as unknown as PrismaClient;
  const created: unknown[] = [];
  const repository = {
    ...authorityOfficerRepository,
    lockWard: () =>
      Promise.resolve(options.ward === undefined ? ward : options.ward),
    officerRole: () =>
      Promise.resolve({
        id: roleId,
        code: ROLES.COMMUNE_FOOD_SAFETY_OFFICER,
        type: "AUTHORITY",
      }),
    usernameTaken: () => Promise.resolve(Boolean(options.usernameTaken)),
    findUnitByLocation: () => Promise.resolve(unit),
    unitHasOfficer: () => Promise.resolve(Boolean(options.hasOfficer)),
    unitCodeTaken: () => Promise.resolve(Boolean(options.codeTaken)),
    createUnit: (_tx: unknown, input: unknown) => {
      calls.push("createUnit");
      created.push(input);
      return Promise.resolve({ id: unitId, status: "ACTIVE" });
    },
    createOfficer: (_tx: unknown, input: unknown) => {
      calls.push("createOfficer");
      created.push(input);
      return Promise.resolve(row);
    },
    list: () => Promise.resolve([row, row]),
    findOne: () => Promise.resolve(null),
  } as unknown as AuthorityOfficerRepository;
  return {
    calls,
    created,
    service: createAuthorityOfficerService(
      repository,
      () => Promise.resolve(client),
      () => Promise.resolve("hash"),
    ),
  };
}

void test("tạo tài khoản ATTP: chuẩn hóa tên đăng nhập và kiểm tra dữ liệu", () => {
  assert.equal(body.username, "attp.w1");
  assert.equal(body.phone, null);
  for (const change of [
    { locationId: "x" },
    { username: "a b" },
    { password: "short" },
    { password: "alllowercase1!" },
    { fullName: " " },
    { email: "a@example.test" },
  ])
    assert.throws(() =>
      validateAuthorityOfficerCreate({
        locationId: wardId,
        username: "attp.w1",
        password: "Officer-123!",
        fullName: "Cán bộ",
        ...change,
      }),
    );
  assert.throws(() => validateAuthorityOfficerListQuery({ status: "X" }));
});

void test("tạo tài khoản ATTP: tạo đơn vị khi chưa có, dùng lại đơn vị chưa có cán bộ", async () => {
  const fresh = harness();
  const result = await fresh.service.create(body, admin);
  assert.deepEqual(fresh.calls, ["createUnit", "createOfficer"]);
  assert.deepEqual(fresh.created[0], {
    code: "ATTP-W1",
    name: "Đơn vị ATTP Phường 1",
    locationId: wardId,
  });
  assert.equal(result.emailSetupRequired, true);
  assert.deepEqual(result.location, {
    id: wardId,
    code: "W1",
    name: ward.name,
  });
  assert(!("passwordHash" in result));
  const reused = harness({ unit: { id: unitId, status: "ACTIVE" } });
  await reused.service.create(body, admin);
  assert.deepEqual(reused.calls, ["createOfficer"]);
});

void test("tạo tài khoản ATTP: từ chối trùng, đơn vị ngừng hoạt động, sai phường/xã và sai quyền", async () => {
  const active: Unit = { id: unitId, status: "ACTIVE" };
  for (const [options, statusCode] of [
    [{ unit: active, hasOfficer: true }, 409],
    [{ unit: { ...active, status: "INACTIVE" as const } }, 409],
    [{ usernameTaken: true }, 409],
    [{ codeTaken: true }, 409],
    [{ ward: null }, 400],
    [{ ward: { ...ward, level: 1 } }, 400],
    [{ ward: { ...ward, isActive: false } }, 400],
    [{ actor: { ...admin, permissions: [] } }, 403],
  ] as const) {
    const h = harness(options);
    await assert.rejects(h.service.create(body, admin), (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, statusCode);
      return true;
    });
    assert.deepEqual(h.calls, []);
  }
  const outsider = { ...admin, orgType: "SCHOOL" as const };
  const h = harness();
  await assert.rejects(h.service.create(body, outsider), { statusCode: 403 });
  await assert.rejects(h.service.getOne({ userId }, admin), {
    statusCode: 404,
  });
  const page = await h.service.list({ page: 1, limit: 1 }, admin);
  assert.equal(page.items.length, 1);
  assert.equal(page.pagination.hasNext, true);
});

function identity(email: string | null) {
  return {
    id: userId,
    username: "attp.w1",
    fullName: "Cán bộ",
    email,
    phone: null,
    status: "UNVERIFIED" as const,
    emailVerifiedAt: null,
    roleId,
    schoolId: null,
    supplierId: null,
    communeFoodSafetyUnitId: unitId,
    School: null,
    Supplier: null,
    communeFoodSafetyUnit: { name: "Đơn vị ATTP" },
    Role: {
      code: ROLES.COMMUNE_FOOD_SAFETY_OFFICER,
      type: "AUTHORITY" as const,
      rolePermissions: [],
    },
    permissionDenials: [],
    RegistrationRequestAsApplicantUser: null,
  };
}

void test("phiên của cán bộ chưa có email chỉ báo emailSetupRequired, không có quyền", () => {
  const dto = toSessionUserResponseDTO(sessionUserFromIdentity(identity(null)));
  assert.equal(dto.emailSetupRequired, true);
  assert.equal(dto.onboardingRequired, false);
  assert(!("permissions" in dto));
  assert.throws(() => sessionUserFromIdentity(identity("a@example.test")), {
    statusCode: 403,
  });
  assert.throws(
    () =>
      sessionUserFromIdentity({
        ...identity(null),
        communeFoodSafetyUnitId: null,
      }),
    { statusCode: 403 },
  );
  assert.deepEqual(pendingOfficer("attp.w1"), {
    username: "attp.w1",
    email: null,
    roleCode: ROLES.COMMUNE_FOOD_SAFETY_OFFICER,
  });
});

function setupFixture(taken = false) {
  let now = Date.now();
  const { store } = memoryEmailVerification(() => now);
  const { store: sessionStore, records } = memorySessions(() => now);
  const sessions = createAuthSessions(sessionStore, () => now);
  const sent: string[] = [];
  let current: Parameters<typeof sessionUserFromIdentity>[0] = identity(null);
  const tx = { user: { findUnique: () => Promise.resolve(current) } };
  const client = {
    ...tx,
    $transaction: (operation: (value: unknown) => unknown) => operation(tx),
  } as unknown as PrismaClient;
  const service = createEmailSetupService(
    store,
    {
      assertConfigured() {},
      send(_email, code) {
        sent.push(code);
        return Promise.resolve();
      },
    },
    {
      ...emailSetupRepository,
      emailTaken: () => Promise.resolve(taken),
      lockPendingOfficer: () =>
        Promise.resolve(current?.email === null ? { id: userId } : null),
      activate: (_tx, id, email) => {
        current = {
          ...identity(email),
          status: "ACTIVE",
          emailVerifiedAt: new Date(now),
        };
        return Promise.resolve({ id });
      },
    },
    sessions,
    () => Promise.resolve(client),
    () => now,
  );
  return {
    service,
    sessions,
    sent,
    records,
    user: sessionUserFromIdentity(identity(null)),
    advance: (seconds: number) => {
      now += seconds * 1000;
    },
  };
}

void test("cập nhật email: mã gắn với email, dùng một lần, kích hoạt và thay phiên cũ", async () => {
  const f = setupFixture();
  const old = await f.sessions.issue(userId);
  const email = "attp@example.test";
  await f.service.request(f.user, { email }, "127.0.0.1");
  await assert.rejects(f.service.request(f.user, { email }, "127.0.0.1"), {
    statusCode: 429,
  });
  const code = f.sent[0] ?? "";
  await assert.rejects(
    f.service.verify(f.user, { email: "other@example.test", code }),
    { statusCode: 400 },
  );
  const result = await f.service.verify(f.user, { email, code });
  assert.equal(result.user.status, "ACTIVE");
  assert.equal(result.user.email, email);
  assert.equal(result.user.emailSetupRequired, false);
  await assert.rejects(
    f.sessions.refresh(old.refreshToken, () => Promise.resolve(null)),
    { statusCode: 401 },
  );
  await assert.rejects(f.service.verify(f.user, { email, code }), {
    statusCode: 400,
  });
});

void test("cập nhật email: hết hạn, email đã dùng và tài khoản đã có email bị từ chối", async () => {
  const email = "attp@example.test";
  const expired = setupFixture();
  await expired.service.request(expired.user, { email });
  expired.advance(601);
  await assert.rejects(
    expired.service.verify(expired.user, {
      email,
      code: expired.sent[0] ?? "",
    }),
    { statusCode: 400 },
  );
  const taken = setupFixture(true);
  await assert.rejects(taken.service.request(taken.user, { email }), {
    statusCode: 409,
  });
  assert.equal(taken.sent.length, 0);
  const active: SessionUser = {
    ...admin,
    email,
    phone: null,
    status: "ACTIVE",
    onboardingRequired: false,
    registrationRequest: null,
    emailVerifiedAt: null,
  };
  await assert.rejects(taken.service.request(active, { email }), {
    statusCode: 409,
  });
  assert.throws(() => validateEmailSetupVerify({ email, code: "12345" }));
});

void test("HTTP: /api/authority-officers chặn quyền trước khi truy cập DB", async (context) => {
  let actor: AuthPrincipal = { ...admin, permissions: [] };
  const app = createApp(
    createApiRateLimiter(new MemoryStore()),
    (req, _res, next) => {
      req.auth = actor;
      next();
    },
  );
  const http = await startHttp(app);
  context.after(() => http.close());
  const send = (method: string, path = "") =>
    http.request("/api/authority-officers" + path, {
      method,
      headers: { "X-CSRF-Protection": "1", "Content-Type": "application/json" },
      ...(method === "POST" ? { body: "{}" } : {}),
    });
  assert.equal((await send("POST")).status, 403);
  assert.equal((await send("GET")).status, 403);
  assert.equal((await send("GET", "/" + userId)).status, 403);
  actor = admin;
  assert.equal((await send("POST")).status, 400);
  assert.equal((await send("GET", "/x")).status, 400);
});
