import express from "express";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import { createSupplyOrderRouter } from "../src/modules/supply-order/supply-order.routes";
import { startHttp } from "./helpers/http";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma, type PrismaClient } from "../src/generated/prisma/client";
import type { AuthPrincipal } from "../src/types/auth";
import { testStaff, testAdmin } from "./helpers/authorization";
import { createSupplyOrderService } from "../src/modules/supply-order/supply-order.service";
import type {
  SupplyOrderRepository,
  AcceptedOrderRow,
  SupplierOrderListRow,
  SupplierOrderDetailRow,
} from "../src/modules/supply-order/supply-order.repository";
import { createSupplyOrderRepository } from "../src/modules/supply-order/supply-order.repository";
import {
  validateSupplyOrderDetailParams,
  validateSupplyOrderDetailQuery,
  validateSupplyOrderAcceptBody,
  validateSupplyOrderAcceptParams,
  validateSupplyOrderListQuery,
} from "../src/modules/supply-order/supply-order.validation";
import { RequestValidationError } from "../src/utils/request-validation";
import { HttpError } from "../src/utils/http-error";

const id = "00000000-0000-4000-8000-000000000006";
const supplierId = "00000000-0000-4000-8000-000000000005";
const supplier: AuthPrincipal = {
  ...testStaff,
  role: "INGREDIENT_SUPPLIER_STAFF",
  orgType: "SUPPLIER",
  schoolId: null,
  supplierId,
  permissions: ["supply_request.accept"],
};
const tx = {} as Prisma.TransactionClient;
function setup() {
  let order: AcceptedOrderRow = {
    id,
    supplierId,
    status: "SENT",
    acceptedAt: null,
    acceptedByUserId: null,
  };
  let changed = 0;
  let paused = false;
  const repository = {
    connect: () => {
      throw new Error("Unexpected database connection");
    },
    list: () => Promise.resolve([]),
    listForSupplier: () => Promise.resolve([]),
    findDetailForSupplier: () => Promise.resolve(null),
    findForSupplier: (
      _tx: Prisma.TransactionClient,
      orderId: string,
      scopeId: string,
    ) =>
      Promise.resolve(
        order.id === orderId && order.supplierId === scopeId ? order : null,
      ),
    accept: (
      _tx: Prisma.TransactionClient,
      _id: string,
      _scope: string,
      actorId: string,
      timestamp: Date,
    ) => {
      changed += 1;
      order = {
        ...order,
        status: "ACCEPTED",
        acceptedAt: timestamp,
        acceptedByUserId: actorId,
      };
      return Promise.resolve(1);
    },
  } satisfies SupplyOrderRepository;
  const service = createSupplyOrderService(repository, {
    transaction: (fn) => fn(tx),
    guard: {
      assertAccess: (_tx, actor) =>
        paused ? Promise.reject(new Error("tạm dừng")) : Promise.resolve(actor),
    },
  });
  return {
    service,
    repository,
    setPaused(value: boolean) {
      paused = value;
    },
    setOrder(value: AcceptedOrderRow) {
      order = value;
    },
    get order() {
      return order;
    },
    get changed() {
      return changed;
    },
  };
}

void test("accept validation rejects extra fields and normalizes IDs", () => {
  assert.deepEqual(validateSupplyOrderAcceptBody(undefined), {});
  assert.throws(
    () => validateSupplyOrderAcceptBody({ supplierId }),
    RequestValidationError,
  );
  assert.throws(
    () => validateSupplyOrderAcceptBody(null),
    RequestValidationError,
  );
  assert.throws(
    () => validateSupplyOrderAcceptParams({ id: "bad" }),
    RequestValidationError,
  );
  assert.equal(
    validateSupplyOrderAcceptParams({ id: id.toUpperCase() }).id,
    id,
  );
});

void test("supplier accept rejects connection failures and preserves existing receipts in every accepted state", async (context) => {
  context.mock.method(console, "error", () => undefined);
  const f = setup();
  const unavailable = createSupplyOrderService({
    ...f.repository,
    connect: () => Promise.reject(new Error("private connection details")),
  });
  await assert.rejects(
    () => unavailable.accept({ id }, supplier),
    (error: unknown) => error instanceof HttpError && error.statusCode === 503,
  );
  const first = await f.service.accept({ id }, supplier);
  f.setOrder({ ...f.order, status: "IN_PROGRESS" });
  assert.deepEqual(await f.service.accept({ id }, supplier), {
    ...first,
    status: "IN_PROGRESS",
  });
  assert.equal(f.changed, 1);
  for (const status of ["DRAFT", "COMPLETED", "CANCELLED"] as const) {
    f.setOrder({ ...f.order, status });
    await assert.rejects(
      () => f.service.accept({ id }, supplier),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === (status === "DRAFT" ? 404 : 409),
    );
  }
  assert.equal(f.changed, 1);
});

void test("supplier receives an order once, preserving receipt on retry", async () => {
  const f = setup();
  f.setOrder(
    Object.assign(f.order, {
      contractSnapshot: { privateQuote: "hidden-quote" },
    }),
  );
  const first = await f.service.accept({ id }, supplier);
  assert.deepEqual(Object.keys(first).sort(), [
    "acceptedAt",
    "acceptedByUserId",
    "id",
    "status",
  ]);
  assert(!JSON.stringify(first).includes("hidden-quote"));
  assert.equal(first.status, "ACCEPTED");
  assert.equal(first.acceptedByUserId, supplier.id);
  assert.match(first.acceptedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  const second = await f.service.accept({ id }, supplier);
  assert.deepEqual(second, first);
  assert.equal(f.changed, 1);
});

void test("a paused supplier and actors without scope cannot accept", async () => {
  const f = setup();
  f.setPaused(true);
  await assert.rejects(f.service.accept({ id }, supplier), /tạm dừng/);
  await assert.rejects(
    f.service.accept({ id }, { ...supplier, permissions: [] }),
    /quyền/i,
  );
  await assert.rejects(
    f.service.accept(
      { id },
      { ...testAdmin, permissions: ["supply_request.accept"] },
    ),
    /nhà cung cấp/i,
  );
  assert.equal(f.changed, 0);
});

void test("orders outside the supplier scope and invalid states are rejected", async () => {
  const f = setup();
  f.setOrder({ ...f.order, supplierId: "other" });
  await assert.rejects(f.service.accept({ id }, supplier), /không tìm thấy/i);
  f.setOrder({ ...f.order, supplierId, status: "DRAFT" });
  await assert.rejects(f.service.accept({ id }, supplier), /không tìm thấy/i);
  assert.equal(f.changed, 0);
});

void test("accept never uses school, officer or system permissions as a supplier bypass", async () => {
  const f = setup();
  for (const actor of [
    { ...testAdmin, permissions: ["supply_request.accept"] },
    { ...testStaff, permissions: ["supply_request.accept"] },
    {
      ...supplier,
      orgType: "AUTHORITY" as const,
      role: "COMMUNE_FOOD_SAFETY_OFFICER",
      supplierId: null,
      communeFoodSafetyUnitId: supplierId,
    },
    { ...supplier, permissions: ["supply_request.view"] },
  ])
    await assert.rejects(
      () => f.service.accept({ id }, actor),
      (error: unknown) =>
        error instanceof HttpError && error.statusCode === 403,
    );
  assert.equal(f.changed, 0);
});

void test("HTTP supplier accept preserves the response envelope and rejects extra input", async (context) => {
  const f = setup();
  const app = express();
  app.use(express.json());
  app.use(
    "/api/supply-requests",
    createSupplyOrderRouter(f.service, (req, _res, next) => {
      req.auth = supplier;
      next();
    }),
  );
  app.use(globalErrorHandler);
  const http = await startHttp(app);
  context.after(() => http.close());
  const invalid = await http.request(`/api/supply-requests/${id}/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ supplierId }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(f.changed, 0);
  const accepted = await http.request(`/api/supply-requests/${id}/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(accepted.status, 200);
  const body = accepted.body as {
    success: boolean;
    statusCode: number;
    data: { id: string; status: string; acceptedByUserId: string };
  };
  assert.equal(body.success, true);
  assert.equal(body.statusCode, 200);
  assert.equal(body.data.id, id);
  assert.equal(body.data.status, "ACCEPTED");
  assert.equal(body.data.acceptedByUserId, supplier.id);
  assert.equal(f.changed, 1);
});

void test("list pagination preserves defaults, bounds and strict inputs", () => {
  assert.deepEqual(validateSupplyOrderListQuery({}), { page: 1, limit: 20 });
  assert.deepEqual(validateSupplyOrderListQuery({ page: "2", limit: "100" }), {
    page: 2,
    limit: 100,
  });
  for (const query of [
    { page: "01" },
    { limit: "101" },
    { page: ["1", "2"] },
    { schoolId: "x" },
    { page: "999999999999999999" },
  ])
    assert.throws(
      () => validateSupplyOrderListQuery(query),
      RequestValidationError,
    );
});

void test("supplier list status accepts only the five sent lifecycle states", () => {
  for (const status of [
    "SENT",
    "ACCEPTED",
    "IN_PROGRESS",
    "COMPLETED",
    "CANCELLED",
  ])
    assert.deepEqual(validateSupplyOrderListQuery({ status }), {
      page: 1,
      limit: 20,
      status,
    });
  for (const query of [
    { status: "DRAFT" },
    { status: "sent" },
    { status: ["SENT"] },
    { status: { equals: "SENT" } },
    { page: "0" },
    { page: "2147483648", limit: "100" },
  ])
    assert.throws(
      () => validateSupplyOrderListQuery(query),
      RequestValidationError,
    );
});

const readActor: AuthPrincipal = {
  ...supplier,
  permissions: ["supply_request.view"],
};
const timestamp = new Date("2026-11-14T03:00:00.000Z");
function listRow(): SupplierOrderListRow {
  return {
    id,
    requestNo: "REQ-001",
    schoolId: testStaff.schoolId!,
    supplierId,
    status: "SENT",
    acceptedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    requestedDeliveryDate: new Date("2026-11-20T00:00:00.000Z"),
    sentAt: timestamp,
    School: { id: testStaff.schoolId!, name: "Trường A" },
  };
}
function detailRow(): SupplierOrderDetailRow {
  return Object.assign(
    {
      ...listRow(),
      note: null,
      acceptedByUserId: null,
      supplyRequestItems: [
        {
          id: "00000000-0000-4000-8000-000000000010",
          ingredientEntryId: "00000000-0000-4000-8000-000000000011",
          requestedQuantity: new Prisma.Decimal("99999999999.123"),
          unit: "kg",
          note: null,
          IngredientEntry: { Ingredient: { name: "Gạo" } },
        },
      ],
    },
    {
      contractSnapshot: { secret: "hidden-quote" },
      acceptedByUser: { email: "hidden-email", passwordHash: "hidden-hash" },
    },
  );
}
function reads() {
  const f = setup();
  let listed: { query: unknown; scope: unknown } | undefined;
  let detailed: { id: string; supplierId: string } | undefined;
  let current: SupplierOrderDetailRow | null = detailRow();
  let resultRows: SupplierOrderListRow[] = [listRow()];
  const repo: SupplyOrderRepository = {
    ...f.repository,
    listForSupplier: (query, scope) => {
      listed = { query, scope };
      return Promise.resolve(resultRows);
    },
    findDetailForSupplier: (detailId, scopeId) => {
      detailed = { id: detailId, supplierId: scopeId };
      return Promise.resolve(current);
    },
  };
  return {
    repo,
    service: createSupplyOrderService(repo),
    setRows(rows: SupplierOrderListRow[]) {
      resultRows = rows;
    },
    setDetail(row: SupplierOrderDetailRow | null) {
      current = row;
    },
    get listed() {
      return listed;
    },
    get detailed() {
      return detailed;
    },
  };
}
const statusError = (status: number) => (error: unknown) =>
  error instanceof HttpError && error.statusCode === status;

void test("supplier list uses trusted scope, filters and safe projections for both roles", async () => {
  for (const role of [
    "INGREDIENT_SUPPLIER_ADMIN",
    "INGREDIENT_SUPPLIER_STAFF",
  ]) {
    const f = reads();
    const query = validateSupplyOrderListQuery({ status: "SENT", limit: "1" });
    f.setRows([
      Object.assign(listRow(), { contractSnapshot: "hidden-quote" }),
      { ...listRow(), id: "next" },
    ]);
    const result = await f.service.getAll(query, { ...readActor, role });
    assert.deepEqual(f.listed, { query, scope: { supplierId } });
    assert.deepEqual(result.pagination, { page: 1, limit: 1, hasNext: true });
    assert.deepEqual(result.items, [
      {
        id,
        requestNo: "REQ-001",
        schoolId: testStaff.schoolId!,
        supplierId,
        status: "SENT",
        acceptedAt: null,
        createdAt: timestamp.toISOString(),
        updatedAt: timestamp.toISOString(),
        schoolName: "Trường A",
        requestedDeliveryDate: "2026-11-20",
        sentAt: timestamp.toISOString(),
      },
    ]);
    assert(!JSON.stringify(result).includes("hidden-quote"));
    f.setRows([]);
    assert.deepEqual(
      await f.service.getAll({ page: 3, limit: 20 }, { ...readActor, role }),
      {
        items: [],
        pagination: { page: 3, limit: 20, hasNext: false },
      },
    );
  }
});

void test("supplier read roles and permissions are enforced without a system detail bypass", async () => {
  for (const actor of [
    { ...readActor, permissions: [] },
    { ...readActor, permissions: ["supply_request.accept"] },
    { ...readActor, role: "SYSTEM_ADMIN" },
    { ...readActor, supplierId: null },
  ]) {
    const f = reads();
    await assert.rejects(
      f.service.getAll({ page: 1, limit: 20 }, actor),
      statusError(403),
    );
    await assert.rejects(f.service.getDetail({ id }, actor), statusError(403));
    assert.equal(f.listed, undefined);
    assert.equal(f.detailed, undefined);
  }
  const f = reads();
  for (const actor of [
    { ...testAdmin, permissions: ["supply_request.view"] },
    { ...testStaff, permissions: ["supply_request.view"] },
  ])
    await assert.rejects(f.service.getDetail({ id }, actor), statusError(403));
});

void test("detail input is strict and normalizes UUIDs", () => {
  assert.deepEqual(validateSupplyOrderDetailParams({ id: id.toUpperCase() }), {
    id,
  });
  assert.deepEqual(validateSupplyOrderDetailQuery({}), {});
  for (const value of [{ id: "bad" }, { id, supplierId }])
    assert.throws(
      () => validateSupplyOrderDetailParams(value),
      RequestValidationError,
    );
  for (const value of [{ supplierId }, { page: "1" }])
    assert.throws(
      () => validateSupplyOrderDetailQuery(value),
      RequestValidationError,
    );
});

void test("detail serializes all item quantities and dates, allows null history and never leaks records", async () => {
  for (const role of [
    "INGREDIENT_SUPPLIER_ADMIN",
    "INGREDIENT_SUPPLIER_STAFF",
  ]) {
    const f = reads();
    const result = await f.service.getDetail({ id }, { ...readActor, role });
    assert.deepEqual(f.detailed, { id, supplierId });
    assert.equal(result.schoolName, "Trường A");
    assert.equal(result.requestedDeliveryDate, "2026-11-20");
    assert.equal(result.sentAt, timestamp.toISOString());
    assert.equal(result.acceptedAt, null);
    assert.equal(result.acceptedByUserId, null);
    assert.equal(result.note, null);
    assert.deepEqual(result.items, [
      {
        id: "00000000-0000-4000-8000-000000000010",
        ingredientEntryId: "00000000-0000-4000-8000-000000000011",
        ingredientName: "Gạo",
        requestedQuantity: "99999999999.123",
        unit: "kg",
        note: null,
      },
    ]);
    for (const hidden of [
      "hidden-quote",
      "hidden-email",
      "hidden-hash",
      "supplyRequestItems",
      "IngredientEntry",
    ])
      assert(!JSON.stringify(result).includes(hidden));
    f.setDetail({
      ...detailRow(),
      requestedDeliveryDate: null,
      sentAt: null,
      acceptedAt: timestamp,
      acceptedByUserId: supplier.id,
      status: "ACCEPTED",
    });
    const accepted = await f.service.getDetail({ id }, { ...readActor, role });
    assert.equal(accepted.requestedDeliveryDate, null);
    assert.equal(accepted.sentAt, null);
    assert.equal(accepted.acceptedAt, timestamp.toISOString());
    assert.equal(accepted.acceptedByUserId, supplier.id);
    f.setDetail(null);
    await assert.rejects(
      f.service.getDetail({ id }, { ...readActor, role }),
      statusError(404),
    );
  }
});

void test("read dependency failures are safe 503 responses", async (context) => {
  context.mock.method(console, "error", () => undefined);
  const f = reads();
  const service = createSupplyOrderService({
    ...f.repo,
    listForSupplier: () =>
      Promise.reject(new Error("postgres://secret:password@private")),
    findDetailForSupplier: () =>
      Promise.reject(new Error("private SQL secret")),
  });
  await assert.rejects(
    service.getAll({ page: 1, limit: 20 }, readActor),
    statusError(503),
  );
  await assert.rejects(service.getDetail({ id }, readActor), statusError(503));
});

void test("both supplier roles accept without view, and forged roles or refreshed scopes cannot write", async () => {
  for (const role of [
    "INGREDIENT_SUPPLIER_ADMIN",
    "INGREDIENT_SUPPLIER_STAFF",
  ]) {
    const f = setup();
    const first = await f.service.accept({ id }, { ...supplier, role });
    const second = await f.service.accept(
      { id },
      { ...supplier, role, id: testAdmin.id },
    );
    assert.deepEqual(first, second);
    assert.equal(f.changed, 1);
  }
  for (const actor of [
    { ...supplier, role: "SYSTEM_ADMIN" },
    { ...supplier, role: "UNKNOWN" },
  ]) {
    const f = setup();
    await assert.rejects(f.service.accept({ id }, actor), statusError(403));
    assert.equal(f.changed, 0);
  }
  for (const refreshed of [
    { ...supplier, supplierId: testAdmin.id },
    { ...supplier, role: "SYSTEM_ADMIN" },
    { ...supplier, permissions: [] },
  ]) {
    const f = setup();
    const service = createSupplyOrderService(f.repository, {
      transaction: (fn) => fn(tx),
      guard: { assertAccess: () => Promise.resolve(refreshed) },
    });
    await assert.rejects(service.accept({ id }, supplier), statusError(403));
    assert.equal(f.changed, 0);
  }
});

void test("accept coordinates guard, reads and conditional writes on one transaction", async () => {
  const f = setup();
  const calls: string[] = [];
  const service = createSupplyOrderService(
    {
      ...f.repository,
      findForSupplier: (client, orderId, scopeId) => {
        assert.equal(client, tx);
        calls.push("read");
        return f.repository.findForSupplier(client, orderId, scopeId);
      },
      accept: (client, orderId, scopeId, actorId, at) => {
        assert.equal(client, tx);
        assert.equal(scopeId, supplierId);
        assert.equal(actorId, supplier.id);
        calls.push("write");
        return f.repository.accept(client, orderId, scopeId, actorId, at);
      },
    },
    {
      transaction: (fn) => fn(tx),
      guard: {
        assertAccess: (client, actor, command) => {
          assert.equal(client, tx);
          assert.deepEqual(command, {
            operation: "SUPPLIER_ACCEPT_ORDER",
            orderId: id,
          });
          calls.push("guard");
          return Promise.resolve(actor);
        },
      },
    },
  );
  await service.accept({ id }, supplier);
  assert.deepEqual(calls, ["guard", "read", "write", "read"]);
  const failed = createSupplyOrderService(
    { ...f.repository, accept: () => Promise.resolve(0) },
    {
      transaction: (fn) => fn(tx),
      guard: { assertAccess: (_tx, actor) => Promise.resolve(actor) },
    },
  );
  f.setOrder({
    ...f.order,
    status: "SENT",
    acceptedAt: null,
    acceptedByUserId: null,
  });
  await assert.rejects(failed.accept({ id }, supplier), statusError(409));
});

void test("repository supplier reads retain scope, hide drafts, use bounded pagination and preserve historical items", async () => {
  const many: Prisma.SupplyRequestFindManyArgs[] = [];
  const first: Prisma.SupplyRequestFindFirstArgs[] = [];
  const db = {
    supplyRequest: {
      findMany: (args: Prisma.SupplyRequestFindManyArgs) => {
        many.push(args);
        return Promise.resolve([]);
      },
      findFirst: (args: Prisma.SupplyRequestFindFirstArgs) => {
        first.push(args);
        return Promise.resolve(null);
      },
    },
  } as unknown as PrismaClient;
  const repository = createSupplyOrderRepository(() => Promise.resolve(db));
  await repository.listForSupplier(
    { page: 2, limit: 3, status: "SENT" },
    { supplierId },
  );
  assert.deepEqual(many[0].where, {
    AND: [
      { supplierId },
      {
        status: {
          in: ["SENT", "ACCEPTED", "IN_PROGRESS", "COMPLETED", "CANCELLED"],
        },
      },
      { status: "SENT" },
    ],
  });
  assert.equal(many[0].skip, 3);
  assert.equal(many[0].take, 4);
  assert.deepEqual(many[0].orderBy, [{ id: "asc" }]);
  assert.deepEqual(Object.keys(many[0].select!).sort(), [
    "School",
    "acceptedAt",
    "createdAt",
    "id",
    "requestNo",
    "requestedDeliveryDate",
    "schoolId",
    "sentAt",
    "status",
    "supplierId",
    "updatedAt",
  ]);
  await repository.listForSupplier({ page: 1, limit: 20 }, { supplierId });
  assert.deepEqual(many[1].where, {
    AND: [
      { supplierId },
      {
        status: {
          in: ["SENT", "ACCEPTED", "IN_PROGRESS", "COMPLETED", "CANCELLED"],
        },
      },
    ],
  });
  await repository.findDetailForSupplier(id, supplierId);
  assert.deepEqual(first[0].where, {
    id,
    supplierId,
    status: {
      in: ["SENT", "ACCEPTED", "IN_PROGRESS", "COMPLETED", "CANCELLED"],
    },
  });
  const itemSelection = first[0].select!.supplyRequestItems;
  assert(itemSelection && typeof itemSelection === "object");
  assert.deepEqual(itemSelection.orderBy, [{ id: "asc" }]);
  assert.equal(itemSelection.where, undefined);
  assert.deepEqual(itemSelection.select!.IngredientEntry, {
    select: { Ingredient: { select: { name: true } } },
  });
  assert.equal(first[0].select!.acceptedByUser, undefined);
  assert.equal(first[0].select!.contractSnapshot, undefined);
});

void test("repository acceptance writes are conditional and share the supplied transaction", async () => {
  const calls: Prisma.SupplyRequestUpdateManyArgs[] = [];
  const client = {
    supplyRequest: {
      updateMany: (args: Prisma.SupplyRequestUpdateManyArgs) => {
        calls.push(args);
        return Promise.resolve({ count: 1 });
      },
    },
  } as unknown as Prisma.TransactionClient;
  const repository = createSupplyOrderRepository(() => {
    throw new Error("must not connect inside acceptance");
  });
  assert.equal(
    await repository.accept(client, id, supplierId, supplier.id, timestamp),
    1,
  );
  assert.deepEqual(calls, [
    {
      where: { id, supplierId, status: "SENT" },
      data: {
        status: "ACCEPTED",
        acceptedByUserId: supplier.id,
        acceptedAt: timestamp,
      },
    },
  ]);
});

void test("HTTP list and detail validate inputs, enforce permissions and preserve complete supplier output", async (context) => {
  const f = reads();
  let actor = readActor;
  const app = express();
  app.use(express.json());
  app.use(
    "/api/supply-requests",
    createSupplyOrderRouter(f.service, (req, _res, next) => {
      req.auth = actor;
      next();
    }),
  );
  app.use(globalErrorHandler);
  const http = await startHttp(app);
  context.after(() => http.close());
  for (const role of [
    "INGREDIENT_SUPPLIER_ADMIN",
    "INGREDIENT_SUPPLIER_STAFF",
  ]) {
    actor = { ...readActor, role };
    const list = await http.request(
      "/api/supply-requests?status=SENT&page=1&limit=20",
    );
    assert.equal(list.status, 200);
    assert.deepEqual(
      (list.body as { data: { pagination: unknown } }).data.pagination,
      { page: 1, limit: 20, hasNext: false },
    );
    const detail = await http.request(`/api/supply-requests/${id}`);
    assert.equal(detail.status, 200);
    assert.equal(
      (detail.body as { data: { items: { requestedQuantity: string }[] } }).data
        .items[0].requestedQuantity,
      "99999999999.123",
    );
    for (const path of [
      "/api/supply-requests?status=DRAFT",
      "/api/supply-requests?status=SENT&supplierId=other",
      `/api/supply-requests/${id}?page=1`,
      "/api/supply-requests/not-a-uuid",
    ])
      assert.equal((await http.request(path)).status, 400);
  }
  actor = { ...readActor, permissions: ["supply_request.accept"] };
  assert.equal((await http.request("/api/supply-requests")).status, 403);
  assert.equal((await http.request(`/api/supply-requests/${id}`)).status, 403);
  actor = readActor;
  f.setDetail(null);
  assert.equal((await http.request(`/api/supply-requests/${id}`)).status, 404);
});

void test("HTTP accept rejects unknown body/query and accepts an absent body", async (context) => {
  const f = setup();
  const app = express();
  app.use(express.json());
  app.use(
    "/api/supply-requests",
    createSupplyOrderRouter(f.service, (req, _res, next) => {
      req.auth = supplier;
      next();
    }),
  );
  app.use(globalErrorHandler);
  const http = await startHttp(app);
  context.after(() => http.close());
  for (const body of [
    "null",
    "[]",
    JSON.stringify({ acceptedAt: timestamp.toISOString() }),
    JSON.stringify({ acceptedByUserId: supplier.id }),
  ]) {
    assert.equal(
      (
        await http.request(`/api/supply-requests/${id}/accept`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        })
      ).status,
      400,
    );
  }
  assert.equal(
    (
      await http.request(
        `/api/supply-requests/${id}/accept?supplierId=${supplierId}`,
        { method: "POST" },
      )
    ).status,
    400,
  );
  assert.equal(f.changed, 0);
  const result = await http.request(`/api/supply-requests/${id}/accept`, {
    method: "POST",
  });
  assert.equal(result.status, 200);
  assert.equal(f.changed, 1);
});

void test("accept failure rolls back the transaction boundary and legacy receipts remain read-only", async () => {
  const f = setup();
  const before = { ...f.order };
  let reads = 0;
  const service = createSupplyOrderService(
    {
      ...f.repository,
      findForSupplier: (client, orderId, scopeId) =>
        ++reads > 1
          ? Promise.reject(new Error("after write failure"))
          : f.repository.findForSupplier(client, orderId, scopeId),
    },
    {
      transaction: async (fn) => {
        try {
          return await fn(tx);
        } catch (error) {
          f.setOrder(before);
          throw error;
        }
      },
      guard: { assertAccess: (_client, actor) => Promise.resolve(actor) },
    },
  );
  await assert.rejects(service.accept({ id }, supplier), /after write failure/);
  assert.deepEqual(f.order, before);
  for (const status of ["ACCEPTED", "IN_PROGRESS"] as const) {
    const existing = setup();
    existing.setOrder({ ...existing.order, status });
    assert.deepEqual(await existing.service.accept({ id }, supplier), {
      id,
      status,
      acceptedByUserId: null,
      acceptedAt: null,
    });
    assert.equal(existing.changed, 0);
  }
});
