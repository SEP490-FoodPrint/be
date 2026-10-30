import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpError } from "../src/utils/http-error";
import {
  validateApprovalPayload,
  validateMenuId,
  validateRevisionPayload,
} from "../src/modules/menu/menu.validation";
import {
  aggregateDayStatus,
  decisionTargets,
} from "../src/modules/menu/menu-approval";

void test("day decisions cannot affect other days or days already decided", () => {
  const days = [
    { id: "monday", approvalStatus: "PENDING_APPROVAL" as const },
    { id: "tuesday", approvalStatus: "PENDING_APPROVAL" as const },
    { id: "wednesday", approvalStatus: "APPROVED" as const },
    { id: "thursday", approvalStatus: "REVISION_REQUIRED" as const },
  ];
  assert.deepEqual(
    decisionTargets(days, "monday").map((day) => day.id),
    ["monday"],
  );
  assert.deepEqual(
    decisionTargets(days).map((day) => day.id),
    ["monday", "tuesday"],
  );
  assert.throws(
    () => decisionTargets(days, "outside-week"),
    (error: unknown) => error instanceof HttpError && error.statusCode === 404,
  );
  assert.throws(
    () => decisionTargets(days, "wednesday"),
    (error: unknown) => error instanceof HttpError && error.statusCode === 409,
  );
});

void test("week is approved only after all days, and revisions never become approvals", () => {
  assert.equal(
    aggregateDayStatus([
      { id: "monday", approvalStatus: "APPROVED" },
      { id: "tuesday", approvalStatus: "PENDING_APPROVAL" },
    ]),
    "PENDING_APPROVAL",
  );
  assert.equal(
    aggregateDayStatus([
      { id: "monday", approvalStatus: "APPROVED" },
      { id: "tuesday", approvalStatus: "REVISION_REQUIRED" },
    ]),
    "REVISION_REQUIRED",
  );
  assert.equal(
    aggregateDayStatus([
      { id: "monday", approvalStatus: "APPROVED" },
      { id: "tuesday", approvalStatus: "APPROVED" },
    ]),
    "APPROVED",
  );
  assert.equal(aggregateDayStatus([]), "PENDING_APPROVAL");
});

void test("decision payload preserves day scope and rejects malformed scope", () => {
  const menuDayId = "00000045-0000-4000-8000-000000000001";
  assert.deepEqual(validateApprovalPayload({ menuDayId, notes: " Đồng ý " }), {
    menuDayId,
    notes: "Đồng ý",
  });
  assert.deepEqual(
    validateRevisionPayload({ menuDayId, reason: " Sửa món " }),
    { menuDayId, reason: "Sửa món" },
  );
  for (const value of [null, "", 1, [], "not-a-uuid"]) {
    assert.throws(() => validateApprovalPayload({ menuDayId: value }));
    assert.throws(() =>
      validateRevisionPayload({ menuDayId: value, reason: "Sửa món" }),
    );
  }
});

void test("menu approval validates UUID path parameters", () => {
  const id = "43000000-0000-4000-8000-000000000001";
  assert.equal(validateMenuId(id), id);
  assert.throws(
    () => validateMenuId("not-a-menu-id"),
    (error: unknown) => error instanceof HttpError && error.statusCode === 400,
  );
});

void test("approval notes are optional, trimmed and bounded", () => {
  assert.deepEqual(validateApprovalPayload(undefined), {});
  assert.deepEqual(validateApprovalPayload({ notes: "  Đồng ý  " }), {
    notes: "Đồng ý",
  });
  for (const body of [{ notes: 1 }, { notes: "x".repeat(2001) }, []]) {
    assert.throws(
      () => validateApprovalPayload(body),
      (error: unknown) =>
        error instanceof HttpError && error.statusCode === 400,
    );
  }
});

void test("revision reason is required, trimmed and bounded", () => {
  assert.deepEqual(validateRevisionPayload({ reason: "  Điều chỉnh món  " }), {
    reason: "Điều chỉnh món",
  });
  for (const body of [
    undefined,
    {},
    { reason: " " },
    { reason: 1 },
    { reason: "x".repeat(2001) },
  ]) {
    assert.throws(
      () => validateRevisionPayload(body),
      (error: unknown) =>
        error instanceof HttpError && error.statusCode === 400,
    );
  }
});
