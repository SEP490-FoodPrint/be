import assert from "node:assert/strict";
import test from "node:test";
import {
  validateCreateComplaint,
  validateFeedbackListQuery,
  validateRespondComplaint,
} from "../src/modules/feedback/feedback.validation";
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
    MealAllocation: {
      DailyMealPortion: { Class: { schoolId: actor.schoolId } },
    },
    submittedByUserId: actor.id,
  });
});
void test("BGH list scope is school-wide", () => {
  const actor = principal({
    role: "SCHOOL_MANAGEMENT_BOARD",
    permissions: ["meal_complaint.view", "meal_complaint.respond"],
  });
  assert.deepEqual(listScopes.feedback(actor), {
    MealAllocation: {
      DailyMealPortion: { Class: { schoolId: actor.schoolId } },
    },
  });
});
void test("create rejects server-owned fields", () => {
  const valid = {
    mealAllocationId: "10000000-0000-4000-8000-000000000020",
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
