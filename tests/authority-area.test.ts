import assert from "node:assert/strict";
import test from "node:test";
import { MemoryStore } from "express-rate-limit";
import { createApp } from "../src/app";
import { createApiRateLimiter } from "../src/middlewares/rate-limit.middleware";
import { INITIAL_ROLE_PERMISSIONS } from "../src/constants/permission-catalog";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import {
  authorityRepository,
  authoritySchoolDetailSelect,
  type AuthorityRepository,
  type AuthoritySchoolDetailRow,
} from "../src/modules/authority/authority.repository";
import { createAuthorityService } from "../src/modules/authority/authority.service";
import {
  validateAssignOrganizationLocationBody,
  validateAuthoritySchoolListQuery,
} from "../src/modules/authority/authority.validation";
import type { AuthPrincipal } from "../src/types/auth";
import { listScopes } from "../src/utils/resource-access";
import { startHttp } from "./helpers/http";

// specs/authority-officer-accounts PR A: phường/xã của trường/NCC, trường thuộc địa bàn ATTP.
const unitId = "40000000-0000-4000-8000-000000000001";
const schoolId = "40000000-0000-4000-8000-000000000002";
const supplierId = "40000000-0000-4000-8000-000000000003";
const wardId = "40000000-0000-4000-8000-000000000004";

const officer: AuthPrincipal = {
  id: "40000000-0000-4000-8000-000000000010",
  username: "attp",
  fullName: "Cán bộ ATTP",
  roleId: "40000000-0000-4000-8000-000000000011",
  role: "COMMUNE_FOOD_SAFETY_OFFICER",
  orgType: "AUTHORITY",
  schoolId: null,
  supplierId: null,
  communeFoodSafetyUnitId: unitId,
  permissions: ["authority_school.view"],
};
const admin: AuthPrincipal = {
  ...officer,
  id: "40000000-0000-4000-8000-000000000020",
  role: "SYSTEM_ADMIN",
  orgType: "SYSTEM",
  communeFoodSafetyUnitId: null,
  permissions: ["authority.manage"],
};
const board: AuthPrincipal = {
  ...officer,
  id: "40000000-0000-4000-8000-000000000030",
  role: "SCHOOL_MANAGEMENT_BOARD",
  orgType: "SCHOOL",
  schoolId,
  communeFoodSafetyUnitId: null,
};

function identityOf(principal: AuthPrincipal) {
  return {
    id: principal.id,
    username: principal.username,
    fullName: principal.fullName,
    status: "ACTIVE",
    roleId: principal.roleId,
    schoolId: principal.schoolId,
    supplierId: principal.supplierId,
    communeFoodSafetyUnitId: principal.communeFoodSafetyUnitId,
    Role: {
      code: principal.role,
      type: principal.orgType,
      rolePermissions: principal.permissions.map((code) => ({
        permission: { code, isActive: true },
      })),
    },
    permissionDenials: [],
  };
}

function fakeClient(actor: AuthPrincipal) {
  return {
    $transaction<T>(
      op: (tx: Prisma.TransactionClient) => Promise<T>,
    ): Promise<T> {
      return op({
        $queryRaw: () => Promise.resolve([]),
        user: { findUnique: () => Promise.resolve(identityOf(actor)) },
      } as unknown as Prisma.TransactionClient);
    },
  } as unknown as PrismaClient;
}

const ward = {
  id: wardId,
  code: "W-A",
  name: "Phường A",
  level: 2,
  isActive: true,
};

function harness(
  options: {
    actor?: AuthPrincipal;
    exists?: boolean;
    location?: typeof ward | null;
    detail?: AuthoritySchoolDetailRow | null;
  } = {},
) {
  const calls: string[] = [];
  const reads: unknown[] = [];
  const repository: AuthorityRepository = {
    ...authorityRepository,
    lockOrganization: (_tx, kind, id) => {
      calls.push(`lock:${kind}:${id}`);
      return Promise.resolve(options.exists ?? true);
    },
    findWard: () =>
      Promise.resolve(options.location === undefined ? ward : options.location),
    updateOrganizationLocation: (_tx, kind, id, locationId) => {
      calls.push(`update:${kind}:${id}:${locationId}`);
      return Promise.resolve({
        id,
        name: kind === "school" ? "Trường A" : "NCC A",
        location: { id: locationId, code: "W-A", name: "Phường A" },
      });
    },
    listSchools: (_client, args) => {
      reads.push(args);
      return Promise.resolve([
        {
          id: schoolId,
          code: "TH-A",
          name: "Trường A",
          address: null,
          phone: null,
          email: null,
          status: "ACTIVE" as const,
          location: { id: wardId, code: "W-A", name: "Phường A" },
        },
      ]);
    },
    findSchoolDetail: (_client, where) => {
      reads.push(where);
      return Promise.resolve(
        options.detail === undefined ? detailRow() : options.detail,
      );
    },
  };
  const service = createAuthorityService(undefined, repository, () =>
    Promise.resolve(fakeClient(options.actor ?? admin)),
  );
  return { service, calls, reads };
}

function detailRow(): AuthoritySchoolDetailRow {
  const supplier = (id: string, name: string) => ({
    id,
    name,
    taxCode: "0101",
    phone: null,
    email: null,
    address: null,
    intakeState: "ACTIVE" as const,
    location: null,
  });
  return {
    id: schoolId,
    code: "TH-A",
    name: "Trường A",
    address: "1 Đường A",
    phone: null,
    email: null,
    status: "ACTIVE",
    location: { id: wardId, code: "W-A", name: "Phường A" },
    schoolSupplierRelationships: [
      {
        status: "ACTIVE",
        linkedAt: new Date("2026-11-01T00:00:00.000Z"),
        suspendedAt: null,
        Supplier: supplier(supplierId, "NCC A"),
      },
      {
        status: "SUSPENDED",
        linkedAt: new Date("2026-10-01T00:00:00.000Z"),
        suspendedAt: new Date("2026-11-10T00:00:00.000Z"),
        Supplier: supplier("40000000-0000-4000-8000-000000000005", "NCC B"),
      },
    ],
  };
}

void test("catalog: cán bộ ATTP có authority_school.view, không còn dashboard.view", () => {
  const grants = INITIAL_ROLE_PERMISSIONS.filter(
    ([role]) => role === "COMMUNE_FOOD_SAFETY_OFFICER",
  ).map(([, code]) => code as string);
  assert(grants.includes("authority_school.view"));
  assert(!grants.includes("dashboard.view"));
});

void test("phạm vi authority-school: chỉ cán bộ ATTP có quyền, lọc theo phường/xã của đơn vị", () => {
  assert.deepEqual(listScopes["authority-school"](officer), {
    location: { communeFoodSafetyUnits: { some: { id: unitId } } },
  });
  for (const principal of [
    { ...officer, permissions: [] },
    { ...officer, communeFoodSafetyUnitId: null },
    { ...admin, permissions: ["authority_school.view"] },
    { ...board, permissions: ["authority_school.view"] },
  ])
    assert.throws(() => listScopes["authority-school"](principal), {
      statusCode: 403,
    });
});

void test("chi tiết trường chỉ chọn NCC còn hoạt động có quan hệ ACTIVE/SUSPENDED", () => {
  assert.deepEqual(
    authoritySchoolDetailSelect.schoolSupplierRelationships.where,
    {
      status: { in: ["ACTIVE", "SUSPENDED"] },
      Supplier: { status: "ACTIVE" },
    },
  );
});

void test("gắn phường/xã cho trường và NCC: System Admin, phường/xã đang hoạt động", async () => {
  const body = validateAssignOrganizationLocationBody({ locationId: wardId });
  const school = harness();
  assert.deepEqual(
    await school.service.assignSchoolLocation({ schoolId }, body, admin),
    {
      id: schoolId,
      name: "Trường A",
      location: { id: wardId, code: "W-A", name: "Phường A" },
    },
  );
  assert.deepEqual(school.calls, [
    `lock:school:${schoolId}`,
    `update:school:${schoolId}:${wardId}`,
  ]);
  const supplier = harness();
  await supplier.service.assignSupplierLocation({ supplierId }, body, admin);
  assert.deepEqual(supplier.calls, [
    `lock:supplier:${supplierId}`,
    `update:supplier:${supplierId}:${wardId}`,
  ]);

  for (const [options, status] of [
    [{ exists: false }, 404],
    [{ location: null }, 400],
    [{ location: { ...ward, level: 1 } }, 400],
    [{ location: { ...ward, isActive: false } }, 400],
  ] as const) {
    const h = harness(options);
    await assert.rejects(
      h.service.assignSchoolLocation({ schoolId }, body, admin),
      {
        statusCode: status,
      },
    );
    assert(!h.calls.some((call) => call.startsWith("update")));
  }
  for (const actor of [officer, { ...admin, permissions: [] }]) {
    const h = harness({ actor });
    await assert.rejects(
      h.service.assignSupplierLocation({ supplierId }, body, actor),
      { statusCode: 403 },
    );
    assert.deepEqual(h.calls, []);
  }
  assert.throws(
    () => validateAssignOrganizationLocationBody({ locationId: "x" }),
    { statusCode: 400 },
  );
});

void test("ATTP xem danh sách trường thuộc địa bàn với tìm kiếm, lọc trạng thái", async () => {
  const h = harness({ actor: officer });
  const query = validateAuthoritySchoolListQuery({
    search: " Trường ",
    status: "ACTIVE",
  });
  const page = await h.service.listSchools(query, officer);
  assert.equal(page.items.length, 1);
  assert.deepEqual(page.items[0]?.location, {
    id: wardId,
    code: "W-A",
    name: "Phường A",
  });
  assert.deepEqual(h.reads, [
    {
      where: {
        AND: [
          { location: { communeFoodSafetyUnits: { some: { id: unitId } } } },
          {
            OR: [
              { name: { contains: "Trường", mode: "insensitive" } },
              { code: { contains: "Trường", mode: "insensitive" } },
            ],
          },
          { status: "ACTIVE" },
        ],
      },
      skip: 0,
      take: 21,
    },
  ]);
  await assert.rejects(h.service.listSchools(query, board), {
    statusCode: 403,
  });
  assert.throws(() => validateAuthoritySchoolListQuery({ status: "x" }), {
    statusCode: 400,
  });
  assert.throws(() => validateAuthoritySchoolListQuery({ schoolId }), {
    statusCode: 400,
  });
});

void test("ATTP xem chi tiết trường kèm NCC liên kết; trường ngoài địa bàn 404", async () => {
  const h = harness({ actor: officer });
  const detail = await h.service.getSchool({ schoolId }, officer);
  assert.deepEqual(h.reads, [
    {
      AND: [
        { location: { communeFoodSafetyUnits: { some: { id: unitId } } } },
        { id: schoolId },
      ],
    },
  ]);
  assert.deepEqual(
    detail.suppliers.map((supplier) => [
      supplier.name,
      supplier.relationshipStatus,
      supplier.suspendedAt,
    ]),
    [
      ["NCC A", "ACTIVE", null],
      ["NCC B", "SUSPENDED", "2026-11-10T00:00:00.000Z"],
    ],
  );
  assert(!("contracts" in (detail.suppliers[0] ?? {})));
  const outside = harness({ actor: officer, detail: null });
  await assert.rejects(outside.service.getSchool({ schoolId }, officer), {
    statusCode: 404,
  });
  await assert.rejects(h.service.getSchool({ schoolId }, board), {
    statusCode: 403,
  });
});

void test("HTTP: route mới được mount và chặn quyền trước khi truy cập DB", async (context) => {
  let actor: AuthPrincipal = officer;
  const app = createApp(
    createApiRateLimiter(new MemoryStore()),
    (req, _res, next) => {
      req.auth = actor;
      next();
    },
  );
  const http = await startHttp(app);
  context.after(() => http.close());
  const send = (method: string, path: string, body?: unknown) =>
    http.request("/api" + path, {
      method,
      headers: {
        "X-CSRF-Protection": "1",
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  for (const path of [
    `/schools/${schoolId}/location`,
    `/suppliers/${supplierId}/location`,
  ])
    assert.equal((await send("PUT", path, { locationId: wardId })).status, 403);
  actor = board;
  for (const path of [
    "/commune-food-safety-units/me/schools",
    `/commune-food-safety-units/me/schools/${schoolId}`,
  ])
    assert.equal((await send("GET", path)).status, 403, path);
  actor = admin;
  assert.equal(
    (await send("PUT", `/schools/${schoolId}/location`, { locationId: "x" }))
      .status,
    400,
  );
  assert.equal(
    (
      await send("PUT", `/suppliers/not-a-uuid/location`, {
        locationId: wardId,
      })
    ).status,
    400,
  );
});
