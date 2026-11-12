import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "../src/generated/prisma/client";
import { ROLES } from "../src/constants/roles";
import {
  createMenuApprovalService,
  type MenuApprovalService,
} from "../src/modules/menu-approval/menu-approval.service";
import type {
  ApprovalDecisionRow,
  ApprovalDetailRow,
  MenuApprovalRepository,
} from "../src/modules/menu-approval/menu-approval.repository";
import { validateMenuApprovalDecision } from "../src/modules/menu-approval/menu-approval.validation";
import type { AuthPrincipal } from "../src/types/auth";
import { HttpError } from "../src/utils/http-error";
import { RequestValidationError } from "../src/utils/request-validation";

const schoolId = "00000000-0000-4000-8000-0000000000a1";
const menuId = "00000000-0000-4000-8000-0000000000a2";
const reviewerId = "00000000-0000-4000-8000-0000000000b1";

const board: AuthPrincipal = {
  id: reviewerId,
  username: "school_bgh",
  fullName: "Ban Giám hiệu",
  roleId: "00000000-0000-4000-8000-0000000000b2",
  role: ROLES.SCHOOL_MANAGEMENT_BOARD,
  orgType: "SCHOOL",
  schoolId,
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: ["menu.view", "menu.review", "menu.approve"],
};

function transactionDatabase(actor: AuthPrincipal): PrismaClient {
  const identity = {
    id: actor.id,
    username: actor.username,
    fullName: actor.fullName,
    roleId: actor.roleId,
    schoolId: actor.schoolId,
    supplierId: null,
    communeFoodSafetyUnitId: null,
    status: "ACTIVE",
    Role: {
      code: actor.role,
      type: "SCHOOL",
      rolePermissions: actor.permissions.map((code) => ({
        permission: { code, isActive: true },
      })),
    },
    permissionDenials: [],
  };
  const tx = {
    $queryRaw: () => Promise.resolve([]),
    user: { findUnique: () => Promise.resolve(identity) },
    school: { findUnique: () => Promise.resolve({ status: "ACTIVE" }) },
  };
  return {
    $transaction: (operation: (client: typeof tx) => Promise<unknown>) =>
      operation(tx),
  } as unknown as PrismaClient;
}

function decisionWeek(
  status: ApprovalDecisionRow["status"] = "PENDING_APPROVAL",
  ready = true,
): ApprovalDecisionRow {
  return {
    id: menuId,
    schoolId,
    status,
    menuDays: ready
      ? [
          {
            approvalStatus: "APPROVED",
            menuDayDishes: [
              {
                Dish: { status: "ACTIVE" },
                ingredients: [{}],
              },
            ],
          },
        ]
      : [],
  } as unknown as ApprovalDecisionRow;
}

function decisionHarness(options?: {
  actor?: AuthPrincipal;
  week?: ApprovalDecisionRow;
}) {
  const actor = options?.actor ?? board;
  const writes = {
    reviews: [] as Array<Record<string, unknown>>,
    days: [] as Array<{ id: string; status: string }>,
    weeks: [] as Array<{
      id: string;
      status: string;
      approvedAt: Date | null;
    }>,
  };
  const repository: MenuApprovalRepository = {
    connect: () => Promise.resolve(transactionDatabase(actor)),
    findDetail: () => Promise.resolve(null),
    findFinalizedPortions: () => Promise.resolve([]),
    findForDecision: () => Promise.resolve(options?.week ?? decisionWeek()),
    createReview: (_tx, input) => {
      writes.reviews.push(input);
      return Promise.resolve({
        reviewedAt: new Date("2026-11-04T01:00:00.000Z"),
        User: { id: reviewerId, fullName: "Ban Giám hiệu" },
      });
    },
    updateAllDays: (_tx, id, status) => {
      writes.days.push({ id, status });
      return Promise.resolve();
    },
    updateWeek: (_tx, id, status, approvedAt) => {
      writes.weeks.push({ id, status, approvedAt });
      return Promise.resolve();
    },
  };
  return { writes, service: createMenuApprovalService(repository) };
}

void test("decision validation rejects menuDayId and requires revision feedback", () => {
  assert.throws(
    () =>
      validateMenuApprovalDecision({
        menuDayId: "00000000-0000-4000-8000-0000000000d1",
        decision: "APPROVED",
      }),
    RequestValidationError,
  );
  assert.throws(
    () => validateMenuApprovalDecision({ decision: "REVISION_REQUESTED" }),
    RequestValidationError,
  );
  assert.deepEqual(validateMenuApprovalDecision({ decision: "APPROVED" }), {
    decision: "APPROVED",
    feedback: null,
  });
});

void test("revision request records one week decision and updates every day", async () => {
  const { service, writes } = decisionHarness();
  const result = await service.decide(
    menuId,
    { decision: "REVISION_REQUESTED", feedback: "Đổi món thứ Ba" },
    board,
  );
  assert.equal(result.weeklyStatus, "REVISION_REQUIRED");
  assert.deepEqual(writes.days, [{ id: menuId, status: "REVISION_REQUIRED" }]);
  assert.deepEqual(writes.weeks, [
    { id: menuId, status: "REVISION_REQUIRED", approvedAt: null },
  ]);
  assert.deepEqual(writes.reviews, [
    {
      weeklyMenuId: menuId,
      reviewerUserId: reviewerId,
      decision: "REVISION_REQUESTED",
      feedback: "Đổi món thứ Ba",
    },
  ]);
});

void test("approval synchronizes the week and stores the review timestamp", async () => {
  const { service, writes } = decisionHarness();
  const result = await service.decide(
    menuId,
    { decision: "APPROVED", feedback: null },
    board,
  );
  const reviewedAt = new Date("2026-11-04T01:00:00.000Z");
  assert.equal(result.weeklyStatus, "APPROVED");
  assert.equal(result.reviewedAt, reviewedAt.toISOString());
  assert.deepEqual(writes.days, [{ id: menuId, status: "APPROVED" }]);
  assert.deepEqual(writes.weeks, [
    { id: menuId, status: "APPROVED", approvedAt: reviewedAt },
  ]);
});

void test("approval refuses an incomplete week before writing", async () => {
  const { service, writes } = decisionHarness({
    week: decisionWeek("PENDING_APPROVAL", false),
  });
  await assert.rejects(
    service.decide(menuId, { decision: "APPROVED", feedback: null }, board),
    (error: unknown) => error instanceof HttpError && error.statusCode === 422,
  );
  assert.equal(writes.reviews.length, 0);
  assert.equal(writes.days.length, 0);
  assert.equal(writes.weeks.length, 0);
});

void test("only a pending week can be decided", async () => {
  const { service, writes } = decisionHarness({
    week: decisionWeek("APPROVED"),
  });
  await assert.rejects(
    service.decide(
      menuId,
      { decision: "REVISION_REQUESTED", feedback: "Sửa lại" },
      board,
    ),
    (error: unknown) => error instanceof HttpError && error.statusCode === 409,
  );
  assert.equal(writes.reviews.length, 0);
});

void test("a non-board account cannot decide even with the permission", async () => {
  const nonBoard = { ...board, role: ROLES.SCHOOL_ADMINISTRATION };
  const { service, writes } = decisionHarness({ actor: nonBoard });
  await assert.rejects(
    service.decide(
      menuId,
      { decision: "REVISION_REQUESTED", feedback: "Sửa lại" },
      nonBoard,
    ),
    (error: unknown) => error instanceof HttpError && error.statusCode === 403,
  );
  assert.equal(writes.reviews.length, 0);
});

function detailRow(): ApprovalDetailRow {
  const monday = new Date("2026-11-02T00:00:00.000Z");
  return {
    id: menuId,
    title: "Tuần 45",
    status: "PENDING_APPROVAL",
    submittedAt: new Date("2026-10-30T01:00:00.000Z"),
    weekStartDate: monday,
    School: { name: "Trường A" },
    menuDays: [
      {
        id: "00000000-0000-4000-8000-0000000000d1",
        menuDate: monday,
        menuDayDishes: [],
      },
    ],
    menuReviewRecords: [
      {
        decision: "REVISION_REQUESTED",
        feedback: "Nhận xét cũ",
        reviewedAt: new Date("2026-10-20T01:00:00.000Z"),
        User: {
          fullName: "Ban Giám hiệu",
          Role: { code: ROLES.SCHOOL_MANAGEMENT_BOARD },
        },
      },
    ],
  } as unknown as ApprovalDetailRow;
}

void test("approval detail stays in school scope and uses finalized class demand", async () => {
  let requestedScope: { id: string; schoolId: string } | undefined;
  const repository = {
    connect: () => Promise.resolve(transactionDatabase(board)),
    findDetail: (id: string, requestedSchoolId: string) => {
      requestedScope = { id, schoolId: requestedSchoolId };
      return Promise.resolve(detailRow());
    },
    findFinalizedPortions: () =>
      Promise.resolve([
        {
          mealDate: new Date("2026-11-02T00:00:00.000Z"),
          mealType: "LUNCH" as const,
          totalPortions: 420,
        },
        {
          mealDate: new Date("2026-11-02T00:00:00.000Z"),
          mealType: "AFTERNOON" as const,
          totalPortions: 390,
        },
      ]),
    findForDecision: () => Promise.resolve(null),
    createReview: () => Promise.reject(new Error("not used")),
    updateAllDays: () => Promise.reject(new Error("not used")),
    updateWeek: () => Promise.reject(new Error("not used")),
  } satisfies MenuApprovalRepository;
  const service: MenuApprovalService = createMenuApprovalService(repository);
  const detail = await service.getDetail(menuId, board);
  assert.deepEqual(requestedScope, { id: menuId, schoolId });
  assert.equal(detail.days[0]?.portions, 420);
  assert.equal(detail.canDecide, true);
  assert.equal(detail.approval.approver, null);
  assert.equal(detail.approval.note, "");
});

void test("approval detail is restricted to the school management board", async () => {
  let reads = 0;
  const repository = {
    connect: () => Promise.resolve(transactionDatabase(board)),
    findDetail: () => {
      reads += 1;
      return Promise.resolve(detailRow());
    },
    findFinalizedPortions: () => Promise.resolve([]),
    findForDecision: () => Promise.resolve(null),
    createReview: () => Promise.reject(new Error("not used")),
    updateAllDays: () => Promise.reject(new Error("not used")),
    updateWeek: () => Promise.reject(new Error("not used")),
  } satisfies MenuApprovalRepository;
  const service = createMenuApprovalService(repository);
  await assert.rejects(
    service.getDetail(menuId, {
      ...board,
      role: ROLES.SCHOOL_ADMINISTRATION,
    }),
    (error: unknown) => error instanceof HttpError && error.statusCode === 403,
  );
  assert.equal(reads, 0);
});
