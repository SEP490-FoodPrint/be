import assert from "node:assert/strict";
import test from "node:test";
import {
  validateComplaintComment,
  validateComplaintReopen,
  validateComplaintResolve,
  validateCreateComplaint,
  validateFeedbackListQuery,
} from "../src/modules/feedback/feedback.validation";
import { createFeedbackRepository } from "../src/modules/feedback/feedback.repository";
import { createFeedbackService } from "../src/modules/feedback/feedback.service";
import type { AuthPrincipal } from "../src/types/auth";
import { listScopes } from "../src/utils/resource-access";

const principal = (overrides: Partial<AuthPrincipal> = {}): AuthPrincipal => ({
  id: "10000000-0000-4000-8000-000000000001",
  username: "teacher",
  fullName: "Giáo viên",
  roleId: "10000000-0000-4000-8000-000000000002",
  role: "HOMEROOM_TEACHER",
  orgType: "SCHOOL",
  schoolId: "10000000-0000-4000-8000-000000000003",
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: ["meal_complaint.submit", "meal_complaint.view"],
  ...overrides,
});
const board = (overrides: Partial<AuthPrincipal> = {}) =>
  principal({
    id: "10000000-0000-4000-8000-000000000009",
    role: "SCHOOL_MANAGEMENT_BOARD",
    permissions: ["meal_complaint.view", "meal_complaint.respond"],
    ...overrides,
  });

void test("GVCN list scope is own MEAL complaints in own school", () => {
  const actor = principal();
  assert.deepEqual(listScopes.feedback(actor), {
    kind: "MEAL",
    mealComplaint: { is: { schoolId: actor.schoolId } },
    senderUserId: actor.id,
  });
});
void test("đại diện phụ huynh chỉ đọc đơn của mình", () => {
  const actor = principal({ role: "PARENTS_COMMITTEE" });
  assert.deepEqual(listScopes.feedback(actor), {
    kind: "MEAL",
    mealComplaint: { is: { schoolId: actor.schoolId } },
    senderUserId: actor.id,
  });
  assert.throws(() => listScopes.feedback({ ...actor, permissions: [] }), {
    statusCode: 403,
  });
});
void test("BGH list scope is school-wide", () => {
  const actor = board();
  assert.deepEqual(listScopes.feedback(actor), {
    kind: "MEAL",
    mealComplaint: { is: { schoolId: actor.schoolId } },
  });
});
void test("create rejects server-owned fields and HEALTH_ISSUE (Q21)", () => {
  const valid = {
    dailyMealPortionId: "10000000-0000-4000-8000-000000000020",
    complaintType: "MEAL_QUALITY",
    description: "Suất ăn có mùi bất thường.",
  };
  assert.deepEqual(validateCreateComplaint(valid), valid);
  for (const extra of [
    { senderUserId: principal().id },
    { status: "RESOLVED" },
    { title: "Tự đặt tiêu đề" },
  ])
    assert.throws(() => validateCreateComplaint({ ...valid, ...extra }), {
      statusCode: 400,
    });
  assert.throws(
    () => validateCreateComplaint({ ...valid, complaintType: "HEALTH_ISSUE" }),
    { statusCode: 400 },
  );
});
void test("ticket bodies trim content, require resolution text, reason optional", () => {
  assert.deepEqual(validateComplaintComment({ content: "  Xin chào  " }), {
    content: "Xin chào",
  });
  assert.throws(() => validateComplaintComment({ content: "   " }), {
    statusCode: 400,
  });
  assert.throws(() => validateComplaintResolve({}), { statusCode: 400 });
  assert.throws(() => validateComplaintResolve({ content: "x".repeat(5001) }), {
    statusCode: 400,
  });
  assert.deepEqual(validateComplaintReopen(undefined), {});
  assert.deepEqual(validateComplaintReopen({ reason: " Chưa ổn " }), {
    reason: "Chưa ổn",
  });
  assert.throws(() => validateComplaintReopen({ reason: "" }), {
    statusCode: 400,
  });
});
void test("list filters validate ticket statuses and range", () => {
  assert.deepEqual(
    validateFeedbackListQuery({
      page: "2",
      limit: "10",
      status: "IN_PROGRESS",
    }),
    { page: 2, limit: 10, status: "IN_PROGRESS" },
  );
  assert.throws(() =>
    validateFeedbackListQuery({ from: "2026-11-10", to: "2026-11-01" }),
  );
  for (const status of ["REJECTED", "SUBMITTED", "IN_REVIEW"])
    assert.throws(() => validateFeedbackListQuery({ status }));
});

const NOW = new Date("2026-11-20T03:00:00.000Z");
const row = (overrides: Record<string, unknown> = {}) => ({
  id: "c1",
  code: "FP-MC-58213",
  title: "Khiếu nại suất ăn lớp 5A - Bữa trưa ngày 19/11/2026",
  description: "Mô tả",
  status: "IN_PROGRESS",
  senderUserId: principal().id,
  lastResolvedAt: null,
  resolvedCount: 0,
  closeReason: null,
  closedAt: null,
  submittedAt: new Date("2026-11-19T01:00:00Z"),
  updatedAt: new Date("2026-11-19T01:00:00Z"),
  senderUser: { id: principal().id, fullName: "GV" },
  mealComplaint: {
    schoolId: principal().schoolId,
    complaintType: "OTHER",
    DailyMealPortion: {
      id: "p1",
      mealDate: new Date("2026-11-19T00:00:00Z"),
      mealType: "LUNCH",
      Class: { id: "k1", name: "5A", academicYear: "2026-2027" },
      MealAllocation: null,
    },
  },
  comments: [{ authorSide: "REQUESTER" }],
  ...overrides,
});

void test("hai lớp trạng thái: người gửi thấy Đang xử lý, BGH thấy nhãn tin nhắn mới", async () => {
  const service = createFeedbackService(
    {
      ...createFeedbackRepository(),
      list: () => Promise.resolve([row()]),
    } as never,
    () => Promise.resolve({} as never),
    () => NOW,
  );
  const [forBoard] = (await service.getAll({ page: 1, limit: 20 }, board()))
    .items;
  assert.equal(forBoard.status, "IN_PROGRESS");
  assert.equal(forBoard.displayStatus, "IN_PROGRESS");
  assert.equal(forBoard.hasNewMessage, true);
  assert.deepEqual(forBoard.allowedActions, ["COMMENT", "RESOLVE"]);
  assert.equal(forBoard.code, "FP-MC-58213");

  const [forSender] = (
    await service.getAll({ page: 1, limit: 20 }, principal())
  ).items;
  assert.equal(forSender.hasNewMessage, false);
  assert.deepEqual(forSender.allowedActions, ["COMMENT"]);
});

void test("lọc trạng thái: người gửi theo trạng thái hiển thị, BGH theo trạng thái thật", async () => {
  const seen: unknown[] = [];
  const service = createFeedbackService(
    {
      ...createFeedbackRepository(),
      list: (
        _db: unknown,
        _scope: unknown,
        _query: unknown,
        statuses?: unknown,
      ) => {
        seen.push(statuses);
        return Promise.resolve([]);
      },
    } as never,
    () => Promise.resolve({} as never),
    () => NOW,
  );
  const list = (status: string | undefined, actor: AuthPrincipal) =>
    service.getAll(
      { page: 1, limit: 20, ...(status ? { status: status as never } : {}) },
      actor,
    );
  await list("IN_PROGRESS", principal());
  await list("RESOLVED", principal({ role: "PARENTS_COMMITTEE" }));
  await list(undefined, principal());
  await list("IN_PROGRESS", board());
  await list("NEW", board());
  assert.deepEqual(seen, [
    ["NEW", "IN_PROGRESS", "REOPENED"],
    ["RESOLVED"],
    undefined,
    ["IN_PROGRESS"],
    ["NEW"],
  ]);
  for (const status of ["NEW", "REOPENED"])
    await assert.rejects(list(status, principal()), { statusCode: 400 });
  assert.equal(seen.length, 5);
});

void test("RESOLVED: người gửi có 48h để Hài lòng / Yêu cầu xử lý lại", async () => {
  const resolvedAt = new Date(NOW.getTime() - 47 * 3600 * 1000);
  const make = (lastResolvedAt: Date) =>
    createFeedbackService(
      {
        ...createFeedbackRepository(),
        findOne: () =>
          Promise.resolve(
            row({
              status: "RESOLVED",
              lastResolvedAt,
              resolvedCount: 1,
              comments: [],
            }),
          ),
      } as never,
      () => Promise.resolve({} as never),
      () => NOW,
    );
  const open = await make(resolvedAt).getOne("c1", principal());
  assert.equal(open.displayStatus, "RESOLVED");
  assert.deepEqual(open.allowedActions, ["SATISFY", "REOPEN"]);
  assert.equal(
    open.feedbackDeadlineAt,
    new Date(resolvedAt.getTime() + 48 * 3600 * 1000).toISOString(),
  );
  assert.deepEqual(open.comments, []);
  const expired = await make(new Date(NOW.getTime() - 48 * 3600 * 1000)).getOne(
    "c1",
    principal(),
  );
  assert.deepEqual(expired.allowedActions, []);
  const handlerView = await make(resolvedAt).getOne("c1", board());
  assert.deepEqual(handlerView.allowedActions, []);
});
