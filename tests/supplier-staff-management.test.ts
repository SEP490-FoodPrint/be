import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import express from "express";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import type { AuthPrincipal } from "../src/types/auth";
import { testAdmin } from "./helpers/authorization";
import { startHttp } from "./helpers/http";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import { HttpError } from "../src/utils/http-error";
import {
  createSupplierStaffRepository,
  supplierStaffWriteError,
  type StaffRow,
} from "../src/modules/supplier-staff/supplier-staff.repository";
import {
  createSupplierStaffService,
  type SupplierStaffService,
} from "../src/modules/supplier-staff/supplier-staff.service";
import { createSupplierStaffRouter } from "../src/modules/supplier-staff/supplier-staff.routes";
import {
  validateSupplierStaffQuery,
  validateSupplierStaffCreate,
  validateSupplierStaffStatus,
} from "../src/modules/supplier-staff/supplier-staff.validation";
import { RequestValidationError } from "../src/utils/request-validation";

const supplierId = "22222222-2222-4222-8222-222222222222";
const otherSupplierId = "33333333-3333-4333-8333-333333333333";
export const staffManagementPrincipal: AuthPrincipal = {
  ...testAdmin,
  role: "INGREDIENT_SUPPLIER_ADMIN",
  orgType: "SUPPLIER",
  supplierId,
  permissions: ["supplier_staff.manage"],
};
const principal = staffManagementPrincipal;
const errorStatus = (status: number) => (error: unknown) =>
  error instanceof HttpError && error.statusCode === status;
const statusValues = [
  "ACTIVE",
  "LOCKED",
  "UNVERIFIED",
  "INACTIVE",
  "DEACTIVATED",
] as const;
const listFields = [
  "id",
  "username",
  "fullName",
  "email",
  "phone",
  "roleCode",
  "roleName",
  "status",
].sort();
function staffRow(index: number, overrides: Partial<StaffRow> = {}): StaffRow {
  return {
    id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
    supplierId,
    username: `staff_${index}`,
    email: `staff-${index}@example.test`,
    fullName: `Nhân viên ${index}`,
    phone: null,
    roleId: "44444444-4444-4444-8444-444444444444",
    roleCode: "INGREDIENT_SUPPLIER_STAFF",
    status: "ACTIVE",
    createdAt: new Date("2026-11-17T01:00:00Z"),
    updatedAt: new Date("2026-11-17T01:00:00Z"),
    Role: {
      code: "INGREDIENT_SUPPLIER_STAFF",
      name: "Nhân viên nhà cung cấp",
      type: "SUPPLIER",
    },
    ...overrides,
  };
}
function listFixture(rows: StaffRow[] = [], failure?: Error) {
  const calls: {
    scope: { supplierId: string };
    query: { page: number; limit: number };
  }[] = [];
  const repo = {
    ...createSupplierStaffRepository(),
    list(
      scope: { supplierId: string },
      query: { page: number; limit: number },
    ) {
      calls.push({ scope, query });
      if (failure) return Promise.reject(failure);
      const offset = (query.page - 1) * query.limit;
      return Promise.resolve(rows.slice(offset, offset + query.limit + 1));
    },
  };
  return { service: createSupplierStaffService(repo), calls };
}
function detailFixture(row: StaffRow | null, failure?: Error) {
  const calls: { scope: { supplierId: string }; id: string }[] = [];
  const repo = {
    ...createSupplierStaffRepository(),
    find(scope: { supplierId: string }, id: string) {
      calls.push({ scope, id });
      if (failure) return Promise.reject(failure);
      return Promise.resolve(row);
    },
  };
  return { service: createSupplierStaffService(repo), calls };
}
const createBody = {
  username: "New.Staff-1",
  fullName: "Nhân viên mới",
  email: "new-staff@example.test",
  password: " Aa1!abcd ",
};
interface StaffCreateData {
  username: string;
  fullName: string;
  email: string;
  phone: string | null;
  passwordHash: string;
  roleId: string;
}
interface PermissionRecord {
  id: string;
  code: string;
  name: string;
  module: string;
  action: string;
  description: string | null;
  isActive: boolean;
}
function permissionRecord(
  index: number,
  overrides: Partial<PermissionRecord> = {},
): PermissionRecord {
  return {
    id: `55555555-5555-4555-8555-${String(index).padStart(12, "0")}`,
    code: `permission.${index}`,
    name: `Quyền ${index}`,
    module: "delivery",
    action: "view",
    description: null,
    isActive: true,
    ...overrides,
  };
}
function createFixture(initialRows: StaffRow[] = []) {
  const rows: StaffRow[] = structuredClone(initialRows);
  const calls: string[] = [];
  const isolationLevels: string[] = [];
  let permissions: PermissionRecord[] = [];
  const denials: {
    userId: string;
    supplierId: string;
    permissionId: string;
    disabledByUserId: string;
  }[] = [];
  const duplicateChecks: {
    scope: { supplierId: string };
    username: string;
    email: string;
  }[] = [];
  let actor = principal;
  let role: {
    id: string;
    code: string;
    type: StaffRow["Role"]["type"];
  } | null = {
    id: staffRow(1).roleId,
    code: "INGREDIENT_SUPPLIER_STAFF",
    type: "SUPPLIER",
  };
  let duplicate = false;
  let accountLock = false;
  let afterLock: (() => void) | undefined;
  let afterCreateFailure: Error | undefined;
  let afterStatusFailure: Error | undefined;
  let afterPermissionFailure: Error | undefined;
  let actorFailure: HttpError | undefined;
  let activeTx: Prisma.TransactionClient | undefined;
  let transactions = 0;
  let hashedPassword: string | undefined;
  let written: StaffCreateData | undefined;
  const assertTx = (tx: Prisma.TransactionClient) => {
    assert(
      activeTx,
      "Repository writes must run within the service transaction",
    );
    assert.equal(
      tx,
      activeTx,
      "All authorization and write operations share one transaction",
    );
  };
  const repo = {
    ...createSupplierStaffRepository(),
    actor(_id: string, tx: Prisma.TransactionClient) {
      assertTx(tx);
      calls.push("actor");
      if (actorFailure) return Promise.reject(actorFailure);
      return Promise.resolve(actor);
    },
    find(
      scope: { supplierId: string },
      id: string,
      tx?: Prisma.TransactionClient,
    ) {
      if (tx) assertTx(tx);
      calls.push("find");
      const row = rows.find(
        (entry) =>
          entry.id === id &&
          entry.supplierId === scope.supplierId &&
          entry.roleCode === "INGREDIENT_SUPPLIER_STAFF" &&
          entry.Role.code === "INGREDIENT_SUPPLIER_STAFF" &&
          entry.Role.type === "SUPPLIER",
      );
      return Promise.resolve(row ? structuredClone(row) : null);
    },
    staffRole(tx: Prisma.TransactionClient) {
      assertTx(tx);
      calls.push("role");
      return Promise.resolve(role);
    },
    lock(
      _scope: { supplierId: string },
      _actor: { id: string; roleId: string },
      _target: { id: string; roleId: string } | null,
      _staffRoleId: string | undefined,
      tx: Prisma.TransactionClient,
    ) {
      assertTx(tx);
      calls.push("lock");
      afterLock?.();
      return Promise.resolve();
    },
    hasAccountLock(
      _scope: { supplierId: string },
      tx: Prisma.TransactionClient,
    ) {
      assertTx(tx);
      return Promise.resolve(accountLock);
    },
    duplicateExists(
      scope: { supplierId: string },
      username: string,
      email: string,
      tx: Prisma.TransactionClient,
    ) {
      assertTx(tx);
      calls.push("duplicate");
      duplicateChecks.push({ scope, username, email });
      return Promise.resolve(duplicate);
    },
    createStaff(
      scope: { supplierId: string },
      input: StaffCreateData,
      tx: Prisma.TransactionClient,
    ) {
      assertTx(tx);
      calls.push("create");
      written = input;
      const row = staffRow(rows.length + 1, {
        ...input,
        supplierId: scope.supplierId,
      });
      rows.push(row);
      if (afterCreateFailure) return Promise.reject(afterCreateFailure);
      return Promise.resolve(row);
    },
    setStatus(
      scope: { supplierId: string },
      id: string,
      previousStatus: StaffRow["status"],
      nextStatus: "ACTIVE" | "LOCKED",
      tx: Prisma.TransactionClient,
    ) {
      assertTx(tx);
      calls.push("status");
      const index = rows.findIndex(
        (row) =>
          row.id === id &&
          row.supplierId === scope.supplierId &&
          row.roleCode === "INGREDIENT_SUPPLIER_STAFF" &&
          row.status === previousStatus,
      );
      if (index < 0) return Promise.resolve(null);
      rows[index] = {
        ...rows[index],
        status: nextStatus,
        updatedAt: new Date("2026-11-17T20:00:00Z"),
      };
      if (afterStatusFailure) return Promise.reject(afterStatusFailure);
      return Promise.resolve(structuredClone(rows[index]));
    },
    permissionState(
      scope: { supplierId: string },
      userId: string,
      _roleId: string,
      tx: Prisma.TransactionClient,
    ) {
      assertTx(tx);
      calls.push("permissions");
      return Promise.resolve({
        grants: permissions
          .slice()
          .sort((a, b) => a.code.localeCompare(b.code))
          .map((permission) => ({ permission: structuredClone(permission) })),
        denials: denials
          .filter(
            (row) =>
              row.userId === userId && row.supplierId === scope.supplierId,
          )
          .map(({ permissionId }) => ({ permissionId })),
      });
    },
    findActiveRoleGrant(
      scope: { supplierId: string },
      userId: string,
      roleId: string,
      permissionId: string,
      tx: Prisma.TransactionClient,
    ) {
      assertTx(tx);
      calls.push("grant");
      const target = rows.find(
        (row) =>
          row.id === userId &&
          row.supplierId === scope.supplierId &&
          row.roleId === roleId,
      );
      const permission = permissions.find(
        (row) => row.id === permissionId && row.isActive,
      );
      return Promise.resolve(target && permission ? { permissionId } : null);
    },
    disablePermission(
      scope: { supplierId: string },
      userId: string,
      permissionId: string,
      actorId: string,
      tx: Prisma.TransactionClient,
    ) {
      assertTx(tx);
      calls.push("disable");
      if (
        denials.some(
          (row) =>
            row.userId === userId &&
            row.permissionId === permissionId &&
            row.supplierId === scope.supplierId,
        )
      )
        return Promise.resolve({ count: 0 });
      denials.push({
        userId,
        permissionId,
        supplierId: scope.supplierId,
        disabledByUserId: actorId,
      });
      if (afterPermissionFailure) return Promise.reject(afterPermissionFailure);
      return Promise.resolve({ count: 1 });
    },
    enablePermission(
      scope: { supplierId: string },
      userId: string,
      permissionId: string,
      tx: Prisma.TransactionClient,
    ) {
      assertTx(tx);
      calls.push("enable");
      const index = denials.findIndex(
        (row) =>
          row.userId === userId &&
          row.permissionId === permissionId &&
          row.supplierId === scope.supplierId,
      );
      if (index < 0) return Promise.resolve({ count: 0 });
      denials.splice(index, 1);
      if (afterPermissionFailure) return Promise.reject(afterPermissionFailure);
      return Promise.resolve({ count: 1 });
    },
  };
  const client = {
    async $transaction(
      operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options: { isolationLevel: string },
    ) {
      assert.equal(activeTx, undefined, "No nested transactions");
      assert(
        ["Serializable", "RepeatableRead"].includes(options.isolationLevel),
      );
      isolationLevels.push(options.isolationLevel);
      const snapshot = structuredClone(rows);
      const denialSnapshot = structuredClone(denials);
      transactions++;
      activeTx = {} as Prisma.TransactionClient;
      try {
        return await operation(activeTx);
      } catch (error) {
        rows.splice(0, rows.length, ...snapshot);
        denials.splice(0, denials.length, ...denialSnapshot);
        throw error;
      } finally {
        activeTx = undefined;
      }
    },
  } as unknown as PrismaClient;
  const service = createSupplierStaffService(
    repo,
    () => Promise.resolve(client),
    (password) => {
      assert.equal(
        activeTx,
        undefined,
        "Password hashing must precede the transaction",
      );
      calls.push("hash");
      hashedPassword = password;
      return Promise.resolve("unit-password-hash");
    },
  );
  return {
    service,
    rows,
    calls,
    isolationLevels,
    denials,
    duplicateChecks,
    hashedPassword: () => hashedPassword,
    written: () => written,
    transactions: () => transactions,
    setDuplicate(value: boolean) {
      duplicate = value;
    },
    setAccountLock(value: boolean) {
      accountLock = value;
    },
    setActor(value: AuthPrincipal) {
      actor = value;
    },
    setRole(value: typeof role) {
      role = value;
    },
    afterLock(operation: () => void) {
      afterLock = operation;
    },
    failAfterCreate(error: Error) {
      afterCreateFailure = error;
    },
    failAfterStatus(error: Error) {
      afterStatusFailure = error;
    },
    failActor(error: HttpError) {
      actorFailure = error;
    },
    setPermissions(value: PermissionRecord[]) {
      permissions = value;
    },
    failAfterPermission(error: Error) {
      afterPermissionFailure = error;
    },
  };
}
async function listApi(
  context: TestContext,
  service: SupplierStaffService,
  actor = principal,
) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/supplier-staff",
    createSupplierStaffRouter(service, (req, _res, next) => {
      req.auth = actor;
      next();
    }),
  );
  app.use(globalErrorHandler);
  const http = await startHttp(app);
  context.after(() => http.close());
  return http;
}

void test("US1 validation defaults pagination, bounds limit and offset, and rejects unsupported queries", () => {
  assert.deepEqual(validateSupplierStaffQuery({}), { page: 1, limit: 20 });
  assert.deepEqual(validateSupplierStaffQuery({ page: "2", limit: "100" }), {
    page: 2,
    limit: 100,
  });
  assert.deepEqual(
    validateSupplierStaffQuery({ page: "2147483648", limit: "1" }),
    { page: 2147483648, limit: 1 },
  );
  for (const query of [
    { page: "0" },
    { page: "-1" },
    { page: "1.5" },
    { page: " 1" },
    { page: ["1", "2"] },
    { page: 1 },
    { limit: "0" },
    { limit: "101" },
    { page: "2147483649", limit: "1" },
    { page: "9007199254740992" },
    { search: "staff" },
    { status: "ACTIVE" },
    { role: "INGREDIENT_SUPPLIER_ADMIN" },
    { supplierId: otherSupplierId },
  ])
    assert.throws(() => validateSupplierStaffQuery(query), errorStatus(400));
});

void test("US1 repository confines rows to trusted supplier staff and applies stable pagination without counting", async () => {
  const calls: Prisma.UserFindManyArgs[] = [];
  const client = {
    user: {
      findMany(query: Prisma.UserFindManyArgs) {
        calls.push(query);
        return Promise.resolve([]);
      },
      count() {
        assert.fail("List must not count or load the full user table");
      },
    },
  } as unknown as PrismaClient;
  const repo = createSupplierStaffRepository(() => Promise.resolve(client));
  await repo.list({ supplierId }, { page: 3, limit: 20 });
  await repo.list({ supplierId: otherSupplierId }, { page: 1, limit: 100 });
  assert.equal(calls.length, 2);
  const expectedScope = {
    supplierId,
    schoolId: null,
    communeFoodSafetyUnitId: null,
    roleCode: "INGREDIENT_SUPPLIER_STAFF",
    Role: { code: "INGREDIENT_SUPPLIER_STAFF", type: "SUPPLIER" },
  };
  assert.deepEqual(calls[0].where, expectedScope);
  assert.deepEqual(calls[1].where, {
    ...expectedScope,
    supplierId: otherSupplierId,
  });
  assert.equal(calls[0].skip, 40);
  assert.equal(calls[0].take, 21);
  assert.equal(calls[1].skip, 0);
  assert.equal(calls[1].take, 101);
  assert.deepEqual(calls[0].orderBy, [{ createdAt: "desc" }, { id: "asc" }]);
  const projection = JSON.stringify(calls[0].select);
  for (const secret of ["passwordHash", "permissionDenials", "lastLoginAt"])
    assert(!projection.includes(secret));
  for (const field of [
    "id",
    "username",
    "email",
    "fullName",
    "phone",
    "status",
  ])
    assert.equal(calls[0].select?.[field as keyof Prisma.UserSelect], true);
});

void test("US1 list returns only the requested page, all staff statuses and explicit safe projections", async () => {
  const rows = Array.from({ length: 21 }, (_, index) => ({
    ...staffRow(index + 1, {
      status: statusValues[index % statusValues.length],
    }),
    passwordHash: "private-password-hash",
    privateValue: "private-persistence-field",
    permissionDenials: [{ permissionId: "private-permission" }],
  }));
  const fixture = listFixture(rows);
  const result = await fixture.service.getAll(
    validateSupplierStaffQuery({}),
    principal,
  );
  assert.deepEqual(fixture.calls, [
    { scope: { supplierId }, query: { page: 1, limit: 20 } },
  ]);
  assert.equal(result.items.length, 20);
  assert.deepEqual(result.pagination, { page: 1, limit: 20, hasNext: true });
  assert.deepEqual(
    [...new Set(result.items.map((item) => item.status))].sort(),
    [...statusValues].sort(),
  );
  assert.equal(result.items[0].id, rows[0].id);
  assert.equal(result.items[0].phone, null);
  assert.equal(result.items[0].roleName, rows[0].Role.name);
  for (const item of result.items)
    assert.deepEqual(Object.keys(item).sort(), listFields);
  assert(!JSON.stringify(result).includes("private-"));
  assert(!("total" in result.pagination));
  const second = await fixture.service.getAll(
    { page: 2, limit: 20 },
    principal,
  );
  assert.deepEqual(
    second.items.map((item) => item.id),
    [rows[20].id],
  );
  assert.deepEqual(second.pagination, { page: 2, limit: 20, hasNext: false });
});

void test("US1 list handles exactly-full, empty, out-of-range pages and maximum page size", async () => {
  for (const [count, page, limit, expectedCount, hasNext] of [
    [0, 1, 20, 0, false],
    [20, 1, 20, 20, false],
    [20, 2, 20, 0, false],
    [101, 1, 100, 100, true],
    [101, 2, 100, 1, false],
  ] as const) {
    const fixture = listFixture(
      Array.from({ length: count }, (_, i) => staffRow(i + 1)),
    );
    const result = await fixture.service.getAll({ page, limit }, principal);
    assert.equal(result.items.length, expectedCount);
    assert.deepEqual(result.pagination, { page, limit, hasNext });
  }
});

void test("US1 list forbids missing permission, SYSTEM and staff before calling the repository", async () => {
  const fixture = listFixture([staffRow(1)]);
  for (const actor of [
    { ...principal, permissions: [] },
    { ...testAdmin, permissions: ["supplier_staff.manage"] },
    { ...principal, role: "INGREDIENT_SUPPLIER_STAFF" },
    { ...principal, supplierId: null },
    { ...principal, schoolId: testAdmin.id },
  ])
    await assert.rejects(
      () => fixture.service.getAll({ page: 1, limit: 20 }, actor),
      errorStatus(403),
    );
  assert.equal(fixture.calls.length, 0);
});

void test("US1 list sanitizes database read failures as 503", async (context) => {
  context.mock.method(console, "error", () => undefined);
  const fixture = listFixture(
    [],
    new Error("postgresql://private:secret@db.invalid/member"),
  );
  await assert.rejects(
    () => fixture.service.getAll({ page: 1, limit: 20 }, principal),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 503 &&
      !error.message.includes("private") &&
      !error.message.includes("secret"),
  );
});

void test("US1 HTTP list keeps the response envelope, defaults and error contract", async (context) => {
  const fixture = listFixture([staffRow(1)]);
  const http = await listApi(context, fixture.service);
  const response = await http.request("/api/supplier-staff");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    success: true,
    statusCode: 200,
    message: "Lấy danh sách nhân viên thành công",
    data: {
      items: [
        {
          id: staffRow(1).id,
          username: "staff_1",
          fullName: "Nhân viên 1",
          email: "staff-1@example.test",
          phone: null,
          roleCode: "INGREDIENT_SUPPLIER_STAFF",
          roleName: "Nhân viên nhà cung cấp",
          status: "ACTIVE",
        },
      ],
      pagination: { page: 1, limit: 20, hasNext: false },
    },
  });
  for (const query of [
    "?limit=101",
    "?page=2147483649&limit=1",
    "?supplierId=" + otherSupplierId,
    "?search=staff",
    "?page=1&page=2",
  ])
    assert.equal(
      (await http.request("/api/supplier-staff" + query)).status,
      400,
    );
  assert.equal(
    fixture.calls.length,
    1,
    "Invalid queries must not reach data access",
  );
});

void test("US1 HTTP list enforces actor authorization and does not leak database failures", async (context) => {
  const fixture = listFixture([staffRow(1)]);
  const forbidden = await listApi(context, fixture.service, {
    ...principal,
    permissions: [],
  });
  const response = await forbidden.request("/api/supplier-staff");
  assert.equal(response.status, 403);
  assert.equal(fixture.calls.length, 0);
  context.mock.method(console, "error", () => undefined);
  const offline = await listApi(
    context,
    listFixture([], new Error("secret database connection")).service,
  );
  const unavailable = await offline.request("/api/supplier-staff");
  assert.equal(unavailable.status, 503);
  assert(!JSON.stringify(unavailable.body).includes("secret"));
});

void test("US2 repository detail includes supplier and staff ownership predicates before reading a User", async () => {
  const queries: Prisma.UserFindFirstArgs[] = [];
  const client = {
    user: {
      findFirst(query: Prisma.UserFindFirstArgs) {
        queries.push(query);
        return Promise.resolve(null);
      },
    },
  } as unknown as PrismaClient;
  const repo = createSupplierStaffRepository(() => Promise.resolve(client));
  const id = staffRow(1).id;
  assert.equal(await repo.find({ supplierId }, id), null);
  assert.deepEqual(queries[0].where, {
    id,
    supplierId,
    schoolId: null,
    communeFoodSafetyUnitId: null,
    roleCode: "INGREDIENT_SUPPLIER_STAFF",
    Role: { code: "INGREDIENT_SUPPLIER_STAFF", type: "SUPPLIER" },
  });
  const projection = JSON.stringify(queries[0].select);
  assert(!projection.includes("password"));
  assert(!projection.includes("permissionDenials"));
});

void test("US2 detail is readable for every account status and serializes only approved fields", async () => {
  for (const status of statusValues) {
    const row = {
      ...staffRow(1, {
        status,
        phone: null,
        createdAt: new Date("2026-11-16T09:10:11.123Z"),
        updatedAt: new Date("2026-11-17T12:13:14.567Z"),
      }),
      passwordHash: "private-password-hash",
      emailVerifiedAt: new Date(),
      privateRelation: { token: "private-token" },
    };
    const fixture = detailFixture(row);
    const result = await fixture.service.getDetail(
      { userId: row.id },
      principal,
    );
    assert.deepEqual(fixture.calls, [{ scope: { supplierId }, id: row.id }]);
    assert.deepEqual(
      Object.keys(result).sort(),
      [...listFields, "supplierId", "createdAt", "updatedAt"].sort(),
    );
    assert.equal(result.status, status);
    assert.equal(result.id, row.id);
    assert.equal(result.supplierId, supplierId);
    assert.equal(result.phone, null);
    assert.equal(result.roleCode, "INGREDIENT_SUPPLIER_STAFF");
    assert.equal(result.createdAt, "2026-11-16T09:10:11.123Z");
    assert.equal(result.updatedAt, "2026-11-17T12:13:14.567Z");
    assert(!JSON.stringify(result).includes("private-"));
  }
});

void test("US2 detail gives the same 404 for unknown, foreign-supplier and administrator targets", async () => {
  const fixture = detailFixture(null);
  const errors: string[] = [];
  for (const userId of [staffRow(100).id, staffRow(200).id, principal.id]) {
    await assert.rejects(
      () => fixture.service.getDetail({ userId }, principal),
      (error: unknown) => {
        if (!(error instanceof HttpError)) return false;
        errors.push(error.message);
        return (
          error.statusCode === 404 &&
          error.message === "Không tìm thấy tài khoản nhân viên"
        );
      },
    );
  }
  assert.equal(new Set(errors).size, 1);
  assert(fixture.calls.every((call) => call.scope.supplierId === supplierId));
});

void test("US2 detail rejects unauthorized actors before target lookup and sanitizes infrastructure errors", async (context) => {
  const fixture = detailFixture(staffRow(1));
  for (const actor of [
    { ...principal, permissions: [] },
    { ...testAdmin, permissions: ["supplier_staff.manage"] },
    { ...principal, role: "INGREDIENT_SUPPLIER_STAFF" },
  ])
    await assert.rejects(
      () => fixture.service.getDetail({ userId: staffRow(1).id }, actor),
      errorStatus(403),
    );
  assert.equal(fixture.calls.length, 0);
  context.mock.method(console, "error", () => undefined);
  const offline = detailFixture(null, new Error("private SQL password"));
  await assert.rejects(
    () => offline.service.getDetail({ userId: staffRow(1).id }, principal),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 503 &&
      !error.message.includes("private"),
  );
});

void test("US2 HTTP detail validates UUID and empty query, normalizes IDs and preserves envelopes", async (context) => {
  const row = staffRow(1, {
    id: "ABCDEFAB-ABCD-4ABC-8ABC-ABCDEFABCDEF".toLowerCase(),
  });
  const fixture = detailFixture(row);
  const http = await listApi(context, fixture.service);
  const response = await http.request(
    "/api/supplier-staff/" + row.id.toUpperCase(),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(fixture.calls[0], { scope: { supplierId }, id: row.id });
  assert.deepEqual(response.body, {
    success: true,
    statusCode: 200,
    message: "Lấy thông tin nhân viên thành công",
    data: {
      id: row.id,
      username: row.username,
      fullName: row.fullName,
      email: row.email,
      phone: null,
      roleCode: "INGREDIENT_SUPPLIER_STAFF",
      roleName: row.Role.name,
      status: "ACTIVE",
      supplierId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
  });
  assert.equal(
    (await http.request("/api/supplier-staff/not-a-uuid")).status,
    400,
  );
  assert.equal(
    (
      await http.request(
        "/api/supplier-staff/" + row.id + "?supplierId=" + otherSupplierId,
      )
    ).status,
    400,
  );
  assert.equal(
    (await http.request("/api/supplier-staff/" + row.id + "?page=1")).status,
    400,
  );
  assert.equal(fixture.calls.length, 1);
  const absent = await listApi(context, detailFixture(null).service);
  const missing = await absent.request(
    "/api/supplier-staff/" + staffRow(99).id,
  );
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, {
    success: false,
    statusCode: 404,
    message: "Không tìm thấy tài khoản nhân viên",
  });
});

void test("US3 create validation normalizes account fields, retains password whitespace and accepts Unicode policy boundaries", () => {
  const normalized = validateSupplierStaffCreate({
    ...createBody,
    username: "  New.Staff-1 ",
    fullName: " Nhân viên mới ",
    email: " NEW-STAFF@Example.test ",
  });
  assert.deepEqual(normalized, { ...createBody, phone: null });
  assert.equal(normalized.password, createBody.password);
  assert.equal(normalized.username, "New.Staff-1");
  assert.equal(
    validateSupplierStaffCreate({ ...createBody, phone: null }).phone,
    null,
  );
  assert.equal(
    validateSupplierStaffCreate({ ...createBody, phone: " 01234 " }).phone,
    "01234",
  );
  for (const password of [
    "Aa1!abcd",
    "Aa1!" + "😀".repeat(4),
    "Aa1!" + "é".repeat(34),
  ])
    assert.equal(
      validateSupplierStaffCreate({ ...createBody, password }).password,
      password,
    );
  for (const extra of [
    { password: "Aa1!ab😀" },
    { password: "Aa1!" + "é".repeat(34) + "x" },
    { password: "lowercase123!" },
    { password: "UPPERCASE123!" },
    { password: "NoDigitsHere!" },
    { password: "NoSymbols123" },
    { phone: " " },
    { phone: "1".repeat(31) },
    { username: "ab" },
    { username: "staff@example.test" },
    { username: "x".repeat(121) },
    { fullName: " " },
    { fullName: "x".repeat(256) },
    { email: "bad-email" },
    { supplierId: otherSupplierId },
    { roleCode: "SYSTEM_ADMIN" },
    { roleId: testAdmin.roleId },
    { status: "LOCKED" },
  ])
    assert.throws(
      () => validateSupplierStaffCreate({ ...createBody, ...extra }),
      errorStatus(400),
    );
});

void test("US3 create collects Vietnamese field issues together without echoing invalid input values", () => {
  assert.throws(
    () =>
      validateSupplierStaffCreate({
        username: "?private",
        fullName: " ",
        email: "private-invalid",
        password: "x",
        phone: "",
        supplierId: otherSupplierId,
      }),
    (error: unknown) => {
      assert(error instanceof RequestValidationError);
      const fields = new Set(error.fields.map((issue) => issue.field));
      for (const field of [
        "username",
        "fullName",
        "email",
        "password",
        "phone",
        "supplierId",
      ])
        assert(fields.has(field));
      assert(
        error.fields.filter((issue) => issue.field === "password").length >= 4,
      );
      assert(!JSON.stringify(error.fields).includes("private"));
      assert(
        error.fields.every((issue) => /[^\u0020-\u007e]/.test(issue.message)),
      );
      return error.statusCode === 400;
    },
  );
});

void test("US3 create uses a trusted supplier and staff role, hashes before a single transaction, and returns a safe detail", async () => {
  const fixture = createFixture();
  const input = validateSupplierStaffCreate(createBody);
  const result = await fixture.service.create(input, principal);
  assert.equal(fixture.hashedPassword(), createBody.password);
  assert.equal(fixture.calls[0], "hash");
  assert.equal(fixture.transactions(), 1);
  assert.deepEqual(fixture.duplicateChecks, [
    {
      scope: { supplierId },
      username: createBody.username,
      email: createBody.email,
    },
  ]);
  assert.deepEqual(fixture.written(), {
    username: createBody.username,
    fullName: createBody.fullName,
    email: createBody.email,
    phone: null,
    passwordHash: "unit-password-hash",
    roleId: staffRow(1).roleId,
  });
  assert.equal(result.supplierId, supplierId);
  assert.equal(result.roleCode, "INGREDIENT_SUPPLIER_STAFF");
  assert.equal(result.status, "ACTIVE");
  assert.equal(result.phone, null);
  assert.equal(result.createdAt, fixture.rows[0].createdAt.toISOString());
  assert.deepEqual(
    Object.keys(result).sort(),
    [...listFields, "supplierId", "createdAt", "updatedAt"].sort(),
  );
  assert(!JSON.stringify(result).includes("unit-password-hash"));
  assert(!JSON.stringify(result).includes(createBody.password));
  assert(fixture.calls.indexOf("duplicate") > fixture.calls.indexOf("lock"));
  assert(fixture.calls.filter((call) => call === "actor").length >= 2);
});

void test("US3 duplicate lookup checks email globally and username only within the trusted supplier, including administrators and inactive users", async () => {
  const queries: Prisma.UserFindFirstArgs[] = [];
  const tx = {
    user: {
      findFirst(query: Prisma.UserFindFirstArgs) {
        queries.push(query);
        return Promise.resolve({ id: principal.id });
      },
    },
  } as unknown as Prisma.TransactionClient;
  const repo = createSupplierStaffRepository();
  assert.equal(
    await repo.duplicateExists(
      { supplierId },
      createBody.username,
      createBody.email,
      tx,
    ),
    true,
  );
  const branches = queries[0].where?.OR;
  assert(Array.isArray(branches));
  assert(
    branches.some(
      (where) =>
        JSON.stringify(where) === JSON.stringify({ email: createBody.email }),
    ),
  );
  assert(
    branches.some((where) => {
      assert(!("status" in where));
      assert(!("roleCode" in where));
      return (
        where.username === createBody.username &&
        where.supplierId === supplierId
      );
    }),
  );
  assert.equal(branches.length, 2);
  assert(!("supplierId" in queries[0].where!));
});

void test("PR6b: supplier under ACCOUNT_LOCKED restriction cannot create or reactivate staff", async () => {
  const locked = staffRow(1, { status: "LOCKED" });
  const fixture = createFixture([locked]);
  fixture.setAccountLock(true);
  await assert.rejects(
    () =>
      fixture.service.create(
        validateSupplierStaffCreate(createBody),
        principal,
      ),
    (error: unknown) => error instanceof HttpError && error.statusCode === 409,
  );
  await assert.rejects(
    () =>
      fixture.service.changeStatus(
        { userId: locked.id },
        { status: "ACTIVE" },
        principal,
      ),
    (error: unknown) => error instanceof HttpError && error.statusCode === 409,
  );
  assert.equal(fixture.rows.length, 1);
  assert.equal(fixture.rows[0].status, "LOCKED");
});

void test("US3 create rejects duplicate prechecks with a generic 409 and writes no account", async () => {
  const fixture = createFixture();
  fixture.setDuplicate(true);
  await assert.rejects(
    () =>
      fixture.service.create(
        validateSupplierStaffCreate(createBody),
        principal,
      ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 409 &&
      error.message === "Tên đăng nhập hoặc email đã được sử dụng",
  );
  assert.equal(fixture.rows.length, 0);
  assert(!fixture.calls.includes("create"));
});

void test("US3 repository create persists fixed membership and status without creating registration, grants or denial records", async () => {
  const creates: Prisma.UserCreateArgs[] = [];
  const tx = {
    user: {
      create(query: Prisma.UserCreateArgs) {
        creates.push(query);
        return Promise.resolve(staffRow(1));
      },
    },
  } as unknown as Prisma.TransactionClient;
  const repo = createSupplierStaffRepository();
  await repo.createStaff(
    { supplierId },
    {
      ...validateSupplierStaffCreate(createBody),
      passwordHash: "unit-hash",
      roleId: staffRow(1).roleId,
    },
    tx,
  );
  assert.equal(creates.length, 1);
  const data = creates[0].data;
  assert.equal(data.supplierId, supplierId);
  assert.equal(data.schoolId, null);
  assert.equal(data.communeFoodSafetyUnitId, null);
  assert.equal(data.roleId, staffRow(1).roleId);
  assert.equal(data.roleCode, "INGREDIENT_SUPPLIER_STAFF");
  assert.equal(data.status, "ACTIVE");
  assert.equal(data.emailVerifiedAt, null);
  assert.equal(data.passwordHash, "unit-hash");
  for (const field of [
    "password",
    "RegistrationRequestAsApplicantUser",
    "permissionDenials",
    "rolePermissions",
    "School",
    "Supplier",
  ])
    assert(!(field in data), field);
});

void test("US3 repository maps proven username or email unique races to a sanitized 409 before the database wrapper", async () => {
  const conflicts = [
    { code: "P2002", meta: { target: ["supplier_id", "username"] } },
    { code: "P2002", meta: { target: ["supplierId", "username"] } },
    { code: "P2002", meta: { target: ["email"] } },
    { code: "P2002", meta: { target: "uq_users_supplier_username" } },
    { code: "23505", constraint: "users_email_key" },
    {
      code: "P2010",
      meta: {
        driverAdapterError: {
          cause: {
            originalCode: "23505",
            constraint: { name: "uq_users_supplier_username" },
          },
        },
      },
    },
  ];
  for (const conflict of conflicts) {
    assert.throws(
      () => supplierStaffWriteError(conflict),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 409 &&
        error.message === "Tên đăng nhập hoặc email đã được sử dụng",
    );
    const tx = {
      user: {
        create: () =>
          Promise.reject(
            Object.assign(new Error("Unique constraint fixture"), conflict),
          ),
      },
    } as unknown as Prisma.TransactionClient;
    await assert.rejects(
      () =>
        createSupplierStaffRepository().createStaff(
          { supplierId },
          {
            ...validateSupplierStaffCreate(createBody),
            passwordHash: "unit-hash",
            roleId: staffRow(1).roleId,
          },
          tx,
        ),
      errorStatus(409),
    );
  }
  for (const error of [
    { code: "P2002", meta: { target: ["id"] } },
    { code: "P2002", meta: { target: "uq_users_non_staff_username" } },
    { code: "P2002" },
    new Error("private database details"),
  ])
    assert.throws(
      () => supplierStaffWriteError(error),
      (caught: unknown) => caught === error,
    );
});

void test("US3 create rechecks actor permission, role and membership after locks without switching to a new scope", async () => {
  for (const actor of [
    { ...principal, permissions: [] },
    { ...principal, role: "INGREDIENT_SUPPLIER_STAFF" },
    { ...principal, roleId: staffRow(1).roleId },
    { ...principal, supplierId: otherSupplierId },
  ]) {
    const fixture = createFixture();
    fixture.afterLock(() => fixture.setActor(actor));
    await assert.rejects(
      () =>
        fixture.service.create(
          validateSupplierStaffCreate(createBody),
          principal,
        ),
      errorStatus(403),
    );
    assert.equal(fixture.rows.length, 0);
    assert(!fixture.calls.includes("create"));
  }
});

void test("US3 create rejects missing or invalid staff role configuration and rolls back a failed write", async (context) => {
  context.mock.method(console, "error", () => undefined);
  for (const role of [
    null,
    {
      id: staffRow(1).roleId,
      code: "SCHOOL_KITCHEN_STAFF",
      type: "SCHOOL" as const,
    },
    {
      id: staffRow(1).roleId,
      code: "INGREDIENT_SUPPLIER_ADMIN",
      type: "SUPPLIER" as const,
    },
  ]) {
    const fixture = createFixture();
    fixture.setRole(role);
    await assert.rejects(
      () =>
        fixture.service.create(
          validateSupplierStaffCreate(createBody),
          principal,
        ),
      errorStatus(503),
    );
    assert.equal(fixture.rows.length, 0);
  }
  const changedRole = createFixture();
  changedRole.afterLock(() =>
    changedRole.setRole({
      id: principal.id,
      code: "INGREDIENT_SUPPLIER_STAFF",
      type: "SUPPLIER",
    }),
  );
  await assert.rejects(
    () =>
      changedRole.service.create(
        validateSupplierStaffCreate(createBody),
        principal,
      ),
    errorStatus(503),
  );
  assert.equal(changedRole.rows.length, 0);
  const failed = createFixture();
  failed.failAfterCreate(new Error("private transaction failure"));
  await assert.rejects(
    () =>
      failed.service.create(validateSupplierStaffCreate(createBody), principal),
    errorStatus(503),
  );
  assert(failed.calls.includes("create"));
  assert.equal(
    failed.rows.length,
    0,
    "Failure must roll back the account mutation",
  );
});

void test("US3 HTTP create returns 201 without credentials and rejects strict field and permission violations", async (context) => {
  const fixture = createFixture();
  const http = await listApi(context, fixture.service);
  const response = await http.request("/api/supplier-staff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(createBody),
  });
  assert.equal(response.status, 201);
  const body = response.body as {
    success: boolean;
    statusCode: number;
    message: string;
    data: { id: string; roleCode: string; supplierId: string };
  };
  assert.equal(body.success, true);
  assert.equal(body.statusCode, 201);
  assert.equal(body.message, "Tạo tài khoản nhân viên thành công");
  assert.equal(body.data.roleCode, "INGREDIENT_SUPPLIER_STAFF");
  assert.equal(body.data.supplierId, supplierId);
  assert.equal(response.headers.getSetCookie().length, 0);
  for (const key of ["password", "passwordHash", "token"])
    assert(!JSON.stringify(body).includes('"' + key + '"'));
  const rejected = await http.request("/api/supplier-staff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...createBody,
      supplierId: otherSupplierId,
      roleCode: "SYSTEM_ADMIN",
      status: "LOCKED",
    }),
  });
  assert.equal(rejected.status, 400);
  assert.equal(fixture.rows.length, 1);
  const forbiddenFixture = createFixture();
  const forbidden = await listApi(context, forbiddenFixture.service, {
    ...principal,
    permissions: [],
  });
  assert.equal(
    (
      await forbidden.request("/api/supplier-staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createBody),
      })
    ).status,
    403,
  );
  assert.equal(forbiddenFixture.calls.length, 0);
});

void test("US3 create rejects unauthorized scope before hashing or starting a transaction", async () => {
  for (const actor of [
    { ...principal, permissions: [] },
    { ...testAdmin, permissions: ["supplier_staff.manage"] },
    { ...principal, role: "INGREDIENT_SUPPLIER_STAFF" },
  ]) {
    const fixture = createFixture();
    await assert.rejects(
      () =>
        fixture.service.create(validateSupplierStaffCreate(createBody), actor),
      errorStatus(403),
    );
    assert.equal(fixture.transactions(), 0);
    assert.equal(fixture.calls.length, 0);
  }
});

void test("US3 create bounds serialization retries, rolls back every failed attempt and keeps database errors private", async (context) => {
  context.mock.method(console, "error", () => undefined);
  const fixture = createFixture();
  fixture.failAfterCreate(
    Object.assign(new Error("private serialization conflict"), {
      code: "P2034",
    }),
  );
  await assert.rejects(
    () =>
      fixture.service.create(
        validateSupplierStaffCreate(createBody),
        principal,
      ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 503 &&
      !error.message.includes("private"),
  );
  assert.equal(fixture.transactions(), 3);
  assert.equal(fixture.rows.length, 0);
  assert.equal(fixture.calls.filter((call) => call === "hash").length, 1);
});

void test("US4 status validation accepts only explicit ACTIVE or LOCKED and rejects unknown fields", () => {
  for (const status of ["ACTIVE", "LOCKED"])
    assert.deepEqual(validateSupplierStaffStatus({ status }), { status });
  for (const body of [
    {},
    null,
    { status: "active" },
    { status: "INACTIVE" },
    { status: "DEACTIVATED" },
    { status: "UNVERIFIED" },
    { status: true },
    { status: "LOCKED", supplierId },
    { status: "ACTIVE", roleCode: "SYSTEM_ADMIN" },
  ])
    assert.throws(() => validateSupplierStaffStatus(body), errorStatus(400));
});

void test("US4 status changes ACTIVE and LOCKED atomically while preserving all account, denial and work data", async () => {
  const target = {
    ...staffRow(1),
    passwordHash: "private-password-hash",
    permissionDenials: [
      { id: "denial-1", permissionId: "delivery.manage", supplierId },
    ],
    orders: [{ id: "order-1", status: "IN_PROGRESS" }],
    history: [{ event: "created" }],
  };
  const other = staffRow(2, {
    supplierId: otherSupplierId,
    username: target.username,
  });
  const fixture = createFixture([target, other]);
  const original = structuredClone(fixture.rows);
  const locked = await fixture.service.changeStatus(
    { userId: target.id },
    { status: "LOCKED" },
    principal,
  );
  assert.equal(locked.status, "LOCKED");
  assert.notEqual(locked.updatedAt, target.updatedAt.toISOString());
  assert.deepEqual(
    {
      ...fixture.rows[0],
      status: original[0].status,
      updatedAt: original[0].updatedAt,
    },
    original[0],
  );
  assert.deepEqual(fixture.rows[1], original[1]);
  assert(!fixture.calls.includes("hash"));
  assert(fixture.calls.indexOf("status") > fixture.calls.indexOf("lock"));
  const reopened = await fixture.service.changeStatus(
    { userId: target.id },
    { status: "ACTIVE" },
    principal,
  );
  assert.equal(reopened.status, "ACTIVE");
  assert.deepEqual(
    { ...fixture.rows[0], updatedAt: original[0].updatedAt },
    original[0],
  );
  assert.equal(fixture.transactions(), 2);
  for (const key of [
    "password",
    "passwordHash",
    "permissionDenials",
    "orders",
    "history",
  ])
    assert(!(key in reopened));
});

void test("US4 same-state status requests succeed without persistence writes or timestamp changes", async () => {
  for (const status of ["ACTIVE", "LOCKED"] as const) {
    const row = staffRow(1, { status });
    const fixture = createFixture([row]);
    const result = await fixture.service.changeStatus(
      { userId: row.id },
      { status },
      principal,
    );
    assert.equal(result.status, status);
    assert.equal(result.updatedAt, row.updatedAt.toISOString());
    assert(!fixture.calls.includes("status"));
    assert.deepEqual(fixture.rows[0], row);
  }
});

void test("US4 unsupported current states return 409 for both requested states without changing the account", async () => {
  for (const current of ["UNVERIFIED", "INACTIVE", "DEACTIVATED"] as const) {
    for (const status of ["ACTIVE", "LOCKED"] as const) {
      const row = staffRow(1, { status: current });
      const fixture = createFixture([row]);
      await assert.rejects(
        () =>
          fixture.service.changeStatus(
            { userId: row.id },
            { status },
            principal,
          ),
        (error: unknown) =>
          error instanceof HttpError &&
          error.statusCode === 409 &&
          error.message ===
            "Trạng thái tài khoản không hỗ trợ khóa hoặc mở khóa",
      );
      assert(!fixture.calls.includes("status"));
      assert.deepEqual(fixture.rows[0], row);
    }
  }
});

void test("US4 status uses uniform ownership 404 for missing, foreign-supplier and admin targets", async () => {
  const foreign = staffRow(2, { supplierId: otherSupplierId });
  const admin = staffRow(3, {
    roleCode: "INGREDIENT_SUPPLIER_ADMIN",
    Role: {
      code: "INGREDIENT_SUPPLIER_ADMIN",
      name: "Admin",
      type: "SUPPLIER",
    },
  });
  const fixture = createFixture([foreign, admin]);
  for (const userId of [staffRow(99).id, foreign.id, admin.id]) {
    await assert.rejects(
      () =>
        fixture.service.changeStatus(
          { userId },
          { status: "LOCKED" },
          principal,
        ),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 404 &&
        error.message === "Không tìm thấy tài khoản nhân viên",
    );
  }
  assert(!fixture.calls.includes("status"));
  assert.deepEqual(fixture.rows, [foreign, admin]);
});

void test("US4 status checks current actor authorization after locks and never switches supplier or target role", async () => {
  for (const actor of [
    { ...principal, permissions: [] },
    { ...principal, supplierId: otherSupplierId },
    { ...principal, role: "INGREDIENT_SUPPLIER_STAFF" },
    { ...principal, roleId: staffRow(1).roleId },
  ]) {
    const row = staffRow(1);
    const fixture = createFixture([row]);
    fixture.afterLock(() => fixture.setActor(actor));
    await assert.rejects(
      () =>
        fixture.service.changeStatus(
          { userId: row.id },
          { status: "LOCKED" },
          principal,
        ),
      errorStatus(403),
    );
    assert(!fixture.calls.includes("status"));
    assert.deepEqual(fixture.rows[0], row);
  }
  const inactive = createFixture([staffRow(1)]);
  inactive.afterLock(() =>
    inactive.failActor(new HttpError(403, "Tài khoản đã bị vô hiệu hóa")),
  );
  await assert.rejects(
    () =>
      inactive.service.changeStatus(
        { userId: staffRow(1).id },
        { status: "LOCKED" },
        principal,
      ),
    errorStatus(403),
  );
  assert(!inactive.calls.includes("status"));
  const changedTarget = createFixture([staffRow(1)]);
  changedTarget.afterLock(() => {
    changedTarget.rows[0].roleId = principal.roleId;
  });
  await assert.rejects(
    () =>
      changedTarget.service.changeStatus(
        { userId: staffRow(1).id },
        { status: "LOCKED" },
        principal,
      ),
    errorStatus(403),
  );
  assert(!changedTarget.calls.includes("status"));
});

void test("US4 repository status update includes ownership and previous status in the write predicate", async () => {
  const updates: Prisma.UserUpdateManyArgs[] = [];
  const reads: Prisma.UserFindFirstArgs[] = [];
  const target = staffRow(1, { status: "LOCKED" });
  const tx = {
    user: {
      updateMany(query: Prisma.UserUpdateManyArgs) {
        updates.push(query);
        return Promise.resolve({ count: 1 });
      },
      findFirst(query: Prisma.UserFindFirstArgs) {
        reads.push(query);
        return Promise.resolve(target);
      },
    },
  } as unknown as Prisma.TransactionClient;
  const result = await createSupplierStaffRepository().setStatus(
    { supplierId },
    target.id,
    "ACTIVE",
    "LOCKED",
    tx,
  );
  assert.equal(result?.status, "LOCKED");
  assert.deepEqual(updates[0].where, {
    id: target.id,
    supplierId,
    schoolId: null,
    communeFoodSafetyUnitId: null,
    roleCode: "INGREDIENT_SUPPLIER_STAFF",
    Role: { code: "INGREDIENT_SUPPLIER_STAFF", type: "SUPPLIER" },
    status: "ACTIVE",
  });
  assert.deepEqual(updates[0].data, { status: "LOCKED" });
  assert.equal(reads.length, 1);
  assert.equal(reads[0].where?.id, target.id);
  assert.equal(reads[0].where?.supplierId, supplierId);
});

void test("US4 status rolls back failed changes and sanitizes database errors", async (context) => {
  context.mock.method(console, "error", () => undefined);
  const row = staffRow(1);
  const fixture = createFixture([row]);
  fixture.failAfterStatus(new Error("private SQL credential"));
  await assert.rejects(
    () =>
      fixture.service.changeStatus(
        { userId: row.id },
        { status: "LOCKED" },
        principal,
      ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 503 &&
      !error.message.includes("private"),
  );
  assert.deepEqual(fixture.rows[0], row);
});

void test("US4 HTTP status validates strict input and empty query, returns safe results and checks permissions", async (context) => {
  const row = staffRow(1);
  const fixture = createFixture([row]);
  const http = await listApi(context, fixture.service);
  const change = (body: unknown, query = "") =>
    http.request("/api/supplier-staff/" + row.id + "/status" + query, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const response = await change({ status: "LOCKED" });
  assert.equal(response.status, 200);
  const body = response.body as {
    success: boolean;
    statusCode: number;
    message: string;
    data: { status: string; updatedAt: string };
  };
  assert.equal(body.success, true);
  assert.equal(body.statusCode, 200);
  assert.equal(body.message, "Cập nhật trạng thái tài khoản thành công");
  assert.equal(body.data.status, "LOCKED");
  const noOp = await change({ status: "LOCKED" });
  assert.equal(noOp.status, 200);
  assert.deepEqual(noOp.body, response.body);
  for (const invalid of [
    {},
    { status: "DEACTIVATED" },
    { status: "ACTIVE", supplierId: otherSupplierId },
  ])
    assert.equal((await change(invalid)).status, 400);
  assert.equal(
    (await change({ status: "ACTIVE" }, "?supplierId=" + otherSupplierId))
      .status,
    400,
  );
  assert.equal(
    (
      await http.request("/api/supplier-staff/not-a-uuid/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ACTIVE" }),
      })
    ).status,
    400,
  );
  assert.equal(fixture.calls.filter((call) => call === "status").length, 1);
  const forbidden = await listApi(context, fixture.service, {
    ...principal,
    permissions: [],
  });
  assert.equal(
    (
      await forbidden.request("/api/supplier-staff/" + row.id + "/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ACTIVE" }),
      })
    ).status,
    403,
  );
  assert.equal(fixture.rows[0].status, "LOCKED");
});

void test("US5 permission detail uses one read snapshot, returns inactive grants, scoped denials and only safe fields in code order", async () => {
  const row = staffRow(1);
  const fixture = createFixture([row]);
  const inactive = permissionRecord(1, { code: "z.inactive", isActive: false });
  const allowed = {
    ...permissionRecord(2, { code: "a.allowed" }),
    privateFlag: "private-permission-data",
  };
  const denied = permissionRecord(3, { code: "m.denied" });
  fixture.setPermissions([inactive, denied, allowed]);
  fixture.denials.push(
    {
      userId: row.id,
      supplierId,
      permissionId: denied.id,
      disabledByUserId: principal.id,
    },
    {
      userId: staffRow(2).id,
      supplierId,
      permissionId: allowed.id,
      disabledByUserId: principal.id,
    },
    {
      userId: row.id,
      supplierId: otherSupplierId,
      permissionId: allowed.id,
      disabledByUserId: principal.id,
    },
  );
  const result = await fixture.service.getPermissions(
    { userId: row.id },
    principal,
  );
  assert.deepEqual(fixture.isolationLevels, ["RepeatableRead"]);
  assert.deepEqual(
    result.permissions.map((permission) => [
      permission.code,
      permission.isActive,
      permission.enabled,
    ]),
    [
      ["a.allowed", true, true],
      ["m.denied", true, false],
      ["z.inactive", false, false],
    ],
  );
  assert.equal(result.userId, row.id);
  assert.equal(result.roleId, row.roleId);
  for (const permission of result.permissions) {
    assert.deepEqual(
      Object.keys(permission).sort(),
      [
        "id",
        "code",
        "name",
        "module",
        "action",
        "description",
        "isActive",
        "enabled",
      ].sort(),
    );
    assert.equal(permission.description, null);
  }
  assert(!JSON.stringify(result).includes("private-"));
  assert(!fixture.calls.includes("lock"));
});

void test("US5 permissions return an empty array for roles without grants", async () => {
  const fixture = createFixture([staffRow(1)]);
  const result = await fixture.service.getPermissions(
    { userId: staffRow(1).id },
    principal,
  );
  assert.deepEqual(result, {
    userId: staffRow(1).id,
    roleId: staffRow(1).roleId,
    permissions: [],
  });
});

void test("US5 permission lookup checks staff ownership before the ACTIVE requirement for both reads and writes", async () => {
  const foreign = staffRow(1, {
    supplierId: otherSupplierId,
    status: "LOCKED",
  });
  const admin = staffRow(2, {
    roleCode: "INGREDIENT_SUPPLIER_ADMIN",
    status: "LOCKED",
    Role: {
      code: "INGREDIENT_SUPPLIER_ADMIN",
      name: "Admin",
      type: "SUPPLIER",
    },
  });
  const fixture = createFixture([foreign, admin]);
  for (const userId of [foreign.id, admin.id, staffRow(99).id]) {
    await assert.rejects(
      () => fixture.service.getPermissions({ userId }, principal),
      errorStatus(404),
    );
    await assert.rejects(
      () =>
        fixture.service.togglePermission(
          { userId, permissionId: permissionRecord(1).id },
          true,
          principal,
        ),
      errorStatus(404),
    );
  }
  for (const status of [
    "LOCKED",
    "UNVERIFIED",
    "INACTIVE",
    "DEACTIVATED",
  ] as const) {
    const inactive = createFixture([staffRow(1, { status })]);
    await assert.rejects(
      () =>
        inactive.service.getPermissions({ userId: staffRow(1).id }, principal),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 403 &&
        error.message === "Chỉ quản lý quyền của tài khoản đang hoạt động",
    );
    await assert.rejects(
      () =>
        inactive.service.togglePermission(
          { userId: staffRow(1).id, permissionId: permissionRecord(1).id },
          true,
          principal,
        ),
      errorStatus(403),
    );
    assert(!inactive.calls.includes("grant"));
    assert(!inactive.calls.includes("disable"));
  }
});

void test("US5 permission toggles are idempotent, affect only one staff and preserve unrelated supplier denials", async () => {
  const row = staffRow(1);
  const other = staffRow(2);
  const fixture = createFixture([row, other]);
  const permission = permissionRecord(1);
  fixture.setPermissions([permission]);
  const unrelated = {
    userId: row.id,
    supplierId: otherSupplierId,
    permissionId: permission.id,
    disabledByUserId: principal.id,
  };
  fixture.denials.push(unrelated);
  const params = { userId: row.id, permissionId: permission.id };
  const disabled = await fixture.service.togglePermission(
    params,
    true,
    principal,
  );
  assert.equal(disabled.permissions[0].enabled, false);
  assert.deepEqual(
    await fixture.service.togglePermission(params, true, principal),
    disabled,
  );
  assert.equal(fixture.denials.length, 2);
  assert.equal(
    (await fixture.service.getPermissions({ userId: other.id }, principal))
      .permissions[0].enabled,
    true,
  );
  const enabled = await fixture.service.togglePermission(
    params,
    false,
    principal,
  );
  assert.equal(enabled.permissions[0].enabled, true);
  assert.deepEqual(
    await fixture.service.togglePermission(params, false, principal),
    enabled,
  );
  assert.deepEqual(fixture.denials, [unrelated]);
  assert(
    fixture.isolationLevels.filter((level) => level === "Serializable")
      .length === 4,
  );
  assert(!fixture.calls.includes("hash"));
});

void test("US5 grant removal or inactivity blocks toggling and never removes a retained user denial", async () => {
  const fixture = createFixture([staffRow(1)]);
  const permission = permissionRecord(1);
  const params = { userId: staffRow(1).id, permissionId: permission.id };
  fixture.setPermissions([permission]);
  await fixture.service.togglePermission(params, true, principal);
  fixture.setPermissions([]);
  assert.deepEqual(
    (await fixture.service.getPermissions({ userId: params.userId }, principal))
      .permissions,
    [],
  );
  for (const disabled of [true, false])
    await assert.rejects(
      () => fixture.service.togglePermission(params, disabled, principal),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 400 &&
        error.message ===
          "Quyền phải đang hoạt động và thuộc vai trò nhân viên",
    );
  assert.equal(fixture.denials.length, 1);
  fixture.setPermissions([{ ...permission, isActive: false }]);
  assert.equal(
    (await fixture.service.getPermissions({ userId: params.userId }, principal))
      .permissions[0].enabled,
    false,
  );
  await assert.rejects(
    () => fixture.service.togglePermission(params, false, principal),
    errorStatus(400),
  );
  fixture.setPermissions([permission]);
  assert.equal(
    (await fixture.service.getPermissions({ userId: params.userId }, principal))
      .permissions[0].enabled,
    false,
  );
  await assert.rejects(
    () =>
      fixture.service.togglePermission(
        { ...params, permissionId: permissionRecord(99).id },
        false,
        principal,
      ),
    errorStatus(400),
  );
  assert.equal(fixture.denials.length, 1);
});

void test("US5 permission writes recheck actor authorization and current target state or grants after locks", async () => {
  for (const change of [
    "permission",
    "actor-role",
    "supplier",
    "inactive-target",
    "removed-grant",
  ] as const) {
    const fixture = createFixture([staffRow(1)]);
    fixture.setPermissions([permissionRecord(1)]);
    fixture.afterLock(() => {
      if (change === "permission")
        fixture.setActor({ ...principal, permissions: [] });
      else if (change === "actor-role")
        fixture.setActor({ ...principal, role: "INGREDIENT_SUPPLIER_STAFF" });
      else if (change === "supplier")
        fixture.setActor({ ...principal, supplierId: otherSupplierId });
      else if (change === "inactive-target") fixture.rows[0].status = "LOCKED";
      else fixture.setPermissions([]);
    });
    await assert.rejects(
      () =>
        fixture.service.togglePermission(
          { userId: staffRow(1).id, permissionId: permissionRecord(1).id },
          true,
          principal,
        ),
      errorStatus(change === "removed-grant" ? 400 : 403),
    );
    assert.equal(fixture.denials.length, 0);
    assert(!fixture.calls.includes("disable"));
  }
});

void test("US5 permission mutations roll back partial changes and sanitize infrastructure errors", async (context) => {
  context.mock.method(console, "error", () => undefined);
  for (const disabled of [true, false]) {
    const fixture = createFixture([staffRow(1)]);
    fixture.setPermissions([permissionRecord(1)]);
    if (!disabled)
      fixture.denials.push({
        userId: staffRow(1).id,
        supplierId,
        permissionId: permissionRecord(1).id,
        disabledByUserId: principal.id,
      });
    const initial = structuredClone(fixture.denials);
    fixture.failAfterPermission(new Error("private SQL details"));
    await assert.rejects(
      () =>
        fixture.service.togglePermission(
          { userId: staffRow(1).id, permissionId: permissionRecord(1).id },
          disabled,
          principal,
        ),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 503 &&
        !error.message.includes("private"),
    );
    assert.deepEqual(fixture.denials, initial);
  }
});

void test("US5 repository denial writes stay scoped and touch the User only when persistence changes", async () => {
  for (const count of [0, 1]) {
    const creates: Prisma.UserPermissionDenialCreateManyArgs[] = [];
    const deletes: Prisma.UserPermissionDenialDeleteManyArgs[] = [];
    const touched: Prisma.UserUpdateArgs[] = [];
    const tx = {
      userPermissionDenial: {
        createMany(query: Prisma.UserPermissionDenialCreateManyArgs) {
          creates.push(query);
          return Promise.resolve({ count });
        },
        deleteMany(query: Prisma.UserPermissionDenialDeleteManyArgs) {
          deletes.push(query);
          return Promise.resolve({ count });
        },
      },
      user: {
        findFirst() {
          return Promise.resolve(staffRow(1));
        },
        update(query: Prisma.UserUpdateArgs) {
          touched.push(query);
          return Promise.resolve({ id: staffRow(1).id });
        },
      },
    } as unknown as Prisma.TransactionClient;
    const repo = createSupplierStaffRepository();
    assert.deepEqual(
      await repo.disablePermission(
        { supplierId },
        staffRow(1).id,
        permissionRecord(1).id,
        principal.id,
        tx,
      ),
      { count },
    );
    assert.equal(creates[0].skipDuplicates, true);
    const data = Array.isArray(creates[0].data)
      ? creates[0].data[0]
      : creates[0].data;
    assert.equal(data.userId, staffRow(1).id);
    assert.equal(data.supplierId, supplierId);
    assert.equal(data.permissionId, permissionRecord(1).id);
    assert.equal(data.disabledByUserId, principal.id);
    assert.equal(data.schoolId ?? null, null);
    assert.equal(data.communeFoodSafetyUnitId ?? null, null);
    assert.deepEqual(
      await repo.enablePermission(
        { supplierId },
        staffRow(1).id,
        permissionRecord(1).id,
        tx,
      ),
      { count },
    );
    assert.equal(deletes[0].where?.userId, staffRow(1).id);
    assert.equal(deletes[0].where?.supplierId, supplierId);
    assert.equal(deletes[0].where?.permissionId, permissionRecord(1).id);
    const targetOwnership = JSON.stringify(deletes[0].where?.user);
    assert(targetOwnership.includes(supplierId));
    assert(targetOwnership.includes("INGREDIENT_SUPPLIER_STAFF"));
    assert.equal(touched.length, count * 2);
    for (const query of touched)
      assert.deepEqual(query.where, { id: staffRow(1).id });
  }
});

void test("US5 repository permission reads use scoped denials and grants ordered by code without discarding inactive grants", async () => {
  const grantQueries: Prisma.RolePermissionFindManyArgs[] = [];
  const denialQueries: Prisma.UserPermissionDenialFindManyArgs[] = [];
  const target = staffRow(1);
  const grant = { permission: permissionRecord(1, { isActive: false }) };
  const tx = {
    user: {
      findFirst() {
        return Promise.resolve(target);
      },
    },
    rolePermission: {
      findMany(query: Prisma.RolePermissionFindManyArgs) {
        grantQueries.push(query);
        return Promise.resolve([grant]);
      },
    },
    userPermissionDenial: {
      findMany(query: Prisma.UserPermissionDenialFindManyArgs) {
        denialQueries.push(query);
        return Promise.resolve([{ permissionId: grant.permission.id }]);
      },
    },
  } as unknown as Prisma.TransactionClient;
  const state = await createSupplierStaffRepository().permissionState(
    { supplierId },
    target.id,
    target.roleId,
    tx,
  );
  assert.deepEqual(state, {
    grants: [grant],
    denials: [{ permissionId: grant.permission.id }],
  });
  assert.equal(grantQueries[0].where?.roleId, target.roleId);
  assert(!JSON.stringify(grantQueries[0].where).includes("isActive"));
  assert.deepEqual(grantQueries[0].orderBy, { permission: { code: "asc" } });
  assert.equal(denialQueries[0].where?.userId, target.id);
  assert.equal(denialQueries[0].where?.supplierId, supplierId);
});

void test("US5 HTTP permission endpoints preserve envelopes and accept only empty body and query with valid UUIDs", async (context) => {
  const fixture = createFixture([staffRow(1)]);
  fixture.setPermissions([permissionRecord(1)]);
  const http = await listApi(context, fixture.service);
  const path = "/api/supplier-staff/" + staffRow(1).id;
  const togglePath = path + "/permission-denials/" + permissionRecord(1).id;
  const initial = await http.request(path + "/permissions");
  assert.equal(initial.status, 200);
  assert.equal(
    (initial.body as { message: string }).message,
    "Lấy quyền nhân viên thành công",
  );
  const disabled = await http.request(togglePath, { method: "PUT" });
  assert.equal(disabled.status, 200);
  assert.equal(
    (disabled.body as { message: string }).message,
    "Tắt quyền nhân viên thành công",
  );
  const enabled = await http.request(togglePath, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(enabled.status, 200);
  assert.equal(
    (enabled.body as { message: string }).message,
    "Bật lại quyền nhân viên thành công",
  );
  for (const body of [
    { permissionId: permissionRecord(1).id },
    { enabled: true },
    null,
    [],
  ])
    assert.equal(
      (
        await http.request(togglePath, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      ).status,
      400,
    );
  assert.equal((await http.request(path + "/permissions?limit=1")).status, 400);
  assert.equal(
    (
      await http.request(togglePath + "?supplierId=" + otherSupplierId, {
        method: "DELETE",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await http.request(path + "/permission-denials/not-a-uuid", {
        method: "PUT",
      })
    ).status,
    400,
  );
  const forbidden = await listApi(context, fixture.service, {
    ...principal,
    role: "INGREDIENT_SUPPLIER_STAFF",
  });
  assert.equal((await forbidden.request(path + "/permissions")).status, 403);
  assert.equal(
    (await forbidden.request(togglePath, { method: "DELETE" })).status,
    403,
  );
});

void test("US5 repository denies out-of-scope inserts and checks active grants only for a scoped target role", async () => {
  let found: StaffRow | null = staffRow(1);
  const grants: Prisma.RolePermissionFindFirstArgs[] = [];
  let writes = 0;
  const tx = {
    user: {
      findFirst: () => Promise.resolve(found),
      update: () => {
        assert.fail("No touch without a denial change");
      },
    },
    rolePermission: {
      findFirst(query: Prisma.RolePermissionFindFirstArgs) {
        grants.push(query);
        return Promise.resolve({ permissionId: permissionRecord(1).id });
      },
    },
    userPermissionDenial: {
      createMany: () => {
        writes++;
        return Promise.resolve({ count: 0 });
      },
    },
  } as unknown as Prisma.TransactionClient;
  const repo = createSupplierStaffRepository();
  assert.deepEqual(
    await repo.findActiveRoleGrant(
      { supplierId },
      staffRow(1).id,
      staffRow(1).roleId,
      permissionRecord(1).id,
      tx,
    ),
    { permissionId: permissionRecord(1).id },
  );
  assert.equal(grants[0].where?.roleId, staffRow(1).roleId);
  assert.equal(grants[0].where?.permissionId, permissionRecord(1).id);
  assert(JSON.stringify(grants[0].where).includes('"isActive":true'));
  found = null;
  assert.equal(
    await repo.findActiveRoleGrant(
      { supplierId },
      staffRow(1).id,
      staffRow(1).roleId,
      permissionRecord(1).id,
      tx,
    ),
    null,
  );
  assert.deepEqual(
    await repo.disablePermission(
      { supplierId },
      staffRow(1).id,
      permissionRecord(1).id,
      principal.id,
      tx,
    ),
    { count: 0 },
  );
  assert.equal(grants.length, 1);
  assert.equal(writes, 0);
});

void test("CI retry reaches real actor lookup conflicts before locks and during authorization recheck", async (context) => {
  context.mock.method(console, "error", () => undefined);
  for (const failureRead of [1, 2]) {
    for (const conflict of [
      Object.assign(new Error("private serialization details"), {
        code: "P2034",
      }),
      Object.assign(new Error("private PostgreSQL details"), {
        code: "P2010",
        meta: { code: "40001" },
      }),
    ]) {
      await context.test(
        `actor read ${failureRead}, ${conflict.code}`,
        async () => {
          const repo = createSupplierStaffRepository();
          let reads = 0,
            attempts = 0,
            hashes = 0,
            creates = 0;
          const identity = {
            ...principal,
            status: "ACTIVE",
            Role: {
              code: principal.role,
              type: principal.orgType,
              rolePermissions: [
                {
                  permission: { code: "supplier_staff.manage", isActive: true },
                },
              ],
            },
            permissionDenials: [],
          };
          const client = {
            user: {
              findUnique() {
                if (++reads === failureRead) throw conflict;
                return Promise.resolve(identity);
              },
            },
            async $transaction(
              operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
              options: { isolationLevel: string },
            ) {
              attempts++;
              assert.equal(options.isolationLevel, "Serializable");
              return operation(client);
            },
          } as unknown as PrismaClient;
          const service = createSupplierStaffService(
            {
              ...repo,
              staffRole() {
                return Promise.resolve({
                  id: staffRow(1).roleId,
                  code: "INGREDIENT_SUPPLIER_STAFF",
                  type: "SUPPLIER" as const,
                });
              },
              lock() {
                return Promise.resolve();
              },
              hasAccountLock() {
                return Promise.resolve(false);
              },
              duplicateExists() {
                return Promise.resolve(false);
              },
              createStaff() {
                creates++;
                return Promise.resolve(staffRow(1));
              },
            },
            () => Promise.resolve(client),
            () => {
              hashes++;
              return Promise.resolve("hashed-once");
            },
          );
          const result = await service.create(
            validateSupplierStaffCreate(createBody),
            principal,
          );
          assert.equal(result.id, staffRow(1).id);
          assert.equal(
            attempts,
            2,
            "the actor query conflict must retry the entire transaction",
          );
          assert.equal(hashes, 1);
          assert.equal(creates, 1);
        },
      );
    }
  }
});

void test("CI actor lookup preserves bounded retries and never retries a real authorization refusal", async (context) => {
  context.mock.method(console, "error", () => undefined);
  for (const serialization of [true, false]) {
    let attempts = 0;
    const client = {
      user: {
        findUnique() {
          if (serialization)
            throw Object.assign(new Error("private query details"), {
              code: "P2034",
            });
          return Promise.resolve({ ...principal, status: "LOCKED" });
        },
      },
      async $transaction(
        operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
      ) {
        attempts++;
        return operation(client);
      },
    } as unknown as PrismaClient;
    const service = createSupplierStaffService(
      createSupplierStaffRepository(),
      () => Promise.resolve(client),
      () => Promise.resolve("hash"),
    );
    await assert.rejects(
      () => service.create(validateSupplierStaffCreate(createBody), principal),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === (serialization ? 503 : 403) &&
        !error.message.includes("private"),
    );
    assert.equal(attempts, serialization ? 3 : 1);
  }
});
