import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import {
  processNextAllocationDraft,
  queueAllocationDraft,
} from "../src/modules/meal-allocation/material-allocation-runtime";
import { createMaterialAllocationService } from "../src/modules/meal-allocation/material-allocation.service";
import { validateAllocationDraft } from "../src/modules/meal-allocation/meal-allocation.validation";
import type { AllocationDay } from "../src/modules/meal-allocation/meal-allocation.repository";
import { HttpError } from "../src/utils/http-error";
import { testStaff } from "./helpers/authorization";
import { fixture } from "./helpers/allocation-day-fixture";

const date = "2026-11-12";
const mealDate = new Date(date);
const lunchKey = `school|${+mealDate}|LUNCH`;

interface Row {
  schoolId: string;
  mealDate: Date;
  mealType: string;
  state: string;
  revision: string;
  sourceRevision?: string | null;
  plan?: unknown;
  error?: string | null;
}
type Loose = Record<string, unknown>;

function asMeal(day: AllocationDay, mealType: string) {
  const copy = structuredClone(day) as unknown as {
    menus: { menuDayDishes: { mealType: string }[] }[];
    demands: { mealType: string }[];
    batches: { mealType: string }[];
  };
  copy.menus.forEach((m) =>
    m.menuDayDishes.forEach((d) => (d.mealType = mealType)),
  );
  copy.demands.forEach((d) => (d.mealType = mealType));
  copy.batches.forEach((b) => (b.mealType = mealType));
  return copy as unknown as AllocationDay;
}

/** In-memory stand-in for the draft table and the sources the worker reads. */
function fakeDb(current: AllocationDay) {
  const state = { current };
  const rows = new Map<string, Row>();
  const id = (r: { schoolId: string; mealDate: Date; mealType: string }) =>
    `${r.schoolId}|${+r.mealDate}|${r.mealType}`;
  const match = (row: Row, where: Loose) =>
    Object.entries(where).every(([k, v]) => {
      if (k === "OR") return true;
      const actual = (row as unknown as Loose)[k];
      return actual instanceof Date ? +actual === +(v as Date) : actual === v;
    });
  const table = {
    findUnique: ({ where }: { where: { schoolId_mealDate_mealType: Row } }) =>
      Promise.resolve(rows.get(id(where.schoolId_mealDate_mealType)) ?? null),
    findFirst: () =>
      Promise.resolve(
        [...rows.values()].find((r) => r.state === "PENDING") ?? null,
      ),
    createMany: ({ data }: { data: Row }) => {
      if (rows.has(id(data))) return Promise.resolve({ count: 0 });
      rows.set(id(data), { ...data });
      return Promise.resolve({ count: 1 });
    },
    updateMany: ({ where, data }: { where: Loose; data: Partial<Row> }) => {
      const hit = [...rows.values()].filter((r) => match(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return Promise.resolve({ count: hit.length });
    },
    deleteMany: ({ where }: { where: Loose }) => {
      const hit = [...rows.entries()].filter(([, r]) => match(r, where));
      hit.forEach(([k]) => rows.delete(k));
      return Promise.resolve({ count: hit.length });
    },
  };
  const tx = {
    menuDay: { findMany: () => Promise.resolve(state.current.menus) },
    cookingBatch: { findMany: () => Promise.resolve(state.current.batches) },
    dailyMealPortion: {
      findMany: () => Promise.resolve(state.current.demands),
    },
    mealAllocationDraft: table,
    $queryRaw: () => Promise.resolve([]),
  };
  const db = {
    ...tx,
    $transaction: (fn: (t: typeof tx) => unknown) => Promise.resolve(fn(tx)),
  };
  return {
    rows,
    state,
    tx: tx as unknown as Prisma.TransactionClient,
    db: db as unknown as PrismaClient,
  };
}
type Fake = ReturnType<typeof fakeDb>;

const markSaved = (day: AllocationDay) =>
  ((day.demands[0] as unknown as Loose).MealAllocation = {
    id: "a",
    status: "ALLOCATED",
    mealAllocationBatches: [],
  });

void test("two concurrent sample saves enqueue exactly one draft per meal", async () => {
  const f = fakeDb(fixture());
  await Promise.all([
    queueAllocationDraft(f.tx, "school", mealDate, "LUNCH"),
    queueAllocationDraft(f.tx, "school", mealDate, "LUNCH"),
  ]);
  assert.equal(f.rows.size, 1);
});

void test("lunch and afternoon jobs are independent", async () => {
  const f = fakeDb(fixture());
  await queueAllocationDraft(f.tx, "school", mealDate, "LUNCH");
  assert.deepEqual(
    [...f.rows.values()].map((r) => r.mealType),
    ["LUNCH"],
  );
  f.state.current = asMeal(fixture(), "AFTERNOON");
  await queueAllocationDraft(f.tx, "school", mealDate, "AFTERNOON");
  assert.deepEqual([...f.rows.values()].map((r) => r.mealType).sort(), [
    "AFTERNOON",
    "LUNCH",
  ]);
  const unsampled = asMeal(fixture(), "AFTERNOON");
  unsampled.batches[0].dishes[0].retainedFoodSamples = [];
  const g = fakeDb(unsampled);
  await queueAllocationDraft(g.tx, "school", mealDate, "AFTERNOON");
  assert.equal(g.rows.size, 0);
});

void test("a meal that already has a saved allocation is never queued", async () => {
  const day = fixture();
  markSaved(day);
  const f = fakeDb(day);
  await queueAllocationDraft(f.tx, "school", mealDate, "LUNCH");
  assert.equal(f.rows.size, 0);
});

function worker(f: Fake, solve: () => Promise<unknown>) {
  let solved = 0;
  const deps = {
    read: () =>
      Promise.resolve({ day: f.state.current, batches: [], allocations: [] }),
    solve: () => {
      solved += 1;
      return solve();
    },
  };
  return {
    run: () => processNextAllocationDraft(f.db, deps as never),
    solved: () => solved,
  };
}

async function queued() {
  const f = fakeDb(fixture());
  await queueAllocationDraft(f.tx, "school", mealDate, "LUNCH");
  return f;
}

void test("worker stores the solver result as the DRAFT for its source revision", async () => {
  const f = await queued();
  const w = worker(f, () => Promise.resolve({ entries: [], groups: [] }));
  assert.equal(await w.run(), true);
  const row = f.rows.get(lunchKey)!;
  assert.equal(row.state, "DRAFT");
  assert.equal(w.solved(), 1);
  assert.equal((row.plan as { revision: string }).revision, row.sourceRevision);
  assert.equal(await w.run(), false, "a finished draft is not recomputed");
  assert.equal(w.solved(), 1);
});

void test("a result computed from stale data never overwrites a newer state", async () => {
  const f = await queued();
  await worker(f, () => {
    f.state.current.demands[0].totalPortions += 1; // sources move while solving
    return Promise.resolve({ entries: [] });
  }).run();
  const row = f.rows.get(lunchKey)!;
  assert.equal(row.state, "PENDING");
  assert.ok(!row.plan, "stale plan was not written");
});

void test("an allocation or draft created meanwhile is kept", async () => {
  const f = await queued();
  await worker(f, () => {
    markSaved(f.state.current); // staff applied while the solver was running
    return Promise.resolve({ entries: [] });
  }).run();
  assert.equal(f.rows.size, 0, "nothing queued or overwritten");

  const g = await queued();
  await worker(g, () => {
    g.rows.set(lunchKey, { ...g.rows.get(lunchKey)!, revision: "staff" });
    return Promise.resolve({ entries: [] });
  }).run();
  assert.equal(g.rows.get(lunchKey)!.revision, "staff");
  assert.ok(!g.rows.get(lunchKey)!.plan, "worker lease no longer matches");
});

void test("a solver failure marks the job FAILED with a readable reason", async () => {
  const f = await queued();
  await worker(f, () =>
    Promise.reject(new HttpError(409, "Không đủ nguyên liệu")),
  ).run();
  const row = f.rows.get(lunchKey)!;
  assert.equal(row.state, "FAILED");
  assert.equal(row.error, "Không đủ nguyên liệu");
});

void test("opening the page only reads: no writes and no solver", async () => {
  const day = fixture();
  const writes: string[] = [];
  const sources: Loose = {
    menuDay: day.menus,
    cookingBatch: day.batches,
    dailyMealPortion: day.demands,
  };
  const table = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) => () => {
          if (/^(create|update|upsert|delete)/.test(method))
            writes.push(`${name}.${method}`);
          if (name === "mealAllocationDraft" && method === "findUnique")
            return Promise.resolve({ state: "PENDING", revision: "r" });
          if (method === "findMany")
            return Promise.resolve(sources[name] ?? []);
          return Promise.resolve(null);
        },
      },
    );
  const tx = new Proxy({}, { get: (_t, name: string) => table(name) });
  const connect = () =>
    Promise.resolve({
      $transaction: (fn: (t: unknown) => unknown) => Promise.resolve(fn(tx)),
    } as unknown as PrismaClient);
  const service = createMaterialAllocationService(connect);
  const base = {
    status: "READY",
    date,
    mealType: "LUNCH",
    supportsMaterialAllocation: false,
    distribution: { canConfirmDistribution: false },
    grades: [],
  };
  const view = await service.getToday(testStaff, { mealType: "LUNCH" }, {
    getToday: () => Promise.resolve(base),
  } as never);
  assert.deepEqual(writes, []);
  assert.equal((view as unknown as Loose).materialPlanPending, true);
  // Khi GLPK chưa xong, nhân viên vẫn phân bổ tay được từ bảng trống.
  assert.equal((view as unknown as Loose).materialEditing, true);
  assert.ok(Array.isArray((view as unknown as Loose).editorGrades));
  assert.ok((view as unknown as Loose).draftRevision);
});

void test("draft payloads are validated: decimal strings only, legacy planId rejected", () => {
  const row = {
    demandId: "11111111-1111-4111-8111-111111111111",
    dishId: "22222222-2222-4222-8222-222222222222",
    batchId: "33333333-3333-4333-8333-333333333333",
    allocatedPortions: "28.00",
  };
  const ok = { mealType: "LUNCH", revision: "a".repeat(64), rows: [row] };
  assert.equal(
    validateAllocationDraft(ok).rows?.[0].allocatedPortions,
    "28.00",
  );
  assert.throws(
    () => validateAllocationDraft({ ...ok, planId: "b".repeat(64) }),
    { statusCode: 400 },
  );
  assert.throws(
    () =>
      validateAllocationDraft({
        ...ok,
        rows: [{ ...row, allocatedPortions: 28 }],
      }),
    { statusCode: 400 },
  );
});

void test("GLPK suggestion needs permission before any connection", async () => {
  let connected = false;
  const service = createMaterialAllocationService(() => {
    connected = true;
    throw new Error("unexpected connection");
  });
  await assert.rejects(
    () =>
      service.suggest({ mealType: "LUNCH" }, { ...testStaff, permissions: [] }),
    { statusCode: 403 },
  );
  assert.equal(connected, false);
});
