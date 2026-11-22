import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDeliveryInspectionService,
  deliveryInspectionRoles,
} from "../src/modules/delivery/delivery.service";
import {
  validateDeliveryArrivalBody,
  validateDeliveryArrivalQuery,
  validateDeliveryInspectionDecision,
  validateDeliveryInspectionQuery,
} from "../src/modules/delivery/delivery.validation";
import { ROLES } from "../src/constants/roles";
import { testStaff } from "./helpers/authorization";
import { Prisma, type PrismaClient } from "../src/generated/prisma/client";
import { principalFromIdentity } from "../src/utils/authorization";
import express, { type RequestHandler } from "express";
import { createDeliveryRouter } from "../src/modules/delivery/delivery.routes";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import { startHttp } from "./helpers/http";
import type { AuthPrincipal } from "../src/types/auth";
import {
  documentStorage,
  type OnboardingDocument,
} from "../src/utils/onboarding-documents";

const id = "11111111-1111-4111-8111-111111111111";
const row = (deliveryId = id) => ({
  id: deliveryId,
  deliveryNo: "D1",
  schoolId: testStaff.schoolId,
  creationMode: "REQUEST" as const,
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
      ingredientEntry: { findMany: () => Promise.resolve([]) },
      delivery: {
        findMany: ({
          where,
          skip,
          take,
        }: {
          where: { schoolId: string; AND: unknown[] };
          skip: number;
          take: number;
        }) => {
          assert.equal(where.schoolId, principal.schoolId);
          // Bộ phận khác Ban quản lý nguyên liệu có thêm điều kiện ẩn xe đồ lưu kho.
          const hidesDry = role !== "INGREDIENT_MANAGEMENT_DEPARTMENT";
          assert.equal(where.AND.length, hidesDry ? 3 : 2);
          assert.equal(JSON.stringify(where).includes('"NOT"'), hidesDry);
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
    assert.equal(result.items[0].schoolId, principal.schoolId);
    assert.equal(result.items[0].sourceType, "REQUEST");
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
      ingredientEntry: { findMany: () => Promise.resolve([]) },
      delivery: {
        findFirst: ({ where }: { where: { id: string; schoolId: string } }) => {
          assert.equal(where.schoolId, principal.schoolId);
          return Promise.resolve({
            ...row(where.id),
            deliveryItems: [
              {
                id,
                ingredientId: id,
                ingredientEntryId: id,
                actualQuantity: "6.125",
                unit: "kg",
                Ingredient: { name: "Rice", ingredientCategory: null },
                IngredientEntry: {
                  id,
                  schoolId: principal.schoolId,
                  ingredientId: id,
                  status: "ACTIVE",
                  handlingType: "DIRECT_USE",
                },
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

void test("xe chỉ có đồ lưu kho: bộ phận khác không xem được, Ban quản lý nguyên liệu xem được", async () => {
  const dryRow = {
    ...row(id),
    deliveryItems: [
      {
        id,
        ingredientId: id,
        ingredientEntryId: id,
        actualQuantity: "5",
        unit: "kg",
        Ingredient: { name: "Gạo", ingredientCategory: null },
        IngredientEntry: {
          id,
          schoolId: testStaff.schoolId,
          ingredientId: id,
          status: "ACTIVE",
          handlingType: "DRY_STOCK",
        },
        SupplyRequestItem: null,
        ingredientLots: [],
      },
    ],
  };
  const service = createDeliveryInspectionService(() =>
    Promise.resolve({
      delivery: { findFirst: () => Promise.resolve(dryRow) },
      ingredientEntry: { findMany: () => Promise.resolve([]) },
      ingredientLot: { findMany: () => Promise.resolve([]) },
    } as never),
  );
  for (const role of deliveryInspectionRoles.filter(
    (r) => r !== "INGREDIENT_MANAGEMENT_DEPARTMENT",
  ))
    await assert.rejects(
      () =>
        service.detail(id, {
          ...testStaff,
          role,
          permissions: ["delivery.view"],
        }),
      { statusCode: 404 },
    );
  const seen = await service.detail(id, {
    ...testStaff,
    role: "INGREDIENT_MANAGEMENT_DEPARTMENT",
    permissions: ["delivery.view"],
  });
  assert.deepEqual(
    seen.requiredRoles.map((r) => r.code),
    ["INGREDIENT_MANAGEMENT_DEPARTMENT"],
  );
});

void test("xe có ít nhất 1 đồ tươi là xe đồ tươi, kể cả NCC có nhiều nguyên liệu khô trong danh mục", async () => {
  const supplierId = "33333333-3333-4333-8333-333333333333";
  const item = (handlingType: string, name: string) => ({
    id,
    ingredientId: id,
    ingredientEntryId: id,
    actualQuantity: "5",
    unit: "kg",
    Ingredient: { name, ingredientCategory: null },
    IngredientEntry: {
      id,
      schoolId: testStaff.schoolId,
      ingredientId: id,
      status: "ACTIVE",
      handlingType,
    },
    SupplyRequestItem: null,
    ingredientLots: [],
  });
  const mixedRow = {
    ...row(id),
    supplierId,
    deliveryItems: [
      item("DRY_STOCK", "Gạo"),
      item("DRY_STOCK", "Muối"),
      item("DIRECT_USE", "Sữa chua"),
    ],
  };
  // Danh mục trường: NCC này có nhiều nguyên liệu khô hơn tươi; không còn ảnh hưởng phân loại xe.
  const entries = ["DRY_STOCK", "DRY_STOCK", "DIRECT_USE"].map(
    (handlingType) => ({ handlingType, Ingredient: { supplierId } }),
  );
  let listWhere: unknown;
  const service = createDeliveryInspectionService(() =>
    Promise.resolve({
      delivery: {
        findFirst: () => Promise.resolve(mixedRow),
        findMany: ({ where }: { where: unknown }) => {
          listWhere = where;
          return Promise.resolve([]);
        },
        groupBy: () => Promise.resolve([]),
      },
      ingredientEntry: { findMany: () => Promise.resolve(entries) },
      ingredientLot: { findMany: () => Promise.resolve([]) },
    } as never),
  );
  const kitchen = {
    ...testStaff,
    role: "SCHOOL_KITCHEN_STAFF",
    permissions: ["delivery.view"],
  };
  const seen = await service.detail(id, kitchen);
  assert.deepEqual(
    seen.requiredRoles.map((r) => r.code).sort(),
    [...deliveryInspectionRoles].sort(),
  );
  await service.list(validateDeliveryInspectionQuery({}), kitchen);
  assert(!JSON.stringify(listWhere).includes(supplierId));
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

function decisionFixture(
  proofs?: Parameters<typeof createDeliveryInspectionService>[2],
) {
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
    handlingType?: "DRY_STOCK" | "DIRECT_USE";
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
    schoolId: delivery.wrongSchool ? uid(999) : uid(20),
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
        ingredientId: uid(25),
        ingredientEntryId: uid(26),
        supplyRequestItemId: uid(24),
        actualQuantity: new Prisma.Decimal(delivery.actual),
        unit: "kg",
        Ingredient: {
          id: uid(25),
          supplierId: delivery.wrongSupplier ? uid(999) : uid(21),
          name: "Rice",
          ingredientCategory: null,
        },
        IngredientEntry: {
          id: uid(26),
          schoolId: delivery.wrongSchool ? uid(999) : uid(20),
          ingredientId: uid(25),
          status: "ACTIVE",
          handlingType: delivery.handlingType ?? "DIRECT_USE",
        },
        SupplyRequestItem: {
          supplyRequestId: uid(22),
          ingredientEntryId: uid(26),
          requestedQuantity: new Prisma.Decimal(data.requestedQuantity),
          unit: "kg",
          IngredientEntry: {
            schoolId: delivery.wrongSchool ? uid(999) : uid(20),
            ingredientId: uid(25),
            status: "ACTIVE",
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
    ingredientEntry: { findMany: () => Promise.resolve([]) },
    schoolDeliveryInspectionRole: { findMany: () => Promise.resolve([]) },
    deliveryInspectionRole: { createMany: () => Promise.resolve({ count: 4 }) },
    blockchainProof: {
      count: () => Promise.resolve(0),
      findFirst: () => Promise.resolve(null),
      create: () => Promise.resolve({ id: uid(99) }),
    },
    delivery: {
      findUnique: ({ where }: { where: { id: string } }) => {
        const found = data.deliveries.find((d) => d.id === where.id);
        return Promise.resolve(found ? snapshot(found) : null);
      },
      findFirst: ({
        where,
        select,
      }: {
        where: { id: string; schoolId: string };
        select: { supplyRequestId?: boolean; deliveryItems?: unknown };
      }) => {
        assert.equal(where.schoolId, uid(20));
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
    supplyRequestItem: {
      findMany: ({
        where,
      }: {
        where: {
          supplyRequestId: string;
          SupplyRequest?: {
            id?: string;
            schoolId?: string;
            supplierId?: string;
          };
        };
      }) => {
        if (
          where.supplyRequestId !== uid(22) ||
          where.SupplyRequest?.schoolId !== uid(20) ||
          where.SupplyRequest?.supplierId !== uid(21)
        ) {
          return Promise.resolve([]);
        }
        return Promise.resolve([
          {
            id: uid(24),
            supplyRequestId: uid(22),
            ingredientEntryId: uid(26),
            requestedQuantity: new Prisma.Decimal(data.requestedQuantity),
            unit: "kg",
            IngredientEntry: {
              ingredientId: uid(25),
              schoolId: uid(20),
              status: "ACTIVE",
              Ingredient: { supplierId: uid(21) },
            },
          },
        ]);
      },
    },
    deliveryItem: {
      findMany: ({
        where,
      }: {
        where: {
          supplyRequestItemId?: string | { in: string[] };
          Delivery: { status: string; id?: { not: string } };
        };
      }) => {
        const excludeId = where.Delivery.id?.not;
        return Promise.resolve(
          data.deliveries
            .filter(
              (delivery) =>
                delivery.status === where.Delivery.status &&
                (!excludeId || delivery.id !== excludeId),
            )
            .map((delivery) => ({
              supplyRequestItemId: uid(24),
              actualQuantity: new Prisma.Decimal(delivery.actual),
              unit: "kg",
            })),
        );
      },
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
      proofs,
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

void test("hạn dùng: đồ lưu kho còn ít nhất 7 ngày kể từ ngày nhận, đồ tươi chỉ cần còn hạn hôm nay", async () => {
  // Đồng hồ fixture: 13/11/2026 (giờ VN).
  const cases = [
    [
      "DRY_STOCK",
      "2026-11-19",
      "Lô (đồ lưu kho) chỉ còn hạn đến 19/11/2026; cần còn hạn ít nhất 7 ngày kể từ ngày nhận (đến 20/11/2026)",
    ],
    ["DRY_STOCK", "2026-11-20", null],
    ["DIRECT_USE", "2026-11-12", "Lô đã hết hạn dùng (12/11/2026)"],
    ["DIRECT_USE", "2026-11-13", null],
  ] as const;
  for (const [handlingType, expiry, issue] of cases) {
    const f = decisionFixture(),
      delivery = f.data.deliveries[0];
    delivery.handlingType = handlingType;
    delivery.lots[0].expiry = expiry;
    // Đồ lưu kho chỉ Ban quản lý nguyên liệu (actors[2]) ký; đồ tươi cần đủ 4 bộ phận.
    const signers = handlingType === "DRY_STOCK" ? [f.actors[2]] : f.actors;
    if (issue) {
      // Bị chặn ngay ở chữ ký "Đạt" đầu tiên, không ghi quyết định.
      await assert.rejects(
        () => f.service.decide(delivery.id, approve(), signers[0]),
        { statusCode: 409, message: issue },
      );
      assert.equal(f.data.decisions.length, 0);
    } else {
      for (const actor of signers)
        await f.service.decide(delivery.id, approve(), actor);
      assert.equal(f.data.deliveries[0].status, "RECEIVED");
    }
  }
});

void test("chuyến chỉ có đồ lưu kho: chỉ Ban quản lý nguyên liệu kiểm tra, một chữ ký là nhập kho", async () => {
  const f = decisionFixture(),
    delivery = f.data.deliveries[0];
  delivery.handlingType = "DRY_STOCK";
  // Các bộ phận khác không được ký chuyến đồ lưu kho.
  for (const actor of [f.actors[0], f.actors[1], f.actors[3]])
    await assert.rejects(
      () => f.service.decide(delivery.id, approve(), actor),
      {
        statusCode: 403,
        message:
          "Chuyến giao đồ lưu kho: chỉ Ban quản lý nguyên liệu kiểm tra và ký nhận",
      },
    );
  assert.equal(f.data.decisions.length, 0);
  const result = await f.service.decide(delivery.id, approve(), f.actors[2]);
  assert.equal(result.status, "RECEIVED");
  assert.deepEqual(
    result.requiredRoles.map((role) => role.code),
    ["INGREDIENT_MANAGEMENT_DEPARTMENT"],
  );
  assert.equal(f.data.decisions.length, 1);
  assert.equal(f.data.receipts.length, 1);
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
  t.mock.method(documentStorage, "upload", () =>
    Promise.resolve({
      id,
      field: "photo",
      publicId: "private/inspection.jpg",
      format: "jpg" as const,
      fileName: "inspection.jpg",
      bytes: 3,
    }),
  );
  t.mock.method(documentStorage, "download", () => "signed-photo-link");
  t.mock.method(documentStorage, "remove", () => Promise.resolve());
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
  const post = (body: unknown) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(body as Record<string, string>))
      data.set(key, value);
    data.set(
      "photo",
      new Blob([new Uint8Array([255, 216, 255])], { type: "image/jpeg" }),
      "inspection.jpg",
    );
    return http.request(path, { method: "POST", body: data });
  };
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

void test("standalone deliveries list, inspect, attach IngredientEntry on final approval and reject without cancelling SupplyRequest", async () => {
  const uid = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const schoolId = uid(20);
  const supplierId = uid(21);
  const deliveryId = uid(91);
  const deliveryItemId = uid(92);
  const ingredientId = uid(93);
  const ingredientEntryId = uid(94);
  const lotId = uid(95);
  const principal = {
    ...testStaff,
    schoolId,
    permissions: ["delivery.view"],
  };
  const standaloneRow = {
    ...row(deliveryId),
    deliveryNo: "DG-STANDALONE-1",
    schoolId,
    supplierId,
    creationMode: "STANDALONE" as const,
    supplyRequestId: null,
    SupplyRequest: null,
  };
  const listAndDetailService = createDeliveryInspectionService(() =>
    Promise.resolve({
      delivery: {
        groupBy: () =>
          Promise.resolve([{ status: "ARRIVED", _count: { _all: 1 } }]),
        findMany: () => Promise.resolve([standaloneRow]),
        findFirst: () =>
          Promise.resolve({
            ...standaloneRow,
            deliveryItems: [
              {
                id: deliveryItemId,
                ingredientId,
                ingredientEntryId: null,
                actualQuantity: "6.125",
                unit: "kg",
                Ingredient: { name: "Thịt gà", ingredientCategory: null },
                IngredientEntry: null,
                SupplyRequestItem: null,
                ingredientLots: [
                  {
                    id: lotId,
                    lotCode: "LOT-STD-1",
                    qrToken: "QR-STD-1",
                    SourceFacility: null,
                    manufactureDate: null,
                    expiryDate: new Date("2026-11-20"),
                    receivedQuantity: "6.125",
                    unit: "kg",
                    status: "BLOCKED",
                  },
                ],
              },
            ],
          }),
      },
      // Trường chưa có danh mục cho nguyên liệu này: báo sớm ở chi tiết.
      ingredientEntry: { findMany: () => Promise.resolve([]) },
    } as never),
  );

  const listResult = await listAndDetailService.list(
    { page: 1, limit: 20, period: "ALL" },
    principal,
  );
  assert.equal(listResult.items[0].sourceType, "STANDALONE");
  assert.equal(listResult.items[0].schoolId, schoolId);
  assert.equal(listResult.items[0].supplyRequestId, null);
  assert.equal(listResult.items[0].requestNo, null);
  assert.equal(listResult.items[0].redeliveryRequiredCount, null);
  assert.equal(listResult.items[0].redeliveryLimit, null);
  assert.equal(listResult.items[0].cancellationNotice, null);

  const detailResult = await listAndDetailService.detail(deliveryId, principal);
  assert.equal(detailResult.sourceType, "STANDALONE");
  assert.equal(detailResult.supplyRequestId, null);
  assert.ok(detailResult.deliveryItems);
  assert.equal(detailResult.deliveryItems[0].id, deliveryItemId);
  assert.equal(detailResult.deliveryItems[0].ingredientName, "Thịt gà");
  if (["ARRIVED", "PENDING_APPROVAL"].includes(detailResult.status))
    assert.equal(
      detailResult.receiptIssue,
      "Chưa cấu hình danh mục nguyên liệu đang hoạt động của trường để tiếp nhận lô",
    );

  const setupStandaloneHarness = (activeEntry: boolean) => {
    const ref = decisionFixture();
    let status: "ARRIVED" | "PENDING_APPROVAL" | "RECEIVED" | "REJECTED" =
      "ARRIVED";
    let attachedEntryId: string | null = null;
    let lotStatus: "BLOCKED" | "AVAILABLE" = "BLOCKED";
    let lotAvailable = "0";
    const approvals: Array<{
      id: string;
      deliveryId: string;
      userId: string;
      roleId: string;
      decision: "APPROVE" | "REJECT";
      reason: string | null;
      decidedAt: Date;
      Role: { code: string; name: string };
      User: { fullName: string };
    }> = [];
    const receipts: Array<{ ingredientLotId: string; quantity: string }> = [];
    let supplyRequestTouched = false;

    const itemSnapshot = () => ({
      id: deliveryItemId,
      ingredientId,
      ingredientEntryId: attachedEntryId,
      supplyRequestItemId: null,
      actualQuantity: new Prisma.Decimal("6.125"),
      unit: "kg",
      Ingredient: {
        id: ingredientId,
        supplierId,
        name: "Thịt gà",
        ingredientCategory: null,
      },
      IngredientEntry: attachedEntryId
        ? {
            id: attachedEntryId,
            schoolId,
            ingredientId,
            status: "ACTIVE",
            handlingType: "DIRECT_USE",
          }
        : null,
      SupplyRequestItem: null,
      ingredientLots: [
        {
          id: lotId,
          lotCode: "LOT-STD-1",
          qrToken: "QR-STD-1",
          SourceFacility: null,
          manufactureDate: null,
          expiryDate: new Date("2026-11-20"),
          receivedQuantity: new Prisma.Decimal("6.125"),
          availableQuantity: new Prisma.Decimal(lotAvailable),
          unit: "kg",
          status: lotStatus,
        },
      ],
    });

    const tx = {
      $queryRaw: () => Promise.resolve([]),
      user: {
        findUnique: ({ where }: { where: { id: string } }) =>
          Promise.resolve(
            ref.identities.find((identity) => identity.id === where.id) ?? null,
          ),
      },
      school: {
        findUnique: () => Promise.resolve({ status: "ACTIVE" }),
      },
      blockchainProof: {
        count: () => Promise.resolve(0),
        findFirst: () => Promise.resolve(null),
        create: () => Promise.resolve({ id: uid(99) }),
      },
      delivery: {
        findUnique: () => Promise.resolve(null),
        findFirst: ({
          where,
          select,
        }: {
          where: { id: string; schoolId: string };
          select?: { deliveryItems?: unknown };
        }) => {
          if (where.id !== deliveryId || where.schoolId !== schoolId) {
            return Promise.resolve(null);
          }
          if (!select?.deliveryItems) {
            return Promise.resolve({ supplyRequestId: null });
          }
          return Promise.resolve({
            ...standaloneRow,
            status,
            deliveryApprovals: approvals.map((entry) => ({ ...entry })),
            deliveryItems: [itemSnapshot()],
          });
        },
        count: () => {
          supplyRequestTouched = true;
          return Promise.resolve(0);
        },
        update: ({ data }: { data: { status: typeof status } }) => {
          status = data.status;
          return Promise.resolve({ id: deliveryId, status });
        },
        updateMany: () => {
          supplyRequestTouched = true;
          return Promise.resolve({ count: 0 });
        },
      },
      deliveryApproval: {
        create: ({
          data,
        }: {
          data: {
            deliveryId: string;
            userId: string;
            roleId: string;
            decision: "APPROVE" | "REJECT";
            reason: string | null;
          };
        }) => {
          const identity = ref.identities.find(
            (entry) => entry.id === data.userId,
          )!;
          const created = {
            id: `apr-${approvals.length + 1}`,
            ...data,
            decidedAt: new Date("2026-11-13T01:00:00Z"),
            Role: {
              code: identity.Role.code,
              name: identity.Role.code,
            },
            User: { fullName: identity.fullName },
          };
          approvals.push(created);
          return Promise.resolve(created);
        },
      },
      ingredientEntry: {
        findMany: ({
          where,
        }: {
          where: {
            schoolId: string;
            ingredientId: { in: string[] };
          };
        }) => {
          if (!where.ingredientId) return Promise.resolve([]);
          if (
            activeEntry &&
            where.schoolId === schoolId &&
            where.ingredientId.in.includes(ingredientId)
          ) {
            return Promise.resolve([
              {
                id: ingredientEntryId,
                schoolId,
                ingredientId,
                status: "ACTIVE",
                handlingType: "DIRECT_USE",
              },
            ]);
          }
          return Promise.resolve([]);
        },
        findUnique: ({
          where,
        }: {
          where: {
            schoolId_ingredientId?: { schoolId: string; ingredientId: string };
          };
        }) => {
          if (
            activeEntry &&
            where.schoolId_ingredientId?.schoolId === schoolId &&
            where.schoolId_ingredientId?.ingredientId === ingredientId
          ) {
            return Promise.resolve({ id: ingredientEntryId, status: "ACTIVE" });
          }
          return Promise.resolve(null);
        },
      },
      deliveryItem: {
        findMany: () => Promise.resolve([{ id: deliveryItemId }]),
        update: ({
          where,
          data,
        }: {
          where: { id: string };
          data: { ingredientEntryId: string };
        }) => {
          assert.equal(where.id, deliveryItemId);
          attachedEntryId = data.ingredientEntryId;
          return Promise.resolve({ id: where.id, ...data });
        },
      },
      ingredientLot: {
        updateMany: ({
          where,
          data,
        }: {
          where: { id?: string; status?: string };
          data: {
            status: typeof lotStatus;
            availableQuantity?: Prisma.Decimal;
          };
        }) => {
          if (
            (where.id && where.id !== lotId) ||
            (where.status && where.status !== lotStatus)
          ) {
            return Promise.resolve({ count: 0 });
          }
          lotStatus = data.status;
          if (data.availableQuantity !== undefined) {
            lotAvailable = data.availableQuantity.toString();
          }
          return Promise.resolve({ count: 1 });
        },
      },
      inventoryTransaction: {
        count: ({ where }: { where: { ingredientLotId?: string } }) =>
          Promise.resolve(
            receipts.filter((item) =>
              where.ingredientLotId
                ? item.ingredientLotId === where.ingredientLotId
                : true,
            ).length,
          ),
        create: ({
          data,
        }: {
          data: { ingredientLotId: string; quantity: Prisma.Decimal };
        }) => {
          receipts.push({
            ingredientLotId: data.ingredientLotId,
            quantity: data.quantity.toString(),
          });
          return Promise.resolve({ id: `inv-${receipts.length}` });
        },
      },
      supplyRequest: {
        update: () => {
          supplyRequestTouched = true;
          return Promise.resolve({});
        },
      },
    };

    const service = createDeliveryInspectionService(
      () =>
        Promise.resolve({
          $transaction: async <T>(fn: (client: typeof tx) => Promise<T>) =>
            fn(tx),
        } as never),
      () => new Date("2026-11-13T01:00:00Z"),
    );
    return {
      service,
      actors: ref.actors,
      getState: () => ({
        status,
        attachedEntryId,
        lotStatus,
        lotAvailable,
        receipts: [...receipts],
        supplyRequestTouched,
      }),
    };
  };

  // Thiếu danh mục nguyên liệu: chặn ngay chữ ký "Đạt" đầu tiên, không đợi bộ phận thứ 4.
  const missingEntry = setupStandaloneHarness(false);
  for (const actor of missingEntry.actors) {
    await assert.rejects(
      () => missingEntry.service.decide(deliveryId, approve(), actor),
      {
        statusCode: 409,
        message:
          "Chưa cấu hình danh mục nguyên liệu đang hoạt động của trường để tiếp nhận lô",
      },
    );
  }
  assert.equal(missingEntry.getState().receipts.length, 0);

  const activeEntryHarness = setupStandaloneHarness(true);
  for (const actor of activeEntryHarness.actors.slice(0, 3)) {
    await activeEntryHarness.service.decide(deliveryId, approve(), actor);
  }
  const finalApprove = await activeEntryHarness.service.decide(
    deliveryId,
    approve(),
    activeEntryHarness.actors[3],
  );
  assert.equal(finalApprove.created, true);
  assert.equal(finalApprove.status, "RECEIVED");
  assert.equal(
    activeEntryHarness.getState().attachedEntryId,
    ingredientEntryId,
  );
  assert.equal(activeEntryHarness.getState().lotStatus, "AVAILABLE");
  assert.equal(activeEntryHarness.getState().lotAvailable, "6.125");
  assert.equal(activeEntryHarness.getState().receipts.length, 1);
  assert.equal(activeEntryHarness.getState().supplyRequestTouched, false);

  const replayApprove = await activeEntryHarness.service.decide(
    deliveryId,
    approve(),
    activeEntryHarness.actors[3],
  );
  assert.equal(replayApprove.created, false);
  assert.equal(activeEntryHarness.getState().receipts.length, 1);

  const rejectHarness = setupStandaloneHarness(true);
  const rejected = await rejectHarness.service.decide(
    deliveryId,
    reject(),
    rejectHarness.actors[0],
  );
  assert.equal(rejected.status, "REJECTED");
  assert.equal(rejected.redeliveryRequiredCount, null);
  assert.equal(rejected.redeliveryLimit, null);
  assert.equal(rejected.cancellationNotice, null);
  assert.equal(rejectHarness.getState().supplyRequestTouched, false);
});

void test("blockchain proof is prepared only when an inspection ends, then scheduled after commit", async () => {
  const prepared: string[] = [];
  const scheduled: unknown[] = [];
  const f = decisionFixture({
    prepareDeliveryInspected: (_tx, deliveryId, actorId) => {
      prepared.push(`${deliveryId}:${actorId}`);
      return Promise.resolve({ kind: "deliveries", id: deliveryId });
    },
    scheduleAnchor: (ref) => {
      scheduled.push(ref);
    },
  });
  const [received, rejected] = f.data.deliveries;
  for (const actor of f.actors.slice(0, 3))
    await f.service.decide(received.id, approve(), actor);
  assert.equal(prepared.length, 0, "PENDING_APPROVAL must not anchor");
  assert.deepEqual(scheduled, [null, null, null]);
  await f.service.decide(received.id, approve(), f.actors[3]);
  assert.deepEqual(prepared, [`${received.id}:${f.actors[3].id}`]);
  await f.service.decide(received.id, approve(), f.actors[3]);
  assert.equal(prepared.length, 1, "replayed signature must not anchor again");
  await f.service.decide(rejected.id, reject(), f.actors[0]);
  assert.deepEqual(prepared[1], `${rejected.id}:${f.actors[0].id}`);
  assert.deepEqual(scheduled.slice(-1), [
    { kind: "deliveries", id: rejected.id },
  ]);
});

function v1InspectionFixture() {
  const uid = (group: number, n: number) =>
    `00000000-0000-4000-${String(group).padStart(4, "0")}-${String(n).padStart(12, "0")}`;
  const schoolA = uid(10, 1);
  const schoolB = uid(10, 2);
  const supplierId = uid(20, 1);
  const requestId = uid(30, 1);
  const requestItemId = uid(31, 1);
  const ingredientId = uid(40, 1);
  const entryId = uid(41, 1);
  const sourceAId = uid(50, 1);
  const sourceBId = uid(50, 2);

  type IdentityRecord = {
    id: string;
    username: string;
    fullName: string;
    status: string;
    roleId: string;
    schoolId: string | null;
    supplierId: string | null;
    communeFoodSafetyUnitId: string | null;
    permissionDenials: { permission: { code: string } }[];
    Role: {
      code: string;
      type: "SCHOOL" | "SUPPLIER" | "SYSTEM" | "AUTHORITY";
      rolePermissions: { permission: { code: string; isActive: boolean } }[];
    };
  };

  const makeIdentity = (
    n: number,
    code: string,
    type: "SCHOOL" | "SUPPLIER" | "SYSTEM" | "AUTHORITY",
    permissions: string[],
    orgId: string | null,
  ): IdentityRecord => ({
    id: uid(1, n),
    username: `${code.toLowerCase()}_${n}`,
    fullName: `Actor ${code} ${n}`,
    status: "ACTIVE",
    roleId: uid(2, n),
    schoolId: type === "SCHOOL" ? orgId : null,
    supplierId: type === "SUPPLIER" ? orgId : null,
    communeFoodSafetyUnitId: type === "AUTHORITY" ? uid(90, 1) : null,
    permissionDenials: [],
    Role: {
      code,
      type,
      rolePermissions: permissions.map((perm) => ({
        permission: { code: perm, isActive: true },
      })),
    },
  });

  const identities: IdentityRecord[] = [
    ...deliveryInspectionRoles.map((role, index) =>
      makeIdentity(
        index + 1,
        role,
        "SCHOOL",
        ["delivery.view", "delivery.inspect"],
        schoolA,
      ),
    ),
    makeIdentity(
      10,
      deliveryInspectionRoles[0],
      "SCHOOL",
      ["delivery.view"],
      schoolA,
    ),
    makeIdentity(
      11,
      deliveryInspectionRoles[0],
      "SCHOOL",
      ["delivery.inspect"],
      schoolA,
    ),
    makeIdentity(
      12,
      ROLES.HOMEROOM_TEACHER,
      "SCHOOL",
      ["delivery.view", "delivery.inspect"],
      schoolA,
    ),
    makeIdentity(
      13,
      ROLES.INGREDIENT_SUPPLIER_ADMIN,
      "SUPPLIER",
      ["delivery.view", "delivery.inspect"],
      supplierId,
    ),
    makeIdentity(
      14,
      ROLES.SYSTEM_ADMIN,
      "SYSTEM",
      ["delivery.view", "delivery.inspect"],
      null,
    ),
    makeIdentity(
      15,
      ROLES.COMMUNE_FOOD_SAFETY_OFFICER,
      "AUTHORITY",
      ["delivery.view", "delivery.inspect"],
      null,
    ),
    makeIdentity(
      16,
      deliveryInspectionRoles[0],
      "SCHOOL",
      ["delivery.view", "delivery.inspect"],
      schoolB,
    ),
    makeIdentity(
      17,
      deliveryInspectionRoles[0],
      "SCHOOL",
      ["delivery.view", "delivery.inspect"],
      schoolA,
    ),
  ];

  const actors = identities
    .slice(0, 4)
    .map((identity) => principalFromIdentity(identity as never));
  const [
    viewOnlyActor,
    inspectOnlyActor,
    wrongSchoolRoleActor,
    supplierActor,
    systemActor,
    authorityActor,
    otherSchoolActor,
    colleagueSameRoleActor,
  ] = identities
    .slice(4)
    .map((identity) => principalFromIdentity(identity as never));

  type LotState = {
    id: string;
    quantity: string;
    available: string;
    unit?: string;
    status: string;
    manufacture: string | null;
    expiry: string | null;
    sourceFacilityId: string | null;
  };
  type ItemState = {
    id: string;
    ingredientId: string;
    ingredientEntryId: string | null;
    supplyRequestItemId: string | null;
    actual: string;
    unit: string;
    sourceFacilityId: string | null;
    sourceFacilityNameSnapshot: string | null;
    sourceFacilityCodeSnapshot: string | null;
    ingredientNameSnapshot: string | null;
    lots: LotState[];
  };
  type DeliveryState = {
    id: string;
    deliveryNo: string;
    schoolId: string;
    supplierId: string;
    supplyRequestId: string | null;
    creationMode: "REQUEST" | "STANDALONE" | null;
    traceabilityVersion: number | null;
    workflowVersion: number | null;
    status: string;
    expectedArrivalAt: string | null;
    arrivedAt: string | null;
    receivedAt: string | null;
    vehiclePlate: string | null;
    items: ItemState[];
  };
  type SourceItemState = {
    id: string;
    supplyRequestId: string;
    ingredientEntryId: string;
    ingredientId: string;
    requestedQuantity: string;
    unit: string;
    ingredientName?: string;
  };
  type DecisionState = {
    id: string;
    deliveryId: string;
    userId: string;
    roleId: string;
    decision: "APPROVE" | "REJECT";
    reason: string | null;
    photoPublicId: string | null;
    photoHash: string | null;
    decidedAt: string;
  };

  const makeDelivery = (
    n: number,
    opts?: {
      schoolId?: string;
      supplyRequestId?: string | null;
      creationMode?: "REQUEST" | "STANDALONE" | null;
      traceabilityVersion?: number | null;
      workflowVersion?: number | null;
      status?: string;
      expectedArrivalAt?: string | null;
      arrivedAt?: string | null;
      vehiclePlate?: string | null;
      sourceFacilityId?: string | null;
      lotSourceFacilityId?: string | null;
      ingredientEntryId?: string | null;
    },
  ): DeliveryState => {
    const version =
      opts && "traceabilityVersion" in opts ? opts.traceabilityVersion : 1;
    const reqIdValue =
      opts && "supplyRequestId" in opts ? opts.supplyRequestId : requestId;
    const itemSource =
      opts && "sourceFacilityId" in opts ? opts.sourceFacilityId : sourceAId;
    const lotSource =
      opts && "lotSourceFacilityId" in opts
        ? opts.lotSourceFacilityId
        : itemSource;
    const defaultStatus = opts?.status ?? "IN_TRANSIT";
    const expectedArrivalAt =
      opts && "expectedArrivalAt" in opts
        ? (opts.expectedArrivalAt ?? null)
        : defaultStatus === "PREPARING"
          ? null
          : "2026-11-15T04:00:00.000Z";
    const vehiclePlate =
      opts && "vehiclePlate" in opts
        ? (opts.vehiclePlate ?? null)
        : defaultStatus === "PREPARING"
          ? null
          : "29C-12345";
    return {
      id: uid(60, n),
      deliveryNo: `FP-DE-${String(n).padStart(5, "0")}`,
      schoolId: opts?.schoolId ?? schoolA,
      supplierId,
      supplyRequestId: reqIdValue ?? null,
      creationMode:
        opts?.creationMode ?? (reqIdValue === null ? "STANDALONE" : "REQUEST"),
      traceabilityVersion: version ?? null,
      workflowVersion:
        opts && "workflowVersion" in opts
          ? (opts.workflowVersion ?? null)
          : null,
      status: defaultStatus,
      expectedArrivalAt,
      arrivedAt: opts?.arrivedAt ?? null,
      receivedAt: null,
      vehiclePlate,
      items: [
        {
          id: uid(70, n),
          ingredientId,
          ingredientEntryId:
            opts && "ingredientEntryId" in opts
              ? opts.ingredientEntryId!
              : reqIdValue
                ? entryId
                : null,
          supplyRequestItemId: reqIdValue ? requestItemId : null,
          actual: "6.125",
          unit: "kg",
          sourceFacilityId: itemSource ?? null,
          sourceFacilityNameSnapshot:
            version === 1 ? "Nông trại A (Chụp lúc tạo)" : null,
          sourceFacilityCodeSnapshot: version === 1 ? "CS-A" : null,
          ingredientNameSnapshot: version === 1 ? "Gạo ST25 (Snapshot)" : null,
          lots: [
            {
              id: uid(80, n),
              quantity: "6.125",
              available: "0",
              status: "BLOCKED",
              manufacture: "2026-11-10",
              expiry: "2027-01-01",
              sourceFacilityId: lotSource ?? null,
            },
          ],
        },
      ],
    };
  };

  const state = {
    currentTime: new Date("2026-11-15T05:00:00.000Z"),
    requestStatus: "IN_PROGRESS",
    requestedQuantity: "25",
    customSourceItems: null as SourceItemState[] | null,
    entryStatus: "ACTIVE" as "ACTIVE" | "INACTIVE" | "MISSING",
    supplierIntakeState: "PAUSED" as "ACTIVE" | "PAUSED",
    facilities: {
      [sourceAId]: {
        name: "Nông trại A (Đã đổi tên)",
        status: "ACTIVE",
        supplierId,
      },
      [sourceBId]: {
        name: "Nông trại B",
        status: "ACTIVE",
        supplierId,
      },
    } as Record<
      string,
      { name: string; status: "ACTIVE" | "INACTIVE"; supplierId: string }
    >,
    deliveries: [
      makeDelivery(1),
      makeDelivery(2),
      makeDelivery(3),
      makeDelivery(4),
      makeDelivery(5, { supplyRequestId: null }),
    ] as DeliveryState[],
    decisions: [] as DecisionState[],
    receipts: [] as { ingredientLotId: string; quantity: string }[],
    failReceipt: false,
    failReceiveLot: false,
  };

  const getSourceItems = (): SourceItemState[] =>
    state.customSourceItems ?? [
      {
        id: requestItemId,
        supplyRequestId: requestId,
        ingredientEntryId: entryId,
        ingredientId,
        requestedQuantity: state.requestedQuantity,
        unit: "kg",
        ingredientName: "Gạo ST25",
      },
    ];

  const buildSnapshot = (d: DeliveryState) => ({
    id: d.id,
    deliveryNo: d.deliveryNo,
    schoolId: d.schoolId,
    supplierId: d.supplierId,
    supplyRequestId: d.supplyRequestId,
    creationMode: d.creationMode,
    traceabilityVersion: d.traceabilityVersion,
    workflowVersion: d.workflowVersion,
    status: d.status,
    expectedArrivalAt: d.expectedArrivalAt
      ? new Date(d.expectedArrivalAt)
      : null,
    arrivedAt: d.arrivedAt ? new Date(d.arrivedAt) : null,
    receivedAt: d.receivedAt ? new Date(d.receivedAt) : null,
    vehiclePlate: d.vehiclePlate,
    note: null,
    createdAt: new Date("2026-11-15T01:00:00.000Z"),
    updatedAt: new Date("2026-11-15T01:00:00.000Z"),
    Supplier: { id: supplierId, name: "NCC VietGAP", phone: "0900000001" },
    SupplyRequest: d.supplyRequestId
      ? {
          id: d.supplyRequestId,
          requestNo: "REQ-V1-001",
          requestedDeliveryDate: new Date("2026-11-15T00:00:00.000Z"),
          note: null,
          schoolId: d.schoolId,
          supplierId: d.supplierId,
          status: state.requestStatus,
          _count: {
            deliveries: new Set(
              state.decisions
                .filter(
                  (dec) =>
                    dec.decision === "REJECT" &&
                    state.deliveries.find((cand) => cand.id === dec.deliveryId)
                      ?.supplyRequestId === d.supplyRequestId,
                )
                .map((dec) => dec.deliveryId),
            ).size,
          },
        }
      : null,
    deliveryApprovals: state.decisions
      .filter((dec) => dec.deliveryId === d.id)
      .map((dec) => {
        const actor = identities.find((u) => u.id === dec.userId)!;
        return {
          id: dec.id,
          roleId: dec.roleId,
          userId: dec.userId,
          decision: dec.decision,
          reason: dec.reason,
          photoPublicId: dec.photoPublicId,
          photoHash: dec.photoHash,
          decidedAt: new Date(dec.decidedAt),
          Role: { code: actor.Role.code, name: actor.Role.code },
          User: { fullName: actor.fullName },
        };
      }),
    deliveryItems: d.items.map((item) => ({
      id: item.id,
      ingredientId: item.ingredientId,
      ingredientEntryId: item.ingredientEntryId,
      supplyRequestItemId: item.supplyRequestItemId,
      actualQuantity: new Prisma.Decimal(item.actual),
      unit: item.unit,
      sourceFacilityId: item.sourceFacilityId,
      sourceFacilityNameSnapshot: item.sourceFacilityNameSnapshot,
      sourceFacilityCodeSnapshot: item.sourceFacilityCodeSnapshot,
      ingredientNameSnapshot: item.ingredientNameSnapshot,
      SourceFacility:
        item.sourceFacilityId && state.facilities[item.sourceFacilityId]
          ? {
              id: item.sourceFacilityId,
              name: state.facilities[item.sourceFacilityId].name,
              facilityCode: "CS-LIVE",
              status: state.facilities[item.sourceFacilityId].status,
              supplierId: state.facilities[item.sourceFacilityId].supplierId,
            }
          : null,
      Ingredient: {
        id: item.ingredientId,
        supplierId,
        name: "Gạo ST25",
        ingredientCategory: null,
      },
      IngredientEntry:
        item.ingredientEntryId && state.entryStatus !== "MISSING"
          ? {
              id: item.ingredientEntryId,
              schoolId: d.schoolId,
              ingredientId: item.ingredientId,
              status: state.entryStatus,
              handlingType: "DIRECT_USE",
            }
          : null,
      SupplyRequestItem: item.supplyRequestItemId
        ? (() => {
            const source = getSourceItems().find(
              (s) => s.id === item.supplyRequestItemId,
            );
            return {
              supplyRequestId: source?.supplyRequestId ?? d.supplyRequestId,
              ingredientEntryId: source?.ingredientEntryId ?? entryId,
              requestedQuantity: new Prisma.Decimal(
                source?.requestedQuantity ?? state.requestedQuantity,
              ),
              unit: source?.unit ?? "kg",
              IngredientEntry: {
                schoolId: d.schoolId,
                ingredientId: source?.ingredientId ?? ingredientId,
                status: state.entryStatus,
                handlingType: "DIRECT_USE",
                Ingredient: {
                  supplierId,
                  name: source?.ingredientName ?? "Gạo ST25",
                  ingredientCategory: null,
                },
              },
            };
          })()
        : null,
      ingredientLots: item.lots.map((lot) => ({
        id: lot.id,
        receivedQuantity: new Prisma.Decimal(lot.quantity),
        availableQuantity: new Prisma.Decimal(lot.available),
        unit: lot.unit ?? "kg",
        status: lot.status,
        manufactureDate: lot.manufacture ? new Date(lot.manufacture) : null,
        expiryDate: lot.expiry ? new Date(lot.expiry) : null,
        sourceFacilityId: lot.sourceFacilityId,
        SourceFacility:
          lot.sourceFacilityId && state.facilities[lot.sourceFacilityId]
            ? {
                name: state.facilities[lot.sourceFacilityId].name,
                supplierId: state.facilities[lot.sourceFacilityId].supplierId,
                status: state.facilities[lot.sourceFacilityId].status,
              }
            : null,
      })),
    })),
  });

  const tx = {
    user: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(identities.find((u) => u.id === where.id) ?? null),
    },
    school: { findUnique: () => Promise.resolve({ status: "ACTIVE" }) },
    $queryRaw: () => Promise.resolve([]),
    supplyRequest: {
      update: ({
        where,
        data: changes,
      }: {
        where: { id: string };
        data: { status: string };
      }) => {
        assert.equal(where.id, requestId);
        state.requestStatus = changes.status;
        return Promise.resolve({});
      },
    },
    supplyRequestItem: {
      findMany: ({
        where,
      }: {
        where: {
          supplyRequestId: string;
          SupplyRequest?: {
            id?: string;
            schoolId?: string;
            supplierId?: string;
          };
        };
      }) =>
        Promise.resolve(
          getSourceItems()
            .filter(
              (item) =>
                item.supplyRequestId === where.supplyRequestId &&
                (!where.SupplyRequest?.schoolId ||
                  where.SupplyRequest.schoolId === schoolA) &&
                (!where.SupplyRequest?.supplierId ||
                  where.SupplyRequest.supplierId === supplierId),
            )
            .map((item) => ({
              id: item.id,
              supplyRequestId: item.supplyRequestId,
              ingredientEntryId: item.ingredientEntryId,
              requestedQuantity: new Prisma.Decimal(item.requestedQuantity),
              unit: item.unit,
              IngredientEntry: {
                ingredientId: item.ingredientId,
                schoolId: schoolA,
                status: state.entryStatus,
                Ingredient: { supplierId },
              },
            })),
        ),
    },
    ingredientEntry: {
      findMany: ({
        where,
      }: {
        where: {
          schoolId: string;
          ingredientId: { in: string[] };
        };
      }) => {
        if (!where.ingredientId) return Promise.resolve([]);
        if (state.entryStatus === "MISSING" || where.schoolId !== schoolA) {
          return Promise.resolve([]);
        }
        const results = getSourceItems()
          .filter((item) => where.ingredientId.in.includes(item.ingredientId))
          .map((item) => ({
            id: item.ingredientEntryId,
            schoolId: schoolA,
            ingredientId: item.ingredientId,
            status: state.entryStatus,
            handlingType: "DIRECT_USE",
          }));
        if (
          where.ingredientId.in.includes(ingredientId) &&
          !results.some((entry) => entry.ingredientId === ingredientId)
        ) {
          results.push({
            id: entryId,
            schoolId: schoolA,
            ingredientId,
            status: state.entryStatus,
            handlingType: "DIRECT_USE",
          });
        }
        return Promise.resolve(results);
      },
      findUnique: ({
        where,
      }: {
        where: {
          schoolId_ingredientId: { schoolId: string; ingredientId: string };
        };
      }) => {
        if (state.entryStatus === "MISSING") return Promise.resolve(null);
        if (
          where.schoolId_ingredientId.schoolId === schoolA &&
          where.schoolId_ingredientId.ingredientId === ingredientId
        ) {
          return Promise.resolve({
            id: entryId,
            schoolId: schoolA,
            ingredientId,
            status: state.entryStatus,
            handlingType: "DIRECT_USE",
          });
        }
        return Promise.resolve(null);
      },
    },
    deliveryItem: {
      findMany: ({
        where,
      }: {
        where: {
          supplyRequestItemId: string | { in: string[] };
          Delivery: { status: string; id?: { not: string } };
        };
      }) => {
        const sourceIds =
          typeof where.supplyRequestItemId === "string"
            ? [where.supplyRequestItemId]
            : where.supplyRequestItemId.in;
        const excludeId = where.Delivery.id?.not;
        return Promise.resolve(
          state.deliveries
            .filter(
              (d) =>
                d.status === where.Delivery.status &&
                (!excludeId || d.id !== excludeId),
            )
            .flatMap((d) =>
              d.items
                .filter(
                  (i) =>
                    i.supplyRequestItemId !== null &&
                    sourceIds.includes(i.supplyRequestItemId),
                )
                .map((i) => ({
                  supplyRequestItemId: i.supplyRequestItemId,
                  actualQuantity: new Prisma.Decimal(i.actual),
                  unit: i.unit,
                })),
            ),
        );
      },
      update: ({
        where,
        data: changes,
      }: {
        where: { id: string };
        data: { ingredientEntryId: string };
      }) => {
        for (const d of state.deliveries) {
          const item = d.items.find((i) => i.id === where.id);
          if (item) {
            item.ingredientEntryId = changes.ingredientEntryId;
            return Promise.resolve({
              id: item.id,
              ingredientEntryId: item.ingredientEntryId,
            });
          }
        }
        throw new Error("DeliveryItem not found");
      },
    },
    blockchainProof: {
      count: () => Promise.resolve(0),
      findFirst: () => Promise.resolve(null),
      create: () => Promise.resolve({ id: uid(99, 1) }),
    },
    delivery: {
      findUnique: ({ where }: { where: { id: string } }) => {
        const found = state.deliveries.find((d) => d.id === where.id);
        return Promise.resolve(found ? buildSnapshot(found) : null);
      },
      findFirst: ({
        where,
        select,
      }: {
        where: { id: string; schoolId: string };
        select: { supplyRequestId?: boolean; deliveryItems?: unknown };
      }) => {
        const found = state.deliveries.find(
          (d) => d.id === where.id && d.schoolId === where.schoolId,
        );
        if (!found) return Promise.resolve(null);
        return Promise.resolve(
          select.deliveryItems
            ? buildSnapshot(found)
            : { supplyRequestId: found.supplyRequestId },
        );
      },
      findMany: () => Promise.resolve([]),
      groupBy: () => Promise.resolve([]),
      update: ({
        where,
        data: changes,
      }: {
        where: { id: string };
        data: { status: string; receivedAt?: Date; receivedByUserId?: string };
      }) => {
        const d = state.deliveries.find((cand) => cand.id === where.id)!;
        d.status = changes.status;
        if (changes.receivedAt) d.receivedAt = changes.receivedAt.toISOString();
        return Promise.resolve({});
      },
      updateMany: ({
        where,
        data: changes,
      }: {
        where: {
          id?: string;
          schoolId?: string;
          traceabilityVersion?: number;
          status?: string | { in: string[] };
          arrivedAt?: null;
          supplyRequestId?: string;
        };
        data: { status: string; arrivedAt?: Date };
      }) => {
        if (where.traceabilityVersion === 1 && where.id) {
          const target = state.deliveries.find(
            (d) =>
              d.id === where.id &&
              d.schoolId === where.schoolId &&
              d.traceabilityVersion === 1 &&
              d.status === where.status &&
              d.arrivedAt === null,
          );
          if (!target) return Promise.resolve({ count: 0 });
          target.status = changes.status;
          target.arrivedAt = changes.arrivedAt?.toISOString() ?? null;
          return Promise.resolve({ count: 1 });
        }
        let count = 0;
        const allowed =
          typeof where.status === "object" && "in" in where.status
            ? where.status.in
            : [];
        for (const d of state.deliveries) {
          if (
            d.supplyRequestId === where.supplyRequestId &&
            allowed.includes(d.status)
          ) {
            d.status = changes.status;
            count += 1;
          }
        }
        return Promise.resolve({ count });
      },
      count: ({ where }: { where: { supplyRequestId: string } }) =>
        Promise.resolve(
          new Set(
            state.decisions
              .filter(
                (dec) =>
                  dec.decision === "REJECT" &&
                  state.deliveries.find((d) => d.id === dec.deliveryId)
                    ?.supplyRequestId === where.supplyRequestId,
              )
              .map((dec) => dec.deliveryId),
          ).size,
        ),
    },
    deliveryApproval: {
      create: ({
        data: dec,
      }: {
        data: {
          deliveryId: string;
          userId: string;
          roleId: string;
          decision: "APPROVE" | "REJECT";
          reason: string | null;
          photoPublicId?: string;
          photoHash?: string;
        };
      }) => {
        state.decisions.push({
          id: uid(99, state.decisions.length + 1),
          deliveryId: dec.deliveryId,
          userId: dec.userId,
          roleId: dec.roleId,
          decision: dec.decision,
          reason: dec.reason,
          photoPublicId: dec.photoPublicId ?? null,
          photoHash: dec.photoHash ?? null,
          decidedAt: state.currentTime.toISOString(),
        });
        return Promise.resolve({});
      },
    },
    inventoryTransaction: {
      count: ({ where }: { where: { ingredientLotId: { in: string[] } } }) =>
        Promise.resolve(
          state.receipts.filter((r) =>
            where.ingredientLotId.in.includes(r.ingredientLotId),
          ).length,
        ),
      create: ({
        data: rec,
      }: {
        data: { ingredientLotId: string; quantity: Prisma.Decimal };
      }) => {
        if (state.failReceipt) throw new Error("receipt write failed");
        state.receipts.push({
          ingredientLotId: rec.ingredientLotId,
          quantity: rec.quantity.toString(),
        });
        return Promise.resolve({});
      },
    },
    ingredientLot: {
      updateMany: ({
        where,
        data: changes,
      }: {
        where: {
          id?: string;
          status?: string;
          availableQuantity?: number;
          DeliveryItem?: {
            Delivery: { supplyRequestId: string; status: { not: string } };
          };
        };
        data: { availableQuantity?: Prisma.Decimal; status: string };
      }) => {
        if (where.id) {
          if (state.failReceiveLot) return Promise.resolve({ count: 0 });
          for (const d of state.deliveries) {
            for (const item of d.items) {
              for (const lot of item.lots) {
                if (
                  lot.id === where.id &&
                  lot.status === where.status &&
                  Number(lot.available) === 0
                ) {
                  lot.status = changes.status;
                  lot.available =
                    changes.availableQuantity?.toString() ?? lot.available;
                  return Promise.resolve({ count: 1 });
                }
              }
            }
          }
          return Promise.resolve({ count: 0 });
        }
        let count = 0;
        const reqTarget = where.DeliveryItem?.Delivery.supplyRequestId;
        const excludedStatus = where.DeliveryItem?.Delivery.status.not;
        for (const d of state.deliveries) {
          if (d.supplyRequestId === reqTarget && d.status !== excludedStatus) {
            for (const item of d.items) {
              for (const lot of item.lots) {
                if (lot.status === where.status) {
                  lot.status = changes.status;
                  count += 1;
                }
              }
            }
          }
        }
        return Promise.resolve({ count });
      },
    },
  };

  let queue = Promise.resolve();
  const client = {
    delivery: tx.delivery,
    ingredientEntry: tx.ingredientEntry,
    $transaction: async <T>(fn: (clientTx: typeof tx) => Promise<T>) => {
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const backup = {
        requestStatus: state.requestStatus,
        deliveries: structuredClone(state.deliveries),
        decisions: structuredClone(state.decisions),
        receipts: structuredClone(state.receipts),
      };
      try {
        return await fn(tx);
      } catch (error) {
        state.requestStatus = backup.requestStatus;
        state.deliveries = backup.deliveries;
        state.decisions = backup.decisions;
        state.receipts = backup.receipts;
        throw error;
      } finally {
        release();
      }
    },
  } as unknown as PrismaClient;

  const service = createDeliveryInspectionService(
    () => Promise.resolve(client),
    () => state.currentTime,
  );

  return {
    ids: {
      schoolA,
      schoolB,
      supplierId,
      requestId,
      requestItemId,
      ingredientId,
      entryId,
      sourceAId,
      sourceBId,
    },
    identities,
    actors,
    viewOnlyActor,
    inspectOnlyActor,
    wrongSchoolRoleActor,
    supplierActor,
    systemActor,
    authorityActor,
    otherSchoolActor,
    colleagueSameRoleActor,
    makeDelivery,
    state,
    service,
  };
}

void test("v1 arrival validation, RBAC scope, replay, and pre-arrival protection work via HTTP and service (T076)", async (t) => {
  const photo: OnboardingDocument = {
    id,
    field: "photo",
    publicId: "private/pre-arrival-inspection.jpg",
    format: "jpg",
    fileName: "inspection.jpg",
    bytes: 3,
  };
  t.mock.method(documentStorage, "upload", () => Promise.resolve(photo));
  const removedPhotos: OnboardingDocument[] = [];
  t.mock.method(documentStorage, "remove", (document: OnboardingDocument) => {
    removedPhotos.push(document);
    return Promise.resolve();
  });
  assert.deepEqual(validateDeliveryArrivalBody(undefined), {});
  assert.deepEqual(validateDeliveryArrivalBody({}), {});
  assert.deepEqual(validateDeliveryArrivalQuery({}), {});
  for (const invalidBody of [
    null,
    [],
    "now",
    { arrivedAt: "2026-11-15T05:00:00.000Z" },
    { lots: [] },
    { schoolId: id },
  ]) {
    assert.throws(() => validateDeliveryArrivalBody(invalidBody), {
      statusCode: 400,
    });
  }
  for (const invalidQuery of [{ schoolId: id }, { force: "1" }]) {
    assert.throws(() => validateDeliveryArrivalQuery(invalidQuery), {
      statusCode: 400,
    });
  }

  const f = v1InspectionFixture();
  const d1 = f.state.deliveries[0];
  // Supplier pause policy does not block ongoing arrival/inspection
  assert.equal(f.state.supplierIntakeState, "PAUSED");

  let currentPrincipal: AuthPrincipal | undefined = f.actors[0];
  const authenticate: RequestHandler = (req, _res, next) => {
    req.auth = currentPrincipal;
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

  const arrivalPath = `/deliveries/${d1.id}/arrival`;
  const postArrival = (body?: unknown, extraHeaders?: Record<string, string>) =>
    http.request(arrivalPath, {
      method: "POST",
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...extraHeaders,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  // Unauthenticated
  currentPrincipal = undefined;
  assert.equal((await postArrival()).status, 401);

  // Missing either delivery.view or delivery.inspect -> 403
  currentPrincipal = f.viewOnlyActor;
  assert.equal((await postArrival()).status, 403);
  currentPrincipal = f.inspectOnlyActor;
  assert.equal((await postArrival()).status, 403);

  // Wrong roles / portals -> 403, foreign school -> 404
  for (const forbidden of [
    f.wrongSchoolRoleActor,
    f.supplierActor,
    f.systemActor,
    f.authorityActor,
  ]) {
    currentPrincipal = forbidden;
    assert.equal((await postArrival()).status, 403);
  }
  currentPrincipal = f.otherSchoolActor;
  assert.equal((await postArrival()).status, 404);

  // Pre-arrival IN_TRANSIT cannot be inspected
  currentPrincipal = f.actors[1];
  const inspectionForm = new FormData();
  inspectionForm.set("decision", "APPROVE");
  inspectionForm.set(
    "photo",
    new Blob([new Uint8Array([255, 216, 255])], { type: "image/jpeg" }),
    "inspection.jpg",
  );
  assert.equal(
    (
      await http.request(`/deliveries/${d1.id}/inspection`, {
        method: "POST",
        body: inspectionForm,
      })
    ).status,
    409,
  );
  assert.deepEqual(removedPhotos, [photo]);
  assert.equal(f.state.decisions.length, 0);

  // Non-empty body / query -> 400
  assert.equal(
    (await postArrival({ arrivedAt: "2026-11-15T06:00:00.000Z" })).status,
    400,
  );
  assert.equal(
    (
      await http.request(`${arrivalPath}?schoolId=${f.ids.schoolB}`, {
        method: "POST",
      })
    ).status,
    400,
  );

  // Successful empty-body HTTP arrival sets server arrivedAt and leaves approvals/receipts empty
  const okArrival = await postArrival();
  assert.equal(okArrival.status, 200);
  const arrivedData = (
    okArrival.body as {
      data: {
        status: string;
        statusLabel: string;
        traceabilityVersion: number;
        arrivedAt: string;
        deliveryApprovals: unknown[];
        deliveryItems: Array<{
          ingredientName: string;
          sourceFacility: {
            id: string;
            name: string;
            facilityCode: string | null;
          } | null;
        }>;
      };
    }
  ).data;
  assert.equal(arrivedData.status, "ARRIVED");
  assert.equal(arrivedData.statusLabel, "Đã đến nơi");
  assert.equal(arrivedData.traceabilityVersion, 1);
  assert.equal(arrivedData.arrivedAt, "2026-11-15T05:00:00.000Z");
  assert.equal(arrivedData.deliveryApprovals.length, 0);
  assert.equal(
    arrivedData.deliveryItems[0].ingredientName,
    "Gạo ST25 (Snapshot)",
  );
  assert.deepEqual(arrivedData.deliveryItems[0].sourceFacility, {
    id: f.ids.sourceAId,
    name: "Nông trại A (Chụp lúc tạo)",
    facilityCode: "CS-A",
  });
  assert.equal(f.state.decisions.length, 0);
  assert.equal(f.state.receipts.length, 0);
  assert.equal(f.state.deliveries[0].items[0].lots[0].status, "BLOCKED");
  assert.equal(f.state.deliveries[0].items[0].lots[0].available, "0");

  // All 4 school inspection roles can replay arrival idempotently across progressed statuses without downgrading arrivedAt or status
  f.state.currentTime = new Date("2026-11-15T08:00:00.000Z");
  for (const [idx, actor] of f.actors.entries()) {
    currentPrincipal = actor;
    const progressed =
      idx === 0
        ? "ARRIVED"
        : idx === 1
          ? "PENDING_APPROVAL"
          : idx === 2
            ? "RECEIVED"
            : "REJECTED";
    f.state.deliveries[0].status = progressed;
    const replay = await postArrival({});
    assert.equal(replay.status, 200);
    const replayData = (
      replay.body as { data: { status: string; arrivedAt: string } }
    ).data;
    assert.equal(replayData.status, progressed);
    assert.equal(replayData.arrivedAt, "2026-11-15T05:00:00.000Z");
  }

  // Live permission revocation inside tx rejects before arrival mutation
  const revokedDelivery = f.makeDelivery(20);
  f.state.deliveries.push(revokedDelivery);
  f.identities[1].Role.rolePermissions =
    f.identities[1].Role.rolePermissions.filter(
      (p) => p.permission.code !== "delivery.inspect",
    );
  await assert.rejects(
    () => f.service.arrive(revokedDelivery.id, {}, {}, f.actors[1]),
    {
      statusCode: 403,
    },
  );
  assert.equal(revokedDelivery.status, "IN_TRANSIT");
  f.identities[1].Role.rolePermissions.push({
    permission: { code: "delivery.inspect", isActive: true },
  });

  // Legacy deliveries (traceabilityVersion === null) reject /arrival even in IN_TRANSIT or replay ARRIVED
  const legacyInTransit = f.makeDelivery(21, {
    traceabilityVersion: null,
    status: "IN_TRANSIT",
    arrivedAt: null,
  });
  const legacyArrived = f.makeDelivery(22, {
    traceabilityVersion: null,
    status: "ARRIVED",
    arrivedAt: "2026-11-14T00:00:00.000Z",
  });
  f.state.deliveries.push(legacyInTransit, legacyArrived);
  for (const legacy of [legacyInTransit, legacyArrived]) {
    await assert.rejects(
      () => f.service.arrive(legacy.id, {}, {}, f.actors[1]),
      {
        statusCode: 409,
      },
    );
  }

  // Cancelled delivery or cancelled parent SupplyRequest rejects arrival with 409
  const cancelledDelivery = f.makeDelivery(23, { status: "CANCELLED" });
  const cancelledMealDelivery = f.makeDelivery(24, {
    status: "CANCELLED_MEAL",
  });
  f.state.deliveries.push(cancelledDelivery, cancelledMealDelivery);
  await assert.rejects(
    () => f.service.arrive(cancelledDelivery.id, {}, {}, f.actors[1]),
    {
      statusCode: 409,
    },
  );
  await assert.rejects(
    () => f.service.arrive(cancelledMealDelivery.id, {}, {}, f.actors[1]),
    { statusCode: 409 },
  );
  const cancelledParentTarget = f.makeDelivery(25, {
    status: "ARRIVED",
    arrivedAt: "2026-11-15T05:00:00.000Z",
  });
  f.state.deliveries.push(cancelledParentTarget);
  f.state.requestStatus = "CANCELLED";
  await assert.rejects(
    () => f.service.arrive(cancelledParentTarget.id, {}, {}, f.actors[1]),
    { statusCode: 409 },
  );
});

void test("v1 receipt requires 4 signatures, enforces v1 lot source match without retro ACTIVE requirement, and keeps legacy multi-lot working (T082)", async () => {
  // 1..3 APPROVE create no stock; 4th APPROVE + concurrent caller receives exactly once; source renamed & INACTIVE after creation still succeeds
  const f = v1InspectionFixture();
  const d1 = f.state.deliveries[0];
  f.state.facilities[f.ids.sourceAId].status = "INACTIVE";
  await f.service.arrive(d1.id, {}, {}, f.actors[1]);

  for (const actor of f.actors.slice(0, 3)) {
    const step = await f.service.decide(d1.id, approve(), actor);
    assert.equal(step.status, "PENDING_APPROVAL");
    assert.equal(step.statusLabel, "Chờ duyệt");
    assert.equal(d1.items[0].lots[0].status, "BLOCKED");
    assert.equal(d1.items[0].lots[0].available, "0");
    assert.equal(f.state.receipts.length, 0);
  }
  const [firstFinal, secondFinal] = await Promise.all([
    f.service.decide(d1.id, approve(), f.actors[3]),
    f.service.decide(d1.id, approve(), f.actors[3]),
  ]);
  assert.equal(firstFinal.status, "RECEIVED");
  assert.equal(secondFinal.status, "RECEIVED");
  assert.equal(firstFinal.statusLabel, "Hoàn thành");
  assert.equal(f.state.receipts.length, 1);
  assert.equal(d1.items[0].lots[0].status, "AVAILABLE");
  assert.equal(d1.items[0].lots[0].available, "6.125");
  assert.equal(f.state.decisions.length, 4);

  // Source mismatch, missing item/lot source on v1, missing standalone ACTIVE entry, bad expiry/quantity/history, and receiveLot error roll back 4th decision cleanly
  for (const scenario of [
    "mismatch-lot-source",
    "null-lot-source",
    "null-item-source",
    "missing-entry",
    "inactive-entry",
    "bad-expiry",
    "bad-quantity",
    "existing-history",
    "receive-lot-cas-fail",
    "receipt-write-fail",
  ] as const) {
    const sub = v1InspectionFixture();
    const target =
      scenario === "missing-entry" || scenario === "inactive-entry"
        ? sub.state.deliveries[4] // standalone delivery
        : sub.state.deliveries[0];
    await sub.service.arrive(target.id, {}, {}, sub.actors[1]);
    for (const actor of sub.actors.slice(0, 3)) {
      await sub.service.decide(target.id, approve(), actor);
    }
    if (scenario === "mismatch-lot-source")
      target.items[0].lots[0].sourceFacilityId = sub.ids.sourceBId;
    if (scenario === "null-lot-source")
      target.items[0].lots[0].sourceFacilityId = null;
    if (scenario === "null-item-source")
      target.items[0].sourceFacilityId = null;
    if (scenario === "missing-entry") sub.state.entryStatus = "MISSING";
    if (scenario === "inactive-entry") sub.state.entryStatus = "INACTIVE";
    if (scenario === "bad-expiry")
      target.items[0].lots[0].expiry = "2026-11-10";
    if (scenario === "bad-quantity") target.items[0].actual = "9.000";
    if (scenario === "existing-history") {
      sub.state.receipts.push({
        ingredientLotId: target.items[0].lots[0].id,
        quantity: "1",
      });
    }
    if (scenario === "receive-lot-cas-fail") sub.state.failReceiveLot = true;
    if (scenario === "receipt-write-fail") sub.state.failReceipt = true;

    await assert.rejects(
      () => sub.service.decide(target.id, approve(), sub.actors[3]),
      scenario === "receipt-write-fail" ? Error : { statusCode: 409 },
    );
    const rolledBackTarget = sub.state.deliveries.find(
      (d) => d.id === target.id,
    )!;
    assert.equal(sub.state.decisions.length, 3);
    assert.equal(rolledBackTarget.status, "PENDING_APPROVAL");
    assert.equal(rolledBackTarget.items[0].lots[0].status, "BLOCKED");
    assert.equal(rolledBackTarget.items[0].lots[0].available, "0");
    assert.equal(
      sub.state.receipts.length,
      scenario === "existing-history" ? 1 : 0,
    );
  }

  // Legacy (traceabilityVersion === null) with multiple lots & null sourceFacilityId still receives without v1 source enforcement
  const legacyFixture = v1InspectionFixture();
  const legacyMultiLot = legacyFixture.makeDelivery(30, {
    traceabilityVersion: null,
    status: "ARRIVED",
    arrivedAt: "2026-11-15T04:30:00.000Z",
    sourceFacilityId: null,
    lotSourceFacilityId: null,
  });
  legacyMultiLot.items[0].lots = [
    {
      id: "00000000-0000-4000-0080-000000000101",
      quantity: "3.125",
      available: "0",
      status: "BLOCKED",
      manufacture: null,
      expiry: "2027-01-01",
      sourceFacilityId: null,
    },
    {
      id: "00000000-0000-4000-0080-000000000102",
      quantity: "3.000",
      available: "0",
      status: "BLOCKED",
      manufacture: null,
      expiry: "2027-01-01",
      sourceFacilityId: null,
    },
  ];
  legacyFixture.state.deliveries.push(legacyMultiLot);
  for (const actor of legacyFixture.actors) {
    await legacyFixture.service.decide(legacyMultiLot.id, approve(), actor);
  }
  assert.equal(legacyMultiLot.status, "RECEIVED");
  assert.equal(legacyFixture.state.receipts.length, 2);
  assert.equal(legacyMultiLot.items[0].lots[0].available, "3.125");
  assert.equal(legacyMultiLot.items[0].lots[1].available, "3");
});

void test("v1 reject immutability, photoHash replay, request cap3 preservation, and standalone null-counter isolation hold (T083)", async (context) => {
  context.mock.method(
    documentStorage,
    "download",
    (document: OnboardingDocument) =>
      `https://example.test/photos/${encodeURIComponent(document.publicId)}`,
  );
  const f = v1InspectionFixture();
  const [reqD1, reqD2, reqD3, reqD4, standaloneD1] = f.state.deliveries;
  const standaloneD2 = f.makeDelivery(6, { supplyRequestId: null });
  f.state.deliveries.push(standaloneD2);

  // Arrive all deliveries first
  for (const delivery of f.state.deliveries) {
    await f.service.arrive(delivery.id, {}, {}, f.actors[1]);
  }

  // Receive reqD4 first so later cap3 cancellation must keep RECEIVED delivery & its receipt intact
  for (const actor of f.actors) {
    await f.service.decide(reqD4.id, approve(), actor, {
      photoPublicId: `pub-${actor.role}`,
      photoHash: `hash-${actor.role}`,
    });
  }
  assert.equal(reqD4.status, "RECEIVED");
  assert.equal(f.state.receipts.length, 1);

  // Replay with matching photoHash succeeds (created: false); mismatched photoHash or different user same role fails 409
  const samePhotoReplay = await f.service.decide(
    reqD4.id,
    approve(),
    f.actors[0],
    { photoPublicId: "pub-ignored-new", photoHash: `hash-${f.actors[0].role}` },
  );
  assert.equal(samePhotoReplay.created, false);
  assert.equal(
    samePhotoReplay.deliveryApprovals.find(
      (approval) => approval.roleCode === f.actors[0].role,
    )?.photoUrl,
    `https://example.test/photos/pub-${f.actors[0].role}`,
  );
  await assert.rejects(
    () =>
      f.service.decide(reqD4.id, approve(), f.actors[0], {
        photoPublicId: "pub-other",
        photoHash: "different-hash",
      }),
    { statusCode: 409 },
  );
  await assert.rejects(
    () =>
      f.service.decide(reqD4.id, approve(), f.colleagueSameRoleActor, {
        photoPublicId: `pub-${f.actors[0].role}`,
        photoHash: `hash-${f.actors[0].role}`,
      }),
    { statusCode: 409 },
  );

  // Reject 2 standalone deliveries -> null cap counters, no SupplyRequest cancellation, no stock received
  for (const standalone of [standaloneD1, standaloneD2]) {
    const res = await f.service.decide(standalone.id, reject(), f.actors[0]);
    assert.equal(res.status, "REJECTED");
    assert.equal(res.statusLabel, "Yêu cầu giao hàng lại");
    assert.equal(res.redeliveryRequiredCount, null);
    assert.equal(res.redeliveryLimit, null);
    assert.equal(res.cancellationNotice, null);
    assert.equal(standalone.items[0].lots[0].status, "BLOCKED");
    assert.equal(standalone.items[0].lots[0].available, "0");
  }
  assert.equal(f.state.requestStatus, "IN_PROGRESS");

  // Two rejects on the same SupplyRequest keep IN_PROGRESS and count 2 (even if another role tries to sign later -> 409)
  const r1 = await f.service.decide(reqD1.id, reject(), f.actors[0]);
  assert.equal(r1.status, "REJECTED");
  assert.equal(r1.redeliveryRequiredCount, 1);
  assert.equal(f.state.requestStatus, "IN_PROGRESS");

  const r2 = await f.service.decide(reqD2.id, reject(), f.actors[1]);
  assert.equal(r2.status, "REJECTED");
  assert.equal(r2.redeliveryRequiredCount, 2);
  assert.equal(f.state.requestStatus, "IN_PROGRESS");

  // Pending delivery queued on same SupplyRequest before 3rd reject
  const reqPending = f.makeDelivery(7, { status: "IN_TRANSIT" });
  f.state.deliveries.push(reqPending);

  // 3rd distinct reject on same SupplyRequest cancels SupplyRequest + non-terminal pending deliveries, keeping RECEIVED reqD4 intact
  const r3 = await f.service.decide(reqD3.id, reject(), f.actors[2]);
  assert.equal(r3.redeliveryRequiredCount, 3);
  assert.equal(r3.redeliveryLimit, 2);
  assert.match(r3.cancellationNotice ?? "", /vượt quá 2/);
  assert.equal(f.state.requestStatus, "CANCELLED");
  assert.equal(reqPending.status, "CANCELLED");
  assert.equal(reqD4.status, "RECEIVED");
  assert.equal(f.state.receipts.length, 1);
});

void test("PREPARING blocks arrival/inspect 409 and dispatched v2 6+4 REQUEST + inactive source + standalone repeated ingredient receive cleanly (T138)", async (context) => {
  context.mock.method(
    documentStorage,
    "download",
    (document: OnboardingDocument) =>
      `https://example.test/photos/${encodeURIComponent(document.publicId)}`,
  );
  const approve = () =>
    validateDeliveryInspectionDecision({ decision: "APPROVE" });
  const f = v1InspectionFixture();
  f.state.requestedQuantity = "10";

  // 1. PREPARING blocks both school arrival and inspection with 409 without side effects
  const preparingOrder = f.makeDelivery(20, {
    workflowVersion: 2,
    status: "PREPARING",
    expectedArrivalAt: null,
    vehiclePlate: null,
  });
  f.state.deliveries.push(preparingOrder);
  await assert.rejects(
    () => f.service.arrive(preparingOrder.id, {}, {}, f.actors[1]),
    { statusCode: 409 },
  );
  await assert.rejects(
    () => f.service.decide(preparingOrder.id, approve(), f.actors[0]),
    { statusCode: 409 },
  );
  assert.equal(preparingOrder.arrivedAt, null);
  assert.equal(f.state.decisions.length, 0);
  assert.equal(f.state.receipts.length, 0);

  // 2. Dispatched v2 REQUEST 6+4 split on the same supplyRequestItemId receives both lots without exposing workflowVersion; inactive sourceFacility after prep does NOT block
  const v2Split = f.makeDelivery(21, {
    workflowVersion: 2,
    status: "IN_TRANSIT",
    expectedArrivalAt: "2026-11-15T04:00:00.000Z",
    vehiclePlate: "29C-64001",
  });
  v2Split.items = [
    {
      id: "00000000-0000-4000-0071-000000000001",
      ingredientId: f.ids.ingredientId,
      ingredientEntryId: f.ids.entryId,
      supplyRequestItemId: f.ids.requestItemId,
      actual: "6.000",
      unit: "kg",
      sourceFacilityId: f.ids.sourceAId,
      sourceFacilityNameSnapshot: "Nông trại A",
      sourceFacilityCodeSnapshot: "CS-A",
      ingredientNameSnapshot: "Gạo ST25",
      lots: [
        {
          id: "00000000-0000-4000-0081-000000000001",
          quantity: "6.000",
          available: "0",
          unit: "kg",
          status: "BLOCKED",
          manufacture: "2026-11-10",
          expiry: "2027-01-01",
          sourceFacilityId: f.ids.sourceAId,
        },
      ],
    },
    {
      id: "00000000-0000-4000-0071-000000000002",
      ingredientId: f.ids.ingredientId,
      ingredientEntryId: f.ids.entryId,
      supplyRequestItemId: f.ids.requestItemId,
      actual: "4.000",
      unit: "kg",
      sourceFacilityId: f.ids.sourceBId,
      sourceFacilityNameSnapshot: "Nông trại B",
      sourceFacilityCodeSnapshot: "CS-B",
      ingredientNameSnapshot: "Gạo ST25",
      lots: [
        {
          id: "00000000-0000-4000-0081-000000000002",
          quantity: "4.000",
          available: "0",
          unit: "kg",
          status: "BLOCKED",
          manufacture: "2026-11-10",
          expiry: "2027-01-01",
          sourceFacilityId: f.ids.sourceBId,
        },
      ],
    },
  ];
  f.state.deliveries.push(v2Split);

  const arrivedDto = await f.service.arrive(v2Split.id, {}, {}, f.actors[1]);
  assert.equal(arrivedDto.status, "ARRIVED");
  assert.equal("workflowVersion" in arrivedDto, false);
  // Deactivate facility B after creation/dispatch -> receipt MUST still succeed cleanly
  f.state.facilities[f.ids.sourceBId].status = "INACTIVE";

  for (const actor of f.actors.slice(0, 3)) {
    const partial = await f.service.decide(v2Split.id, approve(), actor);
    assert.equal(partial.status, "PENDING_APPROVAL");
    assert.equal("workflowVersion" in partial, false);
  }
  assert.equal(f.state.receipts.length, 0);

  const completed = await f.service.decide(v2Split.id, approve(), f.actors[3]);
  assert.equal(completed.status, "RECEIVED");
  assert.equal("workflowVersion" in completed, false);
  assert.equal(
    f.state.decisions.filter((d) => d.deliveryId === v2Split.id).length,
    4,
  );
  assert.equal(f.state.receipts.length, 2);
  assert.equal(v2Split.items[0].lots[0].status, "AVAILABLE");
  assert.equal(v2Split.items[0].lots[0].available, "6");
  assert.equal(v2Split.items[1].lots[0].status, "AVAILABLE");
  assert.equal(v2Split.items[1].lots[0].available, "4");
  const detailDto = await f.service.detail(v2Split.id, f.actors[0]);
  assert.equal("workflowVersion" in detailDto, false);
  assert.equal(detailDto.deliveryItems?.length, 2);

  // 3. STANDALONE repeated ingredient across 2 facilities attaches single IngredientEntry without collapsing lots/receipts
  const fStandalone = v1InspectionFixture();
  const standaloneMulti = fStandalone.makeDelivery(22, {
    supplyRequestId: null,
    workflowVersion: 2,
    status: "ARRIVED",
    arrivedAt: "2026-11-15T04:30:00.000Z",
    ingredientEntryId: null,
  });
  standaloneMulti.items = [
    {
      id: "00000000-0000-4000-0072-000000000001",
      ingredientId: fStandalone.ids.ingredientId,
      ingredientEntryId: null,
      supplyRequestItemId: null,
      actual: "6.000",
      unit: "kg",
      sourceFacilityId: fStandalone.ids.sourceAId,
      sourceFacilityNameSnapshot: "Nông trại A",
      sourceFacilityCodeSnapshot: "CS-A",
      ingredientNameSnapshot: "Gạo ST25",
      lots: [
        {
          id: "00000000-0000-4000-0082-000000000001",
          quantity: "6.000",
          available: "0",
          unit: "kg",
          status: "BLOCKED",
          manufacture: "2026-11-10",
          expiry: "2027-01-01",
          sourceFacilityId: fStandalone.ids.sourceAId,
        },
      ],
    },
    {
      id: "00000000-0000-4000-0072-000000000002",
      ingredientId: fStandalone.ids.ingredientId,
      ingredientEntryId: null,
      supplyRequestItemId: null,
      actual: "4.000",
      unit: "kg",
      sourceFacilityId: fStandalone.ids.sourceBId,
      sourceFacilityNameSnapshot: "Nông trại B",
      sourceFacilityCodeSnapshot: "CS-B",
      ingredientNameSnapshot: "Gạo ST25",
      lots: [
        {
          id: "00000000-0000-4000-0082-000000000002",
          quantity: "4.000",
          available: "0",
          unit: "kg",
          status: "BLOCKED",
          manufacture: "2026-11-10",
          expiry: "2027-01-01",
          sourceFacilityId: fStandalone.ids.sourceBId,
        },
      ],
    },
  ];
  fStandalone.state.deliveries.push(standaloneMulti);
  for (const actor of fStandalone.actors) {
    await fStandalone.service.decide(standaloneMulti.id, approve(), actor);
  }
  assert.equal(standaloneMulti.status, "RECEIVED");
  assert.equal(
    standaloneMulti.items[0].ingredientEntryId,
    fStandalone.ids.entryId,
  );
  assert.equal(
    standaloneMulti.items[1].ingredientEntryId,
    fStandalone.ids.entryId,
  );
  assert.equal(fStandalone.state.receipts.length, 2);
  assert.equal(standaloneMulti.items[0].lots[0].status, "AVAILABLE");
  assert.equal(standaloneMulti.items[1].lots[0].status, "AVAILABLE");
});

void test("v2 grouped/identity/unit/budget violations rollback cleanly while legacy partial convertQuantity and cap3 PREPARING cancellation stay intact (T138)", async () => {
  const approve = () =>
    validateDeliveryInspectionDecision({ decision: "APPROVE" });
  const reject = () =>
    validateDeliveryInspectionDecision({
      decision: "REJECT",
      reason: "Không đạt kiểm tra đầu vào",
    });

  for (const scenario of [
    "split-6-plus-6-over-10",
    "missing-source-group",
    "wrong-ingredient-id",
    "wrong-entry-id",
    "wrong-unit-no-conversion",
    "duplicate-ingredient-source-pair",
    "previous-received-plus-current-over-budget",
    "final-write-error-rollback",
  ] as const) {
    const sub = v1InspectionFixture();
    sub.state.requestedQuantity = "10";
    const delivery = sub.makeDelivery(31, {
      workflowVersion: 2,
      status: "IN_TRANSIT",
    });
    const makeItem = (
      idx: number,
      qty: string,
      facilityId: string,
      opts?: {
        ingredientId?: string;
        ingredientEntryId?: string;
        unit?: string;
      },
    ) => ({
      id: `00000000-0000-4000-0073-${String(idx).padStart(12, "0")}`,
      ingredientId: opts?.ingredientId ?? sub.ids.ingredientId,
      ingredientEntryId: opts?.ingredientEntryId ?? sub.ids.entryId,
      supplyRequestItemId: sub.ids.requestItemId,
      actual: qty,
      unit: opts?.unit ?? "kg",
      sourceFacilityId: facilityId,
      sourceFacilityNameSnapshot: "Nông trại",
      sourceFacilityCodeSnapshot: "CS",
      ingredientNameSnapshot: "Gạo ST25",
      lots: [
        {
          id: `00000000-0000-4000-0083-${String(idx).padStart(12, "0")}`,
          quantity: qty,
          available: "0",
          unit: opts?.unit ?? "kg",
          status: "BLOCKED",
          manufacture: "2026-11-10",
          expiry: "2027-01-01",
          sourceFacilityId: facilityId,
        },
      ],
    });

    if (scenario === "split-6-plus-6-over-10") {
      delivery.items = [
        makeItem(1, "6.000", sub.ids.sourceAId),
        makeItem(2, "6.000", sub.ids.sourceBId),
      ];
    } else if (scenario === "missing-source-group") {
      delivery.items = [makeItem(1, "10.000", sub.ids.sourceAId)];
      sub.state.customSourceItems = [
        {
          id: sub.ids.requestItemId,
          supplyRequestId: sub.ids.requestId,
          ingredientEntryId: sub.ids.entryId,
          ingredientId: sub.ids.ingredientId,
          requestedQuantity: "10",
          unit: "kg",
          ingredientName: "Gạo ST25",
        },
        {
          id: "00000000-0000-4000-0031-000000000002",
          supplyRequestId: sub.ids.requestId,
          ingredientEntryId: "00000000-0000-4000-0041-000000000002",
          ingredientId: "00000000-0000-4000-0040-000000000002",
          requestedQuantity: "5",
          unit: "kg",
          ingredientName: "Thịt heo",
        },
      ];
    } else if (scenario === "wrong-ingredient-id") {
      delivery.items = [
        makeItem(1, "10.000", sub.ids.sourceAId, {
          ingredientId: "00000000-0000-4000-0040-000000000099",
        }),
      ];
    } else if (scenario === "wrong-entry-id") {
      delivery.items = [
        makeItem(1, "10.000", sub.ids.sourceAId, {
          ingredientEntryId: "00000000-0000-4000-0041-000000000099",
        }),
      ];
    } else if (scenario === "wrong-unit-no-conversion") {
      delivery.items = [
        makeItem(1, "10000.000", sub.ids.sourceAId, { unit: "g" }),
      ];
    } else if (scenario === "duplicate-ingredient-source-pair") {
      delivery.items = [
        makeItem(1, "6.000", sub.ids.sourceAId),
        makeItem(2, "4.000", sub.ids.sourceAId),
      ];
    } else if (scenario === "previous-received-plus-current-over-budget") {
      const priorReceived = sub.makeDelivery(30, {
        workflowVersion: null,
        status: "RECEIVED",
        arrivedAt: "2026-11-15T02:00:00.000Z",
      });
      priorReceived.items[0].actual = "4.000";
      priorReceived.items[0].lots[0].quantity = "4.000";
      priorReceived.items[0].lots[0].available = "4.000";
      priorReceived.items[0].lots[0].status = "AVAILABLE";
      sub.state.deliveries.push(priorReceived);
      delivery.items = [
        makeItem(1, "6.000", sub.ids.sourceAId),
        makeItem(2, "4.000", sub.ids.sourceBId),
      ];
    } else {
      delivery.items = [
        makeItem(1, "6.000", sub.ids.sourceAId),
        makeItem(2, "4.000", sub.ids.sourceBId),
      ];
    }

    sub.state.deliveries.push(delivery);
    const arrived = await sub.service.arrive(
      delivery.id,
      {},
      {},
      sub.actors[1],
    );
    if (scenario !== "final-write-error-rollback") {
      // Lỗi dữ liệu được báo ngay khi xe đến và chặn từ chữ ký "Đạt" đầu tiên.
      assert.ok(arrived.receiptIssue, scenario);
      await assert.rejects(
        () => sub.service.decide(delivery.id, approve(), sub.actors[0]),
        { statusCode: 409, message: arrived.receiptIssue },
      );
      const blocked = sub.state.deliveries.find((d) => d.id === delivery.id)!;
      assert.equal(
        sub.state.decisions.filter((d) => d.deliveryId === delivery.id).length,
        0,
      );
      assert.equal(blocked.status, "ARRIVED");
      assert.equal(sub.state.receipts.length, 0);
      continue;
    }
    assert.equal(arrived.receiptIssue, null);
    for (const actor of sub.actors.slice(0, 3)) {
      await sub.service.decide(delivery.id, approve(), actor);
    }
    sub.state.failReceipt = true;

    await assert.rejects(
      () => sub.service.decide(delivery.id, approve(), sub.actors[3]),
      Error,
    );
    const rolledBack = sub.state.deliveries.find((d) => d.id === delivery.id)!;
    assert.equal(
      sub.state.decisions.filter((d) => d.deliveryId === delivery.id).length,
      3,
    );
    assert.equal(rolledBack.status, "PENDING_APPROVAL");
    assert.equal(sub.state.receipts.length, 0);
    for (const item of rolledBack.items) {
      for (const lot of item.lots) {
        assert.equal(lot.status, "BLOCKED");
        assert.equal(lot.available, "0");
      }
    }
  }

  // Legacy/v1 partial receipt (`previous 2 + current 3 <= 10`) with convertQuantity compatibility STILL succeeds
  const legacyFix = v1InspectionFixture();
  legacyFix.state.requestedQuantity = "10";
  legacyFix.state.customSourceItems = [
    {
      id: legacyFix.ids.requestItemId,
      supplyRequestId: legacyFix.ids.requestId,
      ingredientEntryId: legacyFix.ids.entryId,
      ingredientId: legacyFix.ids.ingredientId,
      requestedQuantity: "10",
      unit: "kg",
      ingredientName: "Gạo ST25",
    },
    {
      id: "00000000-0000-4000-0031-000000000002",
      supplyRequestId: legacyFix.ids.requestId,
      ingredientEntryId: "00000000-0000-4000-0041-000000000002",
      ingredientId: "00000000-0000-4000-0040-000000000002",
      requestedQuantity: "5",
      unit: "kg",
      ingredientName: "Thịt heo",
    },
  ];
  const prevLegacy = legacyFix.makeDelivery(40, {
    workflowVersion: null,
    status: "RECEIVED",
    arrivedAt: "2026-11-15T01:00:00.000Z",
  });
  prevLegacy.items[0].actual = "2.000";
  prevLegacy.items[0].lots[0].quantity = "2.000";
  prevLegacy.items[0].lots[0].available = "2.000";
  prevLegacy.items[0].lots[0].status = "AVAILABLE";
  const currentLegacy = legacyFix.makeDelivery(41, {
    workflowVersion: null,
    status: "IN_TRANSIT",
  });
  currentLegacy.items[0].actual = "3000.000";
  currentLegacy.items[0].unit = "g";
  currentLegacy.items[0].lots[0].quantity = "3000.000";
  currentLegacy.items[0].lots[0].unit = "g";
  legacyFix.state.deliveries.push(prevLegacy, currentLegacy);
  await legacyFix.service.arrive(currentLegacy.id, {}, {}, legacyFix.actors[1]);
  for (const actor of legacyFix.actors) {
    await legacyFix.service.decide(currentLegacy.id, approve(), actor);
  }
  assert.equal(currentLegacy.status, "RECEIVED");
  assert.equal(legacyFix.state.receipts.length, 1);

  // cap3 cancels both PREPARING (preserving null metadata) and post-dispatch IN_TRANSIT (preserving metadata) without touching RECEIVED stock/history
  const capFix = v1InspectionFixture();
  capFix.state.requestedQuantity = "10";
  const [d1, d2, d3] = capFix.state.deliveries;
  const receivedKeep = capFix.makeDelivery(50, {
    workflowVersion: 2,
    status: "IN_TRANSIT",
  });
  receivedKeep.items[0].actual = "10.000";
  receivedKeep.items[0].lots[0].quantity = "10.000";
  const preparingCancel = capFix.makeDelivery(51, {
    workflowVersion: 2,
    status: "PREPARING",
    expectedArrivalAt: null,
    vehiclePlate: null,
  });
  const transitCancel = capFix.makeDelivery(52, {
    workflowVersion: 2,
    status: "IN_TRANSIT",
    expectedArrivalAt: "2026-11-15T04:00:00.000Z",
    vehiclePlate: "29C-55555",
  });
  capFix.state.deliveries.push(receivedKeep, preparingCancel, transitCancel);
  await capFix.service.arrive(receivedKeep.id, {}, {}, capFix.actors[1]);
  for (const actor of capFix.actors) {
    await capFix.service.decide(receivedKeep.id, approve(), actor);
  }
  for (const d of [d1, d2, d3]) {
    await capFix.service.arrive(d.id, {}, {}, capFix.actors[1]);
  }
  await capFix.service.decide(d1.id, reject(), capFix.actors[0]);
  await capFix.service.decide(d2.id, reject(), capFix.actors[1]);
  await capFix.service.decide(d3.id, reject(), capFix.actors[2]);
  assert.equal(capFix.state.requestStatus, "CANCELLED");
  assert.equal(preparingCancel.status, "CANCELLED");
  assert.equal(preparingCancel.expectedArrivalAt, null);
  assert.equal(preparingCancel.vehiclePlate, null);
  assert.equal(transitCancel.status, "CANCELLED");
  assert.equal(transitCancel.expectedArrivalAt, "2026-11-15T04:00:00.000Z");
  assert.equal(transitCancel.vehiclePlate, "29C-55555");
  assert.equal(receivedKeep.status, "RECEIVED");
  assert.equal(receivedKeep.items[0].lots[0].status, "AVAILABLE");
  assert.equal(capFix.state.receipts.length, 1);
});
