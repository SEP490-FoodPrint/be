import express from "express";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "../src/generated/prisma/client";
import { ROLES } from "../src/constants/roles";
import type { AuthPrincipal } from "../src/types/auth";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import { createDeliveryRouter } from "../src/modules/delivery/delivery.routes";
import { createSupplierOrderRouter } from "../src/modules/supplier-order/supplier-order.routes";
import {
  supplierOrderRepository,
  type SupplierOrderRepository,
  type SupplierOrderSupplyRequestRecord,
  type SupplierOrderDetailRecord,
  type SupplierOrderCreateDeliveryInput,
} from "../src/modules/supplier-order/supplier-order.repository";
import { createSupplierOrderService } from "../src/modules/supplier-order/supplier-order.service";
import {
  validateCreateSupplierOrderBody,
  validateSupplierOrderDetailParams,
  validateSupplierOrderEmptyQuery,
  validateSupplierOrderIdempotencyKey,
  validateSupplierOrderListQuery,
  validateSupplierOrderOptionsQuery,
} from "../src/modules/supplier-order/supplier-order.validation";
import { HttpError } from "../src/utils/http-error";
import { RequestValidationError } from "../src/utils/request-validation";
import { startHttp } from "./helpers/http";
import { testAdmin, testStaff } from "./helpers/authorization";

const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const supplierId = uid(101);
const schoolId = uid(102);
const supplyRequestId = uid(103);
const deliveryId = uid(104);
const requestItemId = uid(105);
const entryId = uid(106);
const ingredientId = uid(107);
const idemKey1 = uid(201);
const idemKey2 = uid(202);

function makeSupplierActor(
  role:
    | typeof ROLES.INGREDIENT_SUPPLIER_ADMIN
    | typeof ROLES.INGREDIENT_SUPPLIER_STAFF = ROLES.INGREDIENT_SUPPLIER_ADMIN,
  permissions: string[] = ["delivery.manage"],
  overrides: Partial<AuthPrincipal> = {},
): AuthPrincipal {
  return {
    ...testStaff,
    id: role === ROLES.INGREDIENT_SUPPLIER_ADMIN ? uid(301) : uid(302),
    role,
    orgType: "SUPPLIER",
    schoolId: null,
    supplierId,
    communeFoodSafetyUnitId: null,
    permissions,
    ...overrides,
  };
}

function makeSupplyRequestRecord(
  status: "ACCEPTED" | "IN_PROGRESS" = "ACCEPTED",
  withItems = true,
): SupplierOrderSupplyRequestRecord {
  return {
    id: supplyRequestId,
    requestNo: "SR-2026-001",
    schoolId,
    supplierId,
    status,
    School: { name: "Tiểu học Hoa Mai" },
    supplyRequestItems: withItems
      ? [
          {
            id: requestItemId,
            ingredientEntryId: entryId,
            requestedQuantity: new Prisma.Decimal("12.500"),
            unit: "kg",
            note: "Giao sáng sớm",
            IngredientEntry: {
              id: entryId,
              ingredientId,
              Ingredient: {
                id: ingredientId,
                name: "Gạo ST25",
              },
            },
          },
        ]
      : [],
  };
}

function setupUs1Harness(options?: {
  supplyRequest?: SupplierOrderSupplyRequestRecord | null;
  priorDelivery?: boolean;
  updateInProgressCount?: number;
  guardError?: Error;
}) {
  const createdPayloads: SupplierOrderCreateDeliveryInput[] = [];
  const storedDeliveries = new Map<string, SupplierOrderDetailRecord>();
  let markedInProgress = false;
  let markCount = options?.updateInProgressCount ?? 1;
  let requestState =
    options && "supplyRequest" in options
      ? options.supplyRequest
      : makeSupplyRequestRecord("ACCEPTED");
  let hasPrior = options?.priorDelivery ?? false;
  const now = new Date("2026-11-15T01:00:00Z");

  const repo: SupplierOrderRepository = {
    connect: () => Promise.resolve({} as never),
    findByCreationKey: (_db, supId, userId, key) =>
      Promise.resolve(
        storedDeliveries.get(`${supId}:${userId}:${key}`) ?? null,
      ),
    findSupplyRequestForCreation: () => Promise.resolve(requestState ?? null),
    hasDeliveryForRequest: () => Promise.resolve(hasPrior),
    createDeliveryWithItems: (_db, input) => {
      createdPayloads.push(input);
      const record: SupplierOrderDetailRecord = {
        id: deliveryId,
        deliveryNo: input.deliveryNo,
        creationMode: input.creationMode,
        creationFingerprint: input.creationFingerprint,
        schoolId: input.schoolId,
        supplierId: input.supplierId,
        supplyRequestId: input.supplyRequestId,
        status: input.status,
        expectedArrivalAt: input.expectedArrivalAt,
        arrivedAt: null,
        receivedAt: null,
        vehiclePlate: input.vehiclePlate,
        note: input.note,
        createdByUserId: input.createdByUserId,
        createdAt: now,
        updatedAt: now,
        School: { name: "Tiểu học Hoa Mai" },
        SupplyRequest: input.supplyRequestId
          ? { requestNo: "SR-2026-001" }
          : null,
        deliveryItems: input.items.map((item, idx) => ({
          id: uid(500 + idx),
          ingredientId: item.ingredientId,
          ingredientEntryId: item.ingredientEntryId,
          supplyRequestItemId: item.supplyRequestItemId,
          actualQuantity: item.actualQuantity,
          unit: item.unit,
          note: item.note,
          Ingredient: { name: "Gạo ST25" },
        })),
      };
      storedDeliveries.set(
        `${input.supplierId}:${input.createdByUserId}:${input.creationKey}`,
        record,
      );
      hasPrior = true;
      return Promise.resolve(record);
    },
    markSupplyRequestInProgress: () => {
      markedInProgress = true;
      if (requestState && markCount > 0) {
        requestState = { ...requestState, status: "IN_PROGRESS" };
      }
      return Promise.resolve(markCount);
    },
    listSchoolOptions: () => Promise.resolve([]),
    listIngredientOptions: () => Promise.resolve([]),
    findIngredientsByIds: () => Promise.resolve([]),
    findIngredientEntriesForSchool: () => Promise.resolve([]),
    listManagementDeliveries: () => Promise.resolve([]),
    findManagementDeliveryById: () => Promise.resolve(null),
  };

  let txCommitted = false;
  let txRolledBack = false;
  const guardCalls: unknown[] = [];

  const service = createSupplierOrderService(repo, {
    transaction: async (fn) => {
      try {
        const result = await fn({} as never);
        txCommitted = true;
        return result;
      } catch (err) {
        txRolledBack = true;
        storedDeliveries.clear();
        createdPayloads.length = 0;
        markedInProgress = false;
        throw err;
      }
    },
    guard: {
      assertAccess: (_tx, actor, command) => {
        guardCalls.push(command);
        if (options?.guardError) return Promise.reject(options.guardError);
        return Promise.resolve(actor);
      },
    },
    verifyActor: (_tx, actor) => Promise.resolve(actor),
  });

  return {
    service,
    createdPayloads,
    guardCalls,
    getState: () => ({
      markedInProgress,
      txCommitted,
      txRolledBack,
      requestStatus: requestState?.status ?? null,
    }),
    setMarkCount: (count: number) => {
      markCount = count;
    },
  };
}

void test("US1 validation enforces Idempotency-Key header and strict REQUEST body", () => {
  assert.equal(
    validateSupplierOrderIdempotencyKey(idemKey1.toUpperCase()),
    idemKey1,
  );
  for (const badHeader of [undefined, "", "not-a-uuid", [idemKey1, idemKey2]]) {
    assert.throws(
      () => validateSupplierOrderIdempotencyKey(badHeader),
      (err: unknown) =>
        err instanceof RequestValidationError &&
        err.statusCode === 400 &&
        err.fields.some((f) => f.field === "Idempotency-Key"),
    );
  }

  const parsed = validateCreateSupplierOrderBody({
    sourceType: "REQUEST",
    supplyRequestId: supplyRequestId.toUpperCase(),
    expectedArrivalAt: "2026-11-16T08:30:00+07:00",
    vehiclePlate: "  29A-123.45  ",
    note: "   ",
  });
  assert.deepEqual(parsed, {
    sourceType: "REQUEST",
    supplyRequestId,
    expectedArrivalAt: "2026-11-16T01:30:00.000Z",
    vehiclePlate: "29A-123.45",
    note: null,
  });

  for (const invalidBody of [
    null,
    [],
    { sourceType: "REQUEST", supplyRequestId, schoolId },
    { sourceType: "REQUEST", supplyRequestId, supplierId },
    { sourceType: "REQUEST", supplyRequestId, items: [] },
    { sourceType: "REQUEST", supplyRequestId, deliveryNo: "DG-HACK" },
    {
      sourceType: "REQUEST",
      supplyRequestId,
      expectedArrivalAt: "2026-11-16T08:30:00",
    },
    { sourceType: "REQUEST", supplyRequestId, vehiclePlate: "x".repeat(41) },
    { sourceType: "REQUEST", supplyRequestId, note: "x".repeat(2001) },
  ]) {
    assert.throws(
      () => validateCreateSupplierOrderBody(invalidBody),
      (err: unknown) =>
        err instanceof RequestValidationError && err.statusCode === 400,
    );
  }

  assert.throws(
    () => validateSupplierOrderEmptyQuery({ unexpected: "1" }),
    (err: unknown) =>
      err instanceof RequestValidationError && err.statusCode === 400,
  );
});

void test("US1 creates REQUEST delivery for both supplier roles from ACCEPTED or IN_PROGRESS and transitions ACCEPTED", async () => {
  for (const role of [
    ROLES.INGREDIENT_SUPPLIER_ADMIN,
    ROLES.INGREDIENT_SUPPLIER_STAFF,
  ]) {
    const h = setupUs1Harness();
    const actor = makeSupplierActor(role);
    const body = validateCreateSupplierOrderBody({
      sourceType: "REQUEST",
      supplyRequestId,
      expectedArrivalAt: "2026-11-16T08:00:00+07:00",
      vehiclePlate: "29C-55555",
      note: "Giao đủ",
    });

    const result = await h.service.create(
      { idempotencyKey: idemKey1, body },
      actor,
    );
    assert.equal(result.created, true);
    assert.equal(result.sourceType, "REQUEST");
    assert.match(result.deliveryNo, /^DG-/);
    assert.equal(result.status, "CREATED");
    assert.equal(result.schoolId, schoolId);
    assert.equal(result.supplierId, supplierId);
    assert.equal(result.supplyRequestId, supplyRequestId);
    assert.equal(result.requestNo, "SR-2026-001");
    assert.equal(result.expectedArrivalAt, "2026-11-16T01:00:00.000Z");
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].supplyRequestItemId, requestItemId);
    assert.equal(result.items[0].ingredientId, ingredientId);
    assert.equal(result.items[0].ingredientEntryId, entryId);
    assert.equal(result.items[0].actualQuantity, "12.5");
    assert.equal("creationKey" in result, false);
    assert.equal("creationFingerprint" in result, false);
    assert.equal(h.getState().markedInProgress, true);
    assert.equal(h.getState().requestStatus, "IN_PROGRESS");
    assert.equal(h.getState().txCommitted, true);
    assert.deepEqual(h.guardCalls[0], {
      operation: "START_ORDER_PROCESSING",
      orderId: supplyRequestId,
      requiredPermission: "delivery.manage",
    });
  }

  const inProgressHarness = setupUs1Harness({
    supplyRequest: makeSupplyRequestRecord("IN_PROGRESS"),
  });
  const body = validateCreateSupplierOrderBody({
    sourceType: "REQUEST",
    supplyRequestId,
  });
  const inProgressResult = await inProgressHarness.service.create(
    { idempotencyKey: idemKey2, body },
    makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_STAFF),
  );
  assert.equal(inProgressResult.created, true);
  assert.equal(inProgressHarness.getState().markedInProgress, false);
});

void test("US1 rejects unauthorized roles/permissions, prior deliveries, empty items and rolls back on failures", async () => {
  const validInput = {
    idempotencyKey: idemKey1,
    body: validateCreateSupplierOrderBody({
      sourceType: "REQUEST",
      supplyRequestId,
    }),
  };

  const unauthorizedActors: AuthPrincipal[] = [
    makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_ADMIN, ["delivery.view"]),
    { ...testAdmin, orgType: "SYSTEM", permissions: ["delivery.manage"] },
    {
      ...testStaff,
      role: ROLES.SCHOOL_ADMINISTRATION,
      orgType: "SCHOOL",
      permissions: ["delivery.manage"],
    },
    makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_ADMIN, ["delivery.manage"], {
      supplierId: null,
    }),
  ];
  for (const unauthorized of unauthorizedActors) {
    const h = setupUs1Harness();
    await assert.rejects(() => h.service.create(validInput, unauthorized), {
      statusCode: 403,
    });
    assert.equal(h.guardCalls.length, 0);
  }

  const priorHarness = setupUs1Harness({ priorDelivery: true });
  await assert.rejects(
    () => priorHarness.service.create(validInput, makeSupplierActor()),
    { statusCode: 409 },
  );
  assert.equal(priorHarness.getState().txRolledBack, true);

  const emptyHarness = setupUs1Harness({
    supplyRequest: makeSupplyRequestRecord("ACCEPTED", false),
  });
  await assert.rejects(
    () => emptyHarness.service.create(validInput, makeSupplierActor()),
    { statusCode: 409 },
  );
  assert.equal(emptyHarness.getState().txRolledBack, true);

  const pausedHarness = setupUs1Harness({
    guardError: new HttpError(409, "Nhà cung cấp đang tạm dừng"),
  });
  await assert.rejects(
    () => pausedHarness.service.create(validInput, makeSupplierActor()),
    { statusCode: 409 },
  );
  assert.equal(pausedHarness.createdPayloads.length, 0);
  assert.equal(pausedHarness.getState().markedInProgress, false);
  assert.equal(pausedHarness.getState().txRolledBack, true);

  const raceHarness = setupUs1Harness({ updateInProgressCount: 0 });
  await assert.rejects(
    () => raceHarness.service.create(validInput, makeSupplierActor()),
    { statusCode: 409 },
  );
  assert.equal(raceHarness.getState().txRolledBack, true);
});

void test("US1 repository queries enforce supplier scope, ordering and atomic item creation", async () => {
  let seenCreateData: unknown;
  const mockDb = {
    delivery: {
      findFirst: ({ where }: { where: Record<string, unknown> }) => {
        assert.deepEqual(where, { supplyRequestId });
        return Promise.resolve(null);
      },
      create: ({ data }: { data: unknown }) => {
        seenCreateData = data;
        return Promise.resolve({ id: deliveryId });
      },
    },
    supplyRequest: {
      findUnique: () => Promise.resolve(makeSupplyRequestRecord("ACCEPTED")),
      updateMany: ({ where, data }: { where: unknown; data: unknown }) => {
        assert.deepEqual(where, { id: supplyRequestId, status: "ACCEPTED" });
        assert.deepEqual(data, { status: "IN_PROGRESS" });
        return Promise.resolve({ count: 1 });
      },
    },
  } as unknown as Parameters<
    SupplierOrderRepository["findSupplyRequestForCreation"]
  >[0];

  assert.equal(
    await supplierOrderRepository.hasDeliveryForRequest(
      mockDb,
      supplyRequestId,
    ),
    false,
  );
  await supplierOrderRepository.createDeliveryWithItems(mockDb, {
    deliveryNo: "DG-TEST",
    creationMode: "REQUEST",
    creationKey: idemKey1,
    creationFingerprint: "hash",
    schoolId,
    supplierId,
    supplyRequestId,
    createdByUserId: uid(301),
    expectedArrivalAt: null,
    vehiclePlate: null,
    note: null,
    status: "CREATED",
    items: [
      {
        supplyRequestItemId: requestItemId,
        ingredientId,
        ingredientEntryId: entryId,
        actualQuantity: new Prisma.Decimal("12.5"),
        unit: "kg",
        note: "Giao sáng",
      },
    ],
  });
  assert.equal(
    (seenCreateData as { creationMode: string }).creationMode,
    "REQUEST",
  );
  assert.equal(
    await supplierOrderRepository.markSupplyRequestInProgress(
      mockDb,
      supplyRequestId,
    ),
    1,
  );
});

void test("HTTP POST /api/deliveries/management mounts before /api/deliveries and creates REQUEST delivery cleanly", async (context) => {
  const h = setupUs1Harness();
  let actor = makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_STAFF);
  const app = express();
  app.use(express.json());
  app.use(
    "/api/deliveries/management",
    createSupplierOrderRouter(h.service, (req, _res, next) => {
      req.auth = actor;
      next();
    }),
  );
  app.use(
    "/api/deliveries",
    createDeliveryRouter(undefined, (req, _res, next) => {
      req.auth = actor;
      next();
    }),
  );
  app.use(globalErrorHandler);

  const http = await startHttp(app);
  context.after(() => http.close());

  const badKey = await http.request("/api/deliveries/management", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceType: "REQUEST", supplyRequestId }),
  });
  assert.equal(badKey.status, 400);

  const badQuery = await http.request("/api/deliveries/management?extra=1", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idemKey1,
    },
    body: JSON.stringify({ sourceType: "REQUEST", supplyRequestId }),
  });
  assert.equal(badQuery.status, 400);

  actor = { ...actor, permissions: ["delivery.view"] };
  const forbidden = await http.request("/api/deliveries/management", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idemKey1,
    },
    body: JSON.stringify({ sourceType: "REQUEST", supplyRequestId }),
  });
  assert.equal(forbidden.status, 403);

  actor = makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_STAFF);
  const created = await http.request("/api/deliveries/management", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idemKey1,
    },
    body: JSON.stringify({
      sourceType: "REQUEST",
      supplyRequestId,
      expectedArrivalAt: "2026-11-16T08:00:00+07:00",
    }),
  });
  assert.equal(created.status, 201);
  const payload = created.body as {
    success: boolean;
    data: Record<string, unknown>;
  };
  assert.equal(payload.success, true);
  assert.equal(payload.data.sourceType, "REQUEST");
  assert.equal(payload.data.supplyRequestId, supplyRequestId);
  assert.equal("created" in payload.data, false);
  assert.equal("creationKey" in payload.data, false);
  assert.equal("creationFingerprint" in payload.data, false);
});

void test("US2 validation enforces STANDALONE items, quantities, duplicate prevention and options pagination", () => {
  const valid = validateCreateSupplierOrderBody({
    sourceType: "STANDALONE",
    schoolId: schoolId.toUpperCase(),
    expectedArrivalAt: "2026-11-16T08:00:00+07:00",
    vehiclePlate: " 29D-999.88 ",
    note: "Giao độc lập",
    items: [
      {
        ingredientId: ingredientId.toUpperCase(),
        actualQuantity: "12.500",
        unit: " kg ",
      },
      {
        ingredientId: uid(108),
        actualQuantity: "10.000",
        unit: "lit",
      },
    ],
  });
  assert.equal(valid.sourceType, "STANDALONE");
  if (valid.sourceType !== "STANDALONE") assert.fail("expected STANDALONE");
  assert.equal(valid.schoolId, schoolId);
  assert.equal(valid.items[0].ingredientId, ingredientId);
  assert.equal(valid.items[0].actualQuantity, "12.5");
  assert.equal(valid.items[0].unit, "kg");
  assert.equal(valid.items[1].actualQuantity, "10");

  const dupCase = {
    sourceType: "STANDALONE",
    schoolId,
    items: [
      { ingredientId, actualQuantity: "1", unit: "kg" },
      {
        ingredientId: ingredientId.toUpperCase(),
        actualQuantity: "2",
        unit: "kg",
      },
    ],
  };
  assert.throws(
    () => validateCreateSupplierOrderBody(dupCase),
    (err: unknown) =>
      err instanceof RequestValidationError &&
      err.statusCode === 400 &&
      err.fields.some((f) => f.field === "items.1.ingredientId"),
  );

  for (const invalidStandalone of [
    { sourceType: "STANDALONE", schoolId, items: [] },
    {
      sourceType: "STANDALONE",
      schoolId,
      items: Array.from({ length: 101 }, (_, idx) => ({
        ingredientId: uid(1000 + idx),
        actualQuantity: "1",
        unit: "kg",
      })),
    },
    {
      sourceType: "STANDALONE",
      schoolId,
      supplyRequestId,
      items: [{ ingredientId, actualQuantity: "1", unit: "kg" }],
    },
    {
      sourceType: "STANDALONE",
      schoolId,
      supplyRequestItemId: requestItemId,
      items: [{ ingredientId, actualQuantity: "1", unit: "kg" }],
    },
    {
      sourceType: "STANDALONE",
      schoolId,
      previousDeliveryId: deliveryId,
      items: [{ ingredientId, actualQuantity: "1", unit: "kg" }],
    },
    {
      sourceType: "STANDALONE",
      schoolId,
      supplierId,
      items: [{ ingredientId, actualQuantity: "1", unit: "kg" }],
    },
    {
      sourceType: "STANDALONE",
      schoolId,
      items: [{ ingredientId, actualQuantity: "0", unit: "kg" }],
    },
    {
      sourceType: "STANDALONE",
      schoolId,
      items: [{ ingredientId, actualQuantity: "0.000", unit: "kg" }],
    },
    {
      sourceType: "STANDALONE",
      schoolId,
      items: [{ ingredientId, actualQuantity: "-1", unit: "kg" }],
    },
    {
      sourceType: "STANDALONE",
      schoolId,
      items: [{ ingredientId, actualQuantity: "1.2345", unit: "kg" }],
    },
    {
      sourceType: "STANDALONE",
      schoolId,
      items: [{ ingredientId, actualQuantity: "01", unit: "kg" }],
    },
    {
      sourceType: "STANDALONE",
      schoolId,
      items: [{ ingredientId, actualQuantity: 5, unit: "kg" }],
    },
    {
      sourceType: "STANDALONE",
      schoolId,
      items: [{ ingredientId, actualQuantity: "1", unit: "   " }],
    },
    {
      sourceType: "STANDALONE",
      schoolId,
      items: [{ ingredientId, actualQuantity: "1", unit: "x".repeat(31) }],
    },
    {
      sourceType: "STANDALONE",
      schoolId,
      items: [
        {
          ingredientId,
          actualQuantity: "1",
          unit: "kg",
          supplyRequestItemId: requestItemId,
        },
      ],
    },
  ]) {
    assert.throws(
      () => validateCreateSupplierOrderBody(invalidStandalone),
      (err: unknown) =>
        err instanceof RequestValidationError && err.statusCode === 400,
    );
  }

  assert.deepEqual(validateSupplierOrderOptionsQuery({}), {
    page: 1,
    limit: 20,
  });
  for (const badQuery of [
    { page: "0" },
    { limit: "101" },
    { schoolId },
    { search: "gao" },
  ]) {
    assert.throws(
      () => validateSupplierOrderOptionsQuery(badQuery),
      (err: unknown) =>
        err instanceof RequestValidationError && err.statusCode === 400,
    );
  }
});

void test("US2 creates STANDALONE delivery for both supplier roles, links only existing ACTIVE entries and validates ingredients", async () => {
  const ingredientId2 = uid(108);
  function setupStandalone(overrides?: {
    ingredients?: Array<{
      id: string;
      supplierId: string;
      name: string;
      defaultUnit: string;
      status: "ACTIVE" | "INACTIVE";
    }>;
    existingEntries?: Array<{ id: string; ingredientId: string }>;
    guardError?: Error;
  }) {
    const createdPayloads: SupplierOrderCreateDeliveryInput[] = [];
    const guardCommands: unknown[] = [];
    let autoCreatedEntry = false;
    let supplyRequestTouched = false;
    const ingredients = overrides?.ingredients ?? [
      {
        id: ingredientId,
        supplierId,
        name: "Gạo ST25",
        defaultUnit: "kg",
        status: "ACTIVE",
      },
      {
        id: ingredientId2,
        supplierId,
        name: "Thịt gà",
        defaultUnit: "kg",
        status: "ACTIVE",
      },
    ];
    const entries = overrides?.existingEntries ?? [
      { id: entryId, ingredientId },
    ];
    const now = new Date("2026-11-15T02:00:00Z");
    const repo: SupplierOrderRepository = {
      connect: () => Promise.resolve({} as never),
      findByCreationKey: () => Promise.resolve(null),
      findSupplyRequestForCreation: () => {
        supplyRequestTouched = true;
        return Promise.resolve(null);
      },
      hasDeliveryForRequest: () => Promise.resolve(false),
      markSupplyRequestInProgress: () => {
        supplyRequestTouched = true;
        return Promise.resolve(0);
      },
      listSchoolOptions: (_db, { skip, take }) => {
        assert.equal(skip, 0);
        assert.equal(take, 21);
        return Promise.resolve([
          { id: schoolId, code: "TH-HM", name: "Tiểu học Hoa Mai" },
        ]);
      },
      listIngredientOptions: (_db, { skip, take }) => {
        assert.equal(skip, 0);
        assert.equal(take, 21);
        return Promise.resolve([
          {
            id: ingredientId,
            name: "Gạo ST25",
            defaultUnit: "kg",
            categoryId: uid(401),
            ingredientCategory: { categoryName: "Lương thực" },
          },
        ]);
      },
      findIngredientsByIds: () => Promise.resolve(ingredients),
      findIngredientEntriesForSchool: () => Promise.resolve(entries),
      listManagementDeliveries: () => Promise.resolve([]),
      findManagementDeliveryById: () => Promise.resolve(null),
      createDeliveryWithItems: (_db, input) => {
        createdPayloads.push(input);
        return Promise.resolve({
          id: deliveryId,
          deliveryNo: input.deliveryNo,
          creationMode: input.creationMode,
          creationFingerprint: input.creationFingerprint,
          schoolId: input.schoolId,
          supplierId: input.supplierId,
          supplyRequestId: null,
          status: input.status,
          expectedArrivalAt: input.expectedArrivalAt,
          arrivedAt: null,
          receivedAt: null,
          vehiclePlate: input.vehiclePlate,
          note: input.note,
          createdByUserId: input.createdByUserId,
          createdAt: now,
          updatedAt: now,
          School: { name: "Tiểu học Hoa Mai" },
          SupplyRequest: null,
          deliveryItems: input.items.map((item, idx) => ({
            id: uid(600 + idx),
            ingredientId: item.ingredientId,
            ingredientEntryId: item.ingredientEntryId,
            supplyRequestItemId: item.supplyRequestItemId,
            actualQuantity: item.actualQuantity,
            unit: item.unit,
            note: item.note,
            Ingredient: {
              name:
                ingredients.find((i) => i.id === item.ingredientId)?.name ??
                "Unknown",
            },
          })),
        });
      },
    };
    const service = createSupplierOrderService(repo, {
      transaction: async (fn) =>
        fn({
          ingredientEntry: {
            create: () => {
              autoCreatedEntry = true;
              return Promise.reject(new Error("must not create entry"));
            },
          },
          supplyRequest: {
            create: () => {
              supplyRequestTouched = true;
              return Promise.reject(new Error("must not create supplyRequest"));
            },
          },
        } as never),
      guard: {
        assertAccess: (_tx, actor, command) => {
          guardCommands.push(command);
          if (overrides?.guardError)
            return Promise.reject(overrides.guardError);
          return Promise.resolve(actor);
        },
      },
      verifyActor: (_tx, actor) => Promise.resolve(actor),
    });
    return {
      service,
      createdPayloads,
      guardCommands,
      getFlags: () => ({ autoCreatedEntry, supplyRequestTouched }),
    };
  }

  for (const role of [
    ROLES.INGREDIENT_SUPPLIER_ADMIN,
    ROLES.INGREDIENT_SUPPLIER_STAFF,
  ]) {
    const h = setupStandalone();
    const actor = makeSupplierActor(role);
    const body = validateCreateSupplierOrderBody({
      sourceType: "STANDALONE",
      schoolId,
      items: [
        { ingredientId, actualQuantity: "5.250", unit: "kg" },
        { ingredientId: ingredientId2, actualQuantity: "8.000", unit: "kg" },
      ],
    });
    const res = await h.service.create(
      { idempotencyKey: idemKey1, body },
      actor,
    );
    assert.equal(res.created, true);
    assert.equal(res.sourceType, "STANDALONE");
    assert.equal(res.supplyRequestId, null);
    assert.equal(res.requestNo, null);
    assert.equal(res.items[0].supplyRequestItemId, null);
    assert.equal(res.items[0].ingredientEntryId, entryId);
    assert.equal(res.items[0].actualQuantity, "5.25");
    assert.equal(res.items[1].supplyRequestItemId, null);
    assert.equal(res.items[1].ingredientEntryId, null);
    assert.equal(res.items[1].actualQuantity, "8");
    assert.equal(h.getFlags().autoCreatedEntry, false);
    assert.equal(h.getFlags().supplyRequestTouched, false);
    assert.deepEqual(h.guardCommands[0], {
      operation: "SUPPLIER_CREATE_STANDALONE_DELIVERY",
      schoolId,
      ingredientIds: [ingredientId, ingredientId2],
    });
  }

  const unitMismatch = setupStandalone();
  await assert.rejects(
    () =>
      unitMismatch.service.create(
        {
          idempotencyKey: idemKey1,
          body: validateCreateSupplierOrderBody({
            sourceType: "STANDALONE",
            schoolId,
            items: [{ ingredientId, actualQuantity: "1", unit: "gam" }],
          }),
        },
        makeSupplierActor(),
      ),
    { statusCode: 409 },
  );

  const inactiveIngredient = setupStandalone({
    ingredients: [
      {
        id: ingredientId,
        supplierId,
        name: "Gạo ST25",
        defaultUnit: "kg",
        status: "INACTIVE",
      },
    ],
  });
  await assert.rejects(
    () =>
      inactiveIngredient.service.create(
        {
          idempotencyKey: idemKey1,
          body: validateCreateSupplierOrderBody({
            sourceType: "STANDALONE",
            schoolId,
            items: [{ ingredientId, actualQuantity: "1", unit: "kg" }],
          }),
        },
        makeSupplierActor(),
      ),
    { statusCode: 409 },
  );

  const foreignIngredient = setupStandalone({
    ingredients: [
      {
        id: ingredientId,
        supplierId: uid(999),
        name: "Foreign",
        defaultUnit: "kg",
        status: "ACTIVE",
      },
    ],
  });
  await assert.rejects(
    () =>
      foreignIngredient.service.create(
        {
          idempotencyKey: idemKey1,
          body: validateCreateSupplierOrderBody({
            sourceType: "STANDALONE",
            schoolId,
            items: [{ ingredientId, actualQuantity: "1", unit: "kg" }],
          }),
        },
        makeSupplierActor(),
      ),
    { statusCode: 404 },
  );

  const pausedGuard = setupStandalone({
    guardError: new HttpError(409, "Trường đang tạm dừng nhận đơn"),
  });
  await assert.rejects(
    () =>
      pausedGuard.service.create(
        {
          idempotencyKey: idemKey1,
          body: validateCreateSupplierOrderBody({
            sourceType: "STANDALONE",
            schoolId,
            items: [{ ingredientId, actualQuantity: "1", unit: "kg" }],
          }),
        },
        makeSupplierActor(),
      ),
    { statusCode: 409 },
  );
  assert.equal(pausedGuard.createdPayloads.length, 0);
});

void test("US2 options repository queries and HTTP endpoints return safe scoped options and reject unauthorized callers", async (context) => {
  let schoolWhere: Record<string, unknown> | undefined;
  let ingredientWhere: Record<string, unknown> | undefined;
  let entryWhere: Record<string, unknown> | undefined;
  const mockDb = {
    school: {
      findMany: (args: {
        where: Record<string, unknown>;
        orderBy: unknown;
      }) => {
        schoolWhere = args.where;
        assert.deepEqual(args.orderBy, [{ id: "asc" }]);
        return Promise.resolve([
          { id: schoolId, code: "TH-HM", name: "Tiểu học Hoa Mai" },
        ]);
      },
    },
    ingredient: {
      findMany: (args: {
        where: Record<string, unknown>;
        orderBy?: unknown;
      }) => {
        ingredientWhere = args.where;
        if (args.orderBy) assert.deepEqual(args.orderBy, [{ id: "asc" }]);
        return Promise.resolve([
          {
            id: ingredientId,
            name: "Gạo ST25",
            defaultUnit: "kg",
            categoryId: null,
            ingredientCategory: null,
          },
        ]);
      },
    },
    ingredientEntry: {
      findMany: (args: { where: Record<string, unknown> }) => {
        entryWhere = args.where;
        return Promise.resolve([{ id: entryId, ingredientId }]);
      },
    },
  } as unknown as Parameters<SupplierOrderRepository["listSchoolOptions"]>[0];

  const schools = await supplierOrderRepository.listSchoolOptions(mockDb, {
    supplierId,
    skip: 0,
    take: 21,
  });
  assert.equal(schools[0].code, "TH-HM");
  assert.deepEqual(schoolWhere, {
    status: "ACTIVE",
    intakeState: "ACTIVE",
    users: {
      none: { roleCode: "SCHOOL_ADMINISTRATION", status: "DEACTIVATED" },
    },
    schoolSupplierRelationships: {
      some: { supplierId, status: "ACTIVE" },
    },
  });

  await supplierOrderRepository.listIngredientOptions(mockDb, {
    supplierId,
    skip: 0,
    take: 21,
  });
  assert.deepEqual(ingredientWhere, { supplierId, status: "ACTIVE" });

  await supplierOrderRepository.findIngredientEntriesForSchool(
    mockDb,
    schoolId,
    [ingredientId],
  );
  assert.deepEqual(entryWhere, {
    schoolId,
    ingredientId: { in: [ingredientId] },
    status: "ACTIVE",
  });

  const service = createSupplierOrderService(
    {
      ...supplierOrderRepository,
      connect: () => Promise.resolve(mockDb as never),
    },
    {
      transaction: async (fn) => fn(mockDb),
      verifyActor: (_tx, actor) => Promise.resolve(actor),
    },
  );

  let actor: AuthPrincipal = makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_STAFF);
  const app = express();
  app.use(express.json());
  app.use(
    "/api/deliveries/management",
    createSupplierOrderRouter(service, (req, _res, next) => {
      req.auth = actor;
      next();
    }),
  );
  app.use(globalErrorHandler);
  const http = await startHttp(app);
  context.after(() => http.close());

  const schoolRes = await http.request(
    "/api/deliveries/management/options/schools?page=1&limit=20",
  );
  assert.equal(schoolRes.status, 200);
  const schoolBody = schoolRes.body as {
    data: { items: Record<string, unknown>[]; pagination: unknown };
  };
  assert.deepEqual(schoolBody.data.items, [
    { id: schoolId, code: "TH-HM", name: "Tiểu học Hoa Mai" },
  ]);
  assert.deepEqual(schoolBody.data.pagination, {
    page: 1,
    limit: 20,
    hasNext: false,
  });

  const ingRes = await http.request(
    "/api/deliveries/management/options/ingredients",
  );
  assert.equal(ingRes.status, 200);

  actor = { ...actor, permissions: ["delivery.view"] };
  assert.equal(
    (await http.request("/api/deliveries/management/options/schools")).status,
    403,
  );
  assert.equal(
    (await http.request("/api/deliveries/management/options/ingredients"))
      .status,
    403,
  );
});

void test("US3 validates list queries and detail params cleanly", () => {
  assert.deepEqual(validateSupplierOrderListQuery({}), {
    page: 1,
    limit: 20,
  });
  assert.deepEqual(
    validateSupplierOrderListQuery({
      page: "2",
      limit: "50",
      sourceType: "STANDALONE",
      status: "CREATED",
    }),
    {
      page: 2,
      limit: 50,
      sourceType: "STANDALONE",
      status: "CREATED",
    },
  );
  assert.equal(
    validateSupplierOrderDetailParams({ id: deliveryId.toUpperCase() }).id,
    deliveryId,
  );
  for (const bad of [
    { sourceType: "LEGACY" },
    { status: "DRAFT" },
    { supplierId },
    { schoolId },
    { limit: "101" },
  ]) {
    assert.throws(
      () => validateSupplierOrderListQuery(bad),
      (err: unknown) =>
        err instanceof RequestValidationError && err.statusCode === 400,
    );
  }
  assert.throws(
    () => validateSupplierOrderDetailParams({ id: "not-a-uuid" }),
    (err: unknown) =>
      err instanceof RequestValidationError && err.statusCode === 400,
  );
});

void test("US3 idempotent replay returns 200 without re-creating, checks live actor first, rejects 409 on conflict and recovers P2002 races", async () => {
  const ingredientId2 = uid(108);
  const now = new Date("2026-11-15T03:00:00Z");
  const deliveries = new Map<string, SupplierOrderDetailRecord>();
  let createCalls = 0;
  let guardCalls = 0;
  let verifyActorError: Error | null = null;
  let throwP2002Once = false;

  const repo: SupplierOrderRepository = {
    connect: () => Promise.resolve({} as never),
    findByCreationKey: (_db, supId, userId, key) =>
      Promise.resolve(deliveries.get(`${supId}:${userId}:${key}`) ?? null),
    findSupplyRequestForCreation: () =>
      Promise.resolve(makeSupplyRequestRecord("ACCEPTED")),
    hasDeliveryForRequest: () => Promise.resolve(false),
    markSupplyRequestInProgress: () => Promise.resolve(1),
    listSchoolOptions: () => Promise.resolve([]),
    listIngredientOptions: () => Promise.resolve([]),
    findIngredientsByIds: () =>
      Promise.resolve([
        {
          id: ingredientId,
          supplierId,
          name: "Gạo ST25",
          defaultUnit: "kg",
          status: "ACTIVE",
        },
        {
          id: ingredientId2,
          supplierId,
          name: "Thịt gà",
          defaultUnit: "kg",
          status: "ACTIVE",
        },
      ]),
    findIngredientEntriesForSchool: () => Promise.resolve([]),
    listManagementDeliveries: () => Promise.resolve([]),
    findManagementDeliveryById: () => Promise.resolve(null),
    createDeliveryWithItems: (_db, input) => {
      createCalls += 1;
      const record: SupplierOrderDetailRecord = {
        id: deliveryId,
        deliveryNo: input.deliveryNo,
        creationMode: input.creationMode,
        creationFingerprint: input.creationFingerprint,
        schoolId: input.schoolId,
        supplierId: input.supplierId,
        supplyRequestId: input.supplyRequestId,
        status: input.status,
        expectedArrivalAt: input.expectedArrivalAt,
        arrivedAt: null,
        receivedAt: null,
        vehiclePlate: input.vehiclePlate,
        note: input.note,
        createdByUserId: input.createdByUserId,
        createdAt: now,
        updatedAt: now,
        School: { name: "Tiểu học Hoa Mai" },
        SupplyRequest: null,
        deliveryItems: input.items.map((item, idx) => ({
          id: uid(700 + idx),
          ingredientId: item.ingredientId,
          ingredientEntryId: item.ingredientEntryId,
          supplyRequestItemId: item.supplyRequestItemId,
          actualQuantity: item.actualQuantity,
          unit: item.unit,
          note: item.note,
          Ingredient: {
            name: item.ingredientId === ingredientId ? "Gạo ST25" : "Thịt gà",
          },
        })),
      };
      deliveries.set(
        `${input.supplierId}:${input.createdByUserId}:${input.creationKey}`,
        record,
      );
      return Promise.resolve(record);
    },
  };

  const service = createSupplierOrderService(repo, {
    transaction: async (fn) => {
      if (throwP2002Once) {
        throwP2002Once = false;
        throw new Prisma.PrismaClientKnownRequestError("Unique conflict", {
          code: "P2002",
          clientVersion: "test",
        });
      }
      return fn({} as never);
    },
    guard: {
      assertAccess: (_tx, actor) => {
        guardCalls += 1;
        return Promise.resolve(actor);
      },
    },
    verifyActor: (_tx, actor) => {
      if (verifyActorError) return Promise.reject(verifyActorError);
      return Promise.resolve(actor);
    },
  });

  const actor1 = makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_STAFF);
  const firstBody = validateCreateSupplierOrderBody({
    sourceType: "STANDALONE",
    schoolId,
    expectedArrivalAt: "2026-11-16T08:00:00+07:00",
    vehiclePlate: "29A-12345",
    items: [
      { ingredientId, actualQuantity: "12.500", unit: "kg" },
      { ingredientId: ingredientId2, actualQuantity: "5.000", unit: "kg" },
    ],
  });
  const first = await service.create(
    { idempotencyKey: idemKey1, body: firstBody },
    actor1,
  );
  assert.equal(first.created, true);
  assert.equal(createCalls, 1);
  assert.equal(guardCalls, 1);

  const equivalentBody = validateCreateSupplierOrderBody({
    sourceType: "STANDALONE",
    schoolId,
    expectedArrivalAt: "2026-11-16T01:00:00Z",
    vehiclePlate: " 29A-12345 ",
    note: "   ",
    items: [
      { ingredientId: ingredientId2, actualQuantity: "5", unit: "kg" },
      { ingredientId, actualQuantity: "12.5", unit: "kg" },
    ],
  });
  const replay = await service.create(
    { idempotencyKey: idemKey1, body: equivalentBody },
    actor1,
  );
  assert.equal(replay.created, false);
  assert.equal(replay.id, first.id);
  assert.equal(replay.deliveryNo, first.deliveryNo);
  assert.equal(replay.updatedAt, first.updatedAt);
  assert.equal(createCalls, 1);
  assert.equal(guardCalls, 1);

  await assert.rejects(
    () =>
      service.create(
        {
          idempotencyKey: idemKey1,
          body: validateCreateSupplierOrderBody({
            sourceType: "STANDALONE",
            schoolId,
            items: [{ ingredientId, actualQuantity: "99", unit: "kg" }],
          }),
        },
        actor1,
      ),
    { statusCode: 409 },
  );

  verifyActorError = new HttpError(403, "Quyền đã bị thu hồi");
  await assert.rejects(
    () => service.create({ idempotencyKey: idemKey1, body: firstBody }, actor1),
    { statusCode: 403 },
  );
  verifyActorError = null;

  const anotherActor = makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_ADMIN);
  const separate = await service.create(
    { idempotencyKey: idemKey1, body: firstBody },
    anotherActor,
  );
  assert.equal(separate.created, true);
  assert.equal(createCalls, 2);

  throwP2002Once = true;
  const raceReplay = await service.create(
    { idempotencyKey: idemKey1, body: equivalentBody },
    actor1,
  );
  assert.equal(raceReplay.created, false);
  assert.equal(raceReplay.id, first.id);
});

void test("US3 lists, filters legacy+standalone deliveries, returns detail and enforces foreign 404 & HTTP replay statuses", async (context) => {
  const now = new Date("2026-11-15T04:00:00Z");
  const legacyRecord = {
    id: deliveryId,
    deliveryNo: "DG-LEGACY-1",
    creationMode: null,
    creationFingerprint: null,
    schoolId,
    supplierId,
    supplyRequestId,
    status: "CREATED" as const,
    expectedArrivalAt: null,
    arrivedAt: null,
    receivedAt: null,
    vehiclePlate: null,
    note: null,
    createdByUserId: uid(301),
    createdAt: now,
    updatedAt: now,
    School: { name: "Tiểu học Hoa Mai" },
    SupplyRequest: { requestNo: "SR-2026-001" },
  };
  const standaloneRecord: SupplierOrderDetailRecord = {
    id: uid(199),
    deliveryNo: "DG-STD-2",
    creationMode: "STANDALONE",
    creationFingerprint: "secret-fp",
    schoolId,
    supplierId,
    supplyRequestId: null,
    status: "CREATED",
    expectedArrivalAt: null,
    arrivedAt: null,
    receivedAt: null,
    vehiclePlate: "29A-77777",
    note: null,
    createdByUserId: uid(302),
    createdAt: now,
    updatedAt: now,
    School: { name: "Tiểu học Hoa Mai" },
    SupplyRequest: null,
    deliveryItems: [
      {
        id: uid(801),
        ingredientId,
        ingredientEntryId: null,
        supplyRequestItemId: null,
        actualQuantity: new Prisma.Decimal("3.250"),
        unit: "kg",
        note: null,
        Ingredient: { name: "Gạo ST25" },
      },
    ],
  };

  let capturedListArgs: Record<string, unknown> | undefined;
  let capturedDetailWhere: Record<string, unknown> | undefined;
  const mockDb = {
    delivery: {
      findMany: (args: Record<string, unknown>) => {
        capturedListArgs = args;
        return Promise.resolve([legacyRecord, standaloneRecord]);
      },
      findFirst: (args: { where: Record<string, unknown> }) => {
        capturedDetailWhere = args.where;
        if (JSON.stringify(args.where).includes(standaloneRecord.id)) {
          return Promise.resolve(standaloneRecord);
        }
        return Promise.resolve(null);
      },
    },
  } as unknown as Parameters<
    SupplierOrderRepository["listManagementDeliveries"]
  >[0];

  const rows = await supplierOrderRepository.listManagementDeliveries(mockDb, {
    scope: { supplierId },
    skip: 0,
    take: 21,
    sourceType: "REQUEST",
    status: "CREATED",
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(capturedListArgs?.orderBy, [
    { createdAt: "desc" },
    { id: "asc" },
  ]);
  const listWhere = capturedListArgs?.where as { AND: unknown[] };
  assert.ok(
    JSON.stringify(listWhere).includes('"creationMode":null') &&
      JSON.stringify(listWhere).includes('"supplyRequestId":{"not":null}'),
  );

  const detailRow = await supplierOrderRepository.findManagementDeliveryById(
    mockDb,
    { supplierId },
    standaloneRecord.id,
  );
  assert.equal(detailRow?.id, standaloneRecord.id);
  assert.deepEqual(capturedDetailWhere, {
    AND: [{ supplierId }, { id: standaloneRecord.id }],
  });

  const persisted = new Map<string, SupplierOrderDetailRecord>();
  const httpRepo: SupplierOrderRepository = {
    ...supplierOrderRepository,
    connect: () => Promise.resolve(mockDb as never),
    findByCreationKey: (_db, supId, userId, key) =>
      Promise.resolve(persisted.get(`${supId}:${userId}:${key}`) ?? null),
    findIngredientsByIds: () =>
      Promise.resolve([
        {
          id: ingredientId,
          supplierId,
          name: "Gạo ST25",
          defaultUnit: "kg",
          status: "ACTIVE",
        },
      ]),
    findIngredientEntriesForSchool: () => Promise.resolve([]),
    createDeliveryWithItems: (_db, input) => {
      const created: SupplierOrderDetailRecord = {
        ...standaloneRecord,
        id: deliveryId,
        deliveryNo: input.deliveryNo,
        creationFingerprint: input.creationFingerprint,
        createdByUserId: input.createdByUserId,
      };
      persisted.set(
        `${input.supplierId}:${input.createdByUserId}:${input.creationKey}`,
        created,
      );
      return Promise.resolve(created);
    },
  };
  const service = createSupplierOrderService(httpRepo, {
    transaction: async (fn) => fn(mockDb),
    guard: { assertAccess: (_tx, a) => Promise.resolve(a) },
    verifyActor: (_tx, a) => Promise.resolve(a),
  });

  let actor: AuthPrincipal = makeSupplierActor(
    ROLES.INGREDIENT_SUPPLIER_STAFF,
    ["delivery.view", "delivery.manage"],
  );
  const app = express();
  app.use(express.json());
  app.use(
    "/api/deliveries/management",
    createSupplierOrderRouter(service, (req, _res, next) => {
      req.auth = actor;
      next();
    }),
  );
  app.use(globalErrorHandler);
  const http = await startHttp(app);
  context.after(() => http.close());

  const listRes = await http.request(
    "/api/deliveries/management?page=1&limit=20&sourceType=REQUEST",
  );
  assert.equal(listRes.status, 200);
  const listData = (
    listRes.body as { data: { items: Array<Record<string, unknown>> } }
  ).data.items;
  assert.equal(listData[0].sourceType, "REQUEST");
  assert.equal(listData[1].sourceType, "STANDALONE");
  assert.equal("creationKey" in listData[1], false);
  assert.equal("creationFingerprint" in listData[1], false);

  const detailRes = await http.request(
    `/api/deliveries/management/${standaloneRecord.id}`,
  );
  assert.equal(detailRes.status, 200);
  assert.equal(
    (detailRes.body as { data: { items: Array<{ actualQuantity: string }> } })
      .data.items[0].actualQuantity,
    "3.25",
  );

  const foreignRes = await http.request(
    `/api/deliveries/management/${uid(9999)}`,
  );
  assert.equal(foreignRes.status, 404);

  const createPayload = JSON.stringify({
    sourceType: "STANDALONE",
    schoolId,
    items: [{ ingredientId, actualQuantity: "3.250", unit: "kg" }],
  });
  const post1 = await http.request("/api/deliveries/management", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idemKey1,
    },
    body: createPayload,
  });
  assert.equal(post1.status, 201);

  const post2 = await http.request("/api/deliveries/management", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idemKey1,
    },
    body: createPayload,
  });
  assert.equal(post2.status, 200);
  assert.equal(
    (post2.body as { data: { deliveryNo: string } }).data.deliveryNo,
    (post1.body as { data: { deliveryNo: string } }).data.deliveryNo,
  );
  assert.equal("created" in (post2.body as { data: object }).data, false);

  const postConflict = await http.request("/api/deliveries/management", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idemKey1,
    },
    body: JSON.stringify({
      sourceType: "STANDALONE",
      schoolId,
      items: [{ ingredientId, actualQuantity: "9", unit: "kg" }],
    }),
  });
  assert.equal(postConflict.status, 409);

  actor = makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_ADMIN, [
    "delivery.receive",
  ]);
  const receiveReaderRes = await http.request("/api/deliveries/management");
  assert.equal(receiveReaderRes.status, 200);
});
