import assert from "node:assert/strict";
import { test } from "node:test";
import { formatFpCode, reserveFpCodes } from "../src/utils/fp-code";

void test("formatFpCode: FP-<2 chữ>-<5 chữ số>, quá 5 chữ số thì giữ nguyên", () => {
  assert.equal(formatFpCode("LO", 1n), "FP-LO-00001");
  assert.equal(formatFpCode("CB", 42n), "FP-CB-00042");
  assert.equal(formatFpCode("SU", 123456n), "FP-SU-123456");
  assert.throws(() => formatFpCode("BG", 0n), RangeError);
});

void test("reserveFpCodes khóa theo loại mã, đọc số lớn nhất và cấp dãy liên tiếp", async () => {
  const calls: string[] = [];
  const db = {
    $queryRaw: (
      first: TemplateStringsArray | { sql: string; values: unknown[] },
      ...values: unknown[]
    ) => {
      if (Array.isArray(first)) {
        calls.push(`lock:${String(values[0])}`);
        return Promise.resolve([{ locked: 1 }]);
      }
      const query = first as { sql: string; values: unknown[] };
      calls.push(`max:${query.values.join(",")}`);
      assert.ok(query.sql.includes("foodprint.cooking_batches"));
      return Promise.resolve([{ maxSeq: "9" }]);
    },
  };
  const codes = await reserveFpCodes(db as never, "CB", 3);
  assert.deepEqual(codes, ["FP-CB-00010", "FP-CB-00011", "FP-CB-00012"]);
  assert.deepEqual(calls, [
    "lock:foodprint:fp-code:CB",
    "max:^FP-CB-[0-9]{5,}$",
  ]);
  // Chưa có mã nào đúng dạng: bắt đầu từ 00001; không cần mã thì không truy vấn.
  const empty = { $queryRaw: () => Promise.resolve([]) };
  assert.deepEqual(await reserveFpCodes(empty as never, "LO", 1), [
    "FP-LO-00001",
  ]);
  assert.deepEqual(await reserveFpCodes(db as never, "LO", 0), []);
});
