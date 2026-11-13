import express from "express";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import { createSupplyOrderRouter } from "../src/modules/supply-order/supply-order.routes";
import { startHttp } from "./helpers/http";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "../src/generated/prisma/client";
import type { AuthPrincipal } from "../src/types/auth";
import { testStaff, testAdmin } from "./helpers/authorization";
import { createSupplyOrderService } from "../src/modules/supply-order/supply-order.service";
import type {
  SupplyOrderRepository,
  AcceptedOrderRow,
} from "../src/modules/supply-order/supply-order.repository";
import {
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
        error instanceof HttpError && error.statusCode === 409,
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
  await assert.rejects(f.service.accept({ id }, supplier), /trạng thái/i);
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
