import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpError } from "../src/utils/http-error";
import type { PrismaClient } from "../src/generated/prisma/client";
import type { AuthPrincipal } from "../src/types/auth";
import { createMenuService } from "../src/modules/menu/menu.service";

const schoolId = "00000000-0000-4000-8000-0000000000a1";
const menuId = "00000000-0000-4000-8000-0000000000a2";

const board: AuthPrincipal = {
  id: "00000000-0000-4000-8000-0000000000b1",
  username: "school_bgh",
  fullName: "BGH",
  roleId: "00000000-0000-4000-8000-0000000000b2",
  role: "SCHOOL_MANAGEMENT_BOARD",
  orgType: "SCHOOL",
  schoolId,
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: ["menu.view", "menu.review", "menu.approve"],
};

const identity = {
  id: board.id,
  username: board.username,
  fullName: board.fullName,
  roleId: board.roleId,
  schoolId,
  supplierId: null,
  communeFoodSafetyUnitId: null,
  status: "ACTIVE",
  Role: {
    code: board.role,
    type: "SCHOOL",
    rolePermissions: board.permissions.map((code) => ({
      permission: { code, isActive: true },
    })),
  },
  permissionDenials: [],
};

type Week = {
  status: string;
  menuDays: { id: string; approvalStatus: string; menuDayDishes: unknown[] }[];
};

function serviceFor(week: Week) {
  const writes = {
    records: [] as Record<string, unknown>[],
    days: [] as Record<string, unknown>[],
    weeks: [] as Record<string, unknown>[],
  };
  const tx = {
    $queryRaw: () => Promise.resolve([]),
    user: { findUnique: () => Promise.resolve(identity) },
    school: { findUnique: () => Promise.resolve({ status: "ACTIVE" }) },
    weeklyMenu: {
      findFirst: () => Promise.resolve({ id: menuId, schoolId, ...week }),
      update: (args: Record<string, unknown>) => {
        writes.weeks.push(args);
        return Promise.resolve({});
      },
    },
    menuDay: {
      updateMany: (args: Record<string, unknown>) => {
        writes.days.push(args);
        return Promise.resolve({ count: week.menuDays.length });
      },
    },
    menuReviewRecord: {
      create: (args: { data: Record<string, unknown> }) => {
        writes.records.push(args.data);
        return Promise.resolve({
          reviewedAt: new Date("2026-11-04T01:00:00Z"),
          User: { id: board.id, fullName: board.fullName },
        });
      },
    },
  };
  const db = {
    $transaction: (operation: (client: typeof tx) => Promise<unknown>) =>
      operation(tx),
  } as unknown as PrismaClient;
  return {
    writes,
    service: createMenuService(undefined, () => Promise.resolve(db)),
  };
}

const day = (id: string, approvalStatus: string) => ({
  id,
  approvalStatus,
  menuDayDishes: [],
});

void test("a revision request returns every day of the week, including legacy approved days", async () => {
  const { service, writes } = serviceFor({
    status: "PENDING_APPROVAL",
    menuDays: [day("mon", "APPROVED"), day("tue", "PENDING_APPROVAL")],
  });
  const result = await service.review(
    menuId,
    { decision: "REVISION_REQUESTED", feedback: "Đổi món thứ Ba" },
    board,
  );
  assert.equal(result.weeklyStatus, "REVISION_REQUIRED");
  assert.deepEqual(writes.days, [
    {
      where: { weeklyMenuId: menuId },
      data: { approvalStatus: "REVISION_REQUIRED" },
    },
  ]);
  assert.equal(writes.records.length, 1);
  assert.equal(writes.records[0].menuDayId, undefined);
  assert.equal(writes.records[0].reviewerUserId, board.id);
  assert.deepEqual(writes.weeks[0], {
    where: { id: menuId },
    data: { status: "REVISION_REQUIRED", approvedAt: null },
  });
});

void test("approval checks legacy approved days and writes nothing when the week is not ready", async () => {
  const { service, writes } = serviceFor({
    status: "PENDING_APPROVAL",
    menuDays: [day("mon", "APPROVED")],
  });
  await assert.rejects(
    service.review(menuId, { decision: "APPROVED", feedback: null }, board),
    (error: unknown) => error instanceof HttpError && error.statusCode === 422,
  );
  assert.equal(writes.records.length, 0);
  assert.equal(writes.days.length, 0);
});

void test("only weeks waiting for approval can be decided", async () => {
  for (const status of ["DRAFT", "REVISION_REQUIRED", "APPROVED"]) {
    const { service, writes } = serviceFor({
      status,
      menuDays: [day("mon", "PENDING_APPROVAL")],
    });
    await assert.rejects(
      service.review(
        menuId,
        { decision: "REVISION_REQUESTED", feedback: "Sửa" },
        board,
      ),
      (error: unknown) =>
        error instanceof HttpError && error.statusCode === 409,
    );
    assert.equal(writes.records.length, 0);
  }
});

void test("approval detail is scoped to the principal's school and hides a stale decision", async () => {
  let where: unknown;
  const reviewer = { fullName: "BGH", Role: { code: board.role } };
  const db = {
    weeklyMenu: {
      findFirst: (args: { where: unknown }) => {
        where = args.where;
        return Promise.resolve({
          id: menuId,
          title: "Tuần 45",
          status: "PENDING_APPROVAL",
          submittedAt: null,
          weekStartDate: new Date("2026-11-02"),
          School: { name: "Trường A" },
          menuDays: [],
          menuReviewRecords: [
            {
              decision: "REVISION_REQUESTED",
              feedback: "Lần trước",
              reviewedAt: new Date("2026-11-01"),
              User: reviewer,
            },
          ],
        });
      },
    },
  } as unknown as PrismaClient;
  const service = createMenuService(undefined, () => Promise.resolve(db));
  const detail = await service.getApprovalDetail(menuId, board);
  assert.deepEqual(where, { AND: [{ schoolId }, { id: menuId }] });
  assert.equal(detail.canDecide, true);
  assert.equal(detail.approval.note, "");
  assert.equal(detail.approval.approver, null);
});

void test("approval detail reports a missing menu as not found", async () => {
  const db = {
    weeklyMenu: { findFirst: () => Promise.resolve(null) },
  } as unknown as PrismaClient;
  const service = createMenuService(undefined, () => Promise.resolve(db));
  await assert.rejects(
    service.getApprovalDetail(menuId, board),
    (error: unknown) => error instanceof HttpError && error.statusCode === 404,
  );
});
