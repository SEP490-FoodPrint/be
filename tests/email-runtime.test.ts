import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import type { PrismaClient } from "../src/generated/prisma/client";
import { startEmailRuntime } from "../src/utils/email-runtime";

type Dependencies = NonNullable<Parameters<typeof startEmailRuntime>[1]>;
function fixture() {
  const db = {} as PrismaClient;
  const queue = new EventEmitter() as ReturnType<Dependencies["createQueue"]>;
  const worker = new EventEmitter() as ReturnType<Dependencies["createWorker"]>;
  const events: string[] = [];
  const logs: unknown[] = [];
  let tick = () => {};
  let dispatchCalls = 0;
  let operation: () => Promise<void> = () => Promise.resolve();
  const dependencies: Dependencies = {
    createQueue: () => queue,
    createWorker: (client) => {
      assert.equal(client, db);
      return worker;
    },
    dispatch: async (client, target) => {
      assert.equal(client, db);
      assert.equal(target, queue);
      dispatchCalls++;
      await operation();
    },
    closeWorker: (target) => {
      assert.equal(target, worker);
      events.push("worker");
      return Promise.resolve();
    },
    closeQueue: (target) => {
      assert.equal(target, queue);
      events.push("queue");
      return Promise.resolve();
    },
    schedule: (callback) => {
      tick = callback;
      return () => {
        events.push("cancel");
      };
    },
    logError: (message, details) => {
      logs.push({ message, details });
    },
  };
  return {
    db,
    queue,
    worker,
    dependencies,
    events,
    logs,
    tick: () => tick(),
    calls: () => dispatchCalls,
    dispatch: (next: () => Promise<void>) => {
      operation = next;
    },
  };
}
const drain = () => new Promise<void>((resolve) => setImmediate(resolve));

void test("email runtime dispatches immediately, deduplicates active ticks and waits before closing worker/queue", async () => {
  const f = fixture();
  let finish!: () => void;
  f.dispatch(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const runtime = await startEmailRuntime(f.db, f.dependencies);
  assert.equal(f.calls(), 1);
  f.tick();
  f.tick();
  assert.equal(f.calls(), 1);
  const stop = runtime.stop();
  assert.equal(runtime.stop(), stop);
  f.tick();
  assert.deepEqual(f.events, ["cancel"]);
  finish();
  await stop;
  assert.deepEqual(f.events, ["cancel", "worker", "queue"]);
  f.tick();
  assert.equal(f.calls(), 1);
});

void test("email runtime recovers from dispatcher failure without exposing raw errors", async () => {
  const f = fixture();
  f.dispatch(() => Promise.reject(new Error("private provider details")));
  const runtime = await startEmailRuntime(f.db, f.dependencies);
  await drain();
  assert.equal(f.logs.length, 1);
  assert.ok(!JSON.stringify(f.logs).includes("private"));
  f.dispatch(() => Promise.resolve());
  f.tick();
  await drain();
  assert.equal(f.calls(), 2);
  await runtime.stop();
});

void test("email runtime closes the queue even if worker shutdown fails", async () => {
  const f = fixture();
  f.dependencies.closeWorker = () => {
    f.events.push("worker");
    return Promise.reject(new Error("close failed"));
  };
  const runtime = await startEmailRuntime(f.db, f.dependencies);
  await assert.rejects(runtime.stop(), /close failed/);
  await assert.rejects(runtime.stop(), /close failed/);
  assert.deepEqual(f.events, ["cancel", "worker", "queue"]);
});

void test("email runtime cleans partially started resources on worker or timer construction failure", async () => {
  const f = fixture();
  f.dependencies.createWorker = () => {
    throw new Error("worker failed");
  };
  await assert.rejects(
    startEmailRuntime(f.db, f.dependencies),
    /worker failed/,
  );
  assert.deepEqual(f.events, ["queue"]);
  const timer = fixture();
  timer.dependencies.schedule = () => {
    throw new Error("timer failed");
  };
  await assert.rejects(
    startEmailRuntime(timer.db, timer.dependencies),
    /timer failed/,
  );
  assert.deepEqual(timer.events, ["worker", "queue"]);
});

void test("email runtime logs sanitized connection/job failures without payloads", async () => {
  const f = fixture();
  const runtime = await startEmailRuntime(f.db, f.dependencies);
  f.queue.emit("error", new Error("private Redis URL"));
  f.worker.emit("error", new Error("private worker details"));
  (f.worker as EventEmitter).emit(
    "failed",
    { data: { id: "private payload" } },
    new Error("private email"),
  );
  assert.equal(f.logs.length, 3);
  assert.ok(!JSON.stringify(f.logs).includes("private"));
  await runtime.stop();
});
