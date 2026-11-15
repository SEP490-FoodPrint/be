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
const requestItemId2 = uid(115);
const entryId = uid(106);
const entryId2 = uid(116);
const ingredientId = uid(107);
const ingredientId2 = uid(108);
const sourceFacilityId = uid(109);
const sourceFacilityIdNullCode = uid(110);
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
  itemCount = 1,
): SupplierOrderSupplyRequestRecord {
  const baseItems = [
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
    {
      id: requestItemId2,
      ingredientEntryId: entryId2,
      requestedQuantity: new Prisma.Decimal("4.000"),
      unit: "l",
      note: "Đóng can kín",
      IngredientEntry: {
        id: entryId2,
        ingredientId: ingredientId2,
        Ingredient: {
          id: ingredientId2,
          name: "Dầu ăn",
        },
      },
    },
  ];
  return {
    id: supplyRequestId,
    requestNo: "SR-2026-001",
    schoolId,
    supplierId,
    status,
    School: { name: "Tiểu học Hoa Mai" },
    supplyRequestItems: withItems ? baseItems.slice(0, itemCount) : [],
  };
}

function setupUs1Harness(options?: {
  supplyRequest?: SupplierOrderSupplyRequestRecord | null;
  priorDelivery?: boolean;
  updateInProgressCount?: number;
  guardError?: Error;
  highestSequence?: bigint;
  sourceFacilities?: Array<{
    id: string;
    supplierId: string;
    facilityCode: string | null;
    name: string;
    status: "ACTIVE" | "INACTIVE";
  }>;
  renderError?: Error;
}) {
  const createdPayloads: SupplierOrderCreateDeliveryInput[] = [];
  const storedDeliveries = new Map<string, SupplierOrderDetailRecord>();
  const lockedSourceIds: string[] = [];
  let markedInProgress = false;
  let markCount = options?.updateInProgressCount ?? 1;
  let requestState =
    options && "supplyRequest" in options
      ? options.supplyRequest
      : makeSupplyRequestRecord("ACCEPTED");
  let hasPrior = options?.priorDelivery ?? false;
  const highestSequence = options?.highestSequence ?? 0n;
  const facilities = options?.sourceFacilities ?? [
    {
      id: sourceFacilityId,
      supplierId,
      facilityCode: "SF-001",
      name: "Trang trại Đồng Xanh",
      status: "ACTIVE",
    },
    {
      id: sourceFacilityIdNullCode,
      supplierId,
      facilityCode: null,
      name: "Hộ liên kết cũ",
      status: "ACTIVE",
    },
  ];
  const now = new Date("2026-11-15T01:00:00Z");

  const repo: SupplierOrderRepository = {
    connect: () => Promise.resolve({} as never),
    findByCreationKey: (_db, supId, userId, key) =>
      Promise.resolve(
        storedDeliveries.get(`${supId}:${userId}:${key}`) ?? null,
      ),
    findSupplyRequestForCreation: () => Promise.resolve(requestState ?? null),
    hasDeliveryForRequest: () => Promise.resolve(hasPrior),
    lockSupplierForDeliveryNumber: () => Promise.resolve(),
    findHighestCanonicalDeliverySequence: () =>
      Promise.resolve(highestSequence),
    lockSourceFacilities: (_db, _supId, ids) => {
      lockedSourceIds.push(...ids);
      return Promise.resolve();
    },
    findSourceFacilitiesByIds: (_db, ids) =>
      Promise.resolve(
        facilities.filter((facility) => ids.includes(facility.id)),
      ),
    createDeliveryWithItems: (_db, input) => {
      createdPayloads.push(input);
      const record: SupplierOrderDetailRecord = {
        id: deliveryId,
        deliveryNo: input.deliveryNo,
        creationMode: input.creationMode,
        creationFingerprint: input.creationFingerprint,
        traceabilityVersion: input.traceabilityVersion,
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
          sourceFacilityId: item.sourceFacilityId,
          sourceFacilityNameSnapshot: item.sourceFacilityNameSnapshot,
          sourceFacilityCodeSnapshot: item.sourceFacilityCodeSnapshot,
          ingredientNameSnapshot: item.ingredientNameSnapshot,
          qrUrl: item.qrUrl,
          actualQuantity: item.actualQuantity,
          unit: item.unit,
          note: item.note,
          Ingredient: {
            name: item.ingredientNameSnapshot ?? "Gạo ST25",
          },
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
    listSourceFacilityOptions: () => Promise.resolve([]),
    findIngredientsByIds: () => Promise.resolve([]),
    findIngredientEntriesForSchool: () => Promise.resolve([]),
    listManagementDeliveries: () => Promise.resolve([]),
    findManagementDeliveryById: () => Promise.resolve(null),
    findDeliveryForLabels: () => Promise.resolve(null),
    listDeliveryLabelItems: () => Promise.resolve([]),
  };

  let txCommitted = false;
  let txRolledBack = false;
  let transactionCalls = 0;
  const guardCalls: unknown[] = [];

  const service = createSupplierOrderService(repo, {
    publicTraceOrigin: "https://trace.example.test",
    renderQrBatch: options?.renderError
      ? () => Promise.reject(options.renderError!)
      : (urls) => Promise.resolve(urls.map(() => "data:image/png;base64,TEST")),
    transaction: async (fn) => {
      transactionCalls += 1;
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
    lockedSourceIds,
    getState: () => ({
      markedInProgress,
      txCommitted,
      txRolledBack,
      transactionCalls,
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
    sources: [
      {
        supplyRequestItemId: requestItemId.toUpperCase(),
        sourceFacilityId: sourceFacilityId.toUpperCase(),
      },
    ],
    expectedArrivalAt: "2026-11-16T08:30:00+07:00",
    vehiclePlate: "  29A-123.45  ",
    note: "   ",
  });
  assert.deepEqual(parsed, {
    sourceType: "REQUEST",
    supplyRequestId,
    sources: [
      {
        supplyRequestItemId: requestItemId,
        sourceFacilityId,
      },
    ],
    expectedArrivalAt: "2026-11-16T01:30:00.000Z",
    vehiclePlate: "29A-123.45",
    note: null,
  });

  // REQUEST sources may exceed 100 lines when legacy requests contain many items
  const largeSources = Array.from({ length: 105 }, (_, i) => ({
    supplyRequestItemId: uid(2000 + i),
    sourceFacilityId,
  }));
  const parsedLarge = validateCreateSupplierOrderBody({
    sourceType: "REQUEST",
    supplyRequestId,
    sources: largeSources,
    expectedArrivalAt: "2026-11-16T08:30:00Z",
    vehiclePlate: "29C-99999",
  });
  assert.equal(parsedLarge.sourceType, "REQUEST");
  if (parsedLarge.sourceType === "REQUEST") {
    assert.equal(parsedLarge.sources.length, 105);
  }

  for (const invalidBody of [
    null,
    [],
    { sourceType: "REQUEST", supplyRequestId },
    {
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [],
      expectedArrivalAt: "2026-11-16T08:30:00Z",
      vehiclePlate: "29A-1",
    },
    {
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [
        { supplyRequestItemId: requestItemId, sourceFacilityId },
        {
          supplyRequestItemId: requestItemId,
          sourceFacilityId: sourceFacilityIdNullCode,
        },
      ],
      expectedArrivalAt: "2026-11-16T08:30:00Z",
      vehiclePlate: "29A-1",
    },
    {
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [
        {
          supplyRequestItemId: requestItemId,
          sourceFacilityId,
          actualQuantity: "99",
        },
      ],
      expectedArrivalAt: "2026-11-16T08:30:00Z",
      vehiclePlate: "29A-1",
    },
    {
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [{ supplyRequestItemId: requestItemId, sourceFacilityId }],
      schoolId,
      expectedArrivalAt: "2026-11-16T08:30:00Z",
      vehiclePlate: "29A-1",
    },
    {
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [{ supplyRequestItemId: requestItemId, sourceFacilityId }],
      supplierId,
      expectedArrivalAt: "2026-11-16T08:30:00Z",
      vehiclePlate: "29A-1",
    },
    {
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [{ supplyRequestItemId: requestItemId, sourceFacilityId }],
      status: "RECEIVED",
      expectedArrivalAt: "2026-11-16T08:30:00Z",
      vehiclePlate: "29A-1",
    },
    {
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [{ supplyRequestItemId: requestItemId, sourceFacilityId }],
      items: [],
      expectedArrivalAt: "2026-11-16T08:30:00Z",
      vehiclePlate: "29A-1",
    },
    {
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [{ supplyRequestItemId: requestItemId, sourceFacilityId }],
      deliveryNo: "FP-DE-00999",
      expectedArrivalAt: "2026-11-16T08:30:00Z",
      vehiclePlate: "29A-1",
    },
    {
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [{ supplyRequestItemId: requestItemId, sourceFacilityId }],
      expectedArrivalAt: "2026-11-16T08:30:00",
      vehiclePlate: "29A-1",
    },
    {
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [{ supplyRequestItemId: requestItemId, sourceFacilityId }],
      expectedArrivalAt: "2026-11-16T08:30:00Z",
      vehiclePlate: "   ",
    },
    {
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [{ supplyRequestItemId: requestItemId, sourceFacilityId }],
      expectedArrivalAt: "2026-11-16T08:30:00Z",
      vehiclePlate: "x".repeat(41),
    },
    {
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [{ supplyRequestItemId: requestItemId, sourceFacilityId }],
      expectedArrivalAt: "2026-11-16T08:30:00Z",
      vehiclePlate: "29A-1",
      note: "x".repeat(2001),
    },
  ]) {
    assert.throws(
      () => validateCreateSupplierOrderBody(invalidBody),
      (err: unknown) =>
        err instanceof RequestValidationError && err.statusCode === 400,
    );
  }

  assert.throws(
    () =>
      validateCreateSupplierOrderBody({
        sourceType: "REQUEST",
        supplyRequestId,
        sources: [{ supplyRequestItemId: "bad", sourceFacilityId }],
        expectedArrivalAt: "2026-11-16T08:30:00",
        vehiclePlate: "",
      }),
    (err: unknown) =>
      err instanceof RequestValidationError &&
      err.statusCode === 400 &&
      err.fields.some((f) => f.field === "sources.0.supplyRequestItemId") &&
      err.fields.some((f) => f.field === "expectedArrivalAt") &&
      err.fields.some((f) => f.field === "vehiclePlate"),
  );

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
      sources: [{ supplyRequestItemId: requestItemId, sourceFacilityId }],
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
    assert.equal(result.traceabilityVersion, 1);
    assert.equal(result.deliveryNo, "FP-DE-00001");
    assert.equal(result.status, "IN_TRANSIT");
    assert.equal(result.statusLabel, "Đang giao");
    assert.equal(result.schoolId, schoolId);
    assert.equal(result.supplierId, supplierId);
    assert.equal(result.supplyRequestId, supplyRequestId);
    assert.equal(result.requestNo, "SR-2026-001");
    assert.equal(result.expectedArrivalAt, "2026-11-16T01:00:00.000Z");
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].supplyRequestItemId, requestItemId);
    assert.equal(result.items[0].ingredientId, ingredientId);
    assert.equal(result.items[0].ingredientName, "Gạo ST25");
    assert.equal(result.items[0].ingredientEntryId, entryId);
    assert.equal(result.items[0].actualQuantity, "12.5");
    assert.deepEqual(result.items[0].sourceFacility, {
      id: sourceFacilityId,
      name: "Trang trại Đồng Xanh",
      facilityCode: "SF-001",
    });
    assert.match(
      result.items[0].traceUrl ?? "",
      /^https:\/\/trace\.example\.test\/api\/public\/delivery-items\/[0-9a-f]{64}$/,
    );
    assert.equal("qrToken" in result.items[0], false);
    assert.equal("qrImageDataUrl" in result.items[0], false);
    assert.equal("creationKey" in result, false);
    assert.equal("creationFingerprint" in result, false);
    assert.equal(h.getState().markedInProgress, true);
    assert.equal(h.getState().requestStatus, "IN_PROGRESS");
    assert.equal(h.getState().txCommitted, true);
    assert.deepEqual(h.guardCalls[0], {
      operation: "START_ORDER_PROCESSING",
      orderId: supplyRequestId,
      requiredPermission: "delivery.manage",
      sourceFacilityIds: [sourceFacilityId],
    });
  }

  const inProgressHarness = setupUs1Harness({
    supplyRequest: makeSupplyRequestRecord("IN_PROGRESS", true, 2),
    highestSequence: 99999n,
  });
  const body = validateCreateSupplierOrderBody({
    sourceType: "REQUEST",
    supplyRequestId,
    sources: [
      {
        supplyRequestItemId: requestItemId2,
        sourceFacilityId: sourceFacilityIdNullCode,
      },
      { supplyRequestItemId: requestItemId, sourceFacilityId },
    ],
    expectedArrivalAt: "2026-11-16T08:00:00Z",
    vehiclePlate: "29C-55556",
  });
  const inProgressResult = await inProgressHarness.service.create(
    { idempotencyKey: idemKey2, body },
    makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_STAFF),
  );
  assert.equal(inProgressResult.created, true);
  assert.equal(inProgressResult.deliveryNo, "FP-DE-100000");
  assert.equal(inProgressResult.items.length, 2);
  assert.notEqual(
    inProgressResult.items[0].traceUrl,
    inProgressResult.items[1].traceUrl,
  );
  assert.deepEqual(inProgressResult.items[1].sourceFacility, {
    id: sourceFacilityIdNullCode,
    name: "Hộ liên kết cũ",
    facilityCode: null,
  });
  assert.equal(inProgressHarness.getState().markedInProgress, false);
});

void test("US1 rejects unauthorized roles/permissions, prior deliveries, mismatched sources, inactive/foreign facilities, render failures and rolls back cleanly", async () => {
  const validInput = {
    idempotencyKey: idemKey1,
    body: validateCreateSupplierOrderBody({
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [{ supplyRequestItemId: requestItemId, sourceFacilityId }],
      expectedArrivalAt: "2026-11-16T08:00:00Z",
      vehiclePlate: "29C-55555",
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

  const missingLineHarness = setupUs1Harness({
    supplyRequest: makeSupplyRequestRecord("ACCEPTED", true, 2),
  });
  await assert.rejects(
    () => missingLineHarness.service.create(validInput, makeSupplierActor()),
    { statusCode: 409 },
  );
  assert.equal(missingLineHarness.getState().txRolledBack, true);

  const inactiveFacilityHarness = setupUs1Harness({
    sourceFacilities: [
      {
        id: sourceFacilityId,
        supplierId,
        facilityCode: "SF-001",
        name: "Trang trại ngừng",
        status: "INACTIVE",
      },
    ],
  });
  await assert.rejects(
    () =>
      inactiveFacilityHarness.service.create(validInput, makeSupplierActor()),
    { statusCode: 409 },
  );
  assert.equal(inactiveFacilityHarness.createdPayloads.length, 0);
  assert.equal(inactiveFacilityHarness.getState().txRolledBack, true);

  const foreignFacilityHarness = setupUs1Harness({
    sourceFacilities: [
      {
        id: sourceFacilityId,
        supplierId: uid(999),
        facilityCode: "SF-EXT",
        name: "Trang trại ngoài",
        status: "ACTIVE",
      },
    ],
  });
  await assert.rejects(
    () =>
      foreignFacilityHarness.service.create(validInput, makeSupplierActor()),
    { statusCode: 404 },
  );
  assert.equal(foreignFacilityHarness.getState().txRolledBack, true);

  const renderFailHarness = setupUs1Harness({
    renderError: new Error("QR encoder unavailable"),
  });
  await assert.rejects(
    () => renderFailHarness.service.create(validInput, makeSupplierActor()),
    { statusCode: 503 },
  );
  assert.equal(renderFailHarness.getState().transactionCalls, 0);
  assert.equal(renderFailHarness.createdPayloads.length, 0);

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

void test("US1 repository queries enforce supplier scope, ordering, locks, PLAN-01 lots and atomic item creation", async () => {
  let seenCreateData: unknown;
  const rawQueries: string[] = [];
  const mockDb = {
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      rawQueries.push(sql);
      if (sql.includes("MAX(substring")) {
        assert.equal(values[0], supplierId);
        return Promise.resolve([{ maxSeq: "99999" }]);
      }
      return Promise.resolve([{ id: supplierId }]);
    },
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
    await supplierOrderRepository.findHighestCanonicalDeliverySequence(
      mockDb,
      supplierId,
    ),
    99999n,
  );
  await supplierOrderRepository.lockSourceFacilities(mockDb, supplierId, [
    sourceFacilityIdNullCode,
    sourceFacilityId,
    sourceFacilityIdNullCode,
  ]);
  assert.equal(
    await supplierOrderRepository.hasDeliveryForRequest(
      mockDb,
      supplyRequestId,
    ),
    false,
  );
  await supplierOrderRepository.createDeliveryWithItems(mockDb, {
    deliveryNo: "FP-DE-100000",
    creationMode: "REQUEST",
    creationKey: idemKey1,
    creationFingerprint: "hash",
    traceabilityVersion: 1,
    schoolId,
    supplierId,
    supplyRequestId,
    createdByUserId: uid(301),
    expectedArrivalAt: new Date("2026-11-16T01:00:00.000Z"),
    vehiclePlate: "29C-55555",
    note: null,
    status: "IN_TRANSIT",
    items: [
      {
        supplyRequestItemId: requestItemId,
        ingredientId,
        ingredientEntryId: entryId,
        sourceFacilityId,
        sourceFacilityNameSnapshot: "Trang trại Đồng Xanh",
        sourceFacilityCodeSnapshot: "SF-001",
        ingredientNameSnapshot: "Gạo ST25",
        qrToken: "a".repeat(64),
        qrUrl: `https://trace.example.test/api/public/delivery-items/${"a".repeat(64)}`,
        actualQuantity: new Prisma.Decimal("12.5"),
        unit: "kg",
        note: "Giao sáng",
      },
    ],
  });
  const created = seenCreateData as {
    creationMode: string;
    traceabilityVersion: number;
    deliveryItems: {
      create: Array<{
        ingredientLots: { create: Array<Record<string, unknown>> };
      }>;
    };
  };
  assert.equal(created.creationMode, "REQUEST");
  assert.equal(created.traceabilityVersion, 1);
  assert.equal(
    created.deliveryItems.create[0].ingredientLots.create[0].lotCode,
    "PLAN-01",
  );
  assert.equal(
    created.deliveryItems.create[0].ingredientLots.create[0].status,
    "BLOCKED",
  );
  assert.equal(
    String(
      created.deliveryItems.create[0].ingredientLots.create[0]
        .availableQuantity,
    ),
    "0",
  );
  assert.equal(
    created.deliveryItems.create[0].ingredientLots.create[0].manufactureDate,
    null,
  );
  assert.equal(
    created.deliveryItems.create[0].ingredientLots.create[0].expiryDate,
    null,
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

  const validRequestBody = {
    sourceType: "REQUEST",
    supplyRequestId,
    sources: [{ supplyRequestItemId: requestItemId, sourceFacilityId }],
    vehiclePlate: "29C-55555",
    expectedArrivalAt: "2026-11-16T08:00:00+07:00",
  };

  const badKey = await http.request("/api/deliveries/management", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validRequestBody),
  });
  assert.equal(badKey.status, 400);

  const badQuery = await http.request("/api/deliveries/management?extra=1", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idemKey1,
    },
    body: JSON.stringify(validRequestBody),
  });
  assert.equal(badQuery.status, 400);

  actor = { ...actor, permissions: ["delivery.view"] };
  const forbidden = await http.request("/api/deliveries/management", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idemKey1,
    },
    body: JSON.stringify(validRequestBody),
  });
  assert.equal(forbidden.status, 403);

  actor = makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_STAFF);
  const created = await http.request("/api/deliveries/management", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idemKey1,
    },
    body: JSON.stringify(validRequestBody),
  });
  assert.equal(created.status, 201);
  const payload = created.body as {
    success: boolean;
    data: Record<string, unknown>;
  };
  assert.equal(payload.success, true);
  assert.equal(payload.data.sourceType, "REQUEST");
  assert.equal(payload.data.status, "IN_TRANSIT");
  assert.equal(payload.data.statusLabel, "Đang giao");
  assert.equal(payload.data.traceabilityVersion, 1);
  assert.equal(payload.data.deliveryNo, "FP-DE-00001");
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
        sourceFacilityId: sourceFacilityId.toUpperCase(),
        actualQuantity: "12.500",
        unit: " kg ",
      },
      {
        ingredientId: uid(108),
        sourceFacilityId: sourceFacilityId.toUpperCase(),
        actualQuantity: "10.000",
        unit: "lit",
      },
    ],
  });
  assert.equal(valid.sourceType, "STANDALONE");
  if (valid.sourceType !== "STANDALONE") assert.fail("expected STANDALONE");
  assert.equal(valid.schoolId, schoolId);
  assert.equal(valid.vehiclePlate, "29D-999.88");
  assert.equal(valid.items[0].ingredientId, ingredientId);
  assert.equal(valid.items[0].sourceFacilityId, sourceFacilityId);
  assert.equal(valid.items[1].sourceFacilityId, sourceFacilityId);
  assert.equal(valid.items[0].actualQuantity, "12.5");
  assert.equal(valid.items[0].unit, "kg");
  assert.equal(valid.items[1].actualQuantity, "10");

  const dupCase = {
    sourceType: "STANDALONE",
    schoolId,
    expectedArrivalAt: "2026-11-16T08:00:00+07:00",
    vehiclePlate: "29D-999.88",
    items: [
      { ingredientId, sourceFacilityId, actualQuantity: "1", unit: "kg" },
      {
        ingredientId: ingredientId.toUpperCase(),
        sourceFacilityId: sourceFacilityIdNullCode,
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

  const baseStandalone = {
    sourceType: "STANDALONE" as const,
    schoolId,
    expectedArrivalAt: "2026-11-16T08:00:00+07:00",
    vehiclePlate: "29D-999.88",
  };
  for (const invalidStandalone of [
    { ...baseStandalone, items: [] },
    {
      sourceType: "STANDALONE",
      schoolId,
      vehiclePlate: "29D-999.88",
      items: [
        { ingredientId, sourceFacilityId, actualQuantity: "1", unit: "kg" },
      ],
    },
    {
      sourceType: "STANDALONE",
      schoolId,
      expectedArrivalAt: "2026-11-16T08:00:00+07:00",
      items: [
        { ingredientId, sourceFacilityId, actualQuantity: "1", unit: "kg" },
      ],
    },
    {
      ...baseStandalone,
      vehiclePlate: "   ",
      items: [
        { ingredientId, sourceFacilityId, actualQuantity: "1", unit: "kg" },
      ],
    },
    {
      ...baseStandalone,
      items: [{ ingredientId, actualQuantity: "1", unit: "kg" }],
    },
    {
      ...baseStandalone,
      items: [
        {
          ingredientId,
          sourceFacilityId: "not-a-uuid",
          actualQuantity: "1",
          unit: "kg",
        },
      ],
    },
    {
      ...baseStandalone,
      items: [
        {
          ingredientId,
          sourceFacilityId,
          actualQuantity: "1",
          unit: "kg",
          note: "Ghi chú không được phép",
        },
      ],
    },
    {
      ...baseStandalone,
      items: Array.from({ length: 101 }, (_, idx) => ({
        ingredientId: uid(1000 + idx),
        sourceFacilityId,
        actualQuantity: "1",
        unit: "kg",
      })),
    },
    {
      ...baseStandalone,
      supplyRequestId,
      items: [
        { ingredientId, sourceFacilityId, actualQuantity: "1", unit: "kg" },
      ],
    },
    {
      ...baseStandalone,
      supplyRequestItemId: requestItemId,
      items: [
        { ingredientId, sourceFacilityId, actualQuantity: "1", unit: "kg" },
      ],
    },
    {
      ...baseStandalone,
      previousDeliveryId: deliveryId,
      items: [
        { ingredientId, sourceFacilityId, actualQuantity: "1", unit: "kg" },
      ],
    },
    {
      ...baseStandalone,
      supplierId,
      items: [
        { ingredientId, sourceFacilityId, actualQuantity: "1", unit: "kg" },
      ],
    },
    {
      ...baseStandalone,
      items: [
        { ingredientId, sourceFacilityId, actualQuantity: "0", unit: "kg" },
      ],
    },
    {
      ...baseStandalone,
      items: [
        { ingredientId, sourceFacilityId, actualQuantity: "0.000", unit: "kg" },
      ],
    },
    {
      ...baseStandalone,
      items: [
        { ingredientId, sourceFacilityId, actualQuantity: "-1", unit: "kg" },
      ],
    },
    {
      ...baseStandalone,
      items: [
        {
          ingredientId,
          sourceFacilityId,
          actualQuantity: "1.2345",
          unit: "kg",
        },
      ],
    },
    {
      ...baseStandalone,
      items: [
        { ingredientId, sourceFacilityId, actualQuantity: "01", unit: "kg" },
      ],
    },
    {
      ...baseStandalone,
      items: [
        { ingredientId, sourceFacilityId, actualQuantity: 5, unit: "kg" },
      ],
    },
    {
      ...baseStandalone,
      items: [
        { ingredientId, sourceFacilityId, actualQuantity: "1", unit: "   " },
      ],
    },
    {
      ...baseStandalone,
      items: [
        {
          ingredientId,
          sourceFacilityId,
          actualQuantity: "1",
          unit: "x".repeat(31),
        },
      ],
    },
    {
      ...baseStandalone,
      items: [
        {
          ingredientId,
          sourceFacilityId,
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
    sourceFacilities?: Array<{
      id: string;
      supplierId: string;
      facilityCode: string | null;
      name: string;
      status: "ACTIVE" | "INACTIVE";
    }>;
    existingEntries?: Array<{ id: string; ingredientId: string }>;
    guardError?: Error;
    renderError?: Error;
  }) {
    const createdPayloads: SupplierOrderCreateDeliveryInput[] = [];
    const guardCommands: unknown[] = [];
    const lockCalls: string[] = [];
    let transactionCalls = 0;
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
    const facilities = overrides?.sourceFacilities ?? [
      {
        id: sourceFacilityId,
        supplierId,
        facilityCode: "SF-001",
        name: "Cơ sở xay xát 1",
        status: "ACTIVE",
      },
      {
        id: sourceFacilityIdNullCode,
        supplierId,
        facilityCode: null,
        name: "Trang trại không mã",
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
      lockSupplierForDeliveryNumber: (_db, supId) => {
        lockCalls.push(`supplier:${supId}`);
        return Promise.resolve();
      },
      findHighestCanonicalDeliverySequence: () => {
        lockCalls.push("sequence");
        return Promise.resolve(BigInt(createdPayloads.length));
      },
      lockSourceFacilities: (_db, _supId, ids) => {
        lockCalls.push(`sourceFacilities:${ids.join(",")}`);
        return Promise.resolve();
      },
      findSourceFacilitiesByIds: (_db, ids) => {
        lockCalls.push(`findSourceFacilities:${ids.join(",")}`);
        return Promise.resolve(facilities.filter((f) => ids.includes(f.id)));
      },
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
      listSourceFacilityOptions: () => Promise.resolve([]),
      findIngredientsByIds: () => Promise.resolve(ingredients),
      findIngredientEntriesForSchool: () => Promise.resolve(entries),
      listManagementDeliveries: () => Promise.resolve([]),
      findManagementDeliveryById: () => Promise.resolve(null),
      findDeliveryForLabels: () => Promise.resolve(null),
      listDeliveryLabelItems: () => Promise.resolve([]),
      createDeliveryWithItems: (_db, input) => {
        const deliverySeqIndex = createdPayloads.length;
        createdPayloads.push(input);
        return Promise.resolve({
          id: deliverySeqIndex === 0 ? deliveryId : uid(900 + deliverySeqIndex),
          deliveryNo: input.deliveryNo,
          creationMode: input.creationMode,
          creationFingerprint: input.creationFingerprint,
          traceabilityVersion: input.traceabilityVersion,
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
            sourceFacilityId: item.sourceFacilityId,
            sourceFacilityNameSnapshot: item.sourceFacilityNameSnapshot,
            sourceFacilityCodeSnapshot: item.sourceFacilityCodeSnapshot,
            ingredientNameSnapshot: item.ingredientNameSnapshot,
            qrUrl: item.qrUrl,
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
      publicTraceOrigin: "https://trace.example.test",
      renderQrBatch: overrides?.renderError
        ? () =>
            Promise.reject(
              overrides.renderError instanceof Error
                ? overrides.renderError
                : new Error(String(overrides.renderError)),
            )
        : (urls) =>
            Promise.resolve(urls.map(() => "data:image/png;base64,mock")),
      transaction: async (fn) => {
        transactionCalls += 1;
        return fn({
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
        } as never);
      },
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
      lockCalls,
      getFlags: () => ({
        autoCreatedEntry,
        supplyRequestTouched,
        transactionCalls,
      }),
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
      expectedArrivalAt: "2026-11-16T08:00:00+07:00",
      vehiclePlate: "29C-88888",
      items: [
        {
          ingredientId,
          sourceFacilityId,
          actualQuantity: "5.250",
          unit: "kg",
        },
        {
          ingredientId: ingredientId2,
          sourceFacilityId: sourceFacilityIdNullCode,
          actualQuantity: "8.000",
          unit: "kg",
        },
      ],
    });
    const res = await h.service.create(
      { idempotencyKey: idemKey1, body },
      actor,
    );
    assert.equal(res.created, true);
    assert.equal(res.sourceType, "STANDALONE");
    assert.equal(res.status, "IN_TRANSIT");
    assert.equal(res.statusLabel, "Đang giao");
    assert.equal(res.traceabilityVersion, 1);
    assert.equal(res.deliveryNo, "FP-DE-00001");
    assert.equal(res.supplyRequestId, null);
    assert.equal(res.requestNo, null);
    assert.equal(res.items[0].supplyRequestItemId, null);
    assert.equal(res.items[0].ingredientEntryId, entryId);
    assert.equal(res.items[0].actualQuantity, "5.25");
    assert.deepEqual(res.items[0].sourceFacility, {
      id: sourceFacilityId,
      facilityCode: "SF-001",
      name: "Cơ sở xay xát 1",
    });
    assert.equal(res.items[0].ingredientName, "Gạo ST25");
    assert.ok(
      res.items[0].traceUrl?.startsWith(
        "https://trace.example.test/api/public/delivery-items/",
      ),
    );
    assert.equal("qrToken" in res.items[0], false);
    assert.equal(res.items[1].supplyRequestItemId, null);
    assert.equal(res.items[1].ingredientEntryId, null);
    assert.equal(res.items[1].actualQuantity, "8");
    assert.deepEqual(res.items[1].sourceFacility, {
      id: sourceFacilityIdNullCode,
      facilityCode: null,
      name: "Trang trại không mã",
    });
    assert.equal(h.createdPayloads[0].traceabilityVersion, 1);
    assert.equal(h.createdPayloads[0].status, "IN_TRANSIT");
    assert.equal(h.createdPayloads[0].items[0].note, null);
    assert.equal(h.createdPayloads[0].items[1].note, null);
    assert.equal(
      h.createdPayloads[0].items[1].sourceFacilityCodeSnapshot,
      null,
    );
    assert.ok(h.createdPayloads[0].items[0].qrToken);
    assert.notEqual(
      h.createdPayloads[0].items[0].qrToken,
      h.createdPayloads[0].items[1].qrToken,
    );
    assert.equal(h.getFlags().autoCreatedEntry, false);
    assert.equal(h.getFlags().supplyRequestTouched, false);
    assert.deepEqual(h.guardCommands[0], {
      operation: "SUPPLIER_CREATE_STANDALONE_DELIVERY",
      schoolId,
      ingredientIds: [ingredientId, ingredientId2],
      sourceFacilityIds: [sourceFacilityId, sourceFacilityIdNullCode],
    });
    assert.deepEqual(h.lockCalls, [
      `sourceFacilities:${sourceFacilityId},${sourceFacilityIdNullCode}`,
      `findSourceFacilities:${sourceFacilityId},${sourceFacilityIdNullCode}`,
      `supplier:${supplierId}`,
      "sequence",
    ]);
  }

  const standaloneBase = {
    sourceType: "STANDALONE" as const,
    schoolId,
    expectedArrivalAt: "2026-11-16T08:00:00+07:00",
    vehiclePlate: "29C-88888",
  };

  const unitMismatch = setupStandalone();
  await assert.rejects(
    () =>
      unitMismatch.service.create(
        {
          idempotencyKey: idemKey1,
          body: validateCreateSupplierOrderBody({
            ...standaloneBase,
            items: [
              {
                ingredientId,
                sourceFacilityId,
                actualQuantity: "1",
                unit: "gam",
              },
            ],
          }),
        },
        makeSupplierActor(),
      ),
    { statusCode: 409 },
  );
  assert.equal(unitMismatch.createdPayloads.length, 0);

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
            ...standaloneBase,
            items: [
              {
                ingredientId,
                sourceFacilityId,
                actualQuantity: "1",
                unit: "kg",
              },
            ],
          }),
        },
        makeSupplierActor(),
      ),
    { statusCode: 409 },
  );
  assert.equal(inactiveIngredient.createdPayloads.length, 0);

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
            ...standaloneBase,
            items: [
              {
                ingredientId,
                sourceFacilityId,
                actualQuantity: "1",
                unit: "kg",
              },
            ],
          }),
        },
        makeSupplierActor(),
      ),
    { statusCode: 404 },
  );

  const foreignFacility = setupStandalone({
    sourceFacilities: [
      {
        id: sourceFacilityId,
        supplierId: uid(999),
        facilityCode: "SF-OTHER",
        name: "Foreign",
        status: "ACTIVE",
      },
    ],
  });
  await assert.rejects(
    () =>
      foreignFacility.service.create(
        {
          idempotencyKey: idemKey1,
          body: validateCreateSupplierOrderBody({
            ...standaloneBase,
            items: [
              {
                ingredientId,
                sourceFacilityId,
                actualQuantity: "1",
                unit: "kg",
              },
            ],
          }),
        },
        makeSupplierActor(),
      ),
    { statusCode: 404 },
  );
  assert.equal(foreignFacility.createdPayloads.length, 0);

  const inactiveFacility = setupStandalone({
    sourceFacilities: [
      {
        id: sourceFacilityId,
        supplierId,
        facilityCode: "SF-001",
        name: "Cơ sở tạm ngừng",
        status: "INACTIVE",
      },
    ],
  });
  await assert.rejects(
    () =>
      inactiveFacility.service.create(
        {
          idempotencyKey: idemKey1,
          body: validateCreateSupplierOrderBody({
            ...standaloneBase,
            items: [
              {
                ingredientId,
                sourceFacilityId,
                actualQuantity: "1",
                unit: "kg",
              },
            ],
          }),
        },
        makeSupplierActor(),
      ),
    { statusCode: 409 },
  );
  assert.equal(inactiveFacility.createdPayloads.length, 0);

  const renderFailure = setupStandalone({
    renderError: new Error("QR encoder failed"),
  });
  await assert.rejects(
    () =>
      renderFailure.service.create(
        {
          idempotencyKey: idemKey1,
          body: validateCreateSupplierOrderBody({
            ...standaloneBase,
            items: [
              {
                ingredientId,
                sourceFacilityId,
                actualQuantity: "1",
                unit: "kg",
              },
            ],
          }),
        },
        makeSupplierActor(),
      ),
    { statusCode: 503 },
  );
  assert.equal(renderFailure.getFlags().transactionCalls, 0);
  assert.equal(renderFailure.createdPayloads.length, 0);

  const pausedGuard = setupStandalone({
    guardError: new HttpError(409, "Trường đang tạm dừng nhận đơn"),
  });
  await assert.rejects(
    () =>
      pausedGuard.service.create(
        {
          idempotencyKey: idemKey1,
          body: validateCreateSupplierOrderBody({
            ...standaloneBase,
            items: [
              {
                ingredientId,
                sourceFacilityId,
                actualQuantity: "1",
                unit: "kg",
              },
            ],
          }),
        },
        makeSupplierActor(),
      ),
    { statusCode: 409 },
  );

  const distinctIntent = setupStandalone();
  const sameStandaloneBody = validateCreateSupplierOrderBody({
    ...standaloneBase,
    items: [
      {
        ingredientId,
        sourceFacilityId,
        actualQuantity: "2.500",
        unit: "kg",
      },
    ],
  });
  const intent1 = await distinctIntent.service.create(
    { idempotencyKey: idemKey1, body: sameStandaloneBody },
    makeSupplierActor(),
  );
  const intent2 = await distinctIntent.service.create(
    { idempotencyKey: idemKey2, body: sameStandaloneBody },
    makeSupplierActor(),
  );
  assert.equal(intent1.created, true);
  assert.equal(intent2.created, true);
  assert.notEqual(intent1.id, intent2.id);
  assert.equal(intent1.deliveryNo, "FP-DE-00001");
  assert.equal(intent2.deliveryNo, "FP-DE-00002");
  assert.notEqual(
    distinctIntent.createdPayloads[0].items[0].qrToken,
    distinctIntent.createdPayloads[1].items[0].qrToken,
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
  assert.equal(
    (await http.request("/api/deliveries/management/options/source-facilities"))
      .status,
    403,
  );
});

void test("US4 source-facility options and labels endpoints enforce scope, snapshot allowlists, pagination, legacy 409, idempotent reprint and render 503", async (context) => {
  let facilityArgs: Record<string, unknown> | undefined;
  let labelDeliveryArgs: Record<string, unknown> | undefined;
  let labelItemCalls = 0;
  let dbWriteCalls = 0;
  let renderError: Error | null = null;
  let originReadCount = 0;

  const facilityRows = [
    {
      id: sourceFacilityId,
      facilityCode: "SF-001",
      name: "Trang trại Hữu cơ 1",
    },
    {
      id: sourceFacilityIdNullCode,
      facilityCode: null,
      name: "Hợp tác xã cũ chưa có mã",
    },
  ];
  const labelItemRows = [
    {
      id: uid(910),
      deliveryId,
      sourceFacilityId,
      sourceFacilityNameSnapshot: "Trang trại Hữu cơ 1",
      sourceFacilityCodeSnapshot: "SF-001",
      ingredientNameSnapshot: "Gạo ST25 (Snapshot)",
      actualQuantity: new Prisma.Decimal("12.500"),
      unit: "kg",
      qrUrl: "https://stored.trace.test/api/public/delivery-items/tok1",
      Ingredient: { name: "Gạo ST25 Đã Đổi Tên" },
    },
    {
      id: uid(911),
      deliveryId,
      sourceFacilityId: sourceFacilityIdNullCode,
      sourceFacilityNameSnapshot: "Hợp tác xã cũ chưa có mã",
      sourceFacilityCodeSnapshot: null,
      ingredientNameSnapshot: "Rau cải ngọt",
      actualQuantity: new Prisma.Decimal("5.000"),
      unit: "kg",
      qrUrl: "https://stored.trace.test/api/public/delivery-items/tok2",
      Ingredient: { name: "Rau cải ngọt" },
    },
  ];
  const legacyId = uid(888);

  const mockDb = {
    sourceFacility: {
      findMany: (args: {
        where: Record<string, unknown>;
        select: Record<string, unknown>;
        orderBy: unknown;
        skip: number;
        take: number;
      }) => {
        facilityArgs = args;
        return Promise.resolve(
          facilityRows.slice(args.skip, args.skip + args.take),
        );
      },
    },
    delivery: {
      findFirst: (args: { where: Record<string, unknown> }) => {
        labelDeliveryArgs = args;
        const raw = JSON.stringify(args.where);
        if (raw.includes(deliveryId)) {
          return Promise.resolve({
            id: deliveryId,
            supplierId,
            deliveryNo: "FP-DE-00007",
            traceabilityVersion: 1,
            Supplier: { name: "Nhà cung cấp An Phát" },
          });
        }
        if (raw.includes(legacyId)) {
          return Promise.resolve({
            id: legacyId,
            supplierId,
            deliveryNo: "DG-LEGACY-01",
            traceabilityVersion: null,
            Supplier: { name: "Nhà cung cấp An Phát" },
          });
        }
        return Promise.resolve(null);
      },
      update: () => {
        dbWriteCalls += 1;
        return Promise.reject(new Error("reprint must not write"));
      },
    },
    deliveryItem: {
      findMany: (args: { skip: number; take: number }) => {
        labelItemCalls += 1;
        return Promise.resolve(
          labelItemRows.slice(args.skip, args.skip + args.take),
        );
      },
    },
  } as unknown as Parameters<
    SupplierOrderRepository["findDeliveryForLabels"]
  >[0];

  const repoWithWriteTrap: SupplierOrderRepository = {
    ...supplierOrderRepository,
    connect: () => Promise.resolve(mockDb as never),
    createDeliveryWithItems: () => {
      dbWriteCalls += 1;
      return Promise.reject(new Error("must not create"));
    },
  };

  const service = createSupplierOrderService(repoWithWriteTrap, {
    readOrigin: () => {
      originReadCount += 1;
      return "https://changed.origin.test";
    },
    renderQrBatch: (urls) => {
      if (renderError) return Promise.reject(renderError);
      return Promise.resolve(
        urls.map(
          (url) =>
            `data:image/png;base64,${Buffer.from(url).toString("base64")}`,
        ),
      );
    },
    transaction: async (fn) => fn(mockDb),
    verifyActor: (_tx, actor) => Promise.resolve(actor),
  });

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

  for (const role of [
    ROLES.INGREDIENT_SUPPLIER_STAFF,
    ROLES.INGREDIENT_SUPPLIER_ADMIN,
  ]) {
    actor = makeSupplierActor(role, ["delivery.manage"]);
    const sfPage1 = await http.request(
      "/api/deliveries/management/options/source-facilities?page=1&limit=1",
    );
    assert.equal(sfPage1.status, 200);
    const sfBody1 = sfPage1.body as {
      data: { items: Array<Record<string, unknown>>; pagination: unknown };
    };
    assert.deepEqual(sfBody1.data.items, [
      {
        id: sourceFacilityId,
        facilityCode: "SF-001",
        name: "Trang trại Hữu cơ 1",
      },
    ]);
    assert.deepEqual(sfBody1.data.pagination, {
      page: 1,
      limit: 1,
      hasNext: true,
    });
    assert.deepEqual(facilityArgs?.where, { supplierId, status: "ACTIVE" });
    assert.equal("isVisible" in (facilityArgs?.where as object), false);
    assert.deepEqual(facilityArgs?.select, {
      id: true,
      facilityCode: true,
      name: true,
    });

    const sfPage2 = await http.request(
      "/api/deliveries/management/options/source-facilities?page=2&limit=1",
    );
    assert.equal(sfPage2.status, 200);
    const sfBody2 = sfPage2.body as {
      data: { items: Array<Record<string, unknown>>; pagination: unknown };
    };
    assert.deepEqual(sfBody2.data.items, [
      {
        id: sourceFacilityIdNullCode,
        facilityCode: null,
        name: "Hợp tác xã cũ chưa có mã",
      },
    ]);
    assert.deepEqual(sfBody2.data.pagination, {
      page: 2,
      limit: 1,
      hasNext: false,
    });
  }

  assert.equal(
    (
      await http.request(
        "/api/deliveries/management/options/source-facilities?page=1&limit=101",
      )
    ).status,
    400,
  );

  actor = makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_STAFF, [
    "delivery.manage",
  ]);
  const lblPage1 = await http.request(
    `/api/deliveries/management/${deliveryId}/labels?page=1&limit=1`,
  );
  const lblPage2 = await http.request(
    `/api/deliveries/management/${deliveryId}/labels?page=2&limit=1`,
  );
  const lblReprint = await http.request(
    `/api/deliveries/management/${deliveryId}/labels?page=1&limit=20`,
  );
  assert.equal(lblPage1.status, 200);
  assert.equal(lblPage2.status, 200);
  assert.equal(lblReprint.status, 200);

  const l1 = lblPage1.body as {
    data: { items: Array<Record<string, unknown>>; pagination: unknown };
  };
  const l2 = lblPage2.body as {
    data: { items: Array<Record<string, unknown>>; pagination: unknown };
  };
  const lAll = lblReprint.body as {
    data: { items: Array<Record<string, unknown>>; pagination: unknown };
  };
  assert.deepEqual(l1.data.pagination, { page: 1, limit: 1, hasNext: true });
  assert.deepEqual(l2.data.pagination, { page: 2, limit: 1, hasNext: false });
  assert.equal(l1.data.items.length + l2.data.items.length, 2);
  assert.deepEqual([...l1.data.items, ...l2.data.items], lAll.data.items);
  assert.equal(lAll.data.items[0].deliveryNo, "FP-DE-00007");
  assert.equal(lAll.data.items[0].supplierName, "Nhà cung cấp An Phát");
  assert.equal(lAll.data.items[0].ingredientName, "Gạo ST25 (Snapshot)");
  assert.equal(lAll.data.items[0].actualQuantity, "12.5");
  assert.deepEqual(lAll.data.items[0].sourceFacility, {
    name: "Trang trại Hữu cơ 1",
    facilityCode: "SF-001",
  });
  assert.deepEqual(lAll.data.items[1].sourceFacility, {
    name: "Hợp tác xã cũ chưa có mã",
    facilityCode: null,
  });
  assert.equal(
    lAll.data.items[0].traceUrl,
    "https://stored.trace.test/api/public/delivery-items/tok1",
  );
  assert.ok(
    typeof lAll.data.items[0].qrImageDataUrl === "string" &&
      lAll.data.items[0].qrImageDataUrl.startsWith("data:image/png;base64,"),
  );
  assert.equal("qrToken" in lAll.data.items[0], false);
  assert.equal("contacts" in lAll.data.items[0], false);
  assert.equal(originReadCount, 0);

  const callsBeforeRejects = labelItemCalls;
  const foreignLbl = await http.request(
    `/api/deliveries/management/${uid(9999)}/labels?page=1&limit=10`,
  );
  assert.equal(foreignLbl.status, 404);
  assert.deepEqual(labelDeliveryArgs?.where, {
    AND: [{ supplierId }, { id: uid(9999) }],
  });

  const legacyLbl = await http.request(
    `/api/deliveries/management/${legacyId}/labels`,
  );
  assert.equal(legacyLbl.status, 409);
  assert.equal(labelItemCalls, callsBeforeRejects);

  renderError = new Error("PNG failed");
  const renderErrRes = await http.request(
    `/api/deliveries/management/${deliveryId}/labels`,
  );
  assert.equal(renderErrRes.status, 503);
  renderError = null;
  assert.equal(dbWriteCalls, 0);

  actor = makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_STAFF, ["delivery.view"]);
  assert.equal(
    (await http.request(`/api/deliveries/management/${deliveryId}/labels`))
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
    lockSupplierForDeliveryNumber: () => Promise.resolve(),
    findHighestCanonicalDeliverySequence: () => Promise.resolve(0n),
    lockSourceFacilities: () => Promise.resolve(),
    findSourceFacilitiesByIds: (_db, ids) =>
      Promise.resolve(
        ids.map((id) => ({
          id,
          supplierId,
          facilityCode: "SF-001",
          name: "Cơ sở xay xát 1",
          status: "ACTIVE" as const,
        })),
      ),
    markSupplyRequestInProgress: () => Promise.resolve(1),
    listSchoolOptions: () => Promise.resolve([]),
    listIngredientOptions: () => Promise.resolve([]),
    listSourceFacilityOptions: () => Promise.resolve([]),
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
    findDeliveryForLabels: () => Promise.resolve(null),
    listDeliveryLabelItems: () => Promise.resolve([]),
    createDeliveryWithItems: (_db, input) => {
      createCalls += 1;
      const record: SupplierOrderDetailRecord = {
        id: deliveryId,
        deliveryNo: input.deliveryNo,
        creationMode: input.creationMode,
        creationFingerprint: input.creationFingerprint,
        traceabilityVersion: input.traceabilityVersion,
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
          sourceFacilityId: item.sourceFacilityId,
          sourceFacilityNameSnapshot: item.sourceFacilityNameSnapshot,
          sourceFacilityCodeSnapshot: item.sourceFacilityCodeSnapshot,
          ingredientNameSnapshot: item.ingredientNameSnapshot,
          qrUrl: item.qrUrl,
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
    publicTraceOrigin: "https://trace.example.test",
    renderQrBatch: (urls) =>
      Promise.resolve(urls.map(() => "data:image/png;base64,mock")),
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
      { ingredientId, sourceFacilityId, actualQuantity: "12.500", unit: "kg" },
      {
        ingredientId: ingredientId2,
        sourceFacilityId: sourceFacilityIdNullCode,
        actualQuantity: "5.000",
        unit: "kg",
      },
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
      {
        ingredientId: ingredientId2,
        sourceFacilityId: sourceFacilityIdNullCode,
        actualQuantity: "5",
        unit: "kg",
      },
      { ingredientId, sourceFacilityId, actualQuantity: "12.5", unit: "kg" },
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
            expectedArrivalAt: "2026-11-16T08:00:00+07:00",
            vehiclePlate: "29A-12345",
            items: [
              {
                ingredientId,
                sourceFacilityId,
                actualQuantity: "99",
                unit: "kg",
              },
            ],
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
    traceabilityVersion: null,
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
    traceabilityVersion: null,
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
        sourceFacilityId: null,
        sourceFacilityNameSnapshot: null,
        sourceFacilityCodeSnapshot: null,
        ingredientNameSnapshot: null,
        qrUrl: null,
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
    lockSupplierForDeliveryNumber: () => Promise.resolve(),
    findHighestCanonicalDeliverySequence: () => Promise.resolve(0n),
    lockSourceFacilities: () => Promise.resolve(),
    findSourceFacilitiesByIds: (_db, ids) =>
      Promise.resolve(
        ids.map((id) => ({
          id,
          supplierId,
          facilityCode: "SF-001",
          name: "Cơ sở xay xát 1",
          status: "ACTIVE" as const,
        })),
      ),
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
        traceabilityVersion: input.traceabilityVersion,
        status: input.status,
        expectedArrivalAt: input.expectedArrivalAt,
        vehiclePlate: input.vehiclePlate,
        creationFingerprint: input.creationFingerprint,
        createdByUserId: input.createdByUserId,
        deliveryItems: input.items.map((item, idx) => ({
          id: uid(850 + idx),
          ingredientId: item.ingredientId,
          ingredientEntryId: item.ingredientEntryId,
          supplyRequestItemId: item.supplyRequestItemId,
          sourceFacilityId: item.sourceFacilityId,
          sourceFacilityNameSnapshot: item.sourceFacilityNameSnapshot,
          sourceFacilityCodeSnapshot: item.sourceFacilityCodeSnapshot,
          ingredientNameSnapshot: item.ingredientNameSnapshot,
          qrUrl: item.qrUrl,
          actualQuantity: item.actualQuantity,
          unit: item.unit,
          note: item.note,
          Ingredient: { name: "Gạo ST25" },
        })),
      };
      persisted.set(
        `${input.supplierId}:${input.createdByUserId}:${input.creationKey}`,
        created,
      );
      return Promise.resolve(created);
    },
  };
  const service = createSupplierOrderService(httpRepo, {
    publicTraceOrigin: "https://trace.example.test",
    renderQrBatch: (urls) =>
      Promise.resolve(urls.map(() => "data:image/png;base64,mock")),
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
    expectedArrivalAt: "2026-11-16T08:00:00+07:00",
    vehiclePlate: "29C-77777",
    items: [
      {
        ingredientId,
        sourceFacilityId,
        actualQuantity: "3.250",
        unit: "kg",
      },
    ],
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
      expectedArrivalAt: "2026-11-16T08:00:00+07:00",
      vehiclePlate: "29C-77777",
      items: [
        { ingredientId, sourceFacilityId, actualQuantity: "9", unit: "kg" },
      ],
    }),
  });
  assert.equal(postConflict.status, 409);

  actor = makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_ADMIN, [
    "delivery.receive",
  ]);
  const receiveReaderRes = await http.request("/api/deliveries/management");
  assert.equal(receiveReaderRes.status, 200);
});

void test("US3 read matrix covers supplier roles with view-or-manage permission, summary safety, legacy vs v1 detail, ordering and same-deliveryNo cross-tenant 404 (T084)", async (context) => {
  const supplierOtherId = uid(9901);
  const legacyReqDeliveryId = uid(9902);
  const v1StandaloneDeliveryId = uid(9903);
  const otherSupplierSameNoId = uid(9904);
  const createdOlder = new Date("2026-11-14T08:00:00Z");
  const createdNewer = new Date("2026-11-15T08:00:00Z");

  const records: SupplierOrderDetailRecord[] = [
    {
      id: v1StandaloneDeliveryId,
      deliveryNo: "FP-DE-00001",
      creationMode: "STANDALONE",
      creationFingerprint: "fp-secret-hidden",
      traceabilityVersion: 1,
      schoolId,
      supplierId,
      supplyRequestId: null,
      status: "IN_TRANSIT",
      expectedArrivalAt: new Date("2026-11-16T08:00:00Z"),
      arrivedAt: null,
      receivedAt: null,
      vehiclePlate: "29A-00001",
      note: null,
      createdByUserId: uid(302),
      createdAt: createdNewer,
      updatedAt: createdNewer,
      School: { name: "Tiểu học Hoa Mai" },
      SupplyRequest: null,
      deliveryItems: [
        {
          id: uid(9910),
          ingredientId,
          ingredientEntryId: null,
          supplyRequestItemId: null,
          sourceFacilityId,
          sourceFacilityNameSnapshot: "Nông trại Snapshot",
          sourceFacilityCodeSnapshot: "SF-SNAP",
          ingredientNameSnapshot: "Gạo ST25 Snapshot",
          qrUrl:
            "https://trace.example.test/public/delivery-items/secret-hex-should-not-leak-via-token-field",
          actualQuantity: new Prisma.Decimal("8.500"),
          unit: "kg",
          note: null,
          Ingredient: { name: "Gạo ST25 Đã Đổi Tên" },
        },
      ],
    },
    {
      id: legacyReqDeliveryId,
      deliveryNo: "DG-LEGACY-99",
      creationMode: null,
      creationFingerprint: "legacy-fp",
      traceabilityVersion: null,
      schoolId,
      supplierId,
      supplyRequestId,
      status: "RECEIVED",
      expectedArrivalAt: null,
      arrivedAt: createdOlder,
      receivedAt: createdOlder,
      vehiclePlate: null,
      note: "Đơn cũ",
      createdByUserId: uid(301),
      createdAt: createdOlder,
      updatedAt: createdOlder,
      School: { name: "Tiểu học Hoa Mai" },
      SupplyRequest: { requestNo: "SR-LEGACY-01" },
      deliveryItems: [
        {
          id: uid(9911),
          ingredientId,
          ingredientEntryId: entryId,
          supplyRequestItemId: requestItemId,
          sourceFacilityId: null,
          sourceFacilityNameSnapshot: null,
          sourceFacilityCodeSnapshot: null,
          ingredientNameSnapshot: null,
          qrUrl: null,
          actualQuantity: new Prisma.Decimal("12.000"),
          unit: "kg",
          note: "Ghi chú cũ",
          Ingredient: { name: "Gạo ST25" },
        },
      ],
    },
    {
      id: otherSupplierSameNoId,
      deliveryNo: "FP-DE-00001",
      creationMode: "STANDALONE",
      creationFingerprint: "other-fp",
      traceabilityVersion: 1,
      schoolId,
      supplierId: supplierOtherId,
      supplyRequestId: null,
      status: "IN_TRANSIT",
      expectedArrivalAt: new Date("2026-11-16T08:00:00Z"),
      arrivedAt: null,
      receivedAt: null,
      vehiclePlate: "30B-99999",
      note: null,
      createdByUserId: uid(9999),
      createdAt: createdNewer,
      updatedAt: createdNewer,
      School: { name: "Tiểu học Khác" },
      SupplyRequest: null,
      deliveryItems: [],
    },
  ];

  let capturedOrderBy: unknown;
  const mockDb = {
    delivery: {
      findMany: ({
        where,
        orderBy,
      }: {
        where: { AND: Array<{ supplierId?: string; status?: string }> };
        orderBy: unknown;
      }) => {
        capturedOrderBy = orderBy;
        const supFilter = where.AND.find((w) => "supplierId" in w)?.supplierId;
        const statusFilter = where.AND.find((w) => "status" in w)?.status;
        return Promise.resolve(
          records
            .filter(
              (r) =>
                r.supplierId === supFilter &&
                (!statusFilter || r.status === statusFilter),
            )
            .sort(
              (a, b) =>
                b.createdAt.getTime() - a.createdAt.getTime() ||
                a.id.localeCompare(b.id),
            ),
        );
      },
      findFirst: ({
        where,
      }: {
        where: { AND: Array<{ supplierId?: string; id?: string }> };
      }) => {
        const supFilter = where.AND.find((w) => "supplierId" in w)?.supplierId;
        const idFilter = where.AND.find((w) => "id" in w)?.id;
        return Promise.resolve(
          records.find(
            (r) => r.supplierId === supFilter && r.id === idFilter,
          ) ?? null,
        );
      },
    },
    sourceFacility: {
      findMany: () =>
        Promise.resolve([
          { id: sourceFacilityId, facilityCode: "SF-01", name: "Cơ sở A" },
        ]),
    },
    deliveryItem: {
      findMany: () => Promise.resolve([]),
    },
  } as never;

  const repo: SupplierOrderRepository = {
    ...supplierOrderRepository,
    connect: () => Promise.resolve(mockDb),
  };
  const service = createSupplierOrderService(repo, {
    publicTraceOrigin: "https://trace.example.test",
    renderQrBatch: (urls) =>
      Promise.resolve(urls.map(() => "data:image/png;base64,ok")),
  });

  let currentActor: AuthPrincipal = makeSupplierActor(
    ROLES.INGREDIENT_SUPPLIER_ADMIN,
    ["delivery.manage"],
  );
  const app = express();
  app.use(express.json());
  app.use(
    "/api/deliveries/management",
    createSupplierOrderRouter(service, (req, _res, next) => {
      req.auth = currentActor;
      next();
    }),
  );
  app.use(globalErrorHandler);
  const http = await startHttp(app);
  context.after(() => http.close());

  // Rejected query overrides / invalid params
  for (const badQuery of [
    `?supplierId=${supplierOtherId}`,
    `?schoolId=${schoolId}`,
    "?limit=101",
    "?status=UNKNOWN",
  ]) {
    assert.equal(
      (await http.request(`/api/deliveries/management${badQuery}`)).status,
      400,
    );
  }
  assert.equal(
    (
      await http.request(
        `/api/deliveries/management/${v1StandaloneDeliveryId}?extra=1`,
      )
    ).status,
    400,
  );

  // Allowed matrix: BOTH supplier roles with EITHER delivery.view OR delivery.manage (no forced delivery.view)
  for (const role of [
    ROLES.INGREDIENT_SUPPLIER_ADMIN,
    ROLES.INGREDIENT_SUPPLIER_STAFF,
  ] as const) {
    for (const perm of ["delivery.view", "delivery.manage"]) {
      currentActor = makeSupplierActor(role, [perm]);
      const listRes = await http.request("/api/deliveries/management");
      assert.equal(listRes.status, 200);
      assert.equal(
        (
          await http.request(
            `/api/deliveries/management/${v1StandaloneDeliveryId}`,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await http.request(
            "/api/deliveries/management/options/source-facilities",
          )
        ).status,
        perm === "delivery.manage" ? 200 : 403,
      );
    }
  }

  // Forbidden actors & missing permissions
  for (const denied of [
    makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_STAFF, []),
    { ...testStaff, permissions: ["delivery.view", "delivery.manage"] },
    { ...testAdmin, permissions: ["delivery.view", "delivery.manage"] },
    {
      ...testStaff,
      role: ROLES.COMMUNE_FOOD_SAFETY_OFFICER,
      orgType: "AUTHORITY" as const,
      schoolId: null,
      permissions: ["delivery.view", "delivery.manage"],
    },
  ]) {
    currentActor = denied;
    assert.equal(
      (await http.request("/api/deliveries/management")).status,
      403,
    );
    assert.equal(
      (
        await http.request(
          `/api/deliveries/management/${v1StandaloneDeliveryId}`,
        )
      ).status,
      403,
    );
  }

  currentActor = makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_ADMIN, [
    "delivery.view",
  ]);
  const listRes = await http.request("/api/deliveries/management");
  assert.equal(listRes.status, 200);
  assert.deepEqual(capturedOrderBy, [{ createdAt: "desc" }, { id: "asc" }]);
  const listPayload = (
    listRes.body as {
      data: {
        items: Array<{
          id: string;
          deliveryNo: string;
          status: string;
          statusLabel: string;
          sourceType: string;
          traceabilityVersion: number | null;
        }>;
      };
    }
  ).data.items;
  assert.equal(listPayload.length, 2);
  assert.equal(listPayload[0].id, v1StandaloneDeliveryId);
  assert.equal(listPayload[0].status, "IN_TRANSIT");
  assert.equal(listPayload[0].statusLabel, "Đang giao");
  assert.equal(listPayload[1].id, legacyReqDeliveryId);
  assert.equal(listPayload[1].sourceType, "REQUEST");
  assert.equal(listPayload[1].traceabilityVersion, null);
  assert.equal(listPayload[1].status, "RECEIVED");
  assert.equal(listPayload[1].statusLabel, "Hoàn thành");
  const rawListJson = JSON.stringify(listRes.body);
  assert.equal(rawListJson.includes("qrImageDataUrl"), false);
  assert.equal(rawListJson.includes("qrToken"), false);
  assert.equal(rawListJson.includes("creationKey"), false);
  assert.equal(rawListJson.includes("creationFingerprint"), false);

  // Legacy detail stays nullable without snapshot/traceUrl upgrade
  const legacyDetailRes = await http.request(
    `/api/deliveries/management/${legacyReqDeliveryId}`,
  );
  assert.equal(legacyDetailRes.status, 200);
  const legacyDetail = (
    legacyDetailRes.body as {
      data: {
        traceabilityVersion: number | null;
        items: Array<{
          ingredientName: string;
          sourceFacility: unknown;
          traceUrl: string | null;
        }>;
      };
    }
  ).data;
  assert.equal(legacyDetail.traceabilityVersion, null);
  assert.equal(legacyDetail.items[0].ingredientName, "Gạo ST25");
  assert.equal(legacyDetail.items[0].sourceFacility, null);
  assert.equal(legacyDetail.items[0].traceUrl, null);

  // v1 detail uses frozen snapshot name & traceUrl, never exposing secret token fields
  const v1DetailRes = await http.request(
    `/api/deliveries/management/${v1StandaloneDeliveryId}`,
  );
  assert.equal(v1DetailRes.status, 200);
  const v1Detail = (
    v1DetailRes.body as {
      data: {
        traceabilityVersion: number;
        items: Array<{
          ingredientName: string;
          sourceFacility: {
            id: string;
            name: string;
            facilityCode: string | null;
          };
          traceUrl: string;
        }>;
      };
    }
  ).data;
  assert.equal(v1Detail.traceabilityVersion, 1);
  assert.equal(v1Detail.items[0].ingredientName, "Gạo ST25 Snapshot");
  assert.deepEqual(v1Detail.items[0].sourceFacility, {
    id: sourceFacilityId,
    name: "Nông trại Snapshot",
    facilityCode: "SF-SNAP",
  });
  assert.equal("qrToken" in (v1Detail.items[0] as object), false);
  assert.equal("creationFingerprint" in (v1Detail as object), false);

  // Same deliveryNo belonging to another supplier still returns 404
  const sameNoForeignRes = await http.request(
    `/api/deliveries/management/${otherSupplierSameNoId}`,
  );
  assert.equal(sameNoForeignRes.status, 404);
});

void test("US3 canonical v2 equivalence, field-level conflict matrix, legacy baseline conflict, and render failure commit preservation (T088)", async (context) => {
  const persistedByKey = new Map<string, SupplierOrderDetailRecord>();
  const persistedById = new Map<string, SupplierOrderDetailRecord>();
  let renderError: Error | null = null;
  let seq = 0n;
  let tokenSeq = 0;

  const repo: SupplierOrderRepository = {
    connect: () => Promise.resolve({} as never),
    findByCreationKey: (_db, supId, userId, key) =>
      Promise.resolve(persistedByKey.get(`${supId}:${userId}:${key}`) ?? null),
    findSupplyRequestForCreation: () =>
      Promise.resolve(makeSupplyRequestRecord("ACCEPTED", true, 2)),
    hasDeliveryForRequest: () => Promise.resolve(false),
    lockSupplierForDeliveryNumber: () => Promise.resolve(),
    findHighestCanonicalDeliverySequence: () => Promise.resolve(seq),
    lockSourceFacilities: () => Promise.resolve(),
    findSourceFacilitiesByIds: (_db, ids) =>
      Promise.resolve(
        ids.map((id) => ({
          id,
          supplierId,
          facilityCode: id === sourceFacilityId ? "SF-01" : null,
          name: id === sourceFacilityId ? "Cơ sở A" : "Cơ sở B",
          status: "ACTIVE" as const,
        })),
      ),
    markSupplyRequestInProgress: () => Promise.resolve(1),
    listSchoolOptions: () => Promise.resolve([]),
    listIngredientOptions: () => Promise.resolve([]),
    listSourceFacilityOptions: () => Promise.resolve([]),
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
          name: "Dầu ăn",
          defaultUnit: "l",
          status: "ACTIVE",
        },
      ]),
    findIngredientEntriesForSchool: () => Promise.resolve([]),
    listManagementDeliveries: () => Promise.resolve([]),
    findManagementDeliveryById: (_db, _scope, id) =>
      Promise.resolve(persistedById.get(id) ?? null),
    findDeliveryForLabels: (_db, _scope, id) => {
      const found = persistedById.get(id);
      if (!found) return Promise.resolve(null);
      return Promise.resolve({
        id: found.id,
        supplierId: found.supplierId,
        deliveryNo: found.deliveryNo,
        traceabilityVersion: found.traceabilityVersion,
        Supplier: { name: "NCC Test" },
      });
    },
    listDeliveryLabelItems: (_db, cmd) => {
      const found = persistedById.get(cmd.deliveryId);
      if (!found) return Promise.resolve([]);
      return Promise.resolve(
        found.deliveryItems.map((item) => ({
          id: item.id,
          deliveryId: cmd.deliveryId,
          ingredientId: item.ingredientId,
          ingredientNameSnapshot: item.ingredientNameSnapshot,
          sourceFacilityId: item.sourceFacilityId,
          sourceFacilityNameSnapshot: item.sourceFacilityNameSnapshot,
          sourceFacilityCodeSnapshot: item.sourceFacilityCodeSnapshot,
          qrUrl: item.qrUrl,
          actualQuantity: item.actualQuantity,
          unit: item.unit,
          Ingredient: item.Ingredient,
        })),
      );
    },
    createDeliveryWithItems: (_db, input) => {
      seq += 1n;
      const now = new Date("2026-11-15T04:00:00Z");
      const record: SupplierOrderDetailRecord = {
        id: uid(9950 + Number(seq)),
        deliveryNo: input.deliveryNo,
        creationMode: input.creationMode,
        creationFingerprint: input.creationFingerprint,
        traceabilityVersion: input.traceabilityVersion,
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
          id: uid(9970 + idx + Number(seq) * 10),
          ingredientId: item.ingredientId,
          ingredientEntryId: item.ingredientEntryId,
          supplyRequestItemId: item.supplyRequestItemId,
          sourceFacilityId: item.sourceFacilityId,
          sourceFacilityNameSnapshot: item.sourceFacilityNameSnapshot,
          sourceFacilityCodeSnapshot: item.sourceFacilityCodeSnapshot,
          ingredientNameSnapshot: item.ingredientNameSnapshot,
          qrUrl: item.qrUrl,
          actualQuantity: item.actualQuantity,
          unit: item.unit,
          note: item.note,
          Ingredient: {
            name: item.ingredientId === ingredientId ? "Gạo ST25" : "Dầu ăn",
          },
        })),
      };
      persistedByKey.set(
        `${input.supplierId}:${input.createdByUserId}:${input.creationKey}`,
        record,
      );
      persistedById.set(record.id, record);
      return Promise.resolve(record);
    },
  };

  const service = createSupplierOrderService(repo, {
    publicTraceOrigin: "https://trace.example.test",
    generateToken: () => `${String(++tokenSeq).padStart(64, "a")}`,
    renderQrBatch: (urls) =>
      renderError
        ? Promise.reject(renderError)
        : Promise.resolve(urls.map(() => "data:image/png;base64,ok")),
    transaction: async (fn) => fn({} as never),
    guard: { assertAccess: (_tx, a) => Promise.resolve(a) },
    verifyActor: (_tx, a) => Promise.resolve(a),
  });

  const actor = makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_STAFF);

  // 1. Pre-commit render failure -> 503 with 0 DB writes, retry creates exactly 1 REQUEST record
  const reqKey = uid(9981);
  const reqBody = validateCreateSupplierOrderBody({
    sourceType: "REQUEST",
    supplyRequestId,
    expectedArrivalAt: "2026-11-16T08:00:00+07:00",
    vehiclePlate: "29A-12345",
    note: "Giao sáng",
    sources: [
      { supplyRequestItemId: requestItemId, sourceFacilityId },
      {
        supplyRequestItemId: requestItemId2,
        sourceFacilityId: sourceFacilityIdNullCode,
      },
    ],
  });
  renderError = new Error("PNG encoder timeout");
  await assert.rejects(
    () => service.create({ idempotencyKey: reqKey, body: reqBody }, actor),
    { statusCode: 503 },
  );
  assert.equal(persistedById.size, 0);

  renderError = null;
  const createdReq = await service.create(
    { idempotencyKey: reqKey, body: reqBody },
    actor,
  );
  assert.equal(createdReq.created, true);
  assert.equal(persistedById.size, 1);

  // Reordered sources + UTC equivalent timestamp + padded plate -> replay 200 without creating a second delivery
  const reqEquivalentBody = validateCreateSupplierOrderBody({
    sourceType: "REQUEST",
    supplyRequestId,
    expectedArrivalAt: "2026-11-16T01:00:00Z",
    vehiclePlate: "  29A-12345  ",
    note: "Giao sáng",
    sources: [
      {
        supplyRequestItemId: requestItemId2,
        sourceFacilityId: sourceFacilityIdNullCode,
      },
      { supplyRequestItemId: requestItemId, sourceFacilityId },
    ],
  });
  const reqReplay = await service.create(
    { idempotencyKey: reqKey, body: reqEquivalentBody },
    actor,
  );
  assert.equal(reqReplay.created, false);
  assert.equal(reqReplay.id, createdReq.id);
  assert.equal(persistedById.size, 1);

  // Field-level conflicts on REQUEST (facility, plate, ETA, note) -> 409
  for (const mutated of [
    {
      ...reqBody,
      sources: [
        {
          supplyRequestItemId: requestItemId,
          sourceFacilityId: sourceFacilityIdNullCode,
        },
        { supplyRequestItemId: requestItemId2, sourceFacilityId },
      ],
    },
    { ...reqBody, vehiclePlate: "29A-99999" },
    { ...reqBody, expectedArrivalAt: "2026-11-16T08:01:00+07:00" },
    { ...reqBody, note: "Ghi chú khác" },
  ]) {
    await assert.rejects(
      () =>
        service.create(
          {
            idempotencyKey: reqKey,
            body: validateCreateSupplierOrderBody(mutated),
          },
          actor,
        ),
      { statusCode: 409 },
    );
  }

  // 2. Post-commit renderer error on GET labels / POST replay does NOT delete/rollback committed DB record
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

  renderError = new Error("PNG worker down after commit");
  const failedLabels = await http.request(
    `/api/deliveries/management/${createdReq.id}/labels`,
  );
  assert.equal(failedLabels.status, 503);
  const failedReplayHttp = await http.request("/api/deliveries/management", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": reqKey,
    },
    body: JSON.stringify({
      sourceType: "REQUEST",
      supplyRequestId,
      expectedArrivalAt: "2026-11-16T08:00:00+07:00",
      vehiclePlate: "29A-12345",
      note: "Giao sáng",
      sources: [
        { supplyRequestItemId: requestItemId, sourceFacilityId },
        {
          supplyRequestItemId: requestItemId2,
          sourceFacilityId: sourceFacilityIdNullCode,
        },
      ],
    }),
  });
  assert.equal(failedReplayHttp.status, 503);
  // Detail still confirms committed delivery remained persisted cleanly
  const intactDetail = await http.request(
    `/api/deliveries/management/${createdReq.id}`,
  );
  assert.equal(intactDetail.status, 200);
  assert.equal(
    (intactDetail.body as { data: { id: string } }).data.id,
    createdReq.id,
  );
  assert.equal(persistedById.size, 1);

  renderError = null;
  const recoveredReplay = await service.create(
    { idempotencyKey: reqKey, body: reqEquivalentBody },
    actor,
  );
  assert.equal(recoveredReplay.created, false);
  assert.equal(recoveredReplay.id, createdReq.id);

  // 3. STANDALONE field-level conflicts + Legacy baseline key conflict (never upgrades traceabilityVersion)
  const stdKey = uid(9982);
  const stdBase = {
    sourceType: "STANDALONE" as const,
    schoolId,
    expectedArrivalAt: "2026-11-16T09:00:00+07:00",
    vehiclePlate: "30H-11111",
    note: "Đơn độc lập",
    items: [
      {
        ingredientId,
        sourceFacilityId,
        actualQuantity: "3.500",
        unit: "kg",
      },
    ],
  };
  await service.create(
    { idempotencyKey: stdKey, body: validateCreateSupplierOrderBody(stdBase) },
    actor,
  );
  for (const mutatedStd of [
    {
      ...stdBase,
      items: [
        {
          ingredientId,
          sourceFacilityId: sourceFacilityIdNullCode,
          actualQuantity: "3.5",
          unit: "kg",
        },
      ],
    },
    { ...stdBase, vehiclePlate: "30H-22222" },
    { ...stdBase, expectedArrivalAt: "2026-11-16T09:01:00+07:00" },
    { ...stdBase, note: null },
  ]) {
    await assert.rejects(
      () =>
        service.create(
          {
            idempotencyKey: stdKey,
            body: validateCreateSupplierOrderBody(mutatedStd),
          },
          actor,
        ),
      { statusCode: 409 },
    );
  }

  const legacyKey = uid(9983);
  const legacyBaselineRow: SupplierOrderDetailRecord = {
    id: uid(9984),
    deliveryNo: "DG-BASELINE-1",
    creationMode: "STANDALONE",
    creationFingerprint: "legacy-v1-sha256-digest",
    traceabilityVersion: null,
    schoolId,
    supplierId,
    supplyRequestId: null,
    status: "IN_TRANSIT",
    expectedArrivalAt: null,
    arrivedAt: null,
    receivedAt: null,
    vehiclePlate: null,
    note: null,
    createdByUserId: actor.id,
    createdAt: new Date("2026-11-10T00:00:00Z"),
    updatedAt: new Date("2026-11-10T00:00:00Z"),
    School: { name: "Tiểu học Hoa Mai" },
    SupplyRequest: null,
    deliveryItems: [],
  };
  persistedByKey.set(
    `${supplierId}:${actor.id}:${legacyKey}`,
    legacyBaselineRow,
  );
  persistedById.set(legacyBaselineRow.id, legacyBaselineRow);
  await assert.rejects(
    () =>
      service.create(
        {
          idempotencyKey: legacyKey,
          body: validateCreateSupplierOrderBody(stdBase),
        },
        actor,
      ),
    { statusCode: 409 },
  );
  assert.equal(legacyBaselineRow.traceabilityVersion, null);
});
