import assert from "node:assert/strict";
import test from "node:test";
import {
  backfillBusinessCodes,
  type BackfillAllocator,
  type BackfillType,
  type BusinessCodeBackfillRepository,
} from "../src/utils/business-code-backfill";

interface FakeRow {
  id: string;
  code: string | null;
}

function harness(rows: Record<BackfillType, FakeRow[]>) {
  let transactions = 0;
  const lockCalls: Array<{ type: BackfillType; take: number }> = [];
  const allocateCalls: Array<{ type: BackfillType; count: number }> = [];
  const counters: Record<BackfillType, number> = { MC: 0, IC: 0 };
  const tx = {} as never;
  const repository: BusinessCodeBackfillRepository = {
    transaction: async (operation) => {
      transactions++;
      return operation(tx);
    },
    lockUncoded: (_tx, type, take) => {
      lockCalls.push({ type, take });
      return Promise.resolve(
        rows[type]
          .filter((row) => row.code === null)
          .slice(0, take)
          .map((row) => row.id),
      );
    },
    existingCodes: (_tx, type, codes) =>
      Promise.resolve(
        new Set(
          rows[type]
            .map((row) => row.code)
            .filter(
              (code): code is string => code !== null && codes.includes(code),
            ),
        ),
      ),
    assignCode: (_tx, type, id, code) => {
      const row = rows[type].find((item) => item.id === id);
      if (!row || row.code !== null) return Promise.resolve(0);
      row.code = code;
      return Promise.resolve(1);
    },
  };
  const allocate: BackfillAllocator = async (_tx, type, count, exists) => {
    allocateCalls.push({ type, count });
    const result: string[] = [];
    while (result.length < count) {
      counters[type]++;
      const code = `FP-${type}-${String(counters[type] * 7).padStart(5, "0")}`;
      if (!(await exists([code])).has(code)) result.push(code);
    }
    return result;
  };
  return {
    repository,
    allocate,
    lockCalls,
    allocateCalls,
    transactions: () => transactions,
  };
}

const makeRows = (prefix: string, count: number, coded: number[] = []) =>
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    code: coded.includes(index)
      ? `FP-${prefix}-${String(90000 + index).padStart(5, "0")}`
      : null,
  }));

void test("backfill chỉ gán mã cho dòng code IS NULL, theo lô, mỗi lô một transaction", async () => {
  const rows = { MC: makeRows("MC", 5, [1]), IC: makeRows("IC", 2) };
  const keep = rows.MC[1].code;
  const h = harness(rows);
  const result = await backfillBusinessCodes(h.repository, {
    batchSize: 2,
    allocate: h.allocate,
  });
  assert.deepEqual(result, { MC: 4, IC: 2 });
  assert.equal(rows.MC[1].code, keep);
  for (const type of ["MC", "IC"] as const) {
    for (const row of rows[type])
      assert.match(row.code ?? "", new RegExp(`^FP-${type}-[0-9]{5}$`));
    assert.equal(
      new Set(rows[type].map((row) => row.code)).size,
      rows[type].length,
    );
  }
  // MC: 4 dòng thiếu mã với lô 2 → 2 lô đầy + 1 lô rỗng; IC: 1 lô đầy + 1 lô rỗng.
  assert.deepEqual(h.allocateCalls, [
    { type: "MC", count: 2 },
    { type: "MC", count: 2 },
    { type: "IC", count: 2 },
  ]);
  assert.equal(h.transactions(), 5);
  assert(h.lockCalls.every((call) => call.take === 2));
});

void test("backfill idempotent: chạy lần hai gán 0 dòng và không cấp mã", async () => {
  const rows = { MC: makeRows("MC", 3), IC: makeRows("IC", 0) };
  const h = harness(rows);
  assert.deepEqual(
    await backfillBusinessCodes(h.repository, { allocate: h.allocate }),
    { MC: 3, IC: 0 },
  );
  const snapshot = rows.MC.map((row) => row.code);
  const allocationsAfterFirst = h.allocateCalls.length;
  assert.deepEqual(
    await backfillBusinessCodes(h.repository, { allocate: h.allocate }),
    { MC: 0, IC: 0 },
  );
  assert.deepEqual(
    rows.MC.map((row) => row.code),
    snapshot,
  );
  assert.equal(h.allocateCalls.length, allocationsAfterFirst);
});

void test("backfill từ chối kích thước lô không hợp lệ", async () => {
  const h = harness({ MC: [], IC: [] });
  for (const batchSize of [0, -1, 1.5]) {
    await assert.rejects(
      backfillBusinessCodes(h.repository, { batchSize, allocate: h.allocate }),
      RangeError,
    );
  }
});
