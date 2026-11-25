import express from "express";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "../src/generated/prisma/client";
import { ROLES } from "../src/constants/roles";
import type { AuthPrincipal } from "../src/types/auth";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import { createDeliveryRouter } from "../src/modules/delivery/delivery.routes";
import { createSupplierOrderRouter } from "../src/modules/supplier-order/supplier-order.routes";
import { createApiRouter } from "../src/routes";
import { createIntakeAccessRepository } from "../src/modules/account-lifecycle/intake-access.repository";
import { createIntakeAccessService } from "../src/modules/account-lifecycle/intake-access.service";
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
  validateDispatchSupplierOrderBody,
  validateSupplierOrderDetailParams,
  validateSupplierOrderEmptyQuery,
  validateSupplierOrderIdempotencyKey,
  validateSupplierOrderListQuery,
  validateSupplierOrderOptionsQuery,
  validateSupplierSchoolOptionsQuery,
  validateSupplierTopUp,
} from "../src/modules/supplier-order/supplier-order.validation";
import { HttpError } from "../src/utils/http-error";
import { RequestValidationError } from "../src/utils/request-validation";
import { startHttp } from "./helpers/http";
import { testAdmin, testStaff } from "./helpers/authorization";
import {
  businessCodeSuffix,
  formatBusinessCode,
} from "../src/utils/business-code";
import { readBusinessCodeKey } from "../src/config/env";

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

void test("dispatch compare-and-set permits legacy or ready-to-dispatch deliveries", async () => {
  const db = {
    delivery: {
      updateMany: (args: { where: { AND: { OR?: unknown }[] } }) => {
        assert.deepEqual(args.where.AND[1].OR, [
          { preparationStage: null },
          { preparationStage: "READY_TO_DISPATCH" },
        ]);
        return Promise.resolve({ count: 1 });
      },
    },
  } as unknown as Prisma.TransactionClient;
  assert.equal(
    await supplierOrderRepository.dispatchDelivery(db, {
      scope: { supplierId },
      deliveryId,
      expectedArrivalAt: new Date("2026-11-25T06:00:00.000Z"),
      vehiclePlate: "29C-12345",
    }),
    1,
  );
});

void test("round delivery top-up checks exact lots and only increments once on replay", async () => {
  const actor = makeSupplierActor();
  const ingredientLotId = uid(8101);
  let confirmedAt: Date | null = null;
  let added = new Prisma.Decimal(0);
  const increments: string[] = [];
  const tx = {
    delivery: {
      findFirst: () =>
        Promise.resolve({
          status: "PREPARING",
          preparationStage: confirmedAt
            ? "READY_TO_DISPATCH"
            : "TOP_UP_PENDING",
          topUpConfirmedAt: confirmedAt,
        }),
      update: () => {
        confirmedAt = new Date();
        return Promise.resolve({});
      },
    },
    ingredientLot: {
      findMany: () =>
        Promise.resolve([
          {
            id: ingredientLotId,
            lotCode: "FP-LO-8101",
            unit: "kg",
            status: "BLOCKED",
            sampleTopUpQuantity: added,
            DeliveryItem: {
              id: uid(8102),
              supplyRequestItemId: requestItemId,
              unit: "kg",
            },
            cookingBatchLots: [
              { unit: "g", sampleQuantity: new Prisma.Decimal(125) },
            ],
          },
        ]),
      update: (args: {
        data: { receivedQuantity: { increment: Prisma.Decimal } };
      }) => {
        added = added.add(args.data.receivedQuantity.increment);
        increments.push("lot");
        return Promise.resolve({});
      },
    },
    deliveryItem: {
      update: () => {
        increments.push("delivery-item");
        return Promise.resolve({});
      },
    },
    supplyRequestItem: {
      update: () => {
        increments.push("request-item");
        return Promise.resolve({});
      },
    },
  } as unknown as Prisma.TransactionClient;
  const service = createSupplierOrderService(
    {
      ...supplierOrderRepository,
      findManagementDeliveryById: () =>
        Promise.resolve({
          id: deliveryId,
          deliveryNo: "FP-DE-8101",
          creationMode: "REQUEST",
          traceabilityVersion: 1,
          workflowVersion: 2,
          schoolId,
          supplierId,
          supplyRequestId,
          status: "PREPARING",
          preparationStage: "READY_TO_DISPATCH",
          expectedArrivalAt: null,
          arrivedAt: null,
          receivedAt: null,
          vehiclePlate: null,
          note: null,
          createdByUserId: actor.id,
          createdAt: new Date(),
          updatedAt: new Date(),
          creationFingerprint: null,
          School: { name: "Trường" },
          SupplyRequest: null,
          deliveryItems: [],
        }),
    },
    {
      transaction: (operation) => operation(tx),
      guard: {
        assertAccess: () => Promise.reject(new Error("Unexpected guard")),
        assertDeliveryContinuation: () =>
          Promise.resolve({ actor, replayed: false, delivery: {} as never }),
      },
    },
  );
  const post = (quantity: string) =>
    service.confirmTopUp(
      { id: deliveryId },
      validateSupplierTopUp({
        lots: [{ ingredientLotId, sampleTopUpQuantity: quantity }],
      }),
      actor,
    );
  const conflict = (error: unknown) =>
    error instanceof HttpError && error.statusCode === 409;
  await assert.rejects(post("0.120"), conflict);
  assert.deepEqual(increments, []);
  await post("0.125");
  await post("0.125");
  await assert.rejects(post("0.126"), conflict);
  assert.equal(added.toString(), "0.125");
  assert.deepEqual(increments, ["lot", "delivery-item", "request-item"]);
});

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
        handlingType: "DIRECT_USE" as const,
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
        handlingType: "DIRECT_USE" as const,
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
    requestedDeliveryDate: null,
    orderType: null,
    batchNo: null,
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
  deliveryNo?: string;
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
  const nextDeliveryNo = options?.deliveryNo ?? "FP-DE-00001";
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
    allocateDeliveryNo: () => Promise.resolve(nextDeliveryNo),
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
        preparationStage: null,
        id: deliveryId,
        deliveryNo: input.deliveryNo,
        creationMode: input.creationMode,
        creationFingerprint: input.creationFingerprint,
        traceabilityVersion: input.traceabilityVersion,
        workflowVersion: input.workflowVersion ?? null,
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
          ? {
              status: requestState?.status ?? "IN_PROGRESS",
              requestNo: "SR-2026-001",
              orderType: null,
              batchNo: null,
            }
          : null,
        deliveryItems: input.items.map((item, idx) => ({
          sampleTopUpQuantity: new Prisma.Decimal(0),
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
    dispatchDelivery: () => Promise.resolve(0),
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

void test("đồ lưu kho bắt buộc nhập ngày sản xuất và hạn dùng của lô khi tạo chuyến giao; đồ tươi không cần", async () => {
  const dryRequest = () => {
    const record = makeSupplyRequestRecord();
    record.supplyRequestItems[0].IngredientEntry.handlingType = "DRY_STOCK";
    return record;
  };
  const bodyWith = (dates: Record<string, string>) =>
    validateCreateSupplierOrderBody({
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [
        {
          supplyRequestItemId: requestItemId,
          sourceFacilityId,
          actualQuantity: "12.500",
          ...dates,
        },
      ],
      note: null,
    });

  // Thiếu ngày: 422, không tạo chuyến giao.
  const missing = setupUs1Harness({ supplyRequest: dryRequest() });
  await assert.rejects(
    () =>
      missing.service.create(
        {
          idempotencyKey: idemKey1,
          body: bodyWith({ expiryDate: "2027-05-01" }),
        },
        makeSupplierActor(),
      ),
    {
      statusCode: 422,
      message:
        "Đồ lưu kho cần nhập ngày sản xuất và hạn sử dụng của lô: Gạo ST25",
    },
  );
  assert.equal(missing.createdPayloads.length, 0);

  // Hạn dùng trước ngày sản xuất: bị chặn ở bước kiểm tra đầu vào.
  assert.throws(
    () => bodyWith({ manufactureDate: "2026-11-10", expiryDate: "2026-11-01" }),
    (err: unknown) =>
      err instanceof RequestValidationError &&
      err.fields.some((f) => f.field === "sources.0.expiryDate"),
  );

  // Ngày tính theo giờ Việt Nam, tương đối với hôm nay.
  const vnDay = (offsetDays: number) =>
    new Date(Date.now() + 7 * 3600000 + offsetDays * 86400000)
      .toISOString()
      .slice(0, 10);

  // Hạn sử dụng trước hôm nay: 422.
  const expired = setupUs1Harness({ supplyRequest: dryRequest() });
  await assert.rejects(
    () =>
      expired.service.create(
        {
          idempotencyKey: idemKey1,
          body: bodyWith({
            manufactureDate: vnDay(-30),
            expiryDate: vnDay(-1),
          }),
        },
        makeSupplierActor(),
      ),
    {
      statusCode: 422,
      message: "Hạn sử dụng không được trước hôm nay: Gạo ST25",
    },
  );
  assert.equal(expired.createdPayloads.length, 0);

  // Đồ lưu kho còn hạn dưới 7 ngày: 422.
  const shortShelf = setupUs1Harness({ supplyRequest: dryRequest() });
  await assert.rejects(
    () =>
      shortShelf.service.create(
        {
          idempotencyKey: idemKey1,
          body: bodyWith({ manufactureDate: vnDay(-30), expiryDate: vnDay(6) }),
        },
        makeSupplierActor(),
      ),
    {
      statusCode: 422,
      message:
        "Đồ lưu kho cần còn hạn sử dụng ít nhất 7 ngày kể từ hôm nay: Gạo ST25",
    },
  );
  assert.equal(shortShelf.createdPayloads.length, 0);

  // Đủ ngày: lô được tạo với đúng ngày sản xuất và hạn dùng.
  const ok = setupUs1Harness({ supplyRequest: dryRequest() });
  await ok.service.create(
    {
      idempotencyKey: idemKey1,
      body: bodyWith({
        manufactureDate: "2026-11-01",
        expiryDate: "2027-05-01",
      }),
    },
    makeSupplierActor(),
  );
  const item = ok.createdPayloads[0].items[0];
  assert.equal(item.manufactureDate?.toISOString().slice(0, 10), "2026-11-01");
  assert.equal(item.expiryDate?.toISOString().slice(0, 10), "2027-05-01");

  // Đồ tươi: không cần ngày.
  const fresh = setupUs1Harness();
  await fresh.service.create(
    { idempotencyKey: idemKey1, body: bodyWith({}) },
    makeSupplierActor(),
  );
  assert.equal(fresh.createdPayloads[0].items[0].expiryDate, null);
});

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
        actualQuantity: "12.500",
      },
    ],
    note: "   ",
  });
  assert.deepEqual(parsed, {
    sourceType: "REQUEST",
    supplyRequestId,
    sources: [
      {
        supplyRequestItemId: requestItemId,
        sourceFacilityId,
        actualQuantity: "12.5",
        manufactureDate: null,
        expiryDate: null,
      },
    ],
    note: null,
  });

  // Multi-source allocation across distinct source facilities is valid for REQUEST
  const multiSourceParsed = validateCreateSupplierOrderBody({
    sourceType: "REQUEST",
    supplyRequestId,
    sources: [
      {
        supplyRequestItemId: requestItemId,
        sourceFacilityId,
        actualQuantity: "6.000",
      },
      {
        supplyRequestItemId: requestItemId,
        sourceFacilityId: sourceFacilityIdNullCode,
        actualQuantity: "6.500",
      },
    ],
  });
  assert.equal(multiSourceParsed.sourceType, "REQUEST");
  if (multiSourceParsed.sourceType === "REQUEST") {
    assert.deepEqual(
      multiSourceParsed.sources.map((s) => s.actualQuantity),
      ["6", "6.5"],
    );
  }

  // REQUEST sources may exceed 100 lines when legacy requests contain many items
  const largeSources = Array.from({ length: 105 }, (_, i) => ({
    supplyRequestItemId: uid(2000 + i),
    sourceFacilityId,
    actualQuantity: "1",
  }));
  const parsedLarge = validateCreateSupplierOrderBody({
    sourceType: "REQUEST",
    supplyRequestId,
    sources: largeSources,
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
    },
    {
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [{ supplyRequestItemId: requestItemId, sourceFacilityId }],
    },
    {
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [
        {
          supplyRequestItemId: requestItemId,
          sourceFacilityId,
          actualQuantity: "0",
        },
      ],
    },
    {
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [
        {
          supplyRequestItemId: requestItemId,
          sourceFacilityId,
          actualQuantity: "-1",
        },
      ],
    },
    {
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [
        {
          supplyRequestItemId: requestItemId,
          sourceFacilityId,
          actualQuantity: "1e2",
        },
      ],
    },
    {
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [
        {
          supplyRequestItemId: requestItemId,
          sourceFacilityId,
          actualQuantity: "1.2345",
        },
      ],
    },
    {
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [
        {
          supplyRequestItemId: requestItemId,
          sourceFacilityId,
          actualQuantity: "12.5",
        },
        {
          supplyRequestItemId: requestItemId.toUpperCase(),
          sourceFacilityId: sourceFacilityId.toUpperCase(),
          actualQuantity: "0.5",
        },
      ],
    },
    {
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [
        {
          supplyRequestItemId: requestItemId,
          sourceFacilityId,
          actualQuantity: "12.5",
        },
      ],
      schoolId,
    },
    {
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [
        {
          supplyRequestItemId: requestItemId,
          sourceFacilityId,
          actualQuantity: "12.5",
        },
      ],
      supplierId,
    },
    {
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [
        {
          supplyRequestItemId: requestItemId,
          sourceFacilityId,
          actualQuantity: "12.5",
        },
      ],
      status: "RECEIVED",
    },
    {
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [
        {
          supplyRequestItemId: requestItemId,
          sourceFacilityId,
          actualQuantity: "12.5",
        },
      ],
      items: [],
    },
    {
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [
        {
          supplyRequestItemId: requestItemId,
          sourceFacilityId,
          actualQuantity: "12.5",
        },
      ],
      deliveryNo: "FP-DE-00999",
    },
    {
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [
        {
          supplyRequestItemId: requestItemId,
          sourceFacilityId,
          actualQuantity: "12.5",
        },
      ],
      expectedArrivalAt: "2026-11-16T08:30:00Z",
    },
    {
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [
        {
          supplyRequestItemId: requestItemId,
          sourceFacilityId,
          actualQuantity: "12.5",
        },
      ],
      vehiclePlate: "29A-12345",
    },
    {
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [
        {
          supplyRequestItemId: requestItemId,
          sourceFacilityId,
          actualQuantity: "12.5",
        },
      ],
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
        expectedArrivalAt: "2026-11-16T08:30:00Z",
        vehiclePlate: "29A-1",
      }),
    (err: unknown) =>
      err instanceof RequestValidationError &&
      err.statusCode === 400 &&
      err.fields.some((f) => f.field === "sources.0.supplyRequestItemId") &&
      err.fields.some((f) => f.field === "sources.0.actualQuantity") &&
      err.fields.some((f) => f.field === "expectedArrivalAt") &&
      err.fields.some((f) => f.field === "vehiclePlate"),
  );

  assert.throws(
    () =>
      validateCreateSupplierOrderBody({
        sourceType: "REQUEST",
        supplyRequestId,
        sources: [
          {
            supplyRequestItemId: requestItemId,
            sourceFacilityId,
            actualQuantity: "5",
          },
          {
            supplyRequestItemId: requestItemId,
            sourceFacilityId,
            actualQuantity: "7.5",
          },
        ],
      }),
    (err: unknown) =>
      err instanceof RequestValidationError &&
      err.statusCode === 400 &&
      err.fields.some((f) => f.field === "sources.1.sourceFacilityId"),
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
      sources: [
        {
          supplyRequestItemId: requestItemId,
          sourceFacilityId,
          actualQuantity: "12.500",
        },
      ],
      note: "Giao đủ",
    });

    const result = await h.service.create(
      { idempotencyKey: idemKey1, body },
      actor,
    );
    assert.equal(result.created, true);
    assert.equal(result.sourceType, "REQUEST");
    assert.equal(result.traceabilityVersion, 1);
    assert.equal(result.workflowVersion, 2);
    assert.equal(result.nextAction, "ENTER_SHIPPING");
    assert.equal(result.deliveryNo, "FP-DE-00001");
    assert.equal(result.status, "PREPARING");
    assert.equal(result.statusLabel, "Đang chuẩn bị hàng");
    assert.equal(result.schoolId, schoolId);
    assert.equal(result.supplierId, supplierId);
    assert.equal(result.supplyRequestId, supplyRequestId);
    assert.equal(result.requestNo, "SR-2026-001");
    assert.equal(result.expectedArrivalAt, null);
    assert.equal(result.vehiclePlate, null);
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
    deliveryNo: "FP-DE-58213",
  });
  const body = validateCreateSupplierOrderBody({
    sourceType: "REQUEST",
    supplyRequestId,
    sources: [
      {
        supplyRequestItemId: requestItemId2,
        sourceFacilityId: sourceFacilityIdNullCode,
        actualQuantity: "4.000",
      },
      {
        supplyRequestItemId: requestItemId,
        sourceFacilityId,
        actualQuantity: "12.500",
      },
    ],
  });
  const inProgressResult = await inProgressHarness.service.create(
    { idempotencyKey: idemKey2, body },
    makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_STAFF),
  );
  assert.equal(inProgressResult.created, true);
  assert.equal(inProgressResult.workflowVersion, 2);
  assert.equal(inProgressResult.status, "PREPARING");
  assert.equal(inProgressResult.deliveryNo, "FP-DE-58213");
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
      sources: [
        {
          supplyRequestItemId: requestItemId,
          sourceFacilityId,
          actualQuantity: "12.5",
        },
      ],
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

void test("US1 repository queries enforce supplier scope, ordering, locks, FP-LO lot codes and atomic item creation", async () => {
  let seenCreateData: unknown;
  const rawQueries: string[] = [];
  const mockDb = {
    $queryRaw: (
      strings: TemplateStringsArray | { sql: string; values: unknown[] },
      ...values: unknown[]
    ) => {
      // Mã lô FP-LO dùng Prisma.sql (không phải template string): giả lập số lớn nhất hiện có là 41.
      if (!Array.isArray(strings)) {
        const query = strings as { sql: string; values: unknown[] };
        rawQueries.push(query.sql);
        assert.ok(query.sql.includes("ingredient_lots"));
        assert.deepEqual(query.values, ["^FP-LO-[0-9]{5,}$"]);
        return Promise.resolve([{ maxSeq: "41" }]);
      }
      const sql = (strings as TemplateStringsArray).join("?");
      rawQueries.push(sql);
      if (sql.includes("pg_advisory_xact_lock")) {
        assert.ok(
          ["foodprint:fp-code:LO", "foodprint:business-code:DE"].includes(
            values[0] as string,
          ),
        );
        return Promise.resolve([{ locked: 1 }]);
      }
      if (sql.includes("business_code_counters")) {
        assert.equal(values[0], "DE");
        return Promise.resolve([{ lastSequence: 1 }]);
      }
      return Promise.resolve([{ id: supplierId }]);
    },
    delivery: {
      findFirst: ({ where }: { where: Record<string, unknown> }) => {
        assert.deepEqual(where, {
          supplyRequestId,
          status: { notIn: ["REJECTED", "CANCELLED"] },
        });
        return Promise.resolve(null);
      },
      findMany: ({ where }: { where: { deliveryNo: { in: string[] } } }) => {
        // Mã mới được kiểm tra trùng trên toàn bảng, không lọc theo nhà cung cấp.
        assert.deepEqual(Object.keys(where), ["deliveryNo"]);
        assert.equal(where.deliveryNo.in.length, 1);
        return Promise.resolve([]);
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

  const allocatedDeliveryNo =
    await supplierOrderRepository.allocateDeliveryNo(mockDb);
  // Số thứ tự 1 → hậu tố Feistel(0) với khóa test, không phải 00001 thô.
  assert.equal(
    allocatedDeliveryNo,
    formatBusinessCode("DE", businessCodeSuffix(1, readBusinessCodeKey())),
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
    "FP-LO-00042",
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
    sources: [
      {
        supplyRequestItemId: requestItemId,
        sourceFacilityId,
        actualQuantity: "12.5",
      },
    ],
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
  assert.equal(payload.data.status, "PREPARING");
  assert.equal(payload.data.statusLabel, "Đang chuẩn bị hàng");
  assert.equal(payload.data.traceabilityVersion, 1);
  assert.equal(payload.data.workflowVersion, 2);
  assert.equal(payload.data.nextAction, "ENTER_SHIPPING");
  assert.equal(payload.data.expectedArrivalAt, null);
  assert.equal(payload.data.vehiclePlate, null);
  assert.equal(payload.data.deliveryNo, "FP-DE-00001");
  assert.equal(payload.data.supplyRequestId, supplyRequestId);
  assert.equal("created" in payload.data, false);
  assert.equal("creationKey" in payload.data, false);
  assert.equal("creationFingerprint" in payload.data, false);
});

void test("T111 REQUEST multi-source allocation supports 6A+4B split, prevents cross-group/ingredient+facility conflicts and replays canonically", async (context) => {
  const sr10kg = makeSupplyRequestRecord("ACCEPTED", true, 1);
  sr10kg.supplyRequestItems[0].requestedQuantity = new Prisma.Decimal("10.000");

  const stored = new Map<string, SupplierOrderDetailRecord>();
  const createdPayloads: SupplierOrderCreateDeliveryInput[] = [];
  let hasPrior = false;
  let requestState: SupplierOrderSupplyRequestRecord = sr10kg;
  let renderCalls = 0;
  let originCalls = 0;
  let seq = 0;

  const repo: SupplierOrderRepository = {
    connect: () => Promise.resolve({} as never),
    findByCreationKey: (_db, supId, userId, key) =>
      Promise.resolve(stored.get(`${supId}:${userId}:${key}`) ?? null),
    findSupplyRequestForCreation: () => Promise.resolve(requestState),
    hasDeliveryForRequest: () => Promise.resolve(hasPrior),
    allocateDeliveryNo: () => Promise.resolve("FP-DE-00001"),
    lockSourceFacilities: () => Promise.resolve(),
    findSourceFacilitiesByIds: (_db, ids) =>
      Promise.resolve(
        [
          {
            id: sourceFacilityId,
            supplierId,
            facilityCode: "SF-A",
            name: "Cơ sở A",
            status: "ACTIVE" as const,
          },
          {
            id: sourceFacilityIdNullCode,
            supplierId,
            facilityCode: null,
            name: "Cơ sở B",
            status: "ACTIVE" as const,
          },
        ].filter((f) => ids.includes(f.id)),
      ),
    createDeliveryWithItems: (_db, input) => {
      createdPayloads.push(input);
      const now = new Date("2026-11-15T05:00:00Z");
      const rec: SupplierOrderDetailRecord = {
        preparationStage: null,
        id: deliveryId,
        deliveryNo: input.deliveryNo,
        creationMode: input.creationMode,
        creationFingerprint: input.creationFingerprint,
        traceabilityVersion: input.traceabilityVersion,
        workflowVersion: input.workflowVersion ?? null,
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
        SupplyRequest: {
          status: requestState.status,
          requestNo: requestState.requestNo,
          orderType: null,
          batchNo: null,
        },
        deliveryItems: input.items.map((item, idx) => ({
          sampleTopUpQuantity: new Prisma.Decimal(0),
          id: item.id ?? uid(5500 + idx),
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
      stored.set(
        `${input.supplierId}:${input.createdByUserId}:${input.creationKey}`,
        rec,
      );
      hasPrior = true;
      return Promise.resolve(rec);
    },
    markSupplyRequestInProgress: () => {
      requestState = { ...requestState, status: "IN_PROGRESS" };
      return Promise.resolve(1);
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
    dispatchDelivery: () => Promise.resolve(0),
  };

  const service = createSupplierOrderService(repo, {
    readOrigin: () => {
      originCalls += 1;
      return "https://trace.example.test";
    },
    generateToken: () => `${String(++seq).padStart(64, "c")}`,
    renderQrBatch: (urls) => {
      renderCalls += 1;
      return Promise.resolve(urls.map(() => "data:image/png;base64,ok"));
    },
    transaction: async (fn) => fn({} as never),
    guard: { assertAccess: (_tx, a) => Promise.resolve(a) },
    verifyActor: (_tx, a) => Promise.resolve(a),
  });

  const actor = makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_STAFF);
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

  const splitRes = await http.request("/api/deliveries/management", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idemKey1,
    },
    body: JSON.stringify({
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [
        {
          supplyRequestItemId: requestItemId,
          sourceFacilityId,
          actualQuantity: "6.000",
        },
        {
          supplyRequestItemId: requestItemId,
          sourceFacilityId: sourceFacilityIdNullCode,
          actualQuantity: "4",
        },
      ],
    }),
  });
  assert.equal(splitRes.status, 201);
  const splitBody = splitRes.body as {
    data: {
      id: string;
      status: string;
      workflowVersion: number | null;
      traceabilityVersion: number | null;
      nextAction: string;
      expectedArrivalAt: string | null;
      vehiclePlate: string | null;
      items: Array<{
        id: string;
        supplyRequestItemId: string;
        actualQuantity: string;
        traceUrl: string;
        sourceFacility: { id: string } | null;
      }>;
    };
  };
  assert.equal(splitBody.data.status, "PREPARING");
  assert.equal(splitBody.data.workflowVersion, 2);
  assert.equal(splitBody.data.traceabilityVersion, 1);
  assert.equal(splitBody.data.nextAction, "ENTER_SHIPPING");
  assert.equal(splitBody.data.expectedArrivalAt, null);
  assert.equal(splitBody.data.vehiclePlate, null);
  assert.equal(splitBody.data.items.length, 2);
  assert.notEqual(splitBody.data.items[0].id, splitBody.data.items[1].id);
  assert.notEqual(
    splitBody.data.items[0].traceUrl,
    splitBody.data.items[1].traceUrl,
  );
  assert.deepEqual(
    splitBody.data.items.map((i) => ({
      facility: i.sourceFacility?.id,
      qty: i.actualQuantity,
    })),
    [
      { facility: sourceFacilityId, qty: "6" },
      { facility: sourceFacilityIdNullCode, qty: "4" },
    ],
  );
  assert.equal(requestState.status, "IN_PROGRESS");
  assert.ok(createdPayloads[0].items[0].id);
  assert.ok(createdPayloads[0].items[1].id);
  assert.notEqual(
    createdPayloads[0].items[0].id,
    createdPayloads[0].items[1].id,
  );
  const rawJson = JSON.stringify(splitRes.body);
  for (const secret of [
    "created",
    "qrToken",
    "creationKey",
    "creationFingerprint",
  ]) {
    assert.equal(secret in (splitBody.data as object), false);
    assert.equal(rawJson.includes(`"${secret}":`), false);
  }

  // Canonical v3 replay: reorder (4B, 6A) -> 200 without invoking renderer or origin
  const rendersAfterCreate = renderCalls;
  const originsAfterCreate = originCalls;
  const reorderedReplay = await http.request("/api/deliveries/management", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idemKey1,
    },
    body: JSON.stringify({
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [
        {
          supplyRequestItemId: requestItemId,
          sourceFacilityId: sourceFacilityIdNullCode,
          actualQuantity: "4.000",
        },
        {
          supplyRequestItemId: requestItemId,
          sourceFacilityId,
          actualQuantity: "6",
        },
      ],
    }),
  });
  assert.equal(reorderedReplay.status, 200);
  assert.equal(renderCalls, rendersAfterCreate);
  assert.equal(originCalls, originsAfterCreate);
  assert.equal(
    (reorderedReplay.body as { data: { id: string } }).data.id,
    splitBody.data.id,
  );

  // Same key with 5A+5B -> 409; new key for same request -> 409
  const diffSplitSameKey = await http.request("/api/deliveries/management", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idemKey1,
    },
    body: JSON.stringify({
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [
        {
          supplyRequestItemId: requestItemId,
          sourceFacilityId,
          actualQuantity: "5",
        },
        {
          supplyRequestItemId: requestItemId,
          sourceFacilityId: sourceFacilityIdNullCode,
          actualQuantity: "5",
        },
      ],
    }),
  });
  assert.equal(diffSplitSameKey.status, 409);

  const newKeyAfterDelivery = await http.request("/api/deliveries/management", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idemKey2,
    },
    body: JSON.stringify({
      sourceType: "REQUEST",
      supplyRequestId,
      sources: [
        {
          supplyRequestItemId: requestItemId,
          sourceFacilityId,
          actualQuantity: "10",
        },
      ],
    }),
  });
  assert.equal(newKeyAfterDelivery.status, 409);

  // Sum mismatch (9, 11, 6+6), cross-group offsetting, missing/extra group, resolved (ingredientId, sourceFacilityId) duplicate -> 409
  const twoGroupReq = makeSupplyRequestRecord("ACCEPTED", true, 2);
  twoGroupReq.supplyRequestItems[0].requestedQuantity = new Prisma.Decimal(
    "10",
  );
  twoGroupReq.supplyRequestItems[1].requestedQuantity = new Prisma.Decimal("4");

  for (const badSources of [
    // sum = 9
    [
      {
        supplyRequestItemId: requestItemId,
        sourceFacilityId,
        actualQuantity: "5",
      },
      {
        supplyRequestItemId: requestItemId,
        sourceFacilityId: sourceFacilityIdNullCode,
        actualQuantity: "4",
      },
      {
        supplyRequestItemId: requestItemId2,
        sourceFacilityId,
        actualQuantity: "4",
      },
    ],
    // sum = 11
    [
      {
        supplyRequestItemId: requestItemId,
        sourceFacilityId,
        actualQuantity: "6",
      },
      {
        supplyRequestItemId: requestItemId,
        sourceFacilityId: sourceFacilityIdNullCode,
        actualQuantity: "5",
      },
      {
        supplyRequestItemId: requestItemId2,
        sourceFacilityId,
        actualQuantity: "4",
      },
    ],
    // 6+6 = 12
    [
      {
        supplyRequestItemId: requestItemId,
        sourceFacilityId,
        actualQuantity: "6",
      },
      {
        supplyRequestItemId: requestItemId,
        sourceFacilityId: sourceFacilityIdNullCode,
        actualQuantity: "6",
      },
      {
        supplyRequestItemId: requestItemId2,
        sourceFacilityId,
        actualQuantity: "4",
      },
    ],
    // Cross-group offset: 11 + 3 = 14 != (10, 4)
    [
      {
        supplyRequestItemId: requestItemId,
        sourceFacilityId,
        actualQuantity: "11",
      },
      {
        supplyRequestItemId: requestItemId2,
        sourceFacilityId,
        actualQuantity: "3",
      },
    ],
    // Missing second group
    [
      {
        supplyRequestItemId: requestItemId,
        sourceFacilityId,
        actualQuantity: "10",
      },
    ],
    // Extra unknown supplyRequestItemId
    [
      {
        supplyRequestItemId: requestItemId,
        sourceFacilityId,
        actualQuantity: "10",
      },
      {
        supplyRequestItemId: requestItemId2,
        sourceFacilityId,
        actualQuantity: "4",
      },
      { supplyRequestItemId: uid(9998), sourceFacilityId, actualQuantity: "1" },
    ],
  ]) {
    const errH = setupUs1Harness({ supplyRequest: twoGroupReq });
    await assert.rejects(
      () =>
        errH.service.create(
          {
            idempotencyKey: idemKey1,
            body: validateCreateSupplierOrderBody({
              sourceType: "REQUEST",
              supplyRequestId,
              sources: badSources,
            }),
          },
          actor,
        ),
      { statusCode: 409 },
    );
    assert.equal(errH.createdPayloads.length, 0);
  }

  // Two SupplyRequestItems with same ingredientId: duplicate resolved (ingredientId, sourceFacilityId) -> 409; distinct facilities -> 201
  const sameIngTwoItems = makeSupplyRequestRecord("ACCEPTED", true, 2);
  sameIngTwoItems.supplyRequestItems[0].requestedQuantity = new Prisma.Decimal(
    "5",
  );
  sameIngTwoItems.supplyRequestItems[1].requestedQuantity = new Prisma.Decimal(
    "5",
  );
  sameIngTwoItems.supplyRequestItems[1].ingredientEntryId = entryId2;
  sameIngTwoItems.supplyRequestItems[1].IngredientEntry = {
    id: entryId2,
    ingredientId,
    handlingType: "DIRECT_USE" as const,
    Ingredient: { id: ingredientId, name: "Gạo ST25" },
  };
  const dupResolvedH = setupUs1Harness({ supplyRequest: sameIngTwoItems });
  await assert.rejects(
    () =>
      dupResolvedH.service.create(
        {
          idempotencyKey: idemKey1,
          body: validateCreateSupplierOrderBody({
            sourceType: "REQUEST",
            supplyRequestId,
            sources: [
              {
                supplyRequestItemId: requestItemId,
                sourceFacilityId,
                actualQuantity: "5",
              },
              {
                supplyRequestItemId: requestItemId2,
                sourceFacilityId,
                actualQuantity: "5",
              },
            ],
          }),
        },
        actor,
      ),
    { statusCode: 409 },
  );

  const distinctFacSameIngH = setupUs1Harness({
    supplyRequest: sameIngTwoItems,
  });
  const sameIngOk = await distinctFacSameIngH.service.create(
    {
      idempotencyKey: idemKey1,
      body: validateCreateSupplierOrderBody({
        sourceType: "REQUEST",
        supplyRequestId,
        sources: [
          {
            supplyRequestItemId: requestItemId,
            sourceFacilityId,
            actualQuantity: "5",
          },
          {
            supplyRequestItemId: requestItemId2,
            sourceFacilityId: sourceFacilityIdNullCode,
            actualQuantity: "5",
          },
        ],
      }),
    },
    actor,
  );
  assert.equal(sameIngOk.created, true);
  assert.equal(sameIngOk.items.length, 2);

  // Different ingredients sharing the same sourceFacilityId -> allowed
  const diffIngSharedFacH = setupUs1Harness({ supplyRequest: twoGroupReq });
  const sharedFacOk = await diffIngSharedFacH.service.create(
    {
      idempotencyKey: idemKey1,
      body: validateCreateSupplierOrderBody({
        sourceType: "REQUEST",
        supplyRequestId,
        sources: [
          {
            supplyRequestItemId: requestItemId,
            sourceFacilityId,
            actualQuantity: "10",
          },
          {
            supplyRequestItemId: requestItemId2,
            sourceFacilityId,
            actualQuantity: "4",
          },
        ],
      }),
    },
    actor,
  );
  assert.equal(sharedFacOk.created, true);
  assert.equal(sharedFacOk.items.length, 2);
});

void test("US2 validation enforces STANDALONE items, quantities, duplicate prevention and options pagination", () => {
  const valid = validateCreateSupplierOrderBody({
    sourceType: "STANDALONE",
    schoolId: schoolId.toUpperCase(),
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
  assert.equal(valid.note, "Giao độc lập");
  assert.equal(valid.items[0].ingredientId, ingredientId);
  assert.equal(valid.items[0].sourceFacilityId, sourceFacilityId);
  assert.equal(valid.items[1].sourceFacilityId, sourceFacilityId);
  assert.equal(valid.items[0].actualQuantity, "12.5");
  assert.equal(valid.items[0].unit, "kg");
  assert.equal(valid.items[1].actualQuantity, "10");

  const sameIngredientMultiSource = validateCreateSupplierOrderBody({
    sourceType: "STANDALONE",
    schoolId,
    items: [
      { ingredientId, sourceFacilityId, actualQuantity: "6", unit: "kg" },
      {
        ingredientId: ingredientId.toUpperCase(),
        sourceFacilityId: sourceFacilityIdNullCode,
        actualQuantity: "4.000",
        unit: "kg",
      },
    ],
  });
  assert.equal(sameIngredientMultiSource.sourceType, "STANDALONE");
  if (sameIngredientMultiSource.sourceType === "STANDALONE") {
    assert.equal(sameIngredientMultiSource.items.length, 2);
    assert.deepEqual(
      sameIngredientMultiSource.items.map((i) => i.actualQuantity),
      ["6", "4"],
    );
  }

  const dupThirdPair = {
    sourceType: "STANDALONE",
    schoolId,
    items: [
      { ingredientId, sourceFacilityId, actualQuantity: "6", unit: "kg" },
      {
        ingredientId: ingredientId.toUpperCase(),
        sourceFacilityId: sourceFacilityIdNullCode,
        actualQuantity: "4",
        unit: "kg",
      },
      {
        ingredientId: ingredientId.toUpperCase(),
        sourceFacilityId: sourceFacilityId.toUpperCase(),
        actualQuantity: "1",
        unit: "kg",
      },
    ],
  };
  assert.throws(
    () => validateCreateSupplierOrderBody(dupThirdPair),
    (err: unknown) =>
      err instanceof RequestValidationError &&
      err.statusCode === 400 &&
      err.fields.some((f) => f.field === "items.2.sourceFacilityId"),
  );

  // Max 100 allocation rows for STANDALONE
  const standalone101 = Array.from({ length: 101 }, (_, i) => ({
    ingredientId,
    sourceFacilityId: uid(4000 + i),
    actualQuantity: "1",
    unit: "kg",
  }));
  assert.throws(
    () =>
      validateCreateSupplierOrderBody({
        sourceType: "STANDALONE",
        schoolId,
        items: standalone101,
      }),
    (err: unknown) =>
      err instanceof RequestValidationError && err.statusCode === 400,
  );

  // T119: separate school search query validator vs strict options query validator
  assert.deepEqual(validateSupplierSchoolOptionsQuery({}), {
    page: 1,
    limit: 20,
  });
  assert.deepEqual(
    validateSupplierSchoolOptionsQuery({ search: "  Hoa Mai  ", limit: "5" }),
    { page: 1, limit: 5, search: "Hoa Mai" },
  );
  assert.deepEqual(validateSupplierSchoolOptionsQuery({ search: "   " }), {
    page: 1,
    limit: 20,
  });
  assert.deepEqual(
    validateSupplierSchoolOptionsQuery({ search: `  ${"a".repeat(100)}  ` }),
    { page: 1, limit: 20, search: "a".repeat(100) },
  );
  for (const badSchoolQuery of [
    { search: "a".repeat(101) },
    { search: ["hoa", "mai"] },
    { search: { contains: "hoa" } },
    { q: "hoa" },
    { supplierId },
    { schoolId },
  ]) {
    assert.throws(
      () => validateSupplierSchoolOptionsQuery(badSchoolQuery),
      (err: unknown) =>
        err instanceof RequestValidationError && err.statusCode === 400,
    );
  }
  assert.throws(
    () => validateSupplierOrderOptionsQuery({ search: "hoa" }),
    (err: unknown) =>
      err instanceof RequestValidationError && err.statusCode === 400,
  );

  const baseStandalone = {
    sourceType: "STANDALONE" as const,
    schoolId,
  };
  for (const invalidStandalone of [
    { ...baseStandalone, items: [] },
    {
      ...baseStandalone,
      expectedArrivalAt: "2026-11-16T08:00:00+07:00",
      items: [
        { ingredientId, sourceFacilityId, actualQuantity: "1", unit: "kg" },
      ],
    },
    {
      ...baseStandalone,
      vehiclePlate: "29D-999.88",
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
    existingEntries?: Array<{
      id: string;
      ingredientId: string;
      handlingType: string;
    }>;
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
      { id: entryId, ingredientId, handlingType: "DIRECT_USE" },
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
      allocateDeliveryNo: () => {
        lockCalls.push("deliveryNo");
        return Promise.resolve(
          `FP-DE-${String(createdPayloads.length + 1).padStart(5, "0")}`,
        );
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
      dispatchDelivery: () => Promise.resolve(0),
      createDeliveryWithItems: (_db, input) => {
        const deliverySeqIndex = createdPayloads.length;
        createdPayloads.push(input);
        return Promise.resolve({
          preparationStage: null,
          id: deliverySeqIndex === 0 ? deliveryId : uid(900 + deliverySeqIndex),
          deliveryNo: input.deliveryNo,
          creationMode: input.creationMode,
          creationFingerprint: input.creationFingerprint,
          traceabilityVersion: input.traceabilityVersion,
          workflowVersion: input.workflowVersion ?? null,
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
            sampleTopUpQuantity: new Prisma.Decimal(0),
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
    assert.equal(res.status, "PREPARING");
    assert.equal(res.statusLabel, "Đang chuẩn bị hàng");
    assert.equal(res.traceabilityVersion, 1);
    assert.equal(res.workflowVersion, 2);
    assert.equal(res.nextAction, "ENTER_SHIPPING");
    assert.equal(res.expectedArrivalAt, null);
    assert.equal(res.vehiclePlate, null);
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
    assert.equal(h.createdPayloads[0].workflowVersion, 2);
    assert.equal(h.createdPayloads[0].status, "PREPARING");
    assert.equal(h.createdPayloads[0].expectedArrivalAt, null);
    assert.equal(h.createdPayloads[0].vehiclePlate, null);
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
      "deliveryNo",
    ]);
  }

  const standaloneBase = {
    sourceType: "STANDALONE" as const,
    schoolId,
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

  // T122: Same ingredient split 6A+4B across two source facilities in STANDALONE -> 201 PREPARING without CONFIRMED/fake records
  const multiSourceStandalone = setupStandalone({ existingEntries: [] });
  const splitStandaloneBody = validateCreateSupplierOrderBody({
    sourceType: "STANDALONE",
    schoolId,
    items: [
      {
        ingredientId,
        sourceFacilityId,
        actualQuantity: "6.000",
        unit: "kg",
      },
      {
        ingredientId,
        sourceFacilityId: sourceFacilityIdNullCode,
        actualQuantity: "4.000",
        unit: "kg",
      },
    ],
  });
  const splitStandaloneRes = await multiSourceStandalone.service.create(
    { idempotencyKey: idemKey1, body: splitStandaloneBody },
    makeSupplierActor(),
  );
  assert.equal(splitStandaloneRes.created, true);
  assert.equal(splitStandaloneRes.status, "PREPARING");
  assert.equal(splitStandaloneRes.workflowVersion, 2);
  assert.equal(splitStandaloneRes.nextAction, "ENTER_SHIPPING");
  assert.equal(splitStandaloneRes.expectedArrivalAt, null);
  assert.equal(splitStandaloneRes.vehiclePlate, null);
  assert.equal(splitStandaloneRes.items.length, 2);
  assert.notEqual(
    splitStandaloneRes.items[0].id,
    splitStandaloneRes.items[1].id,
  );
  assert.notEqual(
    splitStandaloneRes.items[0].traceUrl,
    splitStandaloneRes.items[1].traceUrl,
  );
  assert.equal(splitStandaloneRes.items[0].ingredientEntryId, null);
  assert.equal(splitStandaloneRes.items[1].ingredientEntryId, null);
  assert.equal(splitStandaloneRes.items[0].actualQuantity, "6");
  assert.equal(splitStandaloneRes.items[1].actualQuantity, "4");
  assert.equal(multiSourceStandalone.getFlags().autoCreatedEntry, false);
  assert.equal(multiSourceStandalone.getFlags().supplyRequestTouched, false);
  assert.deepEqual(multiSourceStandalone.guardCommands[0], {
    operation: "SUPPLIER_CREATE_STANDALONE_DELIVERY",
    schoolId,
    ingredientIds: [ingredientId],
    sourceFacilityIds: [sourceFacilityId, sourceFacilityIdNullCode],
  });

  // Service-level 409 defense if duplicate (ingredientId, sourceFacilityId) bypasses schema validation
  await assert.rejects(
    () =>
      multiSourceStandalone.service.create(
        {
          idempotencyKey: idemKey2,
          body: {
            sourceType: "STANDALONE",
            schoolId,
            note: null,
            items: [
              {
                ingredientId,
                sourceFacilityId,
                actualQuantity: "5",
                unit: "kg",
                manufactureDate: null,
                expiryDate: null,
              },
              {
                ingredientId,
                sourceFacilityId,
                actualQuantity: "5",
                unit: "kg",
                manufactureDate: null,
                expiryDate: null,
              },
            ],
          },
        },
        makeSupplierActor(),
      ),
    { statusCode: 409 },
  );
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

  await supplierOrderRepository.listSchoolOptions(mockDb, {
    supplierId,
    skip: 0,
    take: 6,
    search: "100%_hoa\\nam",
  });
  assert.deepEqual(schoolWhere, {
    AND: [
      {
        status: "ACTIVE",
        intakeState: "ACTIVE",
        users: {
          none: { roleCode: "SCHOOL_ADMINISTRATION", status: "DEACTIVATED" },
        },
        schoolSupplierRelationships: {
          some: { supplierId, status: "ACTIVE" },
        },
      },
      {
        OR: [
          {
            name: {
              contains: "100\\%\\_hoa\\\\nam",
              mode: "insensitive",
            },
          },
          {
            code: {
              contains: "100\\%\\_hoa\\\\nam",
              mode: "insensitive",
            },
          },
        ],
      },
    ],
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

  const schoolQueries: Array<{ skip: number; take: number; search?: string }> =
    [];
  const service = createSupplierOrderService(
    {
      ...supplierOrderRepository,
      connect: () => Promise.resolve(mockDb as never),
      listSchoolOptions: (db, command) => {
        schoolQueries.push({
          skip: command.skip,
          take: command.take,
          ...(command.search !== undefined ? { search: command.search } : {}),
        });
        return supplierOrderRepository.listSchoolOptions(db, command);
      },
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

  const searchRes = await http.request(
    "/api/deliveries/management/options/schools?search=%20Hoa%20Mai%20&limit=5",
  );
  assert.equal(searchRes.status, 200);
  assert.deepEqual(schoolQueries[schoolQueries.length - 1], {
    skip: 0,
    take: 6,
    search: "Hoa Mai",
  });

  const blankSearchRes = await http.request(
    "/api/deliveries/management/options/schools?search=%20%20%20",
  );
  assert.equal(blankSearchRes.status, 200);
  assert.deepEqual(schoolQueries[schoolQueries.length - 1], {
    skip: 0,
    take: 21,
  });

  for (const badSearchUrl of [
    `/api/deliveries/management/options/schools?search=${"x".repeat(101)}`,
    "/api/deliveries/management/options/schools?search=a&search=b",
    "/api/deliveries/management/options/schools?search[contains]=hoa",
    "/api/deliveries/management/options/schools?q=hoa",
    "/api/deliveries/management/options/ingredients?search=gao",
    "/api/deliveries/management/options/source-facilities?search=sf",
    `/api/deliveries/management/${deliveryId}/labels?search=gao`,
  ]) {
    assert.equal((await http.request(badSearchUrl)).status, 400);
  }

  const ingRes = await http.request(
    "/api/deliveries/management/options/ingredients",
  );
  assert.equal(ingRes.status, 200);

  actor = makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_ADMIN, [
    "delivery.manage",
  ]);
  assert.equal(
    (await http.request("/api/deliveries/management/options/schools?search=a"))
      .status,
    200,
  );

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
      sampleTopUpQuantity: new Prisma.Decimal(0),
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
      sampleTopUpQuantity: new Prisma.Decimal(0),
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
        if (raw.includes(supplierId) && raw.includes(deliveryId)) {
          return Promise.resolve({
            id: deliveryId,
            supplierId,
            deliveryNo: "FP-DE-00007",
            traceabilityVersion: 1,
            Supplier: { name: "Nhà cung cấp An Phát" },
          });
        }
        if (raw.includes(supplierId) && raw.includes(legacyId)) {
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

  // T133/T134: /labels allows supplier roles with delivery.view | delivery.manage | delivery.receive; options/source-facilities still needs delivery.manage
  for (const allowedPerm of [
    "delivery.view",
    "delivery.manage",
    "delivery.receive",
  ] as const) {
    actor = makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_STAFF, [allowedPerm]);
    assert.equal(
      (await http.request(`/api/deliveries/management/${deliveryId}/labels`))
        .status,
      200,
    );
  }
  actor = makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_ADMIN, ["delivery.view"]);
  assert.equal(
    (await http.request(`/api/deliveries/management/${deliveryId}/labels`))
      .status,
    200,
  );
  assert.equal(
    (await http.request("/api/deliveries/management/options/source-facilities"))
      .status,
    403,
  );
  actor = makeSupplierActor(
    ROLES.INGREDIENT_SUPPLIER_STAFF,
    ["delivery.view"],
    { supplierId: uid(9988) },
  );
  assert.equal(
    (await http.request(`/api/deliveries/management/${deliveryId}/labels`))
      .status,
    404,
  );
  for (const deniedActor of [
    makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_STAFF, ["supply_order.accept"]),
    makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_STAFF, []),
    {
      ...makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_ADMIN, ["delivery.view"]),
      role: ROLES.SCHOOL_ADMINISTRATION,
      orgType: "SCHOOL" as const,
      supplierId: null,
      schoolId: uid(4001),
    },
  ]) {
    actor = deniedActor;
    assert.equal(
      (await http.request(`/api/deliveries/management/${deliveryId}/labels`))
        .status,
      403,
    );
  }
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
  let hidePreCheckRemaining = 0;

  const repo: SupplierOrderRepository = {
    connect: () => Promise.resolve({} as never),
    findByCreationKey: (_db, supId, userId, key) => {
      if (hidePreCheckRemaining > 0) {
        hidePreCheckRemaining -= 1;
        return Promise.resolve(null);
      }
      return Promise.resolve(
        deliveries.get(`${supId}:${userId}:${key}`) ?? null,
      );
    },
    findSupplyRequestForCreation: () =>
      Promise.resolve(makeSupplyRequestRecord("ACCEPTED")),
    hasDeliveryForRequest: () => Promise.resolve(false),
    allocateDeliveryNo: () => Promise.resolve("FP-DE-00001"),
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
    dispatchDelivery: () => Promise.resolve(0),
    createDeliveryWithItems: (_db, input) => {
      createCalls += 1;
      const record: SupplierOrderDetailRecord = {
        preparationStage: null,
        id: deliveryId,
        deliveryNo: input.deliveryNo,
        creationMode: input.creationMode,
        creationFingerprint: input.creationFingerprint,
        traceabilityVersion: input.traceabilityVersion,
        workflowVersion: input.workflowVersion ?? null,
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
          sampleTopUpQuantity: new Prisma.Decimal(0),
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

  let renderCalls = 0;
  const service = createSupplierOrderService(repo, {
    publicTraceOrigin: "https://trace.example.test",
    renderQrBatch: (urls) => {
      renderCalls += 1;
      return Promise.resolve(urls.map(() => "data:image/png;base64,mock"));
    },
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
  assert.equal(first.workflowVersion, 2);
  assert.equal(createCalls, 1);
  assert.equal(guardCalls, 1);
  assert.equal(renderCalls, 1);

  const equivalentBody = validateCreateSupplierOrderBody({
    sourceType: "STANDALONE",
    schoolId,
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
  assert.equal(renderCalls, 1);

  await assert.rejects(
    () =>
      service.create(
        {
          idempotencyKey: idemKey1,
          body: validateCreateSupplierOrderBody({
            sourceType: "STANDALONE",
            schoolId,
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
  hidePreCheckRemaining = 1;
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
    preparationStage: null,
    id: deliveryId,
    deliveryNo: "DG-LEGACY-1",
    creationMode: null,
    traceabilityVersion: null,
    workflowVersion: null,
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
    SupplyRequest: {
      status: "IN_PROGRESS" as const,
      requestNo: "SR-2026-001",
      orderType: null,
      batchNo: null,
    },
  };
  const standaloneRecord: SupplierOrderDetailRecord = {
    preparationStage: null,
    id: uid(199),
    deliveryNo: "DG-STD-2",
    creationMode: "STANDALONE",
    traceabilityVersion: null,
    workflowVersion: null,
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
        sampleTopUpQuantity: new Prisma.Decimal(0),
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
    allocateDeliveryNo: () => Promise.resolve("FP-DE-00001"),
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
        workflowVersion: input.workflowVersion ?? null,
        status: input.status,
        expectedArrivalAt: input.expectedArrivalAt,
        vehiclePlate: input.vehiclePlate,
        creationFingerprint: input.creationFingerprint,
        createdByUserId: input.createdByUserId,
        deliveryItems: input.items.map((item, idx) => ({
          sampleTopUpQuantity: new Prisma.Decimal(0),
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
      preparationStage: null,
      id: v1StandaloneDeliveryId,
      deliveryNo: "FP-DE-00001",
      creationMode: "STANDALONE",
      creationFingerprint: "fp-secret-hidden",
      traceabilityVersion: 1,
      workflowVersion: null,
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
          sampleTopUpQuantity: new Prisma.Decimal(0),
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
      preparationStage: null,
      id: legacyReqDeliveryId,
      deliveryNo: "DG-LEGACY-99",
      creationMode: null,
      creationFingerprint: "legacy-fp",
      traceabilityVersion: null,
      workflowVersion: null,
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
      SupplyRequest: {
        status: "COMPLETED",
        requestNo: "SR-LEGACY-01",
        orderType: null,
        batchNo: null,
      },
      deliveryItems: [
        {
          sampleTopUpQuantity: new Prisma.Decimal(0),
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
      preparationStage: null,
      id: otherSupplierSameNoId,
      deliveryNo: "FP-DE-00001",
      creationMode: "STANDALONE",
      creationFingerprint: "other-fp",
      traceabilityVersion: 1,
      workflowVersion: null,
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
  assert.equal(listPayload[0].statusLabel, "Đang giao hàng");
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
    allocateDeliveryNo: () =>
      Promise.resolve(`FP-DE-${String(seq + 1n).padStart(5, "0")}`),
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
          sampleTopUpQuantity: new Prisma.Decimal(0),
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
    dispatchDelivery: () => Promise.resolve(0),
    createDeliveryWithItems: (_db, input) => {
      seq += 1n;
      const now = new Date("2026-11-15T04:00:00Z");
      const record: SupplierOrderDetailRecord = {
        preparationStage: null,
        id: uid(9950 + Number(seq)),
        deliveryNo: input.deliveryNo,
        creationMode: input.creationMode,
        creationFingerprint: input.creationFingerprint,
        traceabilityVersion: input.traceabilityVersion,
        workflowVersion: input.workflowVersion ?? null,
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
          ? {
              status: "IN_PROGRESS",
              requestNo: "SR-2026-001",
              orderType: null,
              batchNo: null,
            }
          : null,
        deliveryItems: input.items.map((item, idx) => ({
          sampleTopUpQuantity: new Prisma.Decimal(0),
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

  let renderCount = 0;
  let originCount = 0;
  const service = createSupplierOrderService(repo, {
    readOrigin: () => {
      originCount += 1;
      return "https://trace.example.test";
    },
    generateToken: () => `${String(++tokenSeq).padStart(64, "a")}`,
    renderQrBatch: (urls) => {
      renderCount += 1;
      return renderError
        ? Promise.reject(renderError)
        : Promise.resolve(urls.map(() => "data:image/png;base64,ok"));
    },
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
    note: "Giao sáng",
    sources: [
      {
        supplyRequestItemId: requestItemId,
        sourceFacilityId,
        actualQuantity: "12.5",
      },
      {
        supplyRequestItemId: requestItemId2,
        sourceFacilityId: sourceFacilityIdNullCode,
        actualQuantity: "4",
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
  assert.equal(createdReq.workflowVersion, 2);
  assert.equal(createdReq.status, "PREPARING");
  assert.equal(persistedById.size, 1);

  const renderCountBeforeReplay = renderCount;
  const originCountBeforeReplay = originCount;

  // Reordered sources + equivalent trailing decimals -> replay 200 without invoking renderer/origin or creating a second delivery
  const reqEquivalentBody = validateCreateSupplierOrderBody({
    sourceType: "REQUEST",
    supplyRequestId,
    note: "  Giao sáng  ",
    sources: [
      {
        supplyRequestItemId: requestItemId2,
        sourceFacilityId: sourceFacilityIdNullCode,
        actualQuantity: "4.000",
      },
      {
        supplyRequestItemId: requestItemId,
        sourceFacilityId,
        actualQuantity: "12.500",
      },
    ],
  });
  const reqReplay = await service.create(
    { idempotencyKey: reqKey, body: reqEquivalentBody },
    actor,
  );
  assert.equal(reqReplay.created, false);
  assert.equal(reqReplay.id, createdReq.id);
  assert.equal(persistedById.size, 1);
  assert.equal(renderCount, renderCountBeforeReplay);
  assert.equal(originCount, originCountBeforeReplay);

  // Field-level conflicts on REQUEST (facility, quantity, note) -> 409
  for (const mutated of [
    {
      ...reqBody,
      sources: [
        {
          supplyRequestItemId: requestItemId,
          sourceFacilityId: sourceFacilityIdNullCode,
          actualQuantity: "12.5",
        },
        {
          supplyRequestItemId: requestItemId2,
          sourceFacilityId,
          actualQuantity: "4",
        },
      ],
    },
    {
      ...reqBody,
      sources: [
        {
          supplyRequestItemId: requestItemId,
          sourceFacilityId,
          actualQuantity: "12",
        },
        {
          supplyRequestItemId: requestItemId2,
          sourceFacilityId: sourceFacilityIdNullCode,
          actualQuantity: "4.5",
        },
      ],
    },
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

  // 2. Post-commit renderer error fails GET labels 503 while committed POST replay still succeeds 200 without touching DB or renderer
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
  const replayWhileRendererDown = await http.request(
    "/api/deliveries/management",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": reqKey,
      },
      body: JSON.stringify({
        sourceType: "REQUEST",
        supplyRequestId,
        note: "Giao sáng",
        sources: [
          {
            supplyRequestItemId: requestItemId,
            sourceFacilityId,
            actualQuantity: "12.5",
          },
          {
            supplyRequestItemId: requestItemId2,
            sourceFacilityId: sourceFacilityIdNullCode,
            actualQuantity: "4",
          },
        ],
      }),
    },
  );
  assert.equal(replayWhileRendererDown.status, 200);
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

  // 3. STANDALONE field-level conflicts + Legacy baseline/v1 key conflicts (never upgrades workflowVersion/traceabilityVersion)
  const stdKey = uid(9982);
  const stdBase = {
    sourceType: "STANDALONE" as const,
    schoolId,
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
    {
      ...stdBase,
      items: [
        {
          ingredientId,
          sourceFacilityId,
          actualQuantity: "4",
          unit: "kg",
        },
      ],
    },
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
    preparationStage: null,
    id: uid(9984),
    deliveryNo: "DG-BASELINE-1",
    creationMode: "STANDALONE",
    creationFingerprint: "legacy-v1-sha256-digest",
    traceabilityVersion: null,
    workflowVersion: null,
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
  assert.equal(legacyBaselineRow.workflowVersion, null);

  const v1Key = uid(9985);
  const v1BaselineRow: SupplierOrderDetailRecord = {
    ...legacyBaselineRow,
    id: uid(9986),
    deliveryNo: "FP-DE-00999",
    traceabilityVersion: 1,
    workflowVersion: null,
  };
  persistedByKey.set(`${supplierId}:${actor.id}:${v1Key}`, v1BaselineRow);
  await assert.rejects(
    () =>
      service.create(
        {
          idempotencyKey: v1Key,
          body: validateCreateSupplierOrderBody(stdBase),
        },
        actor,
      ),
    { statusCode: 409 },
  );
  assert.equal(v1BaselineRow.workflowVersion, null);
});

void test("US6 HTTP contract enforces dispatch strict validation, mount order, manage permission without Idempotency-Key, and no internal leak (T125)", async (context) => {
  // Audit main API router mount order: /deliveries/management precedes /deliveries
  const apiRouter = createApiRouter((_req, _res, next) => next());
  const routerLayers = (
    apiRouter as unknown as { stack: Array<{ regexp?: RegExp }> }
  ).stack;
  const mgmtMountIdx = routerLayers.findIndex((layer) =>
    layer.regexp?.source.includes("deliveries\\/management"),
  );
  const genericMountIdx = routerLayers.findIndex(
    (layer) =>
      layer.regexp?.source.includes("\\/deliveries") &&
      !layer.regexp?.source.includes("deliveries\\/management") &&
      !layer.regexp?.source.includes("public\\/delivery-items"),
  );
  assert.equal(mgmtMountIdx >= 0, true);
  assert.equal(genericMountIdx >= 0, true);
  assert.equal(mgmtMountIdx < genericMountIdx, true);

  // Unit validation: multiple errors, strict fields, past/future ISO offset, free-form plate <= 40
  assert.throws(
    () => validateDispatchSupplierOrderBody({}),
    (err: unknown) =>
      err instanceof RequestValidationError &&
      err.fields.some((issue) => issue.field === "expectedArrivalAt") &&
      err.fields.some((issue) => issue.field === "vehiclePlate"),
  );
  for (const invalidBody of [
    null,
    [],
    { expectedArrivalAt: null, vehiclePlate: "29C-12345" },
    { expectedArrivalAt: "2026-11-16T08:00:00", vehiclePlate: "29C-12345" },
    { expectedArrivalAt: "not-a-date", vehiclePlate: "29C-12345" },
    { expectedArrivalAt: "2026-11-16T08:00:00+07:00", vehiclePlate: null },
    { expectedArrivalAt: "2026-11-16T08:00:00+07:00", vehiclePlate: "   " },
    {
      expectedArrivalAt: "2026-11-16T08:00:00+07:00",
      vehiclePlate: "A".repeat(41),
    },
    {
      expectedArrivalAt: "2026-11-16T08:00:00+07:00",
      vehiclePlate: "29C-12345",
      note: "Cấm thêm note",
    },
    {
      expectedArrivalAt: "2026-11-16T08:00:00+07:00",
      vehiclePlate: "29C-12345",
      items: [],
    },
    {
      expectedArrivalAt: "2026-11-16T08:00:00+07:00",
      vehiclePlate: "29C-12345",
      status: "IN_TRANSIT",
    },
    {
      expectedArrivalAt: "2026-11-16T08:00:00+07:00",
      vehiclePlate: "29C-12345",
      workflowVersion: 2,
    },
  ]) {
    assert.throws(
      () => validateDispatchSupplierOrderBody(invalidBody),
      (err: unknown) =>
        err instanceof RequestValidationError && err.statusCode === 400,
    );
  }

  const pastParsed = validateDispatchSupplierOrderBody({
    expectedArrivalAt: "2020-01-01T08:00:00+07:00",
    vehiclePlate: "  XE LẠNH #01 - KCN Bắc  ",
  });
  assert.equal(pastParsed.expectedArrivalAt, "2020-01-01T01:00:00.000Z");
  assert.equal(pastParsed.vehiclePlate, "XE LẠNH #01 - KCN Bắc");

  const deliveryId = uid(7701);
  const schoolId = uid(7702);
  let liveActor = makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_STAFF, [
    "delivery.manage",
  ]);
  const storedRow: SupplierOrderDetailRecord = {
    preparationStage: null,
    id: deliveryId,
    deliveryNo: "FP-DE-00777",
    creationMode: "STANDALONE",
    creationFingerprint: "secret-fp",
    traceabilityVersion: 1,
    workflowVersion: 2,
    schoolId,
    supplierId,
    supplyRequestId: null,
    status: "PREPARING",
    expectedArrivalAt: null,
    arrivedAt: null,
    receivedAt: null,
    vehiclePlate: null,
    note: "Đơn chuẩn bị sẵn",
    createdByUserId: liveActor.id,
    createdAt: new Date("2026-11-15T00:00:00.000Z"),
    updatedAt: new Date("2026-11-15T00:00:00.000Z"),
    School: { name: "Tiểu học Hoa Mai" },
    SupplyRequest: null,
    deliveryItems: [
      {
        sampleTopUpQuantity: new Prisma.Decimal(0),
        id: uid(7703),
        ingredientId: uid(7704),
        ingredientNameSnapshot: "Gạo tám",
        ingredientEntryId: null,
        supplyRequestItemId: null,
        sourceFacilityId: uid(7705),
        sourceFacilityNameSnapshot: "Kho A",
        sourceFacilityCodeSnapshot: "K-A",
        qrUrl: "https://trace.example.test/public/delivery-items/qr-7703",
        actualQuantity: new Prisma.Decimal("6.000"),
        unit: "kg",
        note: null,
        Ingredient: { name: "Gạo tám" },
      },
    ],
  };

  const repo: SupplierOrderRepository = {
    ...supplierOrderRepository,
    connect: () => Promise.resolve({} as never),
    findManagementDeliveryById: (_db, scope, id) => {
      if (scope.supplierId !== storedRow.supplierId || id !== storedRow.id) {
        return Promise.resolve(null);
      }
      return Promise.resolve({ ...storedRow });
    },
    dispatchDelivery: (_db, cmd) => {
      if (
        cmd.scope.supplierId !== storedRow.supplierId ||
        cmd.deliveryId !== storedRow.id ||
        storedRow.workflowVersion !== 2 ||
        storedRow.traceabilityVersion !== 1 ||
        storedRow.status !== "PREPARING" ||
        storedRow.expectedArrivalAt !== null ||
        storedRow.vehiclePlate !== null
      ) {
        return Promise.resolve(0);
      }
      storedRow.status = "IN_TRANSIT";
      storedRow.expectedArrivalAt = cmd.expectedArrivalAt;
      storedRow.vehiclePlate = cmd.vehiclePlate;
      storedRow.updatedAt = new Date("2026-11-15T01:00:00.000Z");
      return Promise.resolve(1);
    },
  };
  const guard = createIntakeAccessService(
    {
      ...createIntakeAccessRepository(),
      lockParents: () => Promise.resolve(),
      lockDelivery: () => Promise.resolve(),
      readDelivery: (_tx, id, supId) =>
        Promise.resolve(
          id === storedRow.id && supId === storedRow.supplierId
            ? {
                id: storedRow.id,
                schoolId: storedRow.schoolId,
                supplierId: storedRow.supplierId,
                supplyRequestId: storedRow.supplyRequestId,
                status: storedRow.status,
                workflowVersion: storedRow.workflowVersion,
                traceabilityVersion: storedRow.traceabilityVersion,
                expectedArrivalAt: storedRow.expectedArrivalAt,
                vehiclePlate: storedRow.vehiclePlate,
              }
            : null,
        ),
      readSchool: () =>
        Promise.resolve({ id: schoolId, status: "ACTIVE" } as never),
      readSupplier: () =>
        Promise.resolve({ id: supplierId, status: "ACTIVE" } as never),
      readSchoolAdmin: () =>
        Promise.resolve({ id: uid(7710), status: "ACTIVE" } as never),
      readSupplierAdmin: () =>
        Promise.resolve({ id: uid(7711), status: "ACTIVE" } as never),
    },
    () => Promise.resolve(liveActor),
  );
  const declared: string[] = [];
  const scheduled: unknown[] = [];
  const service = createSupplierOrderService(repo, {
    now: () => new Date("2026-11-01T00:00:00.000Z"),
    transaction: (fn) => fn({} as never),
    guard,
    proofs: {
      prepareDeliveryDeclared: (_tx, id, actorId) => {
        declared.push(`${id}:${actorId}`);
        return Promise.resolve({ kind: "delivery-declarations", id: "p1" });
      },
      scheduleAnchor: (ref) => {
        scheduled.push(ref);
      },
    },
  });

  let reqActor: AuthPrincipal | undefined = liveActor;
  const app = express();
  app.use(express.json());
  app.use(
    "/api/deliveries/management",
    createSupplierOrderRouter(service, (req, _res, next) => {
      if (!reqActor) {
        next(new HttpError(401, "Chưa đăng nhập"));
        return;
      }
      req.auth = reqActor;
      next();
    }),
  );
  app.use(
    "/api/deliveries",
    createDeliveryRouter(undefined, (req, _res, next) => {
      if (!reqActor) {
        next(new HttpError(401, "Chưa đăng nhập"));
        return;
      }
      req.auth = reqActor;
      next();
    }),
  );
  app.use(globalErrorHandler);

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const started = app.listen(0, () => resolve(started));
  });
  context.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  );
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  // Bad params UUID or unexpected query -> 400
  assert.equal(
    (
      await fetch(`${baseUrl}/api/deliveries/management/not-a-uuid/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedArrivalAt: "2026-11-16T08:00:00+07:00",
          vehiclePlate: "29C-12345",
        }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(
        `${baseUrl}/api/deliveries/management/${deliveryId}/dispatch?extra=1`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedArrivalAt: "2026-11-16T08:00:00+07:00",
            vehiclePlate: "29C-12345",
          }),
        },
      )
    ).status,
    400,
  );

  // PATCH status is not opened (404 from generic/router)
  assert.equal(
    (
      await fetch(`${baseUrl}/api/deliveries/management/${deliveryId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "IN_TRANSIT" }),
      })
    ).status,
    404,
  );

  // Unauthenticated -> 401
  reqActor = undefined;
  assert.equal(
    (
      await fetch(
        `${baseUrl}/api/deliveries/management/${deliveryId}/dispatch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedArrivalAt: "2026-11-16T08:00:00+07:00",
            vehiclePlate: "29C-12345",
          }),
        },
      )
    ).status,
    401,
  );

  // View/accept without manage -> 403; SCHOOL_ADMIN even with manage -> 403
  for (const denied of [
    makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_STAFF, [
      "delivery.view",
      "supply_order.accept",
    ]),
    {
      ...makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_ADMIN, [
        "delivery.manage",
      ]),
      role: ROLES.SCHOOL_ADMINISTRATION,
      orgType: "SCHOOL" as const,
      supplierId: null,
      schoolId,
    },
  ]) {
    reqActor = denied;
    liveActor = denied;
    assert.equal(
      (
        await fetch(
          `${baseUrl}/api/deliveries/management/${deliveryId}/dispatch`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedArrivalAt: "2026-11-16T08:00:00+07:00",
              vehiclePlate: "29C-12345",
            }),
          },
        )
      ).status,
      403,
    );
  }

  // Foreign supplier -> 404
  const foreignActor = makeSupplierActor(
    ROLES.INGREDIENT_SUPPLIER_ADMIN,
    ["delivery.manage"],
    { supplierId: uid(7799) },
  );
  reqActor = foreignActor;
  liveActor = foreignActor;
  assert.equal(
    (
      await fetch(
        `${baseUrl}/api/deliveries/management/${deliveryId}/dispatch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedArrivalAt: "2026-11-16T08:00:00+07:00",
            vehiclePlate: "29C-12345",
          }),
        },
      )
    ).status,
    404,
  );

  // Manage-only staff succeeds WITHOUT Idempotency-Key & exposes clean Detail DTO (no internal markers)
  const manageOnlyStaff = makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_STAFF, [
    "delivery.manage",
  ]);
  reqActor = manageOnlyStaff;
  liveActor = manageOnlyStaff;
  const okRes = await fetch(
    `${baseUrl}/api/deliveries/management/${deliveryId}/dispatch`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedArrivalAt: "2026-11-16T08:00:00+07:00",
        vehiclePlate: "  29C-12345  ",
      }),
    },
  );
  assert.equal(okRes.status, 200);
  const okJson = (await okRes.json()) as {
    success: boolean;
    data: Record<string, unknown>;
  };
  assert.equal(okJson.success, true);
  assert.equal(okJson.data.status, "IN_TRANSIT");
  assert.equal(okJson.data.statusLabel, "Đang giao hàng");
  assert.equal(okJson.data.workflowVersion, 2);
  assert.equal(okJson.data.nextAction, "TRACK_DELIVERY");
  assert.equal(okJson.data.expectedArrivalAt, "2026-11-16T01:00:00.000Z");
  assert.equal(okJson.data.vehiclePlate, "29C-12345");
  assert.equal("created" in okJson.data, false);
  assert.equal("creationKey" in okJson.data, false);
  assert.equal("creationFingerprint" in okJson.data, false);
  assert.equal(
    "qrToken" in (okJson.data.items as Array<Record<string, unknown>>)[0],
    false,
  );
  // The declaration is fixed in the dispatch transaction, sent after commit.
  assert.deepEqual(declared, [`${deliveryId}:${liveActor.id}`]);
  assert.deepEqual(scheduled.at(-1), {
    kind: "delivery-declarations",
    id: "p1",
  });

  // Admin can replay same canonical body after staff dispatched -> 200
  const manageOnlyAdmin = makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_ADMIN, [
    "delivery.manage",
  ]);
  reqActor = manageOnlyAdmin;
  liveActor = manageOnlyAdmin;
  const replayRes = await fetch(
    `${baseUrl}/api/deliveries/management/${deliveryId}/dispatch`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedArrivalAt: "2026-11-16T01:00:00.000Z",
        vehiclePlate: "29C-12345",
      }),
    },
  );
  assert.equal(replayRes.status, 200);
  assert.equal(
    ((await replayRes.json()) as { data: { status: string } }).data.status,
    "IN_TRANSIT",
  );
  // A replay never declares twice.
  assert.equal(declared.length, 1);
  assert.equal(scheduled.at(-1), null);
});

void test("US6 dispatch service handles continuation policy, all-state replay/409, rollback, renderer independence, and CAS race cleanly (T130)", async () => {
  const schoolId = uid(7801);
  const actor = makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_STAFF, [
    "delivery.manage",
  ]);
  const initialUpdatedAt = new Date("2026-11-15T02:00:00.000Z");
  const validEta = new Date("2026-11-16T01:00:00.000Z");
  const validPlate = "51D-999.88";

  const makeRow = (
    overrides: Partial<SupplierOrderDetailRecord> = {},
  ): SupplierOrderDetailRecord => ({
    preparationStage: null,
    id: uid(7802),
    deliveryNo: "FP-DE-00888",
    creationMode: "REQUEST",
    creationFingerprint: "fp-7802",
    traceabilityVersion: 1,
    workflowVersion: 2,
    schoolId,
    supplierId,
    supplyRequestId: uid(7803),
    status: "PREPARING",
    expectedArrivalAt: null,
    arrivedAt: null,
    receivedAt: null,
    vehiclePlate: null,
    note: "Cổng phụ",
    createdByUserId: actor.id,
    createdAt: new Date("2026-11-15T01:00:00.000Z"),
    updatedAt: initialUpdatedAt,
    School: { name: "Tiểu học Hòa Bình" },
    SupplyRequest: {
      status: "IN_PROGRESS",
      requestNo: "YC-7803",
      orderType: null,
      batchNo: null,
    },
    deliveryItems: [
      {
        sampleTopUpQuantity: new Prisma.Decimal(0),
        id: uid(7804),
        ingredientId: uid(7805),
        ingredientNameSnapshot: "Thịt gà",
        ingredientEntryId: null,
        supplyRequestItemId: uid(7806),
        sourceFacilityId: uid(7807),
        sourceFacilityNameSnapshot: "Trại A",
        sourceFacilityCodeSnapshot: "TA",
        qrUrl: "https://trace.example.test/public/delivery-items/qr-7804",
        actualQuantity: new Prisma.Decimal("6.000"),
        unit: "kg",
        note: null,
        Ingredient: { name: "Thịt gà" },
      },
    ],
    ...overrides,
  });

  // 1. Rollback if failure happens right after dispatchDelivery writes inside transaction
  {
    let committed = makeRow();
    let working = { ...committed };
    let findCalls = 0;
    const repo: SupplierOrderRepository = {
      ...supplierOrderRepository,
      connect: () => Promise.resolve({} as never),
      dispatchDelivery: (_db, cmd) => {
        working = {
          ...working,
          status: "IN_TRANSIT",
          expectedArrivalAt: cmd.expectedArrivalAt,
          vehiclePlate: cmd.vehiclePlate,
          updatedAt: new Date("2026-11-15T02:05:00.000Z"),
        };
        return Promise.resolve(1);
      },
      findManagementDeliveryById: () => {
        findCalls += 1;
        if (findCalls === 1)
          return Promise.reject(new Error("post-write read fail"));
        return Promise.resolve(working);
      },
    };
    const guard = createIntakeAccessService(
      {
        ...createIntakeAccessRepository(),
        lockParents: () => Promise.resolve(),
        lockOrder: () => Promise.resolve(),
        lockDelivery: () => Promise.resolve(),
        readOrder: () =>
          Promise.resolve({
            id: working.supplyRequestId!,
            schoolId,
            supplierId,
            status: "IN_PROGRESS",
          } as never),
        readDelivery: () =>
          Promise.resolve({
            id: working.id,
            schoolId,
            supplierId,
            supplyRequestId: working.supplyRequestId,
            status: working.status,
            workflowVersion: working.workflowVersion,
            traceabilityVersion: working.traceabilityVersion,
            expectedArrivalAt: working.expectedArrivalAt,
            vehiclePlate: working.vehiclePlate,
          }),
        readSchool: () =>
          Promise.resolve({ id: schoolId, status: "ACTIVE" } as never),
        readSupplier: () =>
          Promise.resolve({ id: supplierId, status: "ACTIVE" } as never),
        readSchoolAdmin: () =>
          Promise.resolve({ id: uid(7810), status: "ACTIVE" } as never),
        readSupplierAdmin: () =>
          Promise.resolve({ id: uid(7811), status: "ACTIVE" } as never),
      },
      () => Promise.resolve(actor),
    );
    const service = createSupplierOrderService(repo, {
      now: () => new Date("2026-11-01T00:00:00.000Z"),
      guard,
      transaction: async (fn) => {
        try {
          const result = await fn({} as never);
          committed = working;
          return result;
        } catch (err) {
          working = committed;
          if (err instanceof HttpError) throw err;
          throw new HttpError(503, "Rollback cleanly");
        }
      },
    });
    await assert.rejects(
      () =>
        service.dispatch(
          { id: committed.id },
          validateDispatchSupplierOrderBody({
            expectedArrivalAt: validEta.toISOString(),
            vehiclePlate: validPlate,
          }),
          actor,
        ),
      { statusCode: 503 },
    );
    assert.equal(committed.status, "PREPARING");
    assert.equal(committed.expectedArrivalAt, null);
    assert.equal(committed.vehiclePlate, null);
    assert.equal(committed.updatedAt.getTime(), initialUpdatedAt.getTime());

    // First dispatch with ETA not after "now" (equal or earlier) -> 422, nothing written
    for (const nowOffsetMs of [0, 60_000]) {
      const lateService = createSupplierOrderService(repo, {
        now: () => new Date(validEta.getTime() + nowOffsetMs),
        guard,
        transaction: (fn) => fn({} as never),
      });
      await assert.rejects(
        () =>
          lateService.dispatch(
            { id: committed.id },
            validateDispatchSupplierOrderBody({
              expectedArrivalAt: validEta.toISOString(),
              vehiclePlate: validPlate,
            }),
            actor,
          ),
        {
          statusCode: 422,
          message: "Giờ dự kiến đến phải sau thời điểm hiện tại",
        },
      );
      assert.equal(committed.status, "PREPARING");
      assert.equal(committed.expectedArrivalAt, null);
      assert.equal(committed.vehiclePlate, null);
    }
  }

  // 2. Replay across all post-dispatch states (same body -> 200 & untouched updatedAt; diff body -> 409)
  // Plus pre-dispatch CANCELLED & legacy workflowVersion=null -> 409
  // Plus deactivated admin / terminal source does NOT block already-dispatched replay, DOES block first PREPARING dispatch!
  for (const replayStatus of [
    "IN_TRANSIT",
    "ARRIVED",
    "PENDING_APPROVAL",
    "RECEIVED",
    "REJECTED",
    "CANCELLED",
  ] as const) {
    const row = makeRow({
      status: replayStatus,
      expectedArrivalAt: validEta,
      vehiclePlate: validPlate,
      SupplyRequest: {
        status: replayStatus === "CANCELLED" ? "CANCELLED" : "IN_PROGRESS",
        requestNo: "YC-7803",
        orderType: null,
        batchNo: null,
      },
    });
    let dispatchWrites = 0;
    let schoolAdminStatus: "ACTIVE" | "DEACTIVATED" = "DEACTIVATED";
    let currentActor = actor;
    const repo: SupplierOrderRepository = {
      ...supplierOrderRepository,
      connect: () => Promise.resolve({} as never),
      dispatchDelivery: () => {
        dispatchWrites += 1;
        return Promise.resolve(1);
      },
      findManagementDeliveryById: () => Promise.resolve(row),
    };
    const guard = createIntakeAccessService(
      {
        ...createIntakeAccessRepository(),
        lockParents: () => Promise.resolve(),
        lockOrder: () => Promise.resolve(),
        lockDelivery: () => Promise.resolve(),
        readOrder: () =>
          Promise.resolve({
            id: row.supplyRequestId!,
            schoolId,
            supplierId,
            status: row.SupplyRequest!.status,
          } as never),
        readDelivery: () =>
          Promise.resolve({
            id: row.id,
            schoolId,
            supplierId,
            supplyRequestId: row.supplyRequestId,
            status: row.status,
            workflowVersion: row.workflowVersion,
            traceabilityVersion: row.traceabilityVersion,
            expectedArrivalAt: row.expectedArrivalAt,
            vehiclePlate: row.vehiclePlate,
          }),
        readSchool: () =>
          Promise.resolve({ id: schoolId, status: "SUSPENDED" } as never),
        readSupplier: () =>
          Promise.resolve({ id: supplierId, status: "ACTIVE" } as never),
        readSchoolAdmin: () =>
          Promise.resolve({
            id: uid(7810),
            status: schoolAdminStatus,
          } as never),
        readSupplierAdmin: () =>
          Promise.resolve({ id: uid(7811), status: "ACTIVE" } as never),
      },
      () => Promise.resolve(currentActor),
    );
    const service = createSupplierOrderService(repo, {
      guard,
      transaction: (fn) => fn({} as never),
      renderQrBatch: () => Promise.reject(new Error("renderer unavailable")),
    });

    const ok = await service.dispatch(
      { id: row.id },
      validateDispatchSupplierOrderBody({
        expectedArrivalAt: "2026-11-16T08:00:00+07:00",
        vehiclePlate: `  ${validPlate} `,
      }),
      actor,
    );
    assert.equal(ok.status, replayStatus);
    assert.equal(ok.updatedAt, initialUpdatedAt.toISOString());
    assert.equal(dispatchWrites, 0);

    // Different ETA or plate -> 409
    await assert.rejects(
      () =>
        service.dispatch(
          { id: row.id },
          validateDispatchSupplierOrderBody({
            expectedArrivalAt: "2026-11-16T09:00:00+07:00",
            vehiclePlate: validPlate,
          }),
          actor,
        ),
      { statusCode: 409 },
    );
    await assert.rejects(
      () =>
        service.dispatch(
          { id: row.id },
          validateDispatchSupplierOrderBody({
            expectedArrivalAt: "2026-11-16T08:00:00+07:00",
            vehiclePlate: "29C-00000",
          }),
          actor,
        ),
      { statusCode: 409 },
    );

    // Denied permission / org mismatch blocks replay too -> 403
    currentActor = makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_STAFF, [
      "delivery.view",
    ]);
    await assert.rejects(
      () =>
        service.dispatch(
          { id: row.id },
          validateDispatchSupplierOrderBody({
            expectedArrivalAt: validEta.toISOString(),
            vehiclePlate: validPlate,
          }),
          actor,
        ),
      { statusCode: 403 },
    );
    currentActor = { ...actor, supplierId: uid(7899) };
    await assert.rejects(
      () =>
        service.dispatch(
          { id: row.id },
          validateDispatchSupplierOrderBody({
            expectedArrivalAt: validEta.toISOString(),
            vehiclePlate: validPlate,
          }),
          actor,
        ),
      { statusCode: 403 },
    );
    currentActor = actor;
    schoolAdminStatus = "ACTIVE";
  }

  // Pre-dispatch CANCELLED (metadata null) & legacy workflowVersion:null -> 409
  for (const blockedRow of [
    makeRow({
      status: "CANCELLED",
      expectedArrivalAt: null,
      vehiclePlate: null,
    }),
    makeRow({ workflowVersion: null, status: "PREPARING" }),
    makeRow({
      workflowVersion: null,
      status: "IN_TRANSIT",
      expectedArrivalAt: validEta,
      vehiclePlate: validPlate,
    }),
  ]) {
    let dispatchWrites = 0;
    const repo: SupplierOrderRepository = {
      ...supplierOrderRepository,
      connect: () => Promise.resolve({} as never),
      dispatchDelivery: () => {
        dispatchWrites += 1;
        return Promise.resolve(1);
      },
      findManagementDeliveryById: () => Promise.resolve(blockedRow),
    };
    const guard = createIntakeAccessService(
      {
        ...createIntakeAccessRepository(),
        lockParents: () => Promise.resolve(),
        lockOrder: () => Promise.resolve(),
        lockDelivery: () => Promise.resolve(),
        readOrder: () =>
          Promise.resolve({
            id: blockedRow.supplyRequestId!,
            schoolId,
            supplierId,
            status: "IN_PROGRESS",
          } as never),
        readDelivery: () =>
          Promise.resolve({
            id: blockedRow.id,
            schoolId,
            supplierId,
            supplyRequestId: blockedRow.supplyRequestId,
            status: blockedRow.status,
            workflowVersion: blockedRow.workflowVersion,
            traceabilityVersion: blockedRow.traceabilityVersion,
            expectedArrivalAt: blockedRow.expectedArrivalAt,
            vehiclePlate: blockedRow.vehiclePlate,
          }),
        readSchool: () =>
          Promise.resolve({ id: schoolId, status: "ACTIVE" } as never),
        readSupplier: () =>
          Promise.resolve({ id: supplierId, status: "ACTIVE" } as never),
        readSchoolAdmin: () =>
          Promise.resolve({ id: uid(7810), status: "ACTIVE" } as never),
        readSupplierAdmin: () =>
          Promise.resolve({ id: uid(7811), status: "ACTIVE" } as never),
      },
      () => Promise.resolve(actor),
    );
    const service = createSupplierOrderService(repo, {
      now: () => new Date("2026-11-01T00:00:00.000Z"),
      guard,
      transaction: (fn) => fn({} as never),
    });
    await assert.rejects(
      () =>
        service.dispatch(
          { id: blockedRow.id },
          validateDispatchSupplierOrderBody({
            expectedArrivalAt: validEta.toISOString(),
            vehiclePlate: validPlate,
          }),
          actor,
        ),
      { statusCode: 409 },
    );
    assert.equal(dispatchWrites, 0);
  }

  // 3. First dispatch succeeds while renderer is down AND intake/relationship/source are paused,
  // but fails 409 if admin deactivated or source order terminal, plus handles mock CAS race=0!
  {
    let row = makeRow();
    let reqStatus: "IN_PROGRESS" | "CANCELLED" = "IN_PROGRESS";
    let supplierAdminStatus: "ACTIVE" | "DEACTIVATED" = "ACTIVE";
    let casCount = 1;
    const repo: SupplierOrderRepository = {
      ...supplierOrderRepository,
      connect: () => Promise.resolve({} as never),
      dispatchDelivery: (_db, cmd) => {
        if (casCount === 0) {
          row = {
            ...row,
            status: "IN_TRANSIT",
            expectedArrivalAt: validEta,
            vehiclePlate: validPlate,
          };
          return Promise.resolve(0);
        }
        row = {
          ...row,
          status: "IN_TRANSIT",
          expectedArrivalAt: cmd.expectedArrivalAt,
          vehiclePlate: cmd.vehiclePlate,
        };
        return Promise.resolve(1);
      },
      findManagementDeliveryById: () => Promise.resolve(row),
    };
    const guard = createIntakeAccessService(
      {
        ...createIntakeAccessRepository(),
        lockParents: () => Promise.resolve(),
        lockOrder: () => Promise.resolve(),
        lockDelivery: () => Promise.resolve(),
        readOrder: () =>
          Promise.resolve({
            id: row.supplyRequestId!,
            schoolId,
            supplierId,
            status: reqStatus,
          } as never),
        readDelivery: () =>
          Promise.resolve({
            id: row.id,
            schoolId,
            supplierId,
            supplyRequestId: row.supplyRequestId,
            status: row.status,
            workflowVersion: row.workflowVersion,
            traceabilityVersion: row.traceabilityVersion,
            expectedArrivalAt: row.expectedArrivalAt,
            vehiclePlate: row.vehiclePlate,
          }),
        readSchool: () =>
          Promise.resolve({ id: schoolId, status: "PAUSED" } as never),
        readSupplier: () =>
          Promise.resolve({ id: supplierId, status: "ACTIVE" } as never),
        readSchoolAdmin: () =>
          Promise.resolve({ id: uid(7810), status: "ACTIVE" } as never),
        readSupplierAdmin: () =>
          Promise.resolve({
            id: uid(7811),
            status: supplierAdminStatus,
          } as never),
      },
      () => Promise.resolve(actor),
    );
    const service = createSupplierOrderService(repo, {
      now: () => new Date("2026-11-01T00:00:00.000Z"),
      guard,
      transaction: (fn) => fn({} as never),
      renderQrBatch: () => Promise.reject(new Error("renderer offline")),
    });

    reqStatus = "CANCELLED";
    await assert.rejects(
      () =>
        service.dispatch(
          { id: row.id },
          validateDispatchSupplierOrderBody({
            expectedArrivalAt: validEta.toISOString(),
            vehiclePlate: validPlate,
          }),
          actor,
        ),
      { statusCode: 409 },
    );

    reqStatus = "IN_PROGRESS";
    supplierAdminStatus = "DEACTIVATED";
    await assert.rejects(
      () =>
        service.dispatch(
          { id: row.id },
          validateDispatchSupplierOrderBody({
            expectedArrivalAt: validEta.toISOString(),
            vehiclePlate: validPlate,
          }),
          actor,
        ),
      { statusCode: 409 },
    );

    // Mock CAS count = 0 where concurrent writer committed different plate -> 409
    supplierAdminStatus = "ACTIVE";
    casCount = 0;
    await assert.rejects(
      () =>
        service.dispatch(
          { id: row.id },
          validateDispatchSupplierOrderBody({
            expectedArrivalAt: validEta.toISOString(),
            vehiclePlate: "29C-OTHER",
          }),
          actor,
        ),
      { statusCode: 409 },
    );

    // Mock CAS count = 0 where concurrent writer committed SAME canonical metadata -> 200
    row = makeRow();
    const raceWonSame = await service.dispatch(
      { id: row.id },
      validateDispatchSupplierOrderBody({
        expectedArrivalAt: validEta.toISOString(),
        vehiclePlate: validPlate,
      }),
      actor,
    );
    assert.equal(raceWonSame.status, "IN_TRANSIT");
    assert.equal(raceWonSame.nextAction, "TRACK_DELIVERY");
  }
});

void test("US4 labels support PREPARING 6A+4B multi-source items with distinct UUIDs/QRs, read OR and unchanged URL after dispatch (T133)", async () => {
  const deliveryId = uid(8401);
  const ingredientId = uid(8402);
  const facilityA = uid(8403);
  const facilityB = uid(8404);
  const itemAId = uid(8405);
  const itemBId = uid(8406);
  const urlA = `https://trace.example.test/api/public/delivery-items/${"aa".repeat(32)}`;
  const urlB = `https://trace.example.test/api/public/delivery-items/${"bb".repeat(32)}`;
  let capturedLabelOrderBy: unknown;

  const repo: SupplierOrderRepository = {
    ...supplierOrderRepository,
    connect: () => Promise.resolve({} as never),
    findDeliveryForLabels: (_db, scope, id) => {
      if (scope.supplierId !== supplierId || id !== deliveryId) {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        id: deliveryId,
        supplierId,
        deliveryNo: "FP-DE-00604",
        traceabilityVersion: 1,
        Supplier: { name: "NCC 6A4B" },
      });
    },
    listDeliveryLabelItems: (_db, cmd) => {
      capturedLabelOrderBy = cmd;
      return Promise.resolve([
        {
          sampleTopUpQuantity: new Prisma.Decimal(0),
          id: itemAId,
          deliveryId,
          sourceFacilityId: facilityA,
          sourceFacilityNameSnapshot: "Cơ sở A",
          sourceFacilityCodeSnapshot: "FA",
          ingredientNameSnapshot: "Thịt gà sạch",
          actualQuantity: new Prisma.Decimal("6.000"),
          unit: "kg",
          qrUrl: urlA,
          Ingredient: { name: "Thịt gà sạch" },
        },
        {
          sampleTopUpQuantity: new Prisma.Decimal(0),
          id: itemBId,
          deliveryId,
          sourceFacilityId: facilityB,
          sourceFacilityNameSnapshot: "Cơ sở B",
          sourceFacilityCodeSnapshot: null,
          ingredientNameSnapshot: "Thịt gà sạch",
          actualQuantity: new Prisma.Decimal("4.000"),
          unit: "kg",
          qrUrl: urlB,
          Ingredient: { name: "Thịt gà sạch" },
        },
      ]);
    },
  };

  const service = createSupplierOrderService(repo, {
    renderQrBatch: (urls) =>
      Promise.resolve(
        urls.map(
          (u) => `data:image/png;base64,${Buffer.from(u).toString("base64")}`,
        ),
      ),
  });

  const viewStaff = makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_STAFF, [
    "delivery.view",
  ]);
  const prepLabels = await service.listLabels(
    { id: deliveryId },
    { page: 1, limit: 20 },
    viewStaff,
  );
  assert.equal(prepLabels.items.length, 2);
  assert.equal(
    (capturedLabelOrderBy as { deliveryId: string }).deliveryId,
    deliveryId,
  );
  assert.equal(prepLabels.items[0].deliveryItemId, itemAId);
  assert.equal(prepLabels.items[0].actualQuantity, "6");
  assert.equal(prepLabels.items[0].sourceFacility.name, "Cơ sở A");
  assert.equal(prepLabels.items[0].traceUrl, urlA);
  assert.equal(prepLabels.items[1].deliveryItemId, itemBId);
  assert.equal(prepLabels.items[1].actualQuantity, "4");
  assert.equal(prepLabels.items[1].sourceFacility.name, "Cơ sở B");
  assert.equal(prepLabels.items[1].sourceFacility.facilityCode, null);
  assert.equal(prepLabels.items[1].traceUrl, urlB);
  assert.notEqual(
    prepLabels.items[0].qrImageDataUrl,
    prepLabels.items[1].qrImageDataUrl,
  );
  assert.equal(ingredientId.length, 36);

  // Receive-only staff also reads identical label URLs & images after dispatch
  const receiveStaff = makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_STAFF, [
    "delivery.receive",
  ]);
  const postDispatchLabels = await service.listLabels(
    { id: deliveryId },
    { page: 1, limit: 20 },
    receiveStaff,
  );
  assert.deepEqual(postDispatchLabels, prepLabels);
});

void test("US3 management list/detail enforce PREPARING filter, nextAction read/manage/terminal rules, multi-row preservation, and safe DTO projection (T143)", async () => {
  const prepId = uid(9101);
  const terminalSourcePrepId = uid(9102);
  const legacyId = uid(9103);
  const standalonePrepId = uid(9104);
  const facilityAId = uid(9201);
  const facilityBId = uid(9202);
  const itemAId = uid(9301);
  const itemBId = uid(9302);
  const supplierB = uid(9902);
  let capturedListCommand: unknown;

  const baseRow = (
    id: string,
    overrides: Partial<{
      deliveryNo: string;
      creationMode: "REQUEST" | "STANDALONE" | null;
      traceabilityVersion: number | null;
      workflowVersion: number | null;
      status: "PREPARING" | "IN_TRANSIT" | "RECEIVED" | "CANCELLED" | "ARRIVED";
      supplyRequestId: string | null;
      requestStatus: "IN_PROGRESS" | "CANCELLED" | "COMPLETED" | "ACCEPTED";
      expectedArrivalAt: Date | null;
      vehiclePlate: string | null;
    }> = {},
  ) => ({
    preparationStage: null,
    id,
    deliveryNo: overrides.deliveryNo ?? "FP-DE-00901",
    creationMode:
      "creationMode" in overrides
        ? overrides.creationMode!
        : ("REQUEST" as const),
    traceabilityVersion:
      "traceabilityVersion" in overrides ? overrides.traceabilityVersion! : 1,
    workflowVersion:
      "workflowVersion" in overrides ? overrides.workflowVersion! : 2,
    schoolId,
    supplierId,
    supplyRequestId:
      "supplyRequestId" in overrides
        ? overrides.supplyRequestId!
        : supplyRequestId,
    status: overrides.status ?? ("PREPARING" as const),
    expectedArrivalAt:
      "expectedArrivalAt" in overrides ? overrides.expectedArrivalAt! : null,
    arrivedAt: null,
    receivedAt: null,
    vehiclePlate: "vehiclePlate" in overrides ? overrides.vehiclePlate! : null,
    note: null,
    createdByUserId: uid(301),
    createdAt: new Date("2026-11-15T01:00:00.000Z"),
    updatedAt: new Date("2026-11-15T01:00:00.000Z"),
    School: { name: "Trường Tiểu học A" },
    SupplyRequest: (
      "supplyRequestId" in overrides
        ? overrides.supplyRequestId
        : supplyRequestId
    )
      ? {
          requestNo: "SR-901",
          orderType: null,
          batchNo: null,
          status: overrides.requestStatus ?? "IN_PROGRESS",
        }
      : null,
  });

  const summaryRows = [
    baseRow(prepId, {
      status: "PREPARING",
      workflowVersion: 2,
      requestStatus: "IN_PROGRESS",
    }),
    baseRow(terminalSourcePrepId, {
      deliveryNo: "FP-DE-00902",
      status: "PREPARING",
      workflowVersion: 2,
      requestStatus: "COMPLETED",
    }),
    baseRow(standalonePrepId, {
      deliveryNo: "FP-DE-00903",
      creationMode: "STANDALONE",
      supplyRequestId: null,
      status: "PREPARING",
      workflowVersion: 2,
    }),
    baseRow(legacyId, {
      deliveryNo: "DG-OLD-904",
      creationMode: null,
      traceabilityVersion: null,
      workflowVersion: null,
      supplyRequestId: null,
      status: "IN_TRANSIT",
      expectedArrivalAt: new Date("2026-11-15T05:00:00.000Z"),
      vehiclePlate: "29C-00904",
    }),
  ];

  const multiDetailRow = {
    ...summaryRows[0],
    creationFingerprint: "v3:secret-fingerprint",
    deliveryItems: [
      {
        sampleTopUpQuantity: new Prisma.Decimal(0),
        id: itemAId,
        ingredientId,
        ingredientEntryId: entryId,
        supplyRequestItemId: requestItemId,
        sourceFacilityId: facilityAId,
        sourceFacilityNameSnapshot: "Cơ sở A",
        sourceFacilityCodeSnapshot: "SHARED-CODE",
        ingredientNameSnapshot: "Gạo ST25",
        qrUrl: `https://trace.example.test/api/public/delivery-items/${"11".repeat(32)}`,
        actualQuantity: new Prisma.Decimal("6.000"),
        unit: "kg",
        note: null,
        Ingredient: { name: "Gạo ST25" },
      },
      {
        sampleTopUpQuantity: new Prisma.Decimal(0),
        id: itemBId,
        ingredientId,
        ingredientEntryId: entryId,
        supplyRequestItemId: requestItemId,
        sourceFacilityId: facilityBId,
        sourceFacilityNameSnapshot: "Cơ sở B",
        sourceFacilityCodeSnapshot: "SHARED-CODE",
        ingredientNameSnapshot: "Gạo ST25",
        qrUrl: `https://trace.example.test/api/public/delivery-items/${"22".repeat(32)}`,
        actualQuantity: new Prisma.Decimal("4.000"),
        unit: "kg",
        note: null,
        Ingredient: { name: "Gạo ST25" },
      },
    ],
  };

  const repo: SupplierOrderRepository = {
    ...supplierOrderRepository,
    connect: () => Promise.resolve({} as never),
    listManagementDeliveries: (_db, cmd) => {
      capturedListCommand = cmd;
      return Promise.resolve(
        summaryRows.filter((row) => !cmd.status || row.status === cmd.status),
      );
    },
    findManagementDeliveryById: (_db, scope, id) => {
      if (scope.supplierId !== supplierId || id !== prepId) {
        return Promise.resolve(null);
      }
      return Promise.resolve(multiDetailRow as never);
    },
  };

  const service = createSupplierOrderService(repo);
  assert.deepEqual(validateSupplierOrderListQuery({ status: "PREPARING" }), {
    page: 1,
    limit: 20,
    status: "PREPARING",
  });
  assert.throws(
    () => validateSupplierOrderListQuery({ limit: "101" }),
    RequestValidationError,
  );
  assert.throws(
    () => validateSupplierOrderListQuery({ status: "CONFIRMED" }),
    RequestValidationError,
  );

  // HTTP filter ?status=PREPARING accepts all read OR permissions and blocks missing read perm
  const app = express();
  app.use(express.json());
  let currentPrincipal = makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_STAFF, [
    "delivery.view",
  ]);
  app.use(
    "/api/deliveries/management",
    createSupplierOrderRouter(service, (req, _res, next) => {
      req.auth = currentPrincipal;
      next();
    }),
  );
  app.use(globalErrorHandler);
  const http = await startHttp(app);
  try {
    const viewListRes = await http.request(
      "/api/deliveries/management?status=PREPARING",
    );
    assert.equal(viewListRes.status, 200);
    assert.equal(
      (capturedListCommand as { status?: string; take: number }).status,
      "PREPARING",
    );
    assert.equal((capturedListCommand as { take: number }).take, 21);

    const viewData = (
      viewListRes.body as {
        data: { items: Array<Record<string, unknown>> };
      }
    ).data;
    assert.equal(viewData.items.length, 3);
    assert.deepEqual(
      viewData.items.map((item) => item.nextAction),
      ["VIEW_DELIVERY", "VIEW_DELIVERY", "VIEW_DELIVERY"],
    );
    assert.equal(viewData.items[2].supplyRequestId, null);
    assert.notEqual(viewData.items[2].status, "CONFIRMED");

    // delivery.receive read OR gets VIEW_DELIVERY on PREPARING & TRACK_DELIVERY on IN_TRANSIT
    currentPrincipal = makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_STAFF, [
      "delivery.receive",
    ]);
    const receiveListRes = await http.request("/api/deliveries/management");
    assert.equal(receiveListRes.status, 200);
    const receiveItems = (
      receiveListRes.body as {
        data: { items: Array<Record<string, unknown>> };
      }
    ).data.items;
    assert.deepEqual(
      receiveItems.map((item) => item.nextAction),
      ["VIEW_DELIVERY", "VIEW_DELIVERY", "VIEW_DELIVERY", "TRACK_DELIVERY"],
    );
    assert.equal(receiveItems[3].workflowVersion, null);

    // delivery.manage gets ENTER_SHIPPING on non-terminal PREPARING and VIEW_DELIVERY when source COMPLETED
    currentPrincipal = makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_ADMIN, [
      "delivery.manage",
    ]);
    const manageListRes = await http.request("/api/deliveries/management");
    assert.equal(manageListRes.status, 200);
    const manageItems = (
      manageListRes.body as {
        data: { items: Array<Record<string, unknown>> };
      }
    ).data.items;
    assert.deepEqual(
      manageItems.map((item) => item.nextAction),
      ["ENTER_SHIPPING", "VIEW_DELIVERY", "ENTER_SHIPPING", "TRACK_DELIVERY"],
    );
    for (const item of manageItems) {
      if (item.status === "PREPARING") {
        assert.equal(item.expectedArrivalAt, null);
        assert.equal(item.vehiclePlate, null);
      }
    }

    // Detail keeps uncollapsed 6+4 items, same display facilityCode with distinct facility UUIDs, and zero secrets
    const detailRes = await http.request(
      `/api/deliveries/management/${prepId}`,
    );
    assert.equal(detailRes.status, 200);
    const detailData = (
      detailRes.body as {
        data: Record<string, unknown> & {
          items: Array<{
            id: string;
            actualQuantity: string;
            traceUrl: string;
            sourceFacility: { id: string; facilityCode: string | null };
          }>;
        };
      }
    ).data;
    assert.equal(detailData.items.length, 2);
    assert.equal(detailData.items[0].id, itemAId);
    assert.equal(detailData.items[1].id, itemBId);
    assert.equal(detailData.items[0].actualQuantity, "6");
    assert.equal(detailData.items[1].actualQuantity, "4");
    assert.notEqual(
      detailData.items[0].sourceFacility.id,
      detailData.items[1].sourceFacility.id,
    );
    assert.notEqual(detailData.items[0].traceUrl, detailData.items[1].traceUrl);
    for (const serialized of [
      JSON.stringify(manageListRes.body),
      JSON.stringify(detailRes.body),
    ]) {
      assert(!serialized.includes("qrToken"));
      assert(!serialized.includes("photoHash"));
      assert(!serialized.includes("qrImageDataUrl"));
      assert(!serialized.includes("creationFingerprint"));
      assert(!serialized.includes("secret-fingerprint"));
      assert(!serialized.includes('"created"'));
    }

    // Foreign supplier gets 404 even with delivery.manage
    currentPrincipal = makeSupplierActor(
      ROLES.INGREDIENT_SUPPLIER_ADMIN,
      ["delivery.manage"],
      { supplierId: supplierB },
    );
    assert.equal(
      (await http.request(`/api/deliveries/management/${prepId}`)).status,
      404,
    );

    // Invalid status query -> 400; missing read perm -> 403
    currentPrincipal = makeSupplierActor(ROLES.INGREDIENT_SUPPLIER_STAFF, []);
    assert.equal(
      (await http.request("/api/deliveries/management")).status,
      403,
    );
    assert.equal(
      (await http.request("/api/deliveries/management?status=BAD")).status,
      400,
    );
  } finally {
    await http.close();
  }
});
