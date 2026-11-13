import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDeliveryInspectionService,
  deliveryInspectionRoles,
} from "../src/modules/delivery/delivery.service";
import { validateDeliveryInspectionQuery } from "../src/modules/delivery/delivery.validation";
import { testStaff } from "./helpers/authorization";
import { Prisma, type PrismaClient } from "../src/generated/prisma/client";
import { principalFromIdentity } from "../src/utils/authorization";
import { validateDeliveryInspectionDecision } from "../src/modules/delivery/delivery.validation";
import express, { type RequestHandler } from "express";
import { createDeliveryRouter } from "../src/modules/delivery/delivery.routes";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import { startHttp } from "./helpers/http";
import type { AuthPrincipal } from "../src/types/auth";

const id = "11111111-1111-4111-8111-111111111111";
const row = (deliveryId = id) => ({
  id: deliveryId,
  deliveryNo: "D1",
  supplyRequestId: id,
  status: "ARRIVED",
  expectedArrivalAt: new Date("2026-11-13T01:00:00Z"),
  arrivedAt: null,
  receivedAt: null,
  vehiclePlate: null,
  note: null,
  Supplier: { name: "Supplier" },
  SupplyRequest: {
    requestNo: "SR1",
    schoolId: testStaff.schoolId,
    supplierId: id,
  },
  deliveryApprovals: [],
});

void test("all four school inspection roles read scoped deliveries, filtered counts and their own role", async () => {
  for (const role of deliveryInspectionRoles) {
    const principal = { ...testStaff, role, permissions: ["delivery.view"] };
    const database = {
      delivery: {
        findMany: ({
          where,
          skip,
          take,
        }: {
          where: { SupplyRequest: { schoolId: string }; AND: unknown[] };
          skip: number;
          take: number;
        }) => {
          assert.equal(where.SupplyRequest.schoolId, principal.schoolId);
          assert.equal(where.AND.length, 2);
          assert.equal(skip, 10);
          assert.equal(take, 10);
          assert.match(JSON.stringify(where), /2026-11-12T17:00:00.000Z/);
          return Promise.resolve([row()]);
        },
        groupBy: () =>
          Promise.resolve([{ status: "ARRIVED", _count: { _all: 12 } }]),
      },
    };
    const service = createDeliveryInspectionService(
      () => Promise.resolve(database as never),
      () => new Date("2026-11-12T18:00:00Z"),
    );
    const result = await service.list(
      validateDeliveryInspectionQuery({
        page: "2",
        limit: "10",
        search: " Supplier ",
        period: "today",
      }),
      principal,
    );
    assert.equal(result.items[0].currentRole, role);
    assert.equal(result.items[0].requiredRoles.length, 4);
    assert.equal(result.pagination.totalItems, 12);
    assert.equal(result.pagination.hasNext, false);
    assert.equal(result.stats.arrived, 12);
    assert.equal("schoolId" in result.items[0], false);
  }
});

void test("inspection detail keeps separate delivery identities and serializes actual lot quantities", async () => {
  const principal = {
    ...testStaff,
    role: "PARENTS_COMMITTEE",
    permissions: ["delivery.view"],
  };
  const otherId = "22222222-2222-4222-8222-222222222222";
  const service = createDeliveryInspectionService(() =>
    Promise.resolve({
      delivery: {
        findFirst: ({
          where,
        }: {
          where: { id: string; SupplyRequest: { schoolId: string } };
        }) => {
          assert.equal(where.SupplyRequest.schoolId, principal.schoolId);
          return Promise.resolve({
            ...row(where.id),
            deliveryItems: [
              {
                id,
                actualQuantity: "6.125",
                unit: "kg",
                SupplyRequestItem: {
                  IngredientEntry: {
                    Ingredient: { name: "Rice", ingredientCategory: null },
                  },
                },
                ingredientLots: [
                  {
                    id,
                    lotCode: "LOT",
                    qrToken: "opaque",
                    SourceFacility: null,
                    manufactureDate: null,
                    expiryDate: null,
                    receivedQuantity: "6.125",
                    unit: "kg",
                    status: "BLOCKED",
                  },
                ],
              },
            ],
          });
        },
      },
    } as never),
  );
  const first = await service.detail(id, principal);
  const second = await service.detail(otherId, principal);
  assert.notEqual(first.id, second.id);
  assert.equal(first.supplyRequestId, second.supplyRequestId);
  assert.equal(first.deliveryItems?.[0].actualQuantity, "6.125");
  assert.equal(first.deliveryItems?.[0].ingredientLots[0].status, "BLOCKED");
});

void test("inspection rejects foreign organizations, wrong roles and missing permissions before database access", async () => {
  const service = createDeliveryInspectionService(() => {
    throw new Error("Must not connect");
  });
  const query = validateDeliveryInspectionQuery({});
  for (const principal of [
    testStaff,
    { ...testStaff, permissions: ["delivery.view"], role: "HOMEROOM_TEACHER" },
    {
      ...testStaff,
      permissions: ["delivery.view"],
      orgType: "SUPPLIER" as const,
    },
  ]) {
    await assert.rejects(() => service.list(query, principal), {
      statusCode: 403,
    });
  }
  assert.throws(() => validateDeliveryInspectionQuery({ schoolId: id }));
  assert.throws(() => validateDeliveryInspectionQuery({ status: "FAKE" }));
  assert.throws(() => validateDeliveryInspectionQuery({ limit: "101" }));
});

void test("inspection detail hides other schools and sanitizes database failures", async () => {
  const principal = { ...testStaff, permissions: ["delivery.view"] };
  const missing = createDeliveryInspectionService(() =>
    Promise.resolve({
      delivery: { findFirst: () => Promise.resolve(null) },
    } as never),
  );
  await assert.rejects(() => missing.detail(id, principal), {
    statusCode: 404,
  });
  const unavailable = createDeliveryInspectionService(() =>
    Promise.reject(new Error("postgres://private:secret@remote")),
  );
  await assert.rejects(
    () => unavailable.detail(id, principal),
    (error: unknown) => {
      assert.equal((error as { statusCode: number }).statusCode, 503);
      assert.doesNotMatch((error as Error).message, /private|secret|remote/);
      return true;
    },
  );
});

function decisionFixture() {
  const uid = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const identities = deliveryInspectionRoles.map((role, index) => ({
    id: uid(index + 1),
    username: role,
    fullName: role,
    status: "ACTIVE",
    roleId: uid(index + 10),
    schoolId: uid(20),
    supplierId: null,
    communeFoodSafetyUnitId: null,
    permissionDenials: [],
    Role: {
      code: role,
      type: "SCHOOL",
      rolePermissions: ["delivery.view", "delivery.inspect"].map((code) => ({
        permission: { code, isActive: true },
      })),
    },
  }));
  const actors = identities.map((identity) =>
    principalFromIdentity(identity as never),
  );
  const roleCodes = new Map(
    identities.map((identity) => [identity.roleId, identity.Role.code]),
  );
  type Decision = {
    id: string;
    deliveryId: string;
    userId: string;
    roleId: string;
    decision: "APPROVE" | "REJECT";
    reason: string | null;
  };
  type Lot = {
    id: string;
    quantity: string;
    available: string;
    status: string;
    expiry: string | null;
  };
  type Delivery = {
    id: string;
    status: string;
    lots: Lot[];
    actual: string;
    wrongSchool: boolean;
    wrongSupplier: boolean;
  };
  const data = {
    requestStatus: "IN_PROGRESS",
    requestedQuantity: "12.250",
    decisions: [] as Decision[],
    receipts: [] as { ingredientLotId: string; quantity: string }[],
    deliveries: [30, 31, 32, 33].map((n) => ({
      id: uid(n),
      status: "ARRIVED",
      lots: [
        {
          id: uid(n + 10),
          quantity: "6.125",
          available: "0",
          status: "BLOCKED",
          expiry: "2027-01-01",
        },
      ],
      actual: "6.125",
      wrongSchool: false,
      wrongSupplier: false,
    })) as Delivery[],
  };
  let failReceipt = false;
  const snapshot = (delivery: Delivery) => ({
    ...row(delivery.id),
    supplierId: uid(21),
    supplyRequestId: uid(22),
    status: delivery.status,
    SupplyRequest: {
      requestNo: "SHARED-ORDER",
      schoolId: uid(20),
      supplierId: uid(21),
      status: data.requestStatus,
      _count: {
        deliveries: new Set(
          data.decisions
            .filter((d) => d.decision === "REJECT")
            .map((d) => d.deliveryId),
        ).size,
      },
    },
    deliveryApprovals: data.decisions
      .filter((d) => d.deliveryId === delivery.id)
      .map((d) => ({
        ...d,
        decidedAt: new Date("2026-11-13T01:00:00Z"),
        Role: {
          code: roleCodes.get(d.roleId)!,
          name: "Department",
        },
        User: { fullName: d.userId },
      })),
    deliveryItems: [
      {
        id: uid(23),
        supplyRequestItemId: uid(24),
        actualQuantity: new Prisma.Decimal(delivery.actual),
        unit: "kg",
        SupplyRequestItem: {
          supplyRequestId: uid(22),
          requestedQuantity: new Prisma.Decimal(data.requestedQuantity),
          unit: "kg",
          IngredientEntry: {
            schoolId: delivery.wrongSchool ? uid(999) : uid(20),
            Ingredient: {
              supplierId: delivery.wrongSupplier ? uid(999) : uid(21),
              name: "Rice",
              ingredientCategory: null,
            },
          },
        },
        ingredientLots: delivery.lots.map((lot) => ({
          id: lot.id,
          receivedQuantity: new Prisma.Decimal(lot.quantity),
          availableQuantity: new Prisma.Decimal(lot.available),
          unit: "kg",
          status: lot.status,
          manufactureDate: null,
          expiryDate: lot.expiry ? new Date(lot.expiry) : null,
          SourceFacility: null,
        })),
      },
    ],
  });
  const tx = {
    user: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(identities.find((u) => u.id === where.id)),
    },
    school: { findUnique: () => Promise.resolve({ status: "ACTIVE" }) },
    $queryRaw: () => Promise.resolve([]),
    delivery: {
      findFirst: ({
        where,
        select,
      }: {
        where: { id: string; SupplyRequest: { schoolId: string } };
        select: { supplyRequestId?: boolean; deliveryItems?: unknown };
      }) => {
        assert.equal(where.SupplyRequest.schoolId, uid(20));
        const found = data.deliveries.find((d) => d.id === where.id);
        return Promise.resolve(
          found
            ? select.deliveryItems
              ? snapshot(found)
              : { supplyRequestId: uid(22) }
            : null,
        );
      },
      update: ({
        where,
        data: changes,
      }: {
        where: { id: string };
        data: { status: string };
      }) => {
        Object.assign(
          data.deliveries.find((d) => d.id === where.id)!,
          changes,
        );
        return Promise.resolve({});
      },
      count: () =>
        Promise.resolve(
          new Set(
            data.decisions
              .filter((d) => d.decision === "REJECT")
              .map((d) => d.deliveryId),
          ).size,
        ),
      updateMany: ({ where }: { where: { status: { in: string[] } } }) => {
        for (const delivery of data.deliveries)
          if (where.status.in.includes(delivery.status))
            delivery.status = "CANCELLED";
        return Promise.resolve({ count: 1 });
      },
    },
    deliveryApproval: {
      create: ({ data: decision }: { data: Omit<Decision, "id"> }) => {
        data.decisions.push({
          ...decision,
          id: uid(data.decisions.length + 100),
        });
        return Promise.resolve({});
      },
    },
    deliveryItem: {
      findMany: () =>
        Promise.resolve(
          data.deliveries
            .filter((delivery) => delivery.status === "RECEIVED")
            .map((delivery) => ({
              actualQuantity: new Prisma.Decimal(delivery.actual),
              unit: "kg",
            })),
        ),
    },
    inventoryTransaction: {
      count: ({ where }: { where: { ingredientLotId: { in: string[] } } }) =>
        Promise.resolve(
          data.receipts.filter((r) =>
            where.ingredientLotId.in.includes(r.ingredientLotId),
          ).length,
        ),
      create: ({
        data: receipt,
      }: {
        data: { ingredientLotId: string; quantity: Prisma.Decimal };
      }) => {
        if (failReceipt) throw new Error("write failed");
        data.receipts.push({
          ingredientLotId: receipt.ingredientLotId,
          quantity: receipt.quantity.toString(),
        });
        return Promise.resolve({});
      },
    },
    ingredientLot: {
      updateMany: ({
        where,
        data: changes,
      }: {
        where: { id?: string };
        data: { availableQuantity?: Prisma.Decimal; status: string };
      }) => {
        const lots = data.deliveries.flatMap((d) => d.lots);
        if (!where.id) {
          for (const delivery of data.deliveries.filter(
            (d) => d.status !== "RECEIVED",
          ))
            for (const lot of delivery.lots)
              if (lot.status === "AVAILABLE") lot.status = "BLOCKED";
          return Promise.resolve({ count: 1 });
        }
        const lot = lots.find((l) => l.id === where.id)!;
        if (lot.available !== "0" || lot.status !== "BLOCKED")
          return Promise.resolve({ count: 0 });
        lot.available = changes.availableQuantity!.toString();
        lot.status = changes.status;
        return Promise.resolve({ count: 1 });
      },
    },
    supplyRequest: {
      update: () => {
        data.requestStatus = "CANCELLED";
        return Promise.resolve({});
      },
    },
  };
  let queue = Promise.resolve();
  const db = {
    ...tx,
    $transaction: async <T>(operation: (client: typeof tx) => Promise<T>) => {
      const previous = queue;
      let release!: () => void;
      queue = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      const before = structuredClone(data);
      try {
        return await operation(tx);
      } catch (error) {
        Object.assign(data, before);
        throw error;
      } finally {
        release();
      }
    },
  } as unknown as PrismaClient;
  return {
    data,
    actors,
    identities,
    service: createDeliveryInspectionService(
      () => Promise.resolve(db),
      () => new Date("2026-11-13T02:00:00Z"),
    ),
    failReceipt: () => {
      failReceipt = true;
    },
  };
}
const approve = () =>
  validateDeliveryInspectionDecision({ decision: "APPROVE" });
const reject = () =>
  validateDeliveryInspectionDecision({
    decision: "REJECT",
    reason: "Damaged packaging",
  });

void test("two deliveries require eight independent role decisions and receive stock once per lot", async () => {
  const f = decisionFixture();
  for (const delivery of f.data.deliveries.slice(0, 2)) {
    for (const actor of f.actors.slice(0, 3)) {
      const result = await f.service.decide(delivery.id, approve(), actor);
      assert.equal(result.status, "PENDING_APPROVAL");
      assert.equal(delivery.lots[0].available, "0");
    }
    assert.equal(
      (await f.service.decide(delivery.id, approve(), f.actors[3])).status,
      "RECEIVED",
    );
    assert.equal(delivery.lots[0].available, "6.125");
  }
  assert.equal(f.data.decisions.length, 8);
  assert.equal(f.data.receipts.length, 2);
  const replay = await f.service.decide(
    f.data.deliveries[0].id,
    approve(),
    f.actors[3],
  );
  assert.equal(replay.created, false);
  assert.equal(f.data.receipts.length, 2);
  await assert.rejects(
    () => f.service.decide(f.data.deliveries[0].id, reject(), f.actors[3]),
    { statusCode: 409 },
  );
});

void test("concurrent callers on one delivery cannot receive stock twice", async () => {
  const f = decisionFixture(),
    deliveryId = f.data.deliveries[0].id;
  await Promise.all(
    f.actors.map((actor) => f.service.decide(deliveryId, approve(), actor)),
  );
  await Promise.all([
    f.service.decide(deliveryId, approve(), f.actors[3]),
    f.service.decide(deliveryId, approve(), f.actors[3]),
  ]);
  assert.equal(f.data.receipts.length, 1);
  assert.equal(f.data.decisions.length, 4);
});

void test("third distinct rejection across the two delivery rounds cancels the remaining order without changing received stock", async () => {
  const f = decisionFixture();
  const accepted = f.data.deliveries[3];
  for (const actor of f.actors)
    await f.service.decide(accepted.id, approve(), actor);
  for (const delivery of f.data.deliveries.slice(0, 2)) {
    await f.service.decide(delivery.id, reject(), f.actors[0]);
    await f.service.decide(delivery.id, reject(), f.actors[0]);
    assert.equal(f.data.requestStatus, "IN_PROGRESS");
  }
  const result = await f.service.decide(
    f.data.deliveries[2].id,
    reject(),
    f.actors[2],
  );
  assert.equal(result.redeliveryRequiredCount, 3);
  assert.match(result.cancellationNotice!, /vượt quá 2/);
  assert.equal(f.data.requestStatus, "CANCELLED");
  assert.equal(accepted.status, "RECEIVED");
  assert.equal(accepted.lots[0].available, "6.125");
  assert.equal(f.data.receipts.length, 1);
  await assert.rejects(
    () => f.service.decide(f.data.deliveries[1].id, approve(), f.actors[1]),
    { statusCode: 409 },
  );
});

void test("invalid lot totals, ownership and expiry roll back the final approval without any receipt", async () => {
  for (const invalid of [
    "quantity",
    "school",
    "supplier",
    "expiry",
    "history",
    "stock-write",
    "over-request",
  ]) {
    const f = decisionFixture(),
      delivery = f.data.deliveries[0];
    for (const actor of f.actors.slice(0, 3))
      await f.service.decide(delivery.id, approve(), actor);
    if (invalid === "quantity") delivery.actual = "7";
    if (invalid === "over-request") f.data.requestedQuantity = "6";
    if (invalid === "school") delivery.wrongSchool = true;
    if (invalid === "supplier") delivery.wrongSupplier = true;
    if (invalid === "expiry") delivery.lots[0].expiry = "2026-11-12";
    if (invalid === "history")
      f.data.receipts.push({
        ingredientLotId: delivery.lots[0].id,
        quantity: "1",
      });
    if (invalid === "stock-write") f.failReceipt();
    await assert.rejects(() =>
      f.service.decide(delivery.id, approve(), f.actors[3]),
    );
    assert.equal(f.data.decisions.length, 3);
    assert.equal(f.data.deliveries[0].status, "PENDING_APPROVAL");
    assert.equal(f.data.deliveries[0].lots[0].available, "0");
    assert.equal(f.data.receipts.length, invalid === "history" ? 1 : 0);
  }
});

void test("decision bodies reject forged actors and require a rejection reason; live revoked permissions fail before mutation", async () => {
  assert.throws(() =>
    validateDeliveryInspectionDecision({ decision: "APPROVE", roleId: id }),
  );
  assert.throws(() =>
    validateDeliveryInspectionDecision({ decision: "REJECT", reason: "  " }),
  );
  const f = decisionFixture();
  f.identities[0].Role.rolePermissions =
    f.identities[0].Role.rolePermissions.filter(
      (r) => r.permission.code !== "delivery.inspect",
    );
  await assert.rejects(
    () => f.service.decide(f.data.deliveries[0].id, approve(), f.actors[0]),
    { statusCode: 403 },
  );
  assert.equal(f.data.decisions.length, 0);
  assert.equal(f.data.receipts.length, 0);
});

void test("HTTP inspection endpoints validate actors, expose the shared four-role contract and keep immutable decisions", async (t) => {
  const f = decisionFixture();
  let principal: AuthPrincipal | undefined = f.actors[0];
  const authenticate: RequestHandler = (req, _res, next) => {
    req.auth = principal;
    next();
  };
  const app = express();
  app.use(express.json());
  app.use(
    "/deliveries",
    createDeliveryRouter(undefined, authenticate, f.service),
  );
  app.use(globalErrorHandler);
  const http = await startHttp(app);
  t.after(() => http.close());
  const path = `/deliveries/${f.data.deliveries[0].id}/inspection`;
  const post = (body: unknown) =>
    http.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await post({ decision: "APPROVE", roleId: f.actors[1].roleId })).status,
    400,
  );
  assert.equal((await post({ decision: "REJECT", reason: " " })).status, 400);
  for (const actor of f.actors) {
    principal = actor;
    const detail = await http.request(path);
    assert.equal(detail.status, 200);
    assert.equal(
      (detail.body as { data: { currentRole: string } }).data.currentRole,
      actor.role,
    );
    assert.equal((await post({ decision: "APPROVE" })).status, 200);
  }
  assert.equal(f.data.receipts.length, 1);
  assert.equal((await post({ decision: "APPROVE" })).status, 200);
  assert.equal(
    (await post({ decision: "REJECT", reason: "Changed" })).status,
    409,
  );
  principal = undefined;
  assert.equal((await http.request(path)).status, 401);
});

void test("pre-arrival and cancelled deliveries reject inspection and another user cannot sign an existing role decision", async () => {
  for (const status of [
    "CREATED",
    "IN_TRANSIT",
    "CANCELLED",
    "REJECTED",
    "RECEIVED",
  ]) {
    const f = decisionFixture();
    f.data.deliveries[0].status = status;
    await assert.rejects(
      () => f.service.decide(f.data.deliveries[0].id, approve(), f.actors[0]),
      { statusCode: 409 },
    );
    assert.equal(f.data.decisions.length, 0);
    assert.equal(f.data.receipts.length, 0);
  }
  const f = decisionFixture();
  await f.service.decide(f.data.deliveries[0].id, approve(), f.actors[0]);
  const colleague = {
    ...f.identities[0],
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  };
  f.identities.push(colleague);
  await assert.rejects(
    () =>
      f.service.decide(
        f.data.deliveries[0].id,
        approve(),
        principalFromIdentity(colleague as never),
      ),
    { statusCode: 409 },
  );
  f.identities[0].roleId = f.identities[1].roleId;
  f.identities[0].Role = f.identities[1].Role;
  await assert.rejects(
    () => f.service.decide(f.data.deliveries[0].id, approve(), f.actors[0]),
    { statusCode: 409 },
  );
});
