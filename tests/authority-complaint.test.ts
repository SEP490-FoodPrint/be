import assert from "node:assert/strict";
import test from "node:test";
import {
  INITIAL_PERMISSIONS,
  INITIAL_ROLE_PERMISSIONS,
} from "../src/constants/permission-catalog";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import { createAuthorityService } from "../src/modules/authority/authority.service";
import {
  authorityRepository,
  type AuthorityRepository,
} from "../src/modules/authority/authority.repository";
import {
  createAuthorityComplaintRepository,
  type AuthorityComplaintRepository,
  type EscalationSourceRow,
} from "../src/modules/authority-complaint/authority-complaint.repository";
import {
  authorityComplaintDescription,
  createAuthorityComplaintService,
} from "../src/modules/authority-complaint/authority-complaint.service";
import { validateEscalateAuthorityComplaint } from "../src/modules/authority-complaint/authority-complaint.validation";
import {
  allowedTicketActions,
  authorityComplaintTitle,
  TICKET_TRANSITIONS,
} from "../src/modules/complaint-ticket/complaint-ticket.lifecycle";
import {
  createComplaintTicketRepository,
  type ComplaintTicketRepository,
  type TransitionInput,
} from "../src/modules/complaint-ticket/complaint-ticket.repository";
import type { AuthPrincipal } from "../src/types/auth";
import { BUSINESS_CODE_TYPES } from "../src/utils/business-code";
import { listScopes } from "../src/utils/resource-access";

const NOW = new Date("2026-11-22T03:00:00.000Z");
const schoolId = "30000000-0000-4000-8000-000000000001";
const unitId = "30000000-0000-4000-8000-000000000002";
const mealComplaintId = "30000000-0000-4000-8000-000000000003";
const createdId = "30000000-0000-4000-8000-000000000004";
const locationId = "30000000-0000-4000-8000-000000000005";

const parent: AuthPrincipal = {
  id: "30000000-0000-4000-8000-000000000010",
  username: "parent",
  fullName: "Phụ huynh",
  roleId: "30000000-0000-4000-8000-000000000011",
  role: "PARENTS_COMMITTEE",
  orgType: "SCHOOL",
  schoolId,
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: ["authority_complaint.submit", "authority_complaint.view"],
};
const board: AuthPrincipal = {
  ...parent,
  id: "30000000-0000-4000-8000-000000000020",
  role: "SCHOOL_MANAGEMENT_BOARD",
  permissions: ["authority_complaint.view"],
};
const officer: AuthPrincipal = {
  ...parent,
  id: "30000000-0000-4000-8000-000000000030",
  role: "COMMUNE_FOOD_SAFETY_OFFICER",
  orgType: "AUTHORITY",
  schoolId: null,
  communeFoodSafetyUnitId: unitId,
  permissions: ["authority_complaint.view", "authority_complaint.respond"],
};
const admin: AuthPrincipal = {
  ...parent,
  id: "30000000-0000-4000-8000-000000000040",
  role: "SYSTEM_ADMIN",
  orgType: "SYSTEM",
  schoolId: null,
  permissions: ["authority.manage", "authority_complaint.view"],
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

/** Prisma client giả: ghi isolation level; withSchoolTransaction đọc trường ACTIVE. */
function fakeClient(actor: AuthPrincipal, isolation: (string | undefined)[]) {
  return {
    $transaction<T>(
      op: (tx: Prisma.TransactionClient) => Promise<T>,
      options?: { isolationLevel?: string },
    ): Promise<T> {
      isolation.push(options?.isolationLevel);
      return op({
        $queryRaw: () => Promise.resolve([]),
        school: { findUnique: () => Promise.resolve({ status: "ACTIVE" }) },
        user: { findUnique: () => Promise.resolve(identityOf(actor)) },
      } as unknown as Prisma.TransactionClient);
    },
  } as unknown as PrismaClient;
}

function sourceRow(
  overrides: Partial<EscalationSourceRow> = {},
): EscalationSourceRow {
  return {
    id: mealComplaintId,
    code: "FP-MC-48213",
    description: "Cơm bị sống",
    status: "RESOLVED",
    lastResolvedAt: new Date(NOW.getTime() - 3600 * 1000),
    senderRoleCode: "PARENTS_COMMITTEE",
    mealComplaint: { schoolId, authorityEscalation: null },
    ...overrides,
  };
}

function detailRow() {
  return {
    id: createdId,
    code: "FP-AC-00042",
    title: authorityComplaintTitle("FP-MC-48213"),
    description: "Cơm bị sống",
    status: "NEW",
    senderUserId: parent.id,
    lastResolvedAt: null,
    resolvedCount: 0,
    closeReason: null,
    closedAt: null,
    submittedAt: NOW,
    updatedAt: NOW,
    senderUser: { id: parent.id, fullName: parent.fullName },
    authorityComplaint: {
      recipientCommuneFoodSafetyUnitId: unitId,
      School: { id: schoolId, name: "Trường A" },
      RecipientUnit: { id: unitId, name: "ATTP phường B" },
      EscalatedFrom: {
        id: mealComplaintId,
        complaintType: "MEAL_QUALITY",
        DailyMealPortion: {
          id: "p1",
          mealDate: new Date("2026-11-20T00:00:00.000Z"),
          mealType: "LUNCH",
          Class: { id: "c1", name: "1A" },
        },
        Complaint: {
          code: "FP-MC-48213",
          title: "Khiếu nại suất ăn lớp 1A",
          description: "Cơm bị sống",
          submittedAt: NOW,
          comments: [],
        },
      },
    },
    comments: [],
  };
}

function escalateHarness(options: {
  actor?: AuthPrincipal;
  source?: EscalationSourceRow | null;
  locationId?: string | null;
  unit?: { id: string } | null;
  transitionOk?: boolean;
}) {
  const calls: string[] = [];
  const transitions: TransitionInput[] = [];
  const created: unknown[] = [];
  const isolation: (string | undefined)[] = [];
  const repository: AuthorityComplaintRepository = {
    ...createAuthorityComplaintRepository(),
    lockMealComplaint: (_tx, id) => {
      calls.push(`lock:${id}`);
      return Promise.resolve();
    },
    findEscalationSource: (_tx, _id, scope) => {
      calls.push(`source:${scope.schoolId}:${scope.senderUserId}`);
      return Promise.resolve(
        options.source === undefined ? sourceRow() : options.source,
      );
    },
    findSchoolLocationId: () => {
      calls.push("location");
      return Promise.resolve(
        options.locationId === undefined ? locationId : options.locationId,
      );
    },
    findRecipientUnit: (_tx, location) => {
      calls.push(`unit:${location}`);
      return Promise.resolve(
        options.unit === undefined ? { id: unitId } : options.unit,
      );
    },
    create: (_tx, data) => {
      calls.push("create");
      created.push(data);
      return Promise.resolve({ id: createdId });
    },
    findOne: (_tx, _scope, id) => {
      calls.push(`read:${id}`);
      return Promise.resolve(detailRow() as never);
    },
  };
  const tickets: ComplaintTicketRepository = {
    ...createComplaintTicketRepository(),
    transition: (_tx, input) => {
      transitions.push(input);
      calls.push(`transition:${input.kind}:${input.toStatus}`);
      return Promise.resolve(options.transitionOk ?? true);
    },
    addComment: (_tx, input) => {
      calls.push(`comment:${input.type}`);
      return Promise.resolve({});
    },
    allocateCode: (_tx, type) => {
      calls.push(`code:${type}`);
      return Promise.resolve("FP-AC-00042");
    },
    recordCreated: () => {
      calls.push("history");
      return Promise.resolve({});
    },
    findEmailRecipient: () =>
      Promise.resolve({
        kind: "AUTHORITY" as const,
        code: "FP-AC-00042",
        title: "Khiếu nại chuyển ATTP",
        description: "Mô tả",
        comments: [],
        senderUser: {
          email: "parent@example.test",
          fullName: "Phụ huynh",
          status: "ACTIVE" as const,
        },
      }),
    queueEmail: (_tx, input) => {
      calls.push(`email:${input.event}`);
      return Promise.resolve({});
    },
  };
  const service = createAuthorityComplaintService(
    repository,
    () => Promise.resolve(fakeClient(options.actor ?? parent, isolation)),
    () => NOW,
    tickets,
  );
  return { service, calls, transitions, created, isolation };
}

void test("AC, tiêu đề/mô tả tự sinh và ESCALATE chỉ khi được phép trong 48h", () => {
  assert.equal(BUSINESS_CODE_TYPES.AC, "khiếu nại leo thang lên ATTP");
  assert.equal(
    authorityComplaintTitle("FP-MC-48213"),
    "Khiếu nại chuyển ATTP từ đơn FP-MC-48213",
  );
  assert.equal(
    authorityComplaintDescription("Cơm sống", undefined),
    "Cơm sống",
  );
  assert.equal(
    authorityComplaintDescription("Cơm sống", "BGH chưa xử lý triệt để"),
    "Cơm sống\n\nLý do chuyển ATTP: BGH chưa xử lý triệt để",
  );
  assert.deepEqual(TICKET_TRANSITIONS.ESCALATE, {
    to: "CLOSED",
    closeReason: "ESCALATED",
  });
  const state = {
    status: "RESOLVED" as const,
    lastResolvedAt: new Date(NOW.getTime() - 47 * 3600 * 1000),
  };
  assert.deepEqual(allowedTicketActions("REQUESTER", state, NOW), [
    "SATISFY",
    "REOPEN",
  ]);
  assert.deepEqual(
    allowedTicketActions("REQUESTER", state, NOW, { canEscalate: true }),
    ["SATISFY", "REOPEN", "ESCALATE"],
  );
  assert.deepEqual(
    allowedTicketActions(
      "REQUESTER",
      { ...state, lastResolvedAt: new Date(NOW.getTime() - 48 * 3600 * 1000) },
      NOW,
      { canEscalate: true },
    ),
    [],
  );
});

void test("catalog: quyền C05 và authority.manage theo Clarifications", () => {
  const codes = INITIAL_PERMISSIONS.map((p) => p.code as string);
  const grants: readonly (readonly [string, string])[] =
    INITIAL_ROLE_PERMISSIONS;
  const holders = (code: string) =>
    grants
      .filter(([, permission]) => permission === code)
      .map(([role]) => role)
      .sort();
  for (const code of [
    "authority_complaint.submit",
    "authority_complaint.view",
    "authority_complaint.respond",
    "authority.manage",
  ])
    assert.ok(codes.includes(code), code);
  assert.deepEqual(holders("authority_complaint.submit"), [
    "PARENTS_COMMITTEE",
  ]);
  assert.deepEqual(holders("authority_complaint.view"), [
    "COMMUNE_FOOD_SAFETY_OFFICER",
    "PARENTS_COMMITTEE",
    "SCHOOL_MANAGEMENT_BOARD",
  ]);
  assert.deepEqual(holders("authority_complaint.respond"), [
    "COMMUNE_FOOD_SAFETY_OFFICER",
  ]);
  assert.deepEqual(holders("authority.manage"), ["SYSTEM_ADMIN"]);
});

void test("phạm vi đọc: ATTP theo đơn vị, BGH theo trường, phụ huynh đơn của mình; còn lại 403", () => {
  const scope = listScopes["authority-complaint"];
  assert.deepEqual(scope(officer), {
    kind: "AUTHORITY",
    authorityComplaint: { is: { recipientCommuneFoodSafetyUnitId: unitId } },
  });
  assert.deepEqual(scope(board), {
    kind: "AUTHORITY",
    authorityComplaint: { is: { schoolId } },
  });
  assert.deepEqual(scope(parent), {
    kind: "AUTHORITY",
    authorityComplaint: { is: { schoolId } },
    senderUserId: parent.id,
  });
  for (const denied of [
    admin,
    { ...board, permissions: [] },
    { ...board, role: "SCHOOL_ADMINISTRATION" },
  ])
    assert.throws(() => scope(denied), { statusCode: 403 });
});

void test("validation Chuyển ATTP: strict, UUID, lý do tùy chọn được trim", () => {
  assert.deepEqual(
    validateEscalateAuthorityComplaint({
      mealComplaintId,
      reason: "  Chưa hài lòng  ",
    }),
    { mealComplaintId, reason: "Chưa hài lòng" },
  );
  assert.deepEqual(validateEscalateAuthorityComplaint({ mealComplaintId }), {
    mealComplaintId,
  });
  for (const body of [
    {},
    { mealComplaintId: "FP-MC-1" },
    { mealComplaintId, recipientCommuneFoodSafetyUnitId: unitId },
    { mealComplaintId, reason: "   " },
  ])
    assert.throws(() => validateEscalateAuthorityComplaint(body), {
      statusCode: 400,
    });
});

void test("escalate: khóa C03, đóng ESCALATED, ghi chú lý do, cấp FP-AC và tạo C05 trong một transaction", async () => {
  const h = escalateHarness({});
  const detail = await h.service.escalate(
    { mealComplaintId, reason: "BGH chưa xử lý triệt để" },
    parent,
  );
  assert.deepEqual(h.isolation, ["Serializable"]);
  assert.deepEqual(h.calls, [
    `lock:${mealComplaintId}`,
    `source:${schoolId}:${parent.id}`,
    "location",
    `unit:${locationId}`,
    "transition:MEAL:CLOSED",
    "comment:ESCALATION_NOTE",
    "code:AC",
    "create",
    "history",
    "email:CREATED",
    `read:${createdId}`,
  ]);
  assert.equal(h.transitions[0].closeReason, "ESCALATED");
  assert.equal(
    h.transitions[0].resolvedAfter?.toISOString(),
    new Date(NOW.getTime() - 48 * 3600 * 1000).toISOString(),
  );
  assert.deepEqual(h.created, [
    {
      code: "FP-AC-00042",
      title: "Khiếu nại chuyển ATTP từ đơn FP-MC-48213",
      description: "Cơm bị sống\n\nLý do chuyển ATTP: BGH chưa xử lý triệt để",
      senderUserId: parent.id,
      senderRoleCode: "PARENTS_COMMITTEE",
      schoolId,
      recipientCommuneFoodSafetyUnitId: unitId,
      escalatedFromMealComplaintId: mealComplaintId,
    },
  ]);
  assert.equal(detail.displayStatus, "IN_PROGRESS");
  assert.equal(detail.escalatedFrom.code, "FP-MC-48213");
  assert.equal(detail.recipientUnit.id, unitId);
});

void test("escalate: từ chối khi không phải C03 của mình, sai trạng thái/hạn, đã chuyển, thiếu địa bàn hoặc đơn vị", async () => {
  const body = { mealComplaintId };
  const cases: [Parameters<typeof escalateHarness>[0], number][] = [
    [{ source: null }, 404],
    [{ source: sourceRow({ senderRoleCode: "HOMEROOM_TEACHER" }) }, 404],
    [{ source: sourceRow({ status: "IN_PROGRESS" }) }, 409],
    [
      {
        source: sourceRow({
          lastResolvedAt: new Date(NOW.getTime() - 49 * 3600 * 1000),
        }),
      },
      409,
    ],
    [
      {
        source: sourceRow({
          mealComplaint: { schoolId, authorityEscalation: { id: "x" } },
        }),
      },
      409,
    ],
    [{ locationId: null }, 409],
    [{ unit: null }, 409],
    [{ transitionOk: false }, 409],
  ];
  for (const [options, status] of cases) {
    const h = escalateHarness(options);
    await assert.rejects(h.service.escalate(body, parent), {
      statusCode: status,
    });
    assert.ok(!h.calls.includes("create"), JSON.stringify(options));
  }
  for (const principal of [board, officer, { ...parent, permissions: [] }]) {
    const h = escalateHarness({ actor: principal });
    await assert.rejects(h.service.escalate(body, principal), {
      statusCode: 403,
    });
    assert.equal(h.calls.length, 0);
  }
});

void test("người xem: ATTP đơn vị nhận là HANDLER, BGH chỉ xem, phụ huynh thấy Đang xử lý", async () => {
  const service = createAuthorityComplaintService(
    {
      ...createAuthorityComplaintRepository(),
      list: () =>
        Promise.resolve([
          { ...detailRow(), comments: [{ authorSide: "REQUESTER" }] },
        ] as never),
    },
    () => Promise.resolve({} as PrismaClient),
    () => NOW,
  );
  const first = async (principal: AuthPrincipal) =>
    (await service.getAll({ page: 1, limit: 20 }, principal)).items[0];
  assert.deepEqual((await first(officer)).allowedActions, ["ACCEPT"]);
  assert.deepEqual(
    (await first({ ...officer, permissions: ["authority_complaint.view"] }))
      .allowedActions,
    [],
  );
  const forBoard = await first(board);
  assert.deepEqual(forBoard.allowedActions, []);
  assert.deepEqual(forBoard.escalatedFrom, {
    id: mealComplaintId,
    code: "FP-MC-48213",
  });
  const forParent = await first(parent);
  assert.equal(forParent.displayStatus, "IN_PROGRESS");
  assert.deepEqual(forParent.allowedActions, ["COMMENT"]);
  await assert.rejects(service.accept(createdId, board), { statusCode: 403 });
  await assert.rejects(service.resolve(createdId, { content: "x" }, parent), {
    statusCode: 403,
  });
});

void test("lọc trạng thái C05: phụ huynh theo trạng thái hiển thị, ATTP và BGH theo trạng thái thật", async () => {
  const seen: unknown[] = [];
  const service = createAuthorityComplaintService(
    {
      ...createAuthorityComplaintRepository(),
      list: (_db, _scope, filter) => {
        seen.push(filter);
        return Promise.resolve([]);
      },
    },
    () => Promise.resolve({} as PrismaClient),
    () => NOW,
  );
  await service.getAll({ page: 1, limit: 20, status: "IN_PROGRESS" }, parent);
  await service.getAll({ page: 2, limit: 5, status: "CLOSED" }, parent);
  await service.getAll({ page: 1, limit: 20, status: "IN_PROGRESS" }, officer);
  await service.getAll({ page: 1, limit: 20, status: "REOPENED" }, board);
  await service.getAll({ page: 1, limit: 20 }, parent);
  assert.deepEqual(seen, [
    { page: 1, limit: 20, statuses: ["NEW", "IN_PROGRESS", "REOPENED"] },
    { page: 2, limit: 5, statuses: ["CLOSED"] },
    { page: 1, limit: 20, statuses: ["IN_PROGRESS"] },
    { page: 1, limit: 20, statuses: ["REOPENED"] },
    { page: 1, limit: 20, statuses: undefined },
  ]);
  await assert.rejects(
    service.getAll({ page: 1, limit: 20, status: "NEW" }, parent),
    { statusCode: 400 },
  );
});

function locationHarness(options: {
  unitExists?: boolean;
  location?: { id: string; level: number; isActive: boolean } | null;
  holder?: { id: string } | null;
  actor?: AuthPrincipal;
}) {
  const calls: string[] = [];
  const repository: AuthorityRepository = {
    ...authorityRepository,
    lockUnit: () => {
      calls.push("lock");
      return Promise.resolve(options.unitExists ?? true);
    },
    findLocation: () =>
      Promise.resolve(
        options.location === undefined
          ? { id: locationId, level: 2, isActive: true }
          : options.location,
      ),
    findUnitByLocation: () => Promise.resolve(options.holder ?? null),
    updateLocation: (_tx, id, location) => {
      calls.push(`update:${id}:${location}`);
      return Promise.resolve({
        id,
        code: "ATTP-B",
        name: "ATTP phường B",
        status: "ACTIVE" as const,
        location: { id: location, code: "W-B", name: "Phường B" },
      });
    },
  };
  const isolation: (string | undefined)[] = [];
  const service = createAuthorityService(undefined, repository, () =>
    Promise.resolve(fakeClient(options.actor ?? admin, isolation)),
  );
  return { service, calls, isolation };
}

void test("gắn địa bàn: chỉ System Admin, Location cấp phường/xã đang hoạt động, mỗi phường/xã một đơn vị", async () => {
  const params = { id: unitId };
  const body = { locationId };
  const ok = locationHarness({});
  assert.deepEqual(await ok.service.assignLocation(params, body, admin), {
    id: unitId,
    code: "ATTP-B",
    name: "ATTP phường B",
    status: "ACTIVE",
    location: { id: locationId, code: "W-B", name: "Phường B" },
  });
  assert.deepEqual(ok.isolation, ["Serializable"]);
  assert.deepEqual(ok.calls, ["lock", `update:${unitId}:${locationId}`]);
  const same = locationHarness({ holder: { id: unitId } });
  await same.service.assignLocation(params, body, admin);

  for (const [options, status] of [
    [{ unitExists: false }, 404],
    [{ location: null }, 400],
    [{ location: { id: locationId, level: 1, isActive: true } }, 400],
    [{ location: { id: locationId, level: 2, isActive: false } }, 400],
    [{ holder: { id: "other-unit" } }, 409],
  ] as const) {
    const h = locationHarness(options);
    await assert.rejects(h.service.assignLocation(params, body, admin), {
      statusCode: status,
    });
    assert.ok(!h.calls.some((call) => call.startsWith("update")));
  }
  for (const principal of [officer, { ...admin, permissions: [] }]) {
    const h = locationHarness({ actor: principal });
    await assert.rejects(h.service.assignLocation(params, body, principal), {
      statusCode: 403,
    });
  }
});
