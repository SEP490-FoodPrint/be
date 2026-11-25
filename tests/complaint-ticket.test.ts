import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "../src/generated/prisma/client";
import {
  allowedTicketActions,
  assertTicketAction,
  displayStatus,
  FEEDBACK_WINDOW_MS,
  feedbackDeadline,
  hasNewMessage,
  TICKET_STATUSES,
} from "../src/modules/complaint-ticket/complaint-ticket.lifecycle";
import {
  createComplaintTicketRepository,
  type ComplaintTicketRepository,
} from "../src/modules/complaint-ticket/complaint-ticket.repository";
import {
  autoCloseExpiredComplaints,
  startComplaintAutoCloseRuntime,
} from "../src/utils/complaint-auto-close";

const NOW = new Date("2026-11-20T03:00:00.000Z");
const hoursAgo = (hours: number) =>
  new Date(NOW.getTime() - hours * 3600 * 1000);

void test("allowed actions follow the approved transition table", () => {
  const expected: Record<string, { REQUESTER: string[]; HANDLER: string[] }> = {
    NEW: { REQUESTER: ["COMMENT"], HANDLER: ["ACCEPT"] },
    IN_PROGRESS: { REQUESTER: ["COMMENT"], HANDLER: ["COMMENT", "RESOLVE"] },
    REOPENED: { REQUESTER: ["COMMENT"], HANDLER: ["ACCEPT"] },
    RESOLVED: { REQUESTER: ["SATISFY", "REOPEN"], HANDLER: [] },
    CLOSED: { REQUESTER: [], HANDLER: [] },
  };
  for (const status of TICKET_STATUSES) {
    const state = {
      status,
      lastResolvedAt: status === "RESOLVED" ? hoursAgo(1) : null,
    };
    assert.deepEqual(
      allowedTicketActions("REQUESTER", state, NOW),
      expected[status].REQUESTER,
      status,
    );
    assert.deepEqual(
      allowedTicketActions("HANDLER", state, NOW),
      expected[status].HANDLER,
      status,
    );
    assert.deepEqual(allowedTicketActions("OBSERVER", state, NOW), []);
  }
});

void test("48h window: open before deadline, closed at and after it", () => {
  const state = { status: "RESOLVED" as const, lastResolvedAt: hoursAgo(48) };
  assert.equal(
    feedbackDeadline(state)?.getTime(),
    state.lastResolvedAt.getTime() + FEEDBACK_WINDOW_MS,
  );
  assert.deepEqual(allowedTicketActions("REQUESTER", state, NOW), []);
  assert.throws(() => assertTicketAction("REQUESTER", state, "REOPEN", NOW), {
    statusCode: 409,
  });
  const fresh = {
    ...state,
    lastResolvedAt: new Date(hoursAgo(48).getTime() + 1),
  };
  assert.doesNotThrow(() =>
    assertTicketAction("REQUESTER", fresh, "SATISFY", NOW),
  );
  assert.equal(
    feedbackDeadline({ status: "IN_PROGRESS", lastResolvedAt: hoursAgo(1) }),
    null,
  );
});

void test("two display layers and the new-message label", () => {
  assert.deepEqual(
    TICKET_STATUSES.map((status) => displayStatus("REQUESTER", status)),
    ["IN_PROGRESS", "IN_PROGRESS", "IN_PROGRESS", "RESOLVED", "CLOSED"],
  );
  assert.deepEqual(
    TICKET_STATUSES.map((status) => displayStatus("HANDLER", status)),
    [...TICKET_STATUSES],
  );
  assert.equal(hasNewMessage("HANDLER", "IN_PROGRESS", "REQUESTER"), true);
  assert.equal(hasNewMessage("HANDLER", "IN_PROGRESS", "HANDLER"), false);
  assert.equal(hasNewMessage("HANDLER", "NEW", "REQUESTER"), false);
  assert.equal(hasNewMessage("REQUESTER", "IN_PROGRESS", "REQUESTER"), false);
});

void test("transition writes conditional update + history, or reports a lost race", async () => {
  const updates: unknown[] = [];
  const histories: unknown[] = [];
  let count = 1;
  const tx = {
    complaint: {
      updateMany: (args: unknown) => {
        updates.push(args);
        return Promise.resolve({ count });
      },
    },
    complaintStatusHistory: {
      create: (args: unknown) => {
        histories.push(args);
        return Promise.resolve({});
      },
    },
  };
  const repository = createComplaintTicketRepository();
  const actor = { userId: "u1", roleCode: "PARENTS_COMMITTEE" };
  const cutoff = hoursAgo(48);
  assert.equal(
    await repository.transition(tx as never, {
      complaintId: "c1",
      kind: "MEAL",
      fromStatus: "RESOLVED",
      toStatus: "CLOSED",
      closeReason: "SATISFIED",
      resolvedAfter: cutoff,
      actor,
      now: NOW,
    }),
    true,
  );
  assert.deepEqual(updates[0], {
    where: {
      id: "c1",
      kind: "MEAL",
      status: "RESOLVED",
      lastResolvedAt: { gt: cutoff },
    },
    data: {
      status: "CLOSED",
      closeReason: "SATISFIED",
      closedAt: NOW,
      closedByUserId: "u1",
    },
  });
  assert.deepEqual(histories[0], {
    data: {
      complaintId: "c1",
      fromStatus: "RESOLVED",
      toStatus: "CLOSED",
      closeReason: "SATISFIED",
      actorType: "USER",
      actorUserId: "u1",
      actorRoleCode: "PARENTS_COMMITTEE",
    },
  });
  count = 0;
  assert.equal(
    await repository.transition(tx as never, {
      complaintId: "c1",
      kind: "MEAL",
      fromStatus: "IN_PROGRESS",
      toStatus: "RESOLVED",
      markResolved: true,
      actor,
      now: NOW,
    }),
    false,
  );
  assert.deepEqual((updates[1] as { data: unknown }).data, {
    status: "RESOLVED",
    lastResolvedAt: NOW,
    resolvedCount: { increment: 1 },
  });
  assert.equal(histories.length, 1);
});

void test("auto-close closes due tickets in batches, skips those already changed", async () => {
  const due = ["a", "b", "c"];
  const closed: string[] = [];
  const cutoffs: Date[] = [];
  let transactions = 0;
  const repository: ComplaintTicketRepository = {
    ...createComplaintTicketRepository(),
    findDueResolved: (_db, cutoff, take) => {
      cutoffs.push(cutoff);
      return Promise.resolve(
        due.filter((id) => !closed.includes(id)).slice(0, take),
      );
    },
    autoClose: (_tx, id) => {
      // "b" đã được người gửi yêu cầu xử lý lại trước khi job chạy.
      if (id === "b") {
        due.splice(due.indexOf("b"), 1);
        return Promise.resolve(false);
      }
      closed.push(id);
      return Promise.resolve(true);
    },
  };
  const db = {
    $transaction: <T>(op: (tx: unknown) => Promise<T>) => {
      transactions++;
      return op({});
    },
  } as unknown as PrismaClient;
  const count = await autoCloseExpiredComplaints(db, {
    now: () => NOW,
    batchSize: 2,
    repository,
  });
  assert.equal(count, 2);
  assert.deepEqual(closed, ["a", "c"]);
  assert.equal(transactions, 2);
  assert.equal(cutoffs[0].toISOString(), hoursAgo(48).toISOString());
});

void test("auto-close runtime never overlaps runs and stop waits for the active run", async () => {
  let tick: () => void = () => undefined;
  let runs = 0;
  let release: () => void = () => undefined;
  let cancelled = false;
  const runtime = startComplaintAutoCloseRuntime({} as PrismaClient, {
    run: () => {
      runs++;
      return new Promise<number>((resolve) => {
        release = () => resolve(0);
      });
    },
    schedule: (next) => {
      tick = next;
      return () => {
        cancelled = true;
      };
    },
    logError: () => undefined,
  });
  tick();
  tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 1);
  const stopped = runtime.stop();
  release();
  await stopped;
  assert.equal(cancelled, true);
  tick();
  assert.equal(runs, 1);
});
