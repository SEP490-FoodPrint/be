import assert from "node:assert/strict";
import test from "node:test";
import {
  validateCreateComplaint,
  validateFeedbackListQuery,
  validateRespondComplaint,
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

void test("GVCN list scope is own complaints in own school", () => {
  const actor = principal();
  assert.deepEqual(listScopes.feedback(actor), {
    DailyMealPortion: { Class: { schoolId: actor.schoolId } },
    submittedByUserId: actor.id,
  });
});
void test("đại diện phụ huynh chỉ đọc đơn của mình", () => {
  const actor = principal({ role: "PARENTS_COMMITTEE" });
  assert.deepEqual(listScopes.feedback(actor), {
    DailyMealPortion: { Class: { schoolId: actor.schoolId } },
    submittedByUserId: actor.id,
  });
  assert.throws(() => listScopes.feedback({ ...actor, permissions: [] }), {
    statusCode: 403,
  });
});
void test("BGH list scope is school-wide", () => {
  const actor = principal({
    role: "SCHOOL_MANAGEMENT_BOARD",
    permissions: ["meal_complaint.view", "meal_complaint.respond"],
  });
  assert.deepEqual(listScopes.feedback(actor), {
    DailyMealPortion: { Class: { schoolId: actor.schoolId } },
  });
});
void test("create rejects server-owned fields", () => {
  const valid = {
    dailyMealPortionId: "10000000-0000-4000-8000-000000000020",
    complaintType: "MEAL_QUALITY",
    description: "Suất ăn có mùi bất thường.",
  };
  assert.deepEqual(validateCreateComplaint(valid), valid);
  assert.throws(() =>
    validateCreateComplaint({ ...valid, submittedByUserId: principal().id }),
  );
  assert.throws(() =>
    validateCreateComplaint({ ...valid, status: "RESOLVED" }),
  );
});
void test("response action validation enforces lifecycle input", () => {
  assert.throws(() => validateRespondComplaint({ action: "RESOLVE" }));
  assert.throws(() =>
    validateRespondComplaint({
      action: "START_REVIEW",
      resolution: "Không hợp lệ",
    }),
  );
  assert.deepEqual(
    validateRespondComplaint({
      action: "RESOLVE",
      resolution: "Đã thay đổi nhà cung cấp suất ăn.",
    }),
    { action: "RESOLVE", resolution: "Đã thay đổi nhà cung cấp suất ăn." },
  );
});
void test("list filters validate enums and range", () => {
  assert.deepEqual(
    validateFeedbackListQuery({ page: "2", limit: "10", status: "IN_REVIEW" }),
    { page: 2, limit: 10, status: "IN_REVIEW" },
  );
  assert.throws(() =>
    validateFeedbackListQuery({ from: "2026-11-10", to: "2026-11-01" }),
  );
  assert.throws(() => validateFeedbackListQuery({ status: "REJECTED" }));
});

process.env.BUSINESS_CODE_KEY ||=
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

void test("tạo khiếu nại cấp mã FP-MC Feistel trong cùng transaction và lưu vào cột code", async () => {
  const calls: string[] = [];
  let createdData: Record<string, unknown> | undefined;
  const tx = {
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      if (sql.includes("pg_advisory_xact_lock")) {
        calls.push(`lock:${String(values[0])}`);
        return Promise.resolve([{ locked: 1 }]);
      }
      calls.push(`counter:${String(values[0])}`);
      return Promise.resolve([{ lastSequence: 1 }]);
    },
    mealComplaint: {
      findMany: () => {
        calls.push("exists");
        return Promise.resolve([]);
      },
      create: ({ data }: { data: Record<string, unknown> }) => {
        createdData = data;
        return Promise.resolve({ id: "c1", ...data });
      },
    },
  };
  const repository = createFeedbackRepository();
  const code = await repository.allocateMealComplaintCode(tx as never);
  assert.match(code, /^FP-MC-[0-9]{5}$/);
  assert.notEqual(code, "FP-MC-00001");
  assert.deepEqual(calls, [
    "lock:foodprint:business-code:MC",
    "counter:MC",
    "exists",
  ]);
  await repository.create(tx as never, {
    code,
    dailyMealPortionId: "20000000-0000-4000-8000-000000000001",
    submittedByUserId: "10000000-0000-4000-8000-000000000001",
    complaintType: "OTHER",
    description: "Cơm nguội",
  });
  assert.equal(createdData?.code, code);
  assert.equal(createdData?.status, "SUBMITTED");
});

void test("danh sách và chi tiết khiếu nại trả code, null với bản ghi cũ", async () => {
  const row = (id: string, code: string | null) => ({
    id,
    code,
    complaintType: "OTHER",
    description: "Mô tả",
    status: "SUBMITTED",
    submittedAt: new Date("2026-11-19T01:00:00Z"),
    updatedAt: new Date("2026-11-19T01:00:00Z"),
    resolvedAt: null,
    resolution: null,
    submittedByUser: { id: "u1", fullName: "GV" },
    handledByUser: null,
    DailyMealPortion: {
      id: "p1",
      mealDate: new Date("2026-11-19T00:00:00Z"),
      mealType: "LUNCH",
      Class: { id: "k1", name: "5A", academicYear: "2026-2027" },
      MealAllocation: null,
    },
  });
  const rows = [row("a", "FP-MC-58213"), row("b", null)];
  const service = createFeedbackService(
    {
      ...createFeedbackRepository(),
      list: () => Promise.resolve(rows),
      findOne: () => Promise.resolve(rows[1]),
    } as never,
    () => Promise.resolve({} as never),
  );
  const viewer = principal({ role: "SCHOOL_MANAGEMENT_BOARD" });
  const list = await service.getAll({ page: 1, limit: 20 }, viewer);
  assert.deepEqual(
    list.items.map((item) => item.code),
    ["FP-MC-58213", null],
  );
  assert.equal(Object.keys(list.items[0])[1], "code");
  assert.equal((await service.getOne("b", viewer)).code, null);
});
