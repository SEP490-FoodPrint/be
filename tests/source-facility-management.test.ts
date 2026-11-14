import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import express from "express";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import type { AuthPrincipal } from "../src/types/auth";
import { HttpError } from "../src/utils/http-error";
import { testAdmin } from "./helpers/authorization";
import { createSourceFacilityService } from "../src/modules/source-facility/source-facility.service";
import { createSourceFacilityRouter } from "../src/modules/source-facility/source-facility.routes";
import {
  globalErrorHandler,
  notFoundHandler,
} from "../src/middlewares/error.middleware";
import { startHttp } from "./helpers/http";
import {
  validateSourceFacilityCreate,
  validateSourceFacilityParams,
  validateSourceFacilityQuery,
  validateSourceFacilityUpdate,
  validateSourceFacilityDeactivate,
} from "../src/modules/source-facility/source-facility.validation";
import {
  formatSourceFacilityCode,
  parseCanonicalSourceFacilityCode,
} from "../src/utils/source-facility-code";
import { RequestValidationError } from "../src/utils/request-validation";
import {
  createSourceFacilityRepository,
  sourceFacilityWriteError,
} from "../src/modules/source-facility/source-facility.repository";

const sourceFacilityId = "11111111-1111-4111-8111-111111111111";
const supplierId = "22222222-2222-4222-8222-222222222222";
const otherSupplierId = "33333333-3333-4333-8333-333333333333";
const timestamp = new Date("2026-11-14T03:00:00.000Z");
const principal: AuthPrincipal = {
  ...testAdmin,
  role: "INGREDIENT_SUPPLIER_ADMIN",
  orgType: "SUPPLIER",
  supplierId,
  permissions: ["source_facility.manage"],
};

interface Editable {
  name?: string;
  address?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
}
interface FixtureRow {
  id: string;
  supplierId: string;
  facilityCode: string | null;
  name: string;
  address: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  status: "ACTIVE" | "INACTIVE";
  isVisible: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string;
  updatedByUserId: string;
  privateValue: string;
}
function facility(overrides: Partial<FixtureRow> = {}): FixtureRow {
  return {
    id: sourceFacilityId,
    supplierId,
    facilityCode: "FP-SF-00001",
    name: "Cơ sở rau A",
    address: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    status: "ACTIVE",
    isVisible: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    createdByUserId: principal.id,
    updatedByUserId: principal.id,
    privateValue: "private-persistence-value",
    ...overrides,
  };
}
function fixture(initialRows: FixtureRow[] = []) {
  const rows = [...initialRows];
  let actor = principal;
  let supplierStatus: "ACTIVE" | "INACTIVE" = "ACTIVE";
  let activeTx: Prisma.TransactionClient | undefined;
  let attempts = 0;
  let nextFailure: Error | undefined;
  let nextCommitFailure: Error | undefined;
  const calls: { operation: string; scope?: { supplierId: string } }[] = [];
  const inTransaction = (client: Prisma.TransactionClient) => {
    assert(client, "write repository call must receive a transaction");
    assert.equal(client, activeTx, "every write call shares one transaction");
  };
  const find = (scope: { supplierId: string }, id: string) =>
    rows.find((row) => row.id === id && row.supplierId === scope.supplierId) ??
    null;
  const repo = {
    actor: (_id: string, client: Prisma.TransactionClient) => {
      inTransaction(client);
      calls.push({ operation: "actor" });
      return Promise.resolve(actor);
    },
    supplierStatus: (
      scope: { supplierId: string },
      client?: Prisma.TransactionClient,
    ) => {
      if (client) inTransaction(client);
      calls.push({ operation: "supplierStatus", scope });
      return Promise.resolve({ status: supplierStatus });
    },
    lockSupplier: (
      scope: { supplierId: string },
      client: Prisma.TransactionClient,
    ) => {
      inTransaction(client);
      calls.push({ operation: "lockSupplier", scope });
      return Promise.resolve();
    },
    lockTarget: (
      scope: { supplierId: string },
      _id: string,
      client: Prisma.TransactionClient,
    ) => {
      inTransaction(client);
      calls.push({ operation: "lockTarget", scope });
      return Promise.resolve();
    },
    list: (
      scope: { supplierId: string },
      query: { page: number; limit: number },
    ) => {
      calls.push({ operation: "list", scope });
      const offset = (query.page - 1) * query.limit;
      return Promise.resolve(
        rows
          .filter((row) => row.supplierId === scope.supplierId)
          .sort((left, right) => left.id.localeCompare(right.id))
          .slice(offset, offset + query.limit + 1),
      );
    },
    find: (
      scope: { supplierId: string },
      id: string,
      client?: Prisma.TransactionClient,
    ) => {
      if (client) inTransaction(client);
      calls.push({ operation: "find", scope });
      return Promise.resolve(find(scope, id));
    },
    nameExists: (
      scope: { supplierId: string },
      name: string,
      client: Prisma.TransactionClient,
      excludeId?: string,
    ) => {
      inTransaction(client);
      calls.push({ operation: "nameExists", scope });
      return Promise.resolve(
        rows.some(
          (row) =>
            row.supplierId === scope.supplierId &&
            row.name === name &&
            row.id !== excludeId,
        ),
      );
    },
    highestCodeNumber: (
      scope: { supplierId: string },
      client: Prisma.TransactionClient,
    ) => {
      inTransaction(client);
      calls.push({ operation: "highestCodeNumber", scope });
      let highest = 0n;
      for (const row of rows) {
        if (row.supplierId !== scope.supplierId || !row.facilityCode) continue;
        if (!/^FP-SF-(?:[0-9]{5}|[1-9][0-9]{5,73})$/.test(row.facilityCode))
          continue;
        const value = BigInt(row.facilityCode.slice(6));
        if (value > highest) highest = value;
      }
      return Promise.resolve(highest);
    },
    create: (
      scope: { supplierId: string },
      input: Editable & { name: string },
      actorId: string,
      facilityCode: string,
      client: Prisma.TransactionClient,
    ) => {
      inTransaction(client);
      calls.push({ operation: "create", scope });
      if (nextFailure) {
        const failure = nextFailure;
        nextFailure = undefined;
        return Promise.reject(failure);
      }
      const row = facility({
        ...input,
        id:
          "11111111-1111-4111-8111-" +
          String(rows.length + 1).padStart(12, "0"),
        supplierId: scope.supplierId,
        facilityCode,
        createdByUserId: actorId,
        updatedByUserId: actorId,
      });
      rows.push(row);
      return Promise.resolve(row);
    },
    update: (
      scope: { supplierId: string },
      id: string,
      input: Editable,
      actorId: string,
      client: Prisma.TransactionClient,
    ) => {
      inTransaction(client);
      calls.push({ operation: "update", scope });
      const row = find(scope, id);
      if (row)
        Object.assign(row, input, {
          updatedByUserId: actorId,
          updatedAt: new Date(timestamp.getTime() + 1000),
        });
      return Promise.resolve(row);
    },
    deactivate: (
      scope: { supplierId: string },
      id: string,
      actorId: string,
      client: Prisma.TransactionClient,
    ) => {
      inTransaction(client);
      calls.push({ operation: "deactivate", scope });
      const row = find(scope, id);
      if (row?.status === "ACTIVE") {
        row.status = "INACTIVE";
        row.updatedByUserId = actorId;
        row.updatedAt = new Date(timestamp.getTime() + 1000);
      }
      return Promise.resolve(row);
    },
  };
  const connect = () =>
    Promise.resolve({
      $transaction: async (
        operation: (client: Prisma.TransactionClient) => Promise<unknown>,
        options: { isolationLevel: string },
      ) => {
        attempts += 1;
        assert.equal(options.isolationLevel, "Serializable");
        activeTx = { attempt: attempts } as unknown as Prisma.TransactionClient;
        const before = rows.map((row) => ({ ...row }));
        try {
          const result = await operation(activeTx);
          if (nextCommitFailure) {
            const failure = nextCommitFailure;
            nextCommitFailure = undefined;
            throw failure;
          }
          return result;
        } catch (error) {
          rows.splice(0, rows.length, ...before);
          throw error;
        } finally {
          activeTx = undefined;
        }
      },
    } as unknown as PrismaClient);
  return {
    repo,
    connect,
    rows,
    calls,
    attempts: () => attempts,
    setActor: (value: AuthPrincipal) => {
      actor = value;
    },
    setSupplierStatus: (value: "ACTIVE" | "INACTIVE") => {
      supplierStatus = value;
    },
    failNextCreate: (value: Error) => {
      nextFailure = value;
    },
    failNextCommit: (value: Error) => {
      nextCommitFailure = value;
    },
  };
}
const statusIs = (code: number) => (error: unknown) =>
  error instanceof HttpError && error.statusCode === code;

function object(value: unknown): Record<string, unknown> {
  assert(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
async function httpFixture(context: TestContext, f = fixture()) {
  context.mock.method(console, "error", () => undefined);
  let actor: AuthPrincipal | undefined = principal;
  const app = express();
  app.use(express.json());
  app.use(
    "/api/source-facilities",
    createSourceFacilityRouter(
      createSourceFacilityService(f.repo, f.connect),
      (req, _res, next) => {
        if (actor) req.auth = actor;
        next();
      },
    ),
  );
  app.use(notFoundHandler);
  app.use(globalErrorHandler);
  const http = await startHttp(app);
  context.after(() => http.close());
  return {
    ...f,
    http,
    setHttpActor(value: AuthPrincipal | undefined) {
      actor = value;
    },
  };
}

void test("source facility create validates five editable fields and aggregates Vietnamese paths", () => {
  assert.deepEqual(validateSourceFacilityCreate({ name: " Rau " }), {
    name: "Rau",
    address: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
  });
  assert.deepEqual(
    validateSourceFacilityCreate({
      name: " Rau ",
      address: "  ",
      contactName: null,
      contactPhone: " +84900000000 ",
      contactEmail: " contact@example.test ",
    }),
    {
      name: "Rau",
      address: null,
      contactName: null,
      contactPhone: "+84900000000",
      contactEmail: "contact@example.test",
    },
  );
  for (const readonly of [
    "id",
    "supplierId",
    "facilityCode",
    "status",
    "isVisible",
    "createdByUserId",
    "updatedByUserId",
    "createdAt",
    "updatedAt",
  ]) {
    for (const value of [null, "", "FP-SF-00001"])
      assert.throws(
        () => validateSourceFacilityCreate({ name: "Rau", [readonly]: value }),
        RequestValidationError,
      );
  }
  for (const value of [
    {},
    { name: null },
    { name: " " },
    { name: "x".repeat(256) },
    { name: "Rau", contactPhone: 90123 },
    { name: "Rau", contactName: [] },
    null,
    [],
  ])
    assert.throws(
      () => validateSourceFacilityCreate(value),
      RequestValidationError,
    );
  try {
    validateSourceFacilityCreate({
      name: " ",
      contactName: "x".repeat(256),
      contactPhone: "1".repeat(31),
      contactEmail: "private-invalid-email",
      supplierId: "private-tenant-id",
    });
    assert.fail("invalid create must fail");
  } catch (error) {
    assert(error instanceof RequestValidationError);
    assert.deepEqual(
      error.fields.map((item) => item.field).sort(),
      [
        "name",
        "contactName",
        "contactPhone",
        "contactEmail",
        "supplierId",
      ].sort(),
    );
    assert(!JSON.stringify(error.fields).includes("private-invalid-email"));
    assert(!JSON.stringify(error.fields).includes("private-tenant-id"));
  }
});

void test("source facility code formatter preserves numeric precision, canonical padding and storage bounds", () => {
  for (const [number, expected] of [
    [1n, "FP-SF-00001"],
    [99999n, "FP-SF-99999"],
    [100000n, "FP-SF-100000"],
    [9007199254740993n, "FP-SF-9007199254740993"],
  ] as const) {
    assert.equal(formatSourceFacilityCode(number), expected);
    assert.equal(parseCanonicalSourceFacilityCode(expected), number);
  }
  const maximum = BigInt("9".repeat(74));
  assert.equal(formatSourceFacilityCode(maximum).length, 80);
  assert.equal(
    parseCanonicalSourceFacilityCode(formatSourceFacilityCode(maximum)),
    maximum,
  );
  for (const number of [0n, -1n, maximum + 1n])
    assert.throws(() => formatSourceFacilityCode(number), statusIs(503));
  for (const value of [
    null,
    "",
    "FP-SF-00000",
    "FP-SF-1",
    "FP-SF-000001",
    "fp-sf-00001",
    " FP-SF-00001",
    "FP-SF-00001\n",
    "old-code",
    "FP-SF-" + "9".repeat(75),
  ])
    assert.equal(
      parseCanonicalSourceFacilityCode(value),
      undefined,
      String(value),
    );
});

void test("source facility create uses trusted tenant, fresh actor and one transaction for numbering and audit", async () => {
  const f = fixture();
  const service = createSourceFacilityService(f.repo, f.connect);
  const a = await service.create(
    validateSourceFacilityCreate({ name: "A" }),
    principal,
  );
  const a2 = await service.create(
    validateSourceFacilityCreate({ name: "A2" }),
    principal,
  );
  const other = { ...principal, supplierId: otherSupplierId };
  f.setActor(other);
  const b = await service.create(
    validateSourceFacilityCreate({ name: "A" }),
    other,
  );
  assert.deepEqual(
    [a.facilityCode, a2.facilityCode, b.facilityCode],
    ["FP-SF-00001", "FP-SF-00002", "FP-SF-00001"],
  );
  assert.deepEqual([a.supplierId, b.supplierId], [supplierId, otherSupplierId]);
  assert.equal(f.rows.length, 3);
  assert.equal(f.attempts(), 3);
  assert(
    f.calls
      .filter((call) => call.operation === "create")
      .every(
        (call) =>
          call.scope?.supplierId === supplierId ||
          call.scope?.supplierId === otherSupplierId,
      ),
  );
  assert(
    f.calls.findIndex((call) => call.operation === "lockSupplier") <
      f.calls.findIndex((call) => call.operation === "highestCodeNumber"),
  );
});

void test("source facility create forbids duplicate inactive names and rechecks revoked role, membership and permission", async () => {
  const duplicate = fixture([facility({ status: "INACTIVE" })]);
  await assert.rejects(
    () =>
      createSourceFacilityService(duplicate.repo, duplicate.connect).create(
        validateSourceFacilityCreate({ name: "Cơ sở rau A" }),
        principal,
      ),
    statusIs(409),
  );
  assert.equal(duplicate.rows.length, 1);
  for (const actor of [
    { ...principal, permissions: [] },
    { ...principal, role: "INGREDIENT_SUPPLIER_STAFF" },
    { ...principal, supplierId: otherSupplierId },
    { ...principal, schoolId: sourceFacilityId },
  ]) {
    const f = fixture();
    f.setActor(actor);
    await assert.rejects(
      () =>
        createSourceFacilityService(f.repo, f.connect).create(
          validateSourceFacilityCreate({ name: "Refused" }),
          principal,
        ),
      statusIs(403),
    );
    assert.equal(f.rows.length, 0);
    assert(!f.calls.some((call) => call.operation === "create"));
  }
  const inactive = fixture();
  inactive.setSupplierStatus("INACTIVE");
  await assert.rejects(
    () =>
      createSourceFacilityService(inactive.repo, inactive.connect).create(
        validateSourceFacilityCreate({ name: "Refused" }),
        principal,
      ),
    statusIs(403),
  );
  assert.equal(inactive.rows.length, 0);
});

void test("source facility create retries code conflicts and rolls back failed commits without exposing driver errors", async (context) => {
  context.mock.method(console, "error", () => undefined);
  const codeConflict = Object.assign(new Error("private-driver-value"), {
    code: "P2002",
    meta: { target: ["supplierId", "facilityCode"] },
  });
  const f = fixture();
  f.failNextCreate(codeConflict);
  const value = await createSourceFacilityService(f.repo, f.connect).create(
    validateSourceFacilityCreate({ name: "A" }),
    principal,
  );
  assert.equal(value.facilityCode, "FP-SF-00001");
  assert.equal(f.rows.length, 1);
  assert.equal(f.attempts(), 2);
  const rollback = fixture();
  rollback.failNextCommit(
    Object.assign(new Error("write conflict"), { code: "P2034" }),
  );
  const recovered = await createSourceFacilityService(
    rollback.repo,
    rollback.connect,
  ).create(validateSourceFacilityCreate({ name: "A" }), principal);
  assert.equal(recovered.facilityCode, "FP-SF-00001");
  assert.equal(rollback.rows.length, 1);
  assert.equal(rollback.attempts(), 2);
  const exhausted = fixture();
  exhausted.repo.create = () => Promise.reject(codeConflict);
  await assert.rejects(
    () =>
      createSourceFacilityService(exhausted.repo, exhausted.connect).create(
        validateSourceFacilityCreate({ name: "A" }),
        principal,
      ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 503 &&
      !error.message.includes("private-driver-value"),
  );
  assert.equal(exhausted.attempts(), 3);
  assert.equal(exhausted.rows.length, 0);
  const overflow = fixture([
    facility({ facilityCode: "FP-SF-" + "9".repeat(74) }),
  ]);
  await assert.rejects(
    () =>
      createSourceFacilityService(overflow.repo, overflow.connect).create(
        validateSourceFacilityCreate({ name: "Overflow" }),
        principal,
      ),
    statusIs(503),
  );
  assert.equal(overflow.rows.length, 1);
  assert(!overflow.calls.some((call) => call.operation === "create"));
});

void test("source facility write error adapter distinguishes proven name constraints from generated-code conflicts", () => {
  for (const error of [
    { code: "P2002", meta: { target: ["supplierId", "name"] } },
    {
      code: "P2002",
      meta: { target: "source_facilities_supplier_id_name_key" },
    },
    { code: "23505", constraint: "source_facilities_supplier_id_name_key" },
    {
      code: "P2002",
      meta: {
        driverAdapterError: {
          cause: {
            originalCode: "23505",
            constraint: { fields: ["supplier_id", "name"] },
          },
        },
      },
    },
  ])
    assert.throws(() => sourceFacilityWriteError(error), statusIs(409));
  for (const error of [
    { code: "P2002", meta: { target: ["supplierId", "facilityCode"] } },
    { code: "P2002", meta: { target: "uq_source_facility_supplier_code" } },
    { code: "P2002" },
    new Error("private SQL"),
  ])
    assert.throws(
      () => sourceFacilityWriteError(error),
      (actual: unknown) => actual === error,
    );
});

void test("source facility create HTTP normalizes input and returns generated code with safe projection", async (context) => {
  const f = fixture();
  const app = express();
  app.use(express.json());
  app.use(
    "/api/source-facilities",
    createSourceFacilityRouter(
      createSourceFacilityService(f.repo, f.connect),
      (req, _res, next) => {
        req.auth = principal;
        next();
      },
    ),
  );
  app.use(notFoundHandler);
  app.use(globalErrorHandler);
  const http = await startHttp(app);
  context.after(() => http.close());
  const result = await http.request("/api/source-facilities", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "  Cơ sở rau A  ",
      contactPhone: "  +84901234567  ",
      contactEmail: " ",
    }),
  });
  assert.equal(result.status, 201);
  const envelope = result.body as {
    success: boolean;
    statusCode: number;
    data: Record<string, unknown>;
  };
  assert.equal(envelope.success, true);
  assert.equal(envelope.statusCode, 201);
  assert.equal(envelope.data.facilityCode, "FP-SF-00001");
  assert.equal(envelope.data.supplierId, supplierId);
  assert.equal(envelope.data.name, "Cơ sở rau A");
  assert.equal(envelope.data.contactPhone, "+84901234567");
  assert.equal(envelope.data.contactEmail, null);
  assert.equal(envelope.data.address, null);
  assert.equal(envelope.data.status, "ACTIVE");
  assert.equal(envelope.data.isVisible, true);
  assert.equal(envelope.data.createdAt, timestamp.toISOString());
  assert.equal(envelope.data.updatedAt, timestamp.toISOString());
  assert(!JSON.stringify(envelope).includes("private-persistence-value"));
  assert(!("createdByUserId" in envelope.data));
  assert(!("updatedByUserId" in envelope.data));
  assert.equal(f.rows[0].createdByUserId, principal.id);
  assert.equal(f.rows[0].updatedByUserId, principal.id);
});

void test("source facility read validation preserves pagination bounds and requires UUID target params", () => {
  assert.deepEqual(validateSourceFacilityQuery({}), { page: 1, limit: 20 });
  assert.deepEqual(validateSourceFacilityQuery({ page: "2", limit: "100" }), {
    page: 2,
    limit: 100,
  });
  for (const query of [
    { page: "0" },
    { page: "-1" },
    { page: "1.1" },
    { page: "1\n" },
    { page: ["1"] },
    { page: 1 },
    { page: "9007199254740993" },
    { page: "2147483649", limit: "1" },
    { limit: "101" },
    { limit: "0" },
    { supplierId },
    { search: "rau" },
    { status: "ACTIVE" },
    { sort: "name" },
  ])
    assert.throws(
      () => validateSourceFacilityQuery(query),
      RequestValidationError,
    );
  assert.deepEqual(
    validateSourceFacilityParams({
      sourceFacilityId: sourceFacilityId.toUpperCase(),
    }),
    { sourceFacilityId },
  );
  for (const params of [
    { sourceFacilityId: "FP-SF-00001" },
    { sourceFacilityId: "bad-id" },
    { sourceFacilityId: sourceFacilityId + "\n" },
    {},
    { sourceFacilityId, supplierId },
  ])
    assert.throws(
      () => validateSourceFacilityParams(params),
      RequestValidationError,
    );
});

void test("source facility read pages 45 own records without excluding inactive or invisible legacy rows", async () => {
  const own = Array.from({ length: 45 }, (_, index) =>
    facility({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-" + String(index + 1).padStart(12, "0"),
      name: "Cơ sở " + String(index + 1),
      status: index % 2 === 0 ? "ACTIVE" : "INACTIVE",
      isVisible: index % 3 !== 0,
      facilityCode:
        index === 0 ? null : "FP-SF-" + String(index + 1).padStart(5, "0"),
    }),
  );
  const f = fixture([
    ...own,
    facility({
      id: "44444444-4444-4444-8444-444444444444",
      supplierId: otherSupplierId,
    }),
  ]);
  const service = createSourceFacilityService(f.repo, f.connect);
  const first = await service.getAll({ page: 1, limit: 20 }, principal);
  const second = await service.getAll({ page: 2, limit: 20 }, principal);
  const third = await service.getAll({ page: 3, limit: 20 }, principal);
  const beyond = await service.getAll({ page: 4, limit: 20 }, principal);
  assert.deepEqual(
    [first.items.length, second.items.length, third.items.length],
    [20, 20, 5],
  );
  assert.deepEqual(
    [
      first.pagination.hasNext,
      second.pagination.hasNext,
      third.pagination.hasNext,
    ],
    [true, true, false],
  );
  assert.deepEqual(beyond.items, []);
  assert.equal(beyond.pagination.hasNext, false);
  const all = [...first.items, ...second.items, ...third.items];
  assert.equal(new Set(all.map((row) => row.id)).size, 45);
  assert(all.every((row) => row.supplierId === supplierId));
  assert.equal(first.items[0].facilityCode, null);
  assert(all.some((row) => row.status === "INACTIVE"));
  assert(all.some((row) => row.isVisible === false));
  assert.deepEqual(
    Object.keys(first.items[0]).sort(),
    [
      "id",
      "supplierId",
      "facilityCode",
      "name",
      "status",
      "isVisible",
      "createdAt",
      "updatedAt",
    ].sort(),
  );
  assert.equal(first.items[0].createdAt, timestamp.toISOString());
});

void test("source facility detail uses own UUID, safe output and indistinguishable cross-tenant not-found", async () => {
  const foreignId = "44444444-4444-4444-8444-444444444444";
  const f = fixture([
    facility({ facilityCode: null }),
    facility({
      id: foreignId,
      supplierId: otherSupplierId,
      name: "private-other-facility",
    }),
  ]);
  const service = createSourceFacilityService(f.repo, f.connect);
  const detail = await service.getDetail({ sourceFacilityId }, principal);
  assert.equal(detail.facilityCode, null);
  assert.deepEqual(
    Object.keys(detail).sort(),
    [
      "id",
      "supplierId",
      "facilityCode",
      "name",
      "address",
      "contactName",
      "contactPhone",
      "contactEmail",
      "status",
      "isVisible",
      "createdAt",
      "updatedAt",
    ].sort(),
  );
  for (const id of [foreignId, "55555555-5555-4555-8555-555555555555"])
    await assert.rejects(
      () => service.getDetail({ sourceFacilityId: id }, principal),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 404 &&
        error.message === "Không tìm thấy cơ sở cung cấp",
    );
  assert.equal(
    f.rows[0].facilityCode,
    null,
    "reading legacy records must not assign a code",
  );
});

void test("source facility read HTTP rejects unsupported query before persistence and returns structured 404", async (context) => {
  const f = await httpFixture(context, fixture([facility()]));
  const invalid = await f.http.request(
    "/api/source-facilities?supplierId=private-untrusted-tenant&limit=101",
  );
  assert.equal(invalid.status, 400);
  const fields = object(object(invalid.body).error).fields;
  assert(Array.isArray(fields));
  assert.deepEqual(fields.map((value: unknown) => object(value).field).sort(), [
    "limit",
    "supplierId",
  ]);
  assert(!JSON.stringify(invalid.body).includes("private-untrusted-tenant"));
  assert(!f.calls.some((call) => call.operation === "list"));
  const detail = await f.http.request(
    "/api/source-facilities/" + sourceFacilityId,
  );
  assert.equal(detail.status, 200);
  const missing = await f.http.request(
    "/api/source-facilities/55555555-5555-4555-8555-555555555555",
  );
  assert.equal(missing.status, 404);
  assert.equal(object(missing.body).message, "Không tìm thấy cơ sở cung cấp");
  assert.equal(
    (await f.http.request("/api/source-facilities/FP-SF-00001")).status,
    400,
  );
});

void test("source facility repository scopes read and lock operations to trusted supplier and keeps numeric scalar exact", async () => {
  const queries: { operation: string; args: Record<string, unknown> }[] = [];
  const bindings: unknown[][] = [];
  const tx = {
    $queryRaw: (_parts: TemplateStringsArray, ...values: unknown[]) => {
      bindings.push(values);
      return Promise.resolve([{ highest: "9007199254740993" }]);
    },
    sourceFacility: {
      findFirst: (args: Record<string, unknown>) => {
        queries.push({ operation: "findFirst", args });
        return Promise.resolve(null);
      },
      findMany: (args: Record<string, unknown>) => {
        queries.push({ operation: "findMany", args });
        return Promise.resolve([]);
      },
    },
  } as unknown as Prisma.TransactionClient;
  const repo = createSourceFacilityRepository(() =>
    Promise.resolve(tx as unknown as PrismaClient),
  );
  await repo.list({ supplierId }, { page: 2, limit: 20 });
  await repo.find({ supplierId }, sourceFacilityId, tx);
  await repo.lockSupplier({ supplierId }, tx);
  await repo.lockTarget({ supplierId }, sourceFacilityId, tx);
  assert.equal(
    await repo.highestCodeNumber({ supplierId }, tx),
    9007199254740993n,
  );
  assert.deepEqual(queries[0].args.where, { supplierId });
  assert.equal(queries[0].args.skip, 20);
  assert.equal(queries[0].args.take, 21);
  assert.deepEqual(queries[1].args.where, { id: sourceFacilityId, supplierId });
  assert(
    bindings.every((values) => values.includes(supplierId)),
    "every lock/aggregate must bind the trusted supplier",
  );
});

void test("source facility update HTTP preserves omitted fields, immutable code and inactive status", async (context) => {
  const f = await httpFixture(
    context,
    fixture([
      facility({
        status: "INACTIVE",
        isVisible: false,
        address: "Old address",
        contactPhone: "0900000000",
        contactEmail: "old@example.test",
      }),
    ]),
  );
  const result = await f.http.request(
    "/api/source-facilities/" + sourceFacilityId,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: " New address ", contactEmail: " " }),
    },
  );
  assert.equal(result.status, 200);
  const detail = object(object(result.body).data);
  assert.equal(detail.name, "Cơ sở rau A");
  assert.equal(detail.address, "New address");
  assert.equal(detail.contactPhone, "0900000000");
  assert.equal(detail.contactEmail, null);
  assert.equal(detail.facilityCode, "FP-SF-00001");
  assert.equal(detail.status, "INACTIVE");
  assert.equal(detail.isVisible, false);
  assert.equal(detail.createdAt, timestamp.toISOString());
  assert.equal(f.rows[0].createdByUserId, principal.id);
  assert.equal(f.rows[0].updatedByUserId, principal.id);
  for (const input of [
    {},
    { name: null },
    { name: " " },
    { facilityCode: null },
    { facilityCode: "FP-SF-99999" },
    { supplierId: otherSupplierId },
    { status: "ACTIVE" },
    { isVisible: true },
  ]) {
    const denied = await f.http.request(
      "/api/source-facilities/" + sourceFacilityId,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    assert.equal(denied.status, 400, JSON.stringify(input));
  }
  assert.equal(f.rows[0].facilityCode, "FP-SF-00001");
  assert.equal(f.rows[0].status, "INACTIVE");
});

void test("source facility update validation keeps omit distinct from clearing optional values", () => {
  assert.deepEqual(validateSourceFacilityUpdate({ address: " New " }), {
    address: "New",
  });
  assert.deepEqual(
    validateSourceFacilityUpdate({
      contactEmail: " ",
      contactName: null,
      contactPhone: "",
    }),
    { contactEmail: null, contactName: null, contactPhone: null },
  );
  for (const value of [
    {},
    { name: null },
    { name: " " },
    { facilityCode: null },
    { createdAt: timestamp.toISOString() },
    { contactEmail: "not-an-email" },
    { contactPhone: 901234567 },
    null,
    [],
  ])
    assert.throws(
      () => validateSourceFacilityUpdate(value),
      RequestValidationError,
    );
});

void test("source facility update rechecks target ownership and name uniqueness inside the shared transaction", async () => {
  const otherId = "44444444-4444-4444-8444-444444444444";
  const f = fixture([
    facility(),
    facility({ id: otherId, name: "Reserved", status: "INACTIVE" }),
  ]);
  const service = createSourceFacilityService(f.repo, f.connect);
  await assert.rejects(
    () => service.update({ sourceFacilityId }, { name: "Reserved" }, principal),
    statusIs(409),
  );
  assert.equal(f.rows[0].name, "Cơ sở rau A");
  assert.equal(f.rows[0].updatedAt, timestamp);
  const updated = await service.update(
    { sourceFacilityId },
    { name: "Cơ sở rau A" },
    principal,
  );
  assert.equal(
    updated.name,
    "Cơ sở rau A",
    "retaining own name must exclude current target from duplicate lookup",
  );
  const foreign = { ...principal, supplierId: otherSupplierId };
  f.setActor(foreign);
  await assert.rejects(
    () => service.update({ sourceFacilityId }, { address: "Refused" }, foreign),
    statusIs(404),
  );
  f.setActor({ ...principal, permissions: [] });
  await assert.rejects(
    () =>
      service.update({ sourceFacilityId }, { address: "Refused" }, principal),
    statusIs(403),
  );
  assert.equal(f.rows[0].address, null);
  assert(f.calls.some((call) => call.operation === "lockTarget"));
});

void test("source facility deactivate HTTP is idempotent and preserves code, visibility and creation audit", async (context) => {
  const f = await httpFixture(
    context,
    fixture([facility({ isVisible: false })]),
  );
  const first = await f.http.request(
    "/api/source-facilities/" + sourceFacilityId + "/deactivate",
    { method: "POST" },
  );
  assert.equal(first.status, 200);
  const firstData = object(object(first.body).data);
  assert.equal(firstData.status, "INACTIVE");
  assert.equal(firstData.facilityCode, "FP-SF-00001");
  assert.equal(firstData.isVisible, false);
  assert.equal(firstData.createdAt, timestamp.toISOString());
  assert.equal(f.rows.length, 1);
  const second = await f.http.request(
    "/api/source-facilities/" + sourceFacilityId + "/deactivate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );
  assert.equal(second.status, 200);
  assert.deepEqual(object(object(second.body).data), firstData);
  assert.equal(
    f.calls.filter((call) => call.operation === "deactivate").length,
    1,
  );
  assert.equal(f.rows[0].createdByUserId, principal.id);
  for (const input of [
    null,
    [],
    { status: "INACTIVE" },
    { reason: "No longer used" },
  ]) {
    const invalid = await f.http.request(
      "/api/source-facilities/" + sourceFacilityId + "/deactivate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    assert.equal(invalid.status, 400, JSON.stringify(input));
  }
  const detail = await f.http.request(
    "/api/source-facilities/" + sourceFacilityId,
  );
  assert.equal(detail.status, 200);
  assert.equal(object(object(detail.body).data).status, "INACTIVE");
});

void test("source facility deactivate validation accepts only absent or strict empty object", () => {
  assert.deepEqual(validateSourceFacilityDeactivate(undefined), {});
  assert.deepEqual(validateSourceFacilityDeactivate({}), {});
  for (const value of [
    null,
    [],
    "",
    { status: "INACTIVE" },
    { reason: null },
    { facilityCode: "FP-SF-00001" },
  ])
    assert.throws(
      () => validateSourceFacilityDeactivate(value),
      RequestValidationError,
    );
});

void test("source facility deactivate checks target and live authority and does not release its issued code", async () => {
  const f = fixture([facility()]);
  const service = createSourceFacilityService(f.repo, f.connect);
  const inactive = await service.deactivate(
    { sourceFacilityId },
    {},
    principal,
  );
  assert.equal(inactive.status, "INACTIVE");
  const next = await service.create(
    validateSourceFacilityCreate({ name: "Next" }),
    principal,
  );
  assert.equal(next.facilityCode, "FP-SF-00002");
  const updated = await service.update(
    { sourceFacilityId },
    { address: "Still editable" },
    principal,
  );
  assert.equal(updated.status, "INACTIVE");
  assert.equal(updated.facilityCode, "FP-SF-00001");
  const other = { ...principal, supplierId: otherSupplierId };
  f.setActor(other);
  await assert.rejects(
    () => service.deactivate({ sourceFacilityId }, {}, other),
    statusIs(404),
  );
  f.setActor({ ...principal, permissions: [] });
  await assert.rejects(
    () => service.deactivate({ sourceFacilityId: next.id }, {}, principal),
    statusIs(403),
  );
  assert.equal(f.rows.find((row) => row.id === next.id)?.status, "ACTIVE");
});

void test("source facility HTTP guards all five endpoints even when staff and system possess manage permission", async (context) => {
  const f = await httpFixture(context, fixture([facility()]));
  const endpoints = [
    ["GET", ""],
    ["GET", "/" + sourceFacilityId],
    ["POST", ""],
    ["PATCH", "/" + sourceFacilityId],
    ["POST", "/" + sourceFacilityId + "/deactivate"],
  ];
  const deniedActors: AuthPrincipal[] = [
    { ...principal, role: "INGREDIENT_SUPPLIER_STAFF" },
    { ...testAdmin, permissions: ["source_facility.manage"] },
    { ...principal, permissions: [] },
    { ...principal, schoolId: otherSupplierId },
    { ...principal, supplierId: null },
    { ...principal, communeFoodSafetyUnitId: otherSupplierId },
  ];
  for (const actor of deniedActors) {
    f.setHttpActor(actor);
    for (const [method, suffix] of endpoints)
      assert.equal(
        (await f.http.request("/api/source-facilities" + suffix, { method }))
          .status,
        403,
        actor.role + " " + method + suffix,
      );
  }
  f.setHttpActor(undefined);
  for (const [method, suffix] of endpoints)
    assert.equal(
      (await f.http.request("/api/source-facilities" + suffix, { method }))
        .status,
      401,
    );
  f.setHttpActor(principal);
  f.setSupplierStatus("INACTIVE");
  for (const [method, suffix] of endpoints) {
    const result = await f.http.request("/api/source-facilities" + suffix, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(method === "POST" && suffix === ""
        ? { body: JSON.stringify({ name: "Blocked" }) }
        : {}),
      ...(method === "PATCH"
        ? { body: JSON.stringify({ name: "Blocked" }) }
        : {}),
    });
    assert.equal(result.status, 403, method + suffix);
  }
  assert.equal(f.rows.length, 1);
  assert.equal(f.rows[0].status, "ACTIVE");
});

void test("source facility repositories allowlist writes, bind ownership and preserve generated code on update or stop", async () => {
  const writes: { operation: string; args: Record<string, unknown> }[] = [];
  const tx = {
    sourceFacility: {
      create: (args: Record<string, unknown>) => {
        writes.push({ operation: "create", args });
        return Promise.resolve(facility());
      },
      updateMany: (args: Record<string, unknown>) => {
        writes.push({ operation: "updateMany", args });
        return Promise.resolve({ count: 1 });
      },
      findFirst: () => Promise.resolve(facility()),
    },
  } as unknown as Prisma.TransactionClient;
  const repo = createSourceFacilityRepository();
  const tamperedInput = {
    name: "A",
    supplierId: otherSupplierId,
    facilityCode: "OVERRIDE",
    status: "INACTIVE",
    isVisible: false,
  };
  await repo.create(
    { supplierId },
    tamperedInput,
    principal.id,
    "FP-SF-00001",
    tx,
  );
  const created = object(writes[0].args.data);
  assert.deepEqual(created, {
    name: "A",
    address: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    supplierId,
    facilityCode: "FP-SF-00001",
    status: "ACTIVE",
    isVisible: true,
    createdByUserId: principal.id,
    updatedByUserId: principal.id,
  });
  await repo.update(
    { supplierId },
    sourceFacilityId,
    { address: null },
    principal.id,
    tx,
  );
  assert.deepEqual(writes[1].args.where, { id: sourceFacilityId, supplierId });
  assert.deepEqual(writes[1].args.data, {
    address: null,
    updatedByUserId: principal.id,
  });
  await repo.deactivate({ supplierId }, sourceFacilityId, principal.id, tx);
  assert.deepEqual(writes[2].args.where, {
    id: sourceFacilityId,
    supplierId,
    status: "ACTIVE",
  });
  assert.deepEqual(writes[2].args.data, {
    status: "INACTIVE",
    updatedByUserId: principal.id,
  });
});

void test("source facility read failures and inactive account checks fail closed with sanitized errors", async (context) => {
  context.mock.method(console, "error", () => undefined);
  const f = fixture([facility()]);
  f.repo.list = () =>
    Promise.reject(new Error("postgres://private-driver-credential"));
  await assert.rejects(
    () =>
      createSourceFacilityService(f.repo, f.connect).getAll(
        { page: 1, limit: 20 },
        principal,
      ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 503 &&
      !error.message.includes("private-driver-credential"),
  );
  f.repo.actor = () =>
    Promise.reject(new HttpError(403, "Tài khoản đã bị khóa"));
  await assert.rejects(
    () =>
      createSourceFacilityService(f.repo, f.connect).update(
        { sourceFacilityId },
        { name: "Blocked" },
        principal,
      ),
    statusIs(403),
  );
  assert.equal(f.rows[0].name, "Cơ sở rau A");
});
