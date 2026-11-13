import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "../src/generated/prisma/client";
import {
  evaluateLifecyclePreflight,
  readLifecyclePreflight,
} from "../src/modules/account-lifecycle/account-lifecycle-data.repository";
import { createAccountLifecycleRouter } from "../src/modules/account-lifecycle/account-lifecycle.routes";
import { createAccountLifecycleRepository } from "../src/modules/account-lifecycle/account-lifecycle.repository";
import { lifecycleService, lifecycleAdmin } from "./helpers/account-lifecycle";

void test("setup creates the factory and router without connecting to infrastructure", () => {
  let connected = false;
  const repository = createAccountLifecycleRepository(() => {
    connected = true;
    throw new Error("unexpected connection");
  });
  assert.equal(typeof lifecycleService(repository).getLifecycle, "function");
  assert.equal(lifecycleAdmin().role, "SYSTEM_ADMIN");
  assert.equal(typeof createAccountLifecycleRouter(), "function");
  assert.equal(connected, false);
});

void test("preflight rejects duplicate officers and ambiguous internal recipients", () => {
  assert.deepEqual(
    evaluateLifecyclePreflight({
      duplicateUnits: 1,
      unresolvedUnits: 2,
      mismatchedRecipients: 3,
      invalidOfficers: 1,
    }),
    {
      ok: false,
      duplicateUnits: 1,
      unresolvedUnits: 2,
      mismatchedRecipients: 3,
      invalidOfficers: 1,
    },
  );
});

void test("preflight reads old schema without referencing the new recipient field", async () => {
  const queries: string[] = [];
  const tx = {
    $queryRaw: (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      queries.push(sql);
      return Promise.resolve(
        queries.length === 1
          ? [{ duplicateUnits: 0, unresolvedUnits: 1, invalidOfficers: 0 }]
          : [{ exists: false }],
      );
    },
  } as unknown as Prisma.TransactionClient;
  assert.equal((await readLifecyclePreflight(tx)).ok, false);
  assert.equal(queries.length, 2);
  assert.match(queries[0], /recipient_commune_food_safety_unit_id IS NOT NULL/);
  assert.doesNotMatch(queries[0], /f\.recipient_user_id/);
  for (const sql of queries) {
    assert.doesNotMatch(sql, /\b(UPDATE|INSERT|DELETE|ALTER)\b/i);
    assert.doesNotMatch(sql, /forwarded_at|received_at/i);
  }
});

void test("preflight detects mismatched recipient on the upgraded schema", async () => {
  let calls = 0;
  const tx = {
    $queryRaw: () => {
      calls += 1;
      return Promise.resolve(
        calls === 1
          ? [{ duplicateUnits: 0, unresolvedUnits: 0, invalidOfficers: 0 }]
          : calls === 2
            ? [{ exists: true }]
            : [{ count: 1 }],
      );
    },
  } as unknown as Prisma.TransactionClient;
  assert.deepEqual(await readLifecyclePreflight(tx), {
    ok: false,
    duplicateUnits: 0,
    unresolvedUnits: 0,
    mismatchedRecipients: 1,
    invalidOfficers: 0,
  });
});

void test("preflight accepts data without ambiguous internal recipients", () => {
  // External reports and historical receipt timestamps are not evidence of an
  // internal assignment conflict and must not be synthesized by the check.
  assert.deepEqual(
    evaluateLifecyclePreflight({
      duplicateUnits: 0,
      unresolvedUnits: 0,
      mismatchedRecipients: 0,
      invalidOfficers: 0,
    }),
    {
      ok: true,
      duplicateUnits: 0,
      unresolvedUnits: 0,
      mismatchedRecipients: 0,
      invalidOfficers: 0,
    },
  );
});

void test("preflight rejects an active officer without a valid membership", () => {
  assert.equal(
    evaluateLifecyclePreflight({
      duplicateUnits: 0,
      unresolvedUnits: 0,
      mismatchedRecipients: 0,
      invalidOfficers: 1,
    }).ok,
    false,
  );
});
