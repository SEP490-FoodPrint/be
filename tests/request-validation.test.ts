import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { HttpError } from "../src/utils/http-error";
import { parseRequest } from "../src/utils/request-validation";

void test("request validation returns normalized data and rejects all reported fields", () => {
  const schema = z.strictObject({
    name: z.string().trim().min(1, "Bắt buộc"),
    count: z.number().int("Phải là số nguyên").nonnegative("Không được âm"),
  });
  assert.deepEqual(parseRequest(schema, { name: "  Lớp 3A1  ", count: 2 }), {
    name: "Lớp 3A1",
    count: 2,
  });
  assert.throws(
    () => parseRequest(schema, { name: "", count: -1, schoolId: "secret" }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /name: Bắt buộc/);
      assert.match(error.message, /count: Không được âm/);
      assert.match(error.message, /request:/);
      assert.doesNotMatch(error.message, /secret/);
      return true;
    },
  );
});
