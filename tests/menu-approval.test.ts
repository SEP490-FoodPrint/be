import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpError } from "../src/utils/http-error";
import {
  validateApprovalPayload,
  validateMenuId,
  validateRevisionPayload,
} from "../src/modules/menu/menu.validation";

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
