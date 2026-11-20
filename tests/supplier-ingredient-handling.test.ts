import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "../src/generated/prisma/client";
import { isDryDelivery } from "../src/modules/delivery/delivery.service";
import type { ingredientHandlingRepository } from "../src/modules/supplier-onboarding/supplier-onboarding.repository";
import {
  contractHandlingItems,
  createIngredientHandlingService,
  syncIngredientEntries,
} from "../src/modules/supplier-onboarding/supplier-onboarding.service";
import {
  contractPayload,
  validateIngredientHandlingBody,
} from "../src/modules/supplier-onboarding/supplier-onboarding.validation";
import type { AuthPrincipal } from "../src/types/auth";
import { HttpError } from "../src/utils/http-error";
import { RequestValidationError } from "../src/utils/request-validation";
import { testStaff } from "./helpers/authorization";

type HandlingType = "DRY_STOCK" | "DIRECT_USE";
type Entry = {
  id: string;
  ingredientId: string;
  handlingType: HandlingType;
  status: "ACTIVE" | "INACTIVE";
};

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const supplierId = uuid(100);
const rice = uuid(201);
const salt = uuid(202);
const fish = uuid(203);
const tx = {} as Prisma.TransactionClient;
const manager: AuthPrincipal = {
  ...testStaff,
  role: "SCHOOL_MANAGEMENT_BOARD",
  permissions: ["supplier_relationship.manage"],
};
const schoolId = manager.schoolId!;

function fakeRepository(options: {
  entries?: Entry[];
  scope?: { ingredientId: string; name: string }[];
  pending?: string[];
}) {
  const entries = [...(options.entries ?? [])];
  const events: { action: string; reason: string }[] = [];
  const created: string[] = [];
  const pendingQueries: string[][] = [];
  const repository = {
    findEntries: (_tx: unknown, school: string, ids: string[]) => {
      assert.equal(school, schoolId);
      return Promise.resolve(
        entries.filter((entry) => ids.includes(entry.ingredientId)),
      );
    },
    createEntries: (
      _tx: unknown,
      school: string,
      actorId: string,
      items: { ingredientId: string; handlingType: HandlingType }[],
    ) => {
      assert.equal(school, schoolId);
      assert.equal(actorId, manager.id);
      for (const item of items) {
        created.push(item.ingredientId);
        entries.push({
          id: `entry-${item.ingredientId}`,
          ingredientId: item.ingredientId,
          handlingType: item.handlingType,
          status: "ACTIVE",
        });
      }
      return Promise.resolve({ count: items.length });
    },
    updateEntry: (_tx: unknown, id: string, handlingType: HandlingType) => {
      const entry = entries.find((row) => row.id === id)!;
      entry.handlingType = handlingType;
      entry.status = "ACTIVE";
      return Promise.resolve({ id });
    },
    activeContractItems: () =>
      Promise.resolve(
        (options.scope ?? []).map((row) => ({
          ingredientId: row.ingredientId,
          ingredient: {
            name: row.name,
            defaultUnit: "kg",
            ingredientCategory: null,
          },
          contract: {
            id: uuid(300),
            number: "HD-01",
            startsOn: new Date("2026-01-01"),
            endsOn: new Date("2026-12-31"),
            relationshipId: uuid(400),
          },
        })),
      ),
    pendingDeliveries: (_tx: unknown, _school: string, ids: string[]) => {
      pendingQueries.push(ids);
      return Promise.resolve(
        (options.pending ?? []).map((deliveryNo) => ({ deliveryNo })),
      );
    },
    createEvent: (
      _tx: unknown,
      data: { action: string; reason: string; relationshipId: string },
    ) => {
      assert.equal(data.relationshipId, uuid(400));
      events.push({ action: data.action, reason: data.reason });
      return Promise.resolve({ id: "event" });
    },
  } as unknown as typeof ingredientHandlingRepository;
  return { repository, entries, events, created, pendingQueries };
}

function service(repository: typeof ingredientHandlingRepository) {
  let writes = 0;
  const handling = createIngredientHandlingService({
    repository,
    write: (_principal, actualSupplier, operation) => {
      writes += 1;
      assert.equal(actualSupplier, supplierId);
      return operation(tx, manager, schoolId);
    },
  });
  return { ...handling, writes: () => writes };
}

void test("contract draft payload requires a handling type for every ingredient", () => {
  const ok = contractPayload(
    {
      supplierId,
      items: [
        { ingredientId: rice, handlingType: "DRY_STOCK" },
        { ingredientId: fish, handlingType: "DIRECT_USE" },
      ],
    },
    true,
  );
  assert.deepEqual(ok.ingredientIds, [rice, fish]);
  assert.equal(ok.items[1].handlingType, "DIRECT_USE");

  for (const items of [
    [{ ingredientId: rice }],
    [{ ingredientId: rice, handlingType: "FRESH" }],
    [
      { ingredientId: rice, handlingType: "DRY_STOCK" },
      { ingredientId: rice, handlingType: "DIRECT_USE" },
    ],
    undefined,
  ])
    assert.throws(
      () => contractPayload({ supplierId, items }, true),
      RequestValidationError,
    );
  assert.throws(
    () => contractPayload({ supplierId, ingredientIds: [rice] }, true),
    (error: unknown) => error instanceof HttpError && error.statusCode === 400,
  );
  assert.throws(
    () => validateIngredientHandlingBody({ items: [] }),
    RequestValidationError,
  );
});

void test("activation rejects contract lines without a handling type", () => {
  assert.throws(
    () =>
      contractHandlingItems([
        { ingredientId: rice, handlingType: "DRY_STOCK" },
        { ingredientId: salt, handlingType: null },
      ]),
    (error: unknown) => error instanceof HttpError && error.statusCode === 409,
  );
  assert.deepEqual(
    contractHandlingItems([{ ingredientId: rice, handlingType: "DRY_STOCK" }]),
    [{ ingredientId: rice, handlingType: "DRY_STOCK" }],
  );
});

void test("activation creates missing entries and updates existing ones without duplicates", async () => {
  const fake = fakeRepository({
    entries: [
      {
        id: "entry-salt",
        ingredientId: salt,
        handlingType: "DIRECT_USE",
        status: "INACTIVE",
      },
    ],
  });
  const changes = await syncIngredientEntries(
    tx,
    schoolId,
    manager.id,
    [
      { ingredientId: rice, handlingType: "DRY_STOCK" },
      { ingredientId: salt, handlingType: "DRY_STOCK" },
    ],
    fake.repository,
  );
  assert.deepEqual(fake.created, [rice]);
  assert.equal(fake.entries.length, 2);
  assert.deepEqual(
    fake.entries.map((entry) => [
      entry.ingredientId,
      entry.handlingType,
      entry.status,
    ]),
    [
      [salt, "DRY_STOCK", "ACTIVE"],
      [rice, "DRY_STOCK", "ACTIVE"],
    ],
  );
  assert.equal(changes.length, 2);

  const again = await syncIngredientEntries(
    tx,
    schoolId,
    manager.id,
    [{ ingredientId: rice, handlingType: "DRY_STOCK" }],
    fake.repository,
  );
  assert.deepEqual(again, []);
  assert.deepEqual(fake.created, [rice]);
});

void test("handling update is limited to contract managers", async () => {
  const fake = fakeRepository({ scope: [{ ingredientId: rice, name: "Gạo" }] });
  const handling = service(fake.repository);
  for (const actor of [
    { ...manager, permissions: [] },
    { ...manager, role: "SCHOOL_KITCHEN_STAFF" },
  ])
    await assert.rejects(
      handling.updateIngredientHandling(
        actor,
        { supplierId },
        { items: [{ ingredientId: rice, handlingType: "DIRECT_USE" }] },
      ),
      (error: unknown) =>
        error instanceof HttpError && error.statusCode === 403,
    );
  assert.equal(handling.writes(), 0);
});

void test("handling update rejects ingredients outside the active contract", async () => {
  const fake = fakeRepository({
    scope: [{ ingredientId: rice, name: "Gạo" }],
    entries: [
      {
        id: "entry-rice",
        ingredientId: rice,
        handlingType: "DRY_STOCK",
        status: "ACTIVE",
      },
    ],
  });
  await assert.rejects(
    service(fake.repository).updateIngredientHandling(
      manager,
      { supplierId },
      {
        items: [
          { ingredientId: rice, handlingType: "DIRECT_USE" },
          { ingredientId: fish, handlingType: "DIRECT_USE" },
        ],
      },
    ),
    (error: unknown) => error instanceof HttpError && error.statusCode === 409,
  );
  assert.equal(fake.entries[0].handlingType, "DRY_STOCK");
  assert.equal(fake.events.length, 0);
});

void test("handling update is blocked while an arrived or pending delivery carries the ingredient", async () => {
  const fake = fakeRepository({
    scope: [{ ingredientId: rice, name: "Gạo" }],
    entries: [
      {
        id: "entry-rice",
        ingredientId: rice,
        handlingType: "DRY_STOCK",
        status: "ACTIVE",
      },
    ],
    pending: ["DLV-001"],
  });
  await assert.rejects(
    service(fake.repository).updateIngredientHandling(
      manager,
      { supplierId },
      { items: [{ ingredientId: rice, handlingType: "DIRECT_USE" }] },
    ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 409 &&
      error.message.includes("DLV-001"),
  );
  assert.deepEqual(fake.pendingQueries, [[rice]]);
  assert.equal(fake.entries[0].handlingType, "DRY_STOCK");
  assert.equal(fake.events.length, 0);
});

void test("handling update saves once, writes one event and reclassifies upcoming deliveries", async () => {
  const fake = fakeRepository({
    scope: [
      { ingredientId: rice, name: "Gạo" },
      { ingredientId: salt, name: "Muối" },
    ],
    entries: [
      {
        id: "entry-rice",
        ingredientId: rice,
        handlingType: "DRY_STOCK",
        status: "ACTIVE",
      },
      {
        id: "entry-salt",
        ingredientId: salt,
        handlingType: "DRY_STOCK",
        status: "ACTIVE",
      },
    ],
  });
  const [riceEntry, saltEntry] = fake.entries;
  const upcoming = {
    deliveryItems: [
      { IngredientEntry: riceEntry, SupplyRequestItem: null },
      { IngredientEntry: saltEntry, SupplyRequestItem: null },
    ],
  };
  assert.equal(isDryDelivery(upcoming), true);

  const handling = service(fake.repository);
  const result = await handling.updateIngredientHandling(
    manager,
    { supplierId },
    {
      items: [
        { ingredientId: rice, handlingType: "DIRECT_USE" },
        { ingredientId: salt, handlingType: "DRY_STOCK" },
      ],
    },
  );
  assert.equal(handling.writes(), 1);
  assert.deepEqual(result.changes, [
    { ingredientId: rice, from: "DRY_STOCK", to: "DIRECT_USE", name: "Gạo" },
  ]);
  assert.deepEqual(fake.pendingQueries, [[rice]]);
  assert.deepEqual(fake.events, [
    {
      action: "INGREDIENT_HANDLING_CHANGED",
      reason: "Gạo: Lưu kho → Dùng ngay",
    },
  ]);
  assert.equal(isDryDelivery(upcoming), false);

  const unchanged = await handling.updateIngredientHandling(
    manager,
    { supplierId },
    { items: [{ ingredientId: rice, handlingType: "DIRECT_USE" }] },
  );
  assert.deepEqual(unchanged.changes, []);
  assert.equal(fake.events.length, 1);
});
