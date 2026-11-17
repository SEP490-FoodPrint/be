import assert from "node:assert/strict";
import { once } from "node:events";
import { test, type TestContext } from "node:test";
import express from "express";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import type { AuthPrincipal } from "../src/types/auth";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import { HttpError } from "../src/utils/http-error";
import { RequestValidationError } from "../src/utils/request-validation";
import {
  createSupplierSchoolRepository,
  type ContractDocumentContentRow,
  type LinkedSchoolDetailRow,
  type LinkedSchoolListRow,
  type SchoolContractRow,
  type SupplierSchoolRepository,
} from "../src/modules/supplier-school/supplier-school.repository";
import {
  createSupplierSchoolService,
  type SupplierSchoolService,
} from "../src/modules/supplier-school/supplier-school.service";
import { createSupplierSchoolRouter } from "../src/modules/supplier-school/supplier-school.routes";
import {
  validateSupplierSchoolContractListQuery,
  validateSupplierSchoolContractParams,
  validateSupplierSchoolDocumentParams,
  validateSupplierSchoolDocumentQuery,
  validateSupplierSchoolEmptyQuery,
  validateSupplierSchoolListQuery,
  validateSupplierSchoolParams,
} from "../src/modules/supplier-school/supplier-school.validation";
import { testAdmin } from "./helpers/authorization";

export const supplierIdA = "22222222-2222-4222-8222-222222222222";
export const supplierIdB = "33333333-3333-4333-8333-333333333333";
export const schoolId1 = "44444444-4444-4444-8444-444444444441";
export const schoolId2 = "44444444-4444-4444-8444-444444444442";
export const contractId1 = "55555555-5555-4555-8555-555555555551";
export const documentId1 = "66666666-6666-4666-8666-666666666661";

export const supplierSchoolPrincipal: AuthPrincipal = {
  ...testAdmin,
  id: "11111111-1111-4111-8111-111111111111",
  username: "supplier-admin-a",
  fullName: "Supplier Admin A",
  role: "INGREDIENT_SUPPLIER_ADMIN",
  orgType: "SUPPLIER",
  schoolId: null,
  supplierId: supplierIdA,
  communeFoodSafetyUnitId: null,
  permissions: ["supplier_relationship.view"],
};

const errorStatus = (status: number) => (error: unknown) =>
  error instanceof HttpError && error.statusCode === status;

export function createReadTransactionHarness() {
  let activeTx: Prisma.TransactionClient | undefined;
  const isolationLevels: string[] = [];
  let transactions = 0;

  const client = {
    async $transaction<T>(
      operation: (tx: Prisma.TransactionClient) => Promise<T>,
      options?: { isolationLevel?: string },
    ): Promise<T> {
      assert.equal(activeTx, undefined, "No nested read transactions");
      assert.equal(
        options?.isolationLevel,
        "RepeatableRead",
        "Reads must use RepeatableRead isolation",
      );
      isolationLevels.push(options.isolationLevel);
      transactions++;
      activeTx = {
        $transactionId: transactions,
      } as unknown as Prisma.TransactionClient;
      try {
        return await operation(activeTx);
      } finally {
        activeTx = undefined;
      }
    },
  } as unknown as PrismaClient;

  return {
    connect: () => Promise.resolve(client),
    assertInTx(tx: Prisma.TransactionClient) {
      assert(activeTx, "Repository read must run inside read transaction");
      assert.equal(tx, activeTx, "Operations must share one read transaction");
    },
    transactions: () => transactions,
    isolationLevels,
  };
}

export function createSupplierSchoolHarness(
  overrides:
    | Partial<SupplierSchoolRepository>
    | ((
        txHarness: ReturnType<typeof createReadTransactionHarness>,
      ) => Partial<SupplierSchoolRepository>) = {},
) {
  const txHarness = createReadTransactionHarness();
  const resolved =
    typeof overrides === "function" ? overrides(txHarness) : overrides;
  const repo: SupplierSchoolRepository = {
    ...createSupplierSchoolRepository(),
    ...resolved,
  };
  const service = createSupplierSchoolService(repo, txHarness.connect);
  return { service, repo, txHarness };
}

export async function startSupplierSchoolApi(
  context: TestContext,
  service: SupplierSchoolService,
  actor: AuthPrincipal | null = supplierSchoolPrincipal,
) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/supplier-schools",
    createSupplierSchoolRouter(service, (req, _res, next) => {
      if (actor) req.auth = actor;
      next();
    }),
  );
  app.use(globalErrorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  const address = server.address();
  assert(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    async request(path: string, init?: RequestInit) {
      const response = await fetch(baseUrl + path, init);
      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") ?? "";
      const isJson = contentType.includes("application/json");
      const body: unknown =
        isJson && buffer.length ? JSON.parse(buffer.toString("utf8")) : null;
      return {
        status: response.status,
        headers: response.headers,
        body,
        buffer,
      };
    },
  };
}

void test("Phase 2 validation normalizes UUIDs, applies strict pagination/empty/disposition rules and aggregates Vietnamese issues without raw values", () => {
  assert.deepEqual(
    validateSupplierSchoolParams({
      schoolId: schoolId1.toUpperCase(),
    }),
    { schoolId: schoolId1 },
  );
  assert.deepEqual(
    validateSupplierSchoolContractParams({
      schoolId: schoolId1.toUpperCase(),
      contractId: contractId1.toUpperCase(),
    }),
    { schoolId: schoolId1, contractId: contractId1 },
  );
  assert.deepEqual(
    validateSupplierSchoolDocumentParams({
      schoolId: schoolId1.toUpperCase(),
      contractId: contractId1.toUpperCase(),
      documentId: documentId1.toUpperCase(),
    }),
    {
      schoolId: schoolId1,
      contractId: contractId1,
      documentId: documentId1,
    },
  );

  for (const validate of [
    validateSupplierSchoolListQuery,
    validateSupplierSchoolContractListQuery,
  ]) {
    assert.deepEqual(validate({}), { page: 1, limit: 20 });
    assert.deepEqual(validate({ page: "2", limit: "100" }), {
      page: 2,
      limit: 100,
    });
    assert.deepEqual(validate({ page: "2147483648", limit: "1" }), {
      page: 2147483648,
      limit: 1,
    });
    for (const bad of [
      { page: "0" },
      { page: "-1" },
      { page: "1.5" },
      { page: " 1" },
      { page: ["1", "2"] },
      { page: { a: "1" } },
      { page: 1 },
      { limit: "0" },
      { limit: "101" },
      { page: "2147483649", limit: "1" },
      { page: "9007199254740992" },
      { limit: "9007199254740992" },
      { supplierId: supplierIdB },
      { orgId: supplierIdB },
      { organizationId: supplierIdB },
      { schoolId: schoolId1 },
      { status: "ACTIVE" },
      { search: "truong" },
    ]) {
      assert.throws(() => validate(bad), errorStatus(400));
    }
  }

  assert.throws(
    () =>
      validateSupplierSchoolListQuery({
        page: "0",
        limit: "101",
        supplierId: "raw-secret-supplier",
      }),
    (error: unknown) => {
      assert(error instanceof RequestValidationError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, "Nội dung yêu cầu không hợp lệ");
      assert.deepEqual(error.fields.map((f) => f.field).sort(), [
        "limit",
        "page",
        "supplierId",
      ]);
      for (const field of error.fields) {
        assert(/[^\u0020-\u007E]/.test(field.message), field.message);
      }
      assert(!JSON.stringify(error.fields).includes("raw-secret-supplier"));
      return true;
    },
  );

  assert.throws(
    () =>
      validateSupplierSchoolDocumentParams({
        schoolId: "bad-school-raw",
        contractId: "bad-contract-raw",
        documentId: "bad-doc-raw",
      }),
    (error: unknown) => {
      assert(error instanceof RequestValidationError);
      assert.deepEqual(error.fields.map((f) => f.field).sort(), [
        "contractId",
        "documentId",
        "schoolId",
      ]);
      const serialized = JSON.stringify(error.fields);
      assert(!serialized.includes("bad-school-raw"));
      assert(!serialized.includes("bad-contract-raw"));
      assert(!serialized.includes("bad-doc-raw"));
      return true;
    },
  );

  assert.deepEqual(validateSupplierSchoolEmptyQuery(undefined), {});
  assert.deepEqual(validateSupplierSchoolEmptyQuery({}), {});
  for (const badEmpty of [
    { page: "1" },
    { supplierId: supplierIdB },
    { orgId: supplierIdB },
    { unknown: ["a"] },
  ]) {
    assert.throws(
      () => validateSupplierSchoolEmptyQuery(badEmpty),
      errorStatus(400),
    );
  }

  assert.deepEqual(validateSupplierSchoolDocumentQuery(undefined), {
    disposition: "inline",
  });
  assert.deepEqual(validateSupplierSchoolDocumentQuery({}), {
    disposition: "inline",
  });
  assert.deepEqual(
    validateSupplierSchoolDocumentQuery({ disposition: "inline" }),
    { disposition: "inline" },
  );
  assert.deepEqual(
    validateSupplierSchoolDocumentQuery({ disposition: "attachment" }),
    { disposition: "attachment" },
  );
  for (const badDisp of [
    { disposition: "INLINE" },
    { disposition: "download" },
    { disposition: ["inline", "attachment"] },
    { disposition: { type: "inline" } },
    { disposition: "inline", supplierId: supplierIdB },
  ]) {
    assert.throws(
      () => validateSupplierSchoolDocumentQuery(badDisp),
      errorStatus(400),
    );
  }
});

void test("Phase 2 router guard rejects unauthenticated and unauthorized actors before validation and direct service checks scope", async (context) => {
  const { service, txHarness } = createSupplierSchoolHarness();
  const unauthenticatedHttp = await startSupplierSchoolApi(
    context,
    service,
    null,
  );
  assert.equal(
    (await unauthenticatedHttp.request("/api/supplier-schools")).status,
    401,
  );

  for (const actor of [
    { ...supplierSchoolPrincipal, permissions: [] },
    { ...supplierSchoolPrincipal, role: "INGREDIENT_SUPPLIER_STAFF" },
    {
      ...testAdmin,
      permissions: [
        "supplier_relationship.view",
        "supplier_relationship.manage",
      ],
    },
  ]) {
    const http = await startSupplierSchoolApi(context, service, actor);
    for (const path of [
      "/api/supplier-schools?page=0&supplierId=bad",
      "/api/supplier-schools/not-a-uuid?extra=1",
      "/api/supplier-schools/not-a-uuid/contracts?limit=999",
      "/api/supplier-schools/not-a-uuid/contracts/not-a-uuid?extra=1",
      "/api/supplier-schools/not-a-uuid/contracts/not-a-uuid/documents/not-a-uuid?disposition=bad",
    ]) {
      const res = await http.request(path);
      assert.equal(res.status, 403, path);
    }
    await assert.rejects(
      () => service.listSchools({ page: 1, limit: 20 }, actor),
      errorStatus(403),
    );
    await assert.rejects(
      () => service.getSchoolDetail({ schoolId: schoolId1 }, actor),
      errorStatus(403),
    );
    await assert.rejects(
      () =>
        service.listContracts(
          { schoolId: schoolId1 },
          { page: 1, limit: 20 },
          actor,
        ),
      errorStatus(403),
    );
    await assert.rejects(
      () =>
        service.getContractDetail(
          { schoolId: schoolId1, contractId: contractId1 },
          actor,
        ),
      errorStatus(403),
    );
    await assert.rejects(
      () =>
        service.getDocumentContent(
          {
            schoolId: schoolId1,
            contractId: contractId1,
            documentId: documentId1,
          },
          { disposition: "inline" },
          actor,
        ),
      errorStatus(403),
    );
  }
  assert.equal(txHarness.transactions(), 0);
});

const schoolListItemKeys = [
  "address",
  "code",
  "email",
  "id",
  "name",
  "phone",
  "relationship",
  "status",
].sort();

function makeSchoolListRow(
  index: number,
  overrides: Partial<LinkedSchoolListRow> = {},
): LinkedSchoolListRow {
  return {
    id: `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`,
    name: `Trường ${index}`,
    code: index % 2 === 0 ? null : `SCH-${String(index).padStart(3, "0")}`,
    address: index % 3 === 0 ? null : `Địa chỉ ${index}`,
    email: index % 3 === 0 ? null : `school${index}@example.test`,
    phone: index % 3 === 0 ? null : `0900000${String(index).padStart(3, "0")}`,
    status: index % 4 === 0 ? ("INACTIVE" as const) : ("ACTIVE" as const),
    relationshipStatus: (["ACTIVE", "SUSPENDED", "UNLINKED"] as const)[
      index % 3
    ],
    linkedAt: new Date(Date.UTC(2026, 10, 1, 12, index, 0)),
    ...overrides,
  };
}

void test("US1 repository uses tagged $queryRaw with DISTINCT ON representative selection before pagination and explicit safe columns", async () => {
  const captured: { sql: string; params: unknown[] }[] = [];
  const fakeTx = {
    $queryRaw(strings: TemplateStringsArray, ...params: unknown[]) {
      captured.push({ sql: strings.join("?"), params });
      return Promise.resolve([]);
    },
    $queryRawUnsafe() {
      assert.fail("Repository must never use $queryRawUnsafe");
    },
  } as unknown as Prisma.TransactionClient;

  const repo = createSupplierSchoolRepository();
  await repo.listLinkedSchools(fakeTx, { supplierId: supplierIdA }, 40, 21);
  assert.equal(captured.length, 1);
  const { sql, params } = captured[0];
  assert.match(sql, /DISTINCT\s+ON\s*\(\s*r\.school_id\s*\)/i);
  assert.match(sql, /r\.supplier_id\s*=\s*\?::uuid/i);
  assert.match(sql, /'ACTIVE'.*'SUSPENDED'/is);
  assert.match(sql, /r\.linked_at\s+DESC/i);
  assert.match(sql, /r\.id\s+ASC/i);
  assert.match(sql, /JOIN\s+foodprint\.schools/i);
  assert.match(sql, /ORDER\s+BY[\s\S]*linkedAt"?\s+DESC[\s\S]*s\.id\s+ASC/i);
  assert.match(sql, /OFFSET\s+\?::bigint/i);
  assert.match(sql, /LIMIT\s+\?::int/i);
  assert(!/SELECT\s+\*/i.test(sql));
  assert(!sql.includes("password"));
  assert(!sql.includes("content"));
  assert(!sql.includes("link_note"));
  assert.deepEqual(params, [supplierIdA, 40, 21]);
});

void test("US1 service listSchools enforces scope, RepeatableRead tx, allowlist mapping, id+code separation and pagination", async () => {
  const rows = Array.from({ length: 21 }, (_, idx) => ({
    ...makeSchoolListRow(idx + 1),
    supplierId: supplierIdA,
    linkNote: "private-link-note",
    passwordHash: "private-secret",
  }));
  const seenCalls: {
    scope: { supplierId: string };
    offset: number;
    limit: number;
  }[] = [];
  const harness = createSupplierSchoolHarness((txHarness) => ({
    listLinkedSchools(
      tx: Prisma.TransactionClient,
      scope: { supplierId: string },
      offset: number,
      limit: number,
    ) {
      txHarness.assertInTx(tx);
      seenCalls.push({ scope, offset, limit });
      return Promise.resolve(rows.slice(offset, offset + limit));
    },
  }));

  const page1 = await harness.service.listSchools(
    { page: 1, limit: 20 },
    {
      ...supplierSchoolPrincipal,
      permissions: ["supplier_relationship.manage"],
    },
  );
  assert.deepEqual(seenCalls[0], {
    scope: { supplierId: supplierIdA },
    offset: 0,
    limit: 21,
  });
  assert.equal(page1.items.length, 20);
  assert.deepEqual(page1.pagination, { page: 1, limit: 20, hasNext: true });
  assert.equal(page1.items[0].id, rows[0].id);
  assert.equal(page1.items[0].code, "SCH-001");
  assert.equal(page1.items[1].id, rows[1].id);
  assert.equal(page1.items[1].code, null);
  assert.notEqual(page1.items[1].code, page1.items[1].id);
  assert.equal(
    page1.items[0].relationship.linkedAt,
    "2026-11-01T12:01:00.000Z",
  );
  for (const item of page1.items) {
    assert.deepEqual(Object.keys(item).sort(), schoolListItemKeys);
    assert.deepEqual(Object.keys(item.relationship).sort(), [
      "linkedAt",
      "status",
    ]);
  }
  assert(!JSON.stringify(page1).includes("private-"));

  const page2 = await harness.service.listSchools(
    { page: 2, limit: 20 },
    supplierSchoolPrincipal,
  );
  assert.equal(page2.items.length, 1);
  assert.deepEqual(page2.pagination, { page: 2, limit: 20, hasNext: false });
});

void test("US1 HTTP list returns envelope, no-store header, empty list, and sanitized 503 on DB error", async (context) => {
  const row = makeSchoolListRow(1);
  const { service } = createSupplierSchoolHarness({
    listLinkedSchools() {
      return Promise.resolve([row]);
    },
  });
  const http = await startSupplierSchoolApi(context, service);
  const res = await http.request("/api/supplier-schools");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(res.body, {
    success: true,
    statusCode: 200,
    message: "Lấy danh sách trường đã liên kết thành công",
    data: {
      items: [
        {
          id: row.id,
          name: row.name,
          code: row.code,
          address: row.address,
          email: row.email,
          phone: row.phone,
          status: row.status,
          relationship: {
            status: row.relationshipStatus,
            linkedAt: row.linkedAt.toISOString(),
          },
        },
      ],
      pagination: { page: 1, limit: 20, hasNext: false },
    },
  });

  const emptyHarness = createSupplierSchoolHarness({
    listLinkedSchools() {
      return Promise.resolve([]);
    },
  });
  const emptyHttp = await startSupplierSchoolApi(context, emptyHarness.service);
  const emptyRes = await emptyHttp.request("/api/supplier-schools");
  assert.equal(emptyRes.status, 200);
  assert.equal(emptyRes.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(emptyRes.body, {
    success: true,
    statusCode: 200,
    message: "Lấy danh sách trường đã liên kết thành công",
    data: {
      items: [],
      pagination: { page: 1, limit: 20, hasNext: false },
    },
  });

  context.mock.method(console, "error", () => undefined);
  const brokenHarness = createSupplierSchoolHarness({
    listLinkedSchools() {
      return Promise.reject(
        new Error("postgresql://secret:password@host/foodprint_db"),
      );
    },
  });
  const brokenHttp = await startSupplierSchoolApi(
    context,
    brokenHarness.service,
  );
  const brokenRes = await brokenHttp.request("/api/supplier-schools");
  assert.equal(brokenRes.status, 503);
  assert(!JSON.stringify(brokenRes.body).includes("secret"));
  assert(!JSON.stringify(brokenRes.body).includes("password"));
});

const schoolDetailKeys = [
  "address",
  "boardingScale",
  "code",
  "coverImageUrl",
  "description",
  "email",
  "id",
  "logoUrl",
  "name",
  "phone",
  "relationship",
  "status",
  "websiteUrl",
].sort();

const schoolDetailRelKeys = [
  "linkedAt",
  "status",
  "suspendedAt",
  "suspensionReason",
  "unlinkReason",
  "unlinkedAt",
].sort();

function makeSchoolDetailRow(
  overrides: Partial<LinkedSchoolDetailRow> = {},
): LinkedSchoolDetailRow {
  return {
    id: schoolId1,
    name: "Trường Tiểu học A",
    code: "SCH-A",
    address: "10 Đường Lê Lợi",
    email: "a@school.test",
    phone: "0901234567",
    status: "ACTIVE" as const,
    description: "Mô tả trường",
    websiteUrl: "https://school-a.example.test",
    logoUrl: "https://cdn.example.test/logo.png",
    coverImageUrl: "https://cdn.example.test/cover.png",
    boardingScale: "500 suất/ngày",
    relationshipStatus: "ACTIVE" as const,
    linkedAt: new Date("2026-11-10T08:00:00.000Z"),
    suspendedAt: null,
    unlinkedAt: null,
    suspensionReason: null,
    unlinkReason: null,
    ...overrides,
  };
}

void test("US2 repository finds school detail scoped by schoolId and trusted supplierId with representative ordering and safe columns", async () => {
  const captured: { sql: string; params: unknown[] }[] = [];
  const fakeTx = {
    $queryRaw(strings: TemplateStringsArray, ...params: unknown[]) {
      captured.push({ sql: strings.join("?"), params });
      return Promise.resolve([]);
    },
    $queryRawUnsafe() {
      assert.fail("Repository must never use $queryRawUnsafe");
    },
  } as unknown as Prisma.TransactionClient;

  const repo = createSupplierSchoolRepository();
  const result = await repo.findLinkedSchoolDetail(
    fakeTx,
    { supplierId: supplierIdA },
    schoolId1,
  );
  assert.equal(result, null);
  assert.equal(captured.length, 1);
  const { sql, params } = captured[0];
  assert.match(sql, /r\.supplier_id\s*=\s*\?::uuid/i);
  assert.match(sql, /r\.school_id\s*=\s*\?::uuid/i);
  assert.match(sql, /'ACTIVE'.*'SUSPENDED'/is);
  assert.match(sql, /r\.linked_at\s+DESC/i);
  assert.match(sql, /r\.id\s+ASC/i);
  assert.match(sql, /JOIN\s+foodprint\.schools/i);
  assert(!/s\.status\s*=\s*'ACTIVE'/i.test(sql));
  assert(!sql.includes("users"));
  assert(!sql.includes("supplier_relationship_events"));
  assert(!sql.includes("link_note"));
  assert.deepEqual(params, [supplierIdA, schoolId1]);
});

void test("US2 service getSchoolDetail enforces scope, RepeatableRead tx, allowlist mapping, nullable fields, and uniform 404", async () => {
  let currentRow: (LinkedSchoolDetailRow & Record<string, unknown>) | null = {
    ...makeSchoolDetailRow({
      status: "INACTIVE",
      code: null,
      description: null,
      websiteUrl: null,
      logoUrl: null,
      coverImageUrl: null,
      boardingScale: null,
      relationshipStatus: "UNLINKED",
      suspendedAt: new Date("2026-11-11T09:00:00.000Z"),
      unlinkedAt: new Date("2026-11-12T10:00:00.000Z"),
      suspensionReason: "Tạm dừng kiểm tra",
      unlinkReason: "Hết năm học",
    }),
    privateNote: "internal-only-note",
    contracts: [{ id: contractId1 }],
  };
  const seenCalls: { scope: { supplierId: string }; schoolId: string }[] = [];
  const harness = createSupplierSchoolHarness((txHarness) => ({
    findLinkedSchoolDetail(
      tx: Prisma.TransactionClient,
      scope: { supplierId: string },
      schoolId: string,
    ) {
      txHarness.assertInTx(tx);
      seenCalls.push({ scope, schoolId });
      return Promise.resolve(currentRow);
    },
  }));

  const detail = await harness.service.getSchoolDetail(
    { schoolId: schoolId1 },
    supplierSchoolPrincipal,
  );
  assert.deepEqual(seenCalls, [
    { scope: { supplierId: supplierIdA }, schoolId: schoolId1 },
  ]);
  assert.deepEqual(Object.keys(detail).sort(), schoolDetailKeys);
  assert.deepEqual(
    Object.keys(detail.relationship).sort(),
    schoolDetailRelKeys,
  );
  assert.equal(detail.status, "INACTIVE");
  assert.equal(detail.code, null);
  assert.equal(detail.description, null);
  assert.equal(detail.websiteUrl, null);
  assert.equal(detail.logoUrl, null);
  assert.equal(detail.coverImageUrl, null);
  assert.equal(detail.boardingScale, null);
  assert.equal(detail.relationship.status, "UNLINKED");
  assert.equal(detail.relationship.linkedAt, "2026-11-10T08:00:00.000Z");
  assert.equal(detail.relationship.suspendedAt, "2026-11-11T09:00:00.000Z");
  assert.equal(detail.relationship.unlinkedAt, "2026-11-12T10:00:00.000Z");
  assert.equal(detail.relationship.suspensionReason, "Tạm dừng kiểm tra");
  assert.equal(detail.relationship.unlinkReason, "Hết năm học");
  assert(!JSON.stringify(detail).includes("internal-only-note"));
  assert(!("contracts" in detail));

  // Same 404 message for missing / out-of-scope school
  currentRow = null;
  const messages: string[] = [];
  for (const id of [schoolId1, schoolId2]) {
    await assert.rejects(
      () =>
        harness.service.getSchoolDetail(
          { schoolId: id },
          supplierSchoolPrincipal,
        ),
      (error: unknown) => {
        if (!(error instanceof HttpError) || error.statusCode !== 404)
          return false;
        messages.push(error.message);
        return (
          error.message === "Không tìm thấy dữ liệu trong phạm vi được phép"
        );
      },
    );
  }
  assert.equal(new Set(messages).size, 1);

  // Direct service rejects forbidden principal without tx
  await assert.rejects(
    () =>
      harness.service.getSchoolDetail(
        { schoolId: schoolId1 },
        { ...supplierSchoolPrincipal, permissions: [] },
      ),
    errorStatus(403),
  );
});

void test("US2 HTTP detail returns envelope, no-store, rejects non-empty query, preserves 404 and sanitizes 503", async (context) => {
  const row = makeSchoolDetailRow();
  let mode: "ok" | "missing" | "dbError" = "ok";
  const { service } = createSupplierSchoolHarness({
    findLinkedSchoolDetail() {
      if (mode === "dbError")
        return Promise.reject(new Error("postgresql://secret:pw@db/foodprint"));
      if (mode === "missing") return Promise.resolve(null);
      return Promise.resolve(row);
    },
  });
  const http = await startSupplierSchoolApi(context, service);

  const ok = await http.request(`/api/supplier-schools/${schoolId1}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(ok.body, {
    success: true,
    statusCode: 200,
    message: "Lấy chi tiết trường đã liên kết thành công",
    data: {
      id: row.id,
      name: row.name,
      code: row.code,
      address: row.address,
      email: row.email,
      phone: row.phone,
      status: row.status,
      description: row.description,
      websiteUrl: row.websiteUrl,
      logoUrl: row.logoUrl,
      coverImageUrl: row.coverImageUrl,
      boardingScale: row.boardingScale,
      relationship: {
        status: row.relationshipStatus,
        linkedAt: row.linkedAt.toISOString(),
        suspendedAt: null,
        unlinkedAt: null,
        suspensionReason: null,
        unlinkReason: null,
      },
    },
  });

  // Extra query rejected 400
  const badQuery = await http.request(
    `/api/supplier-schools/${schoolId1}?supplierId=${supplierIdB}`,
  );
  assert.equal(badQuery.status, 400);

  // Missing / foreign school -> 404
  mode = "missing";
  const missing = await http.request(`/api/supplier-schools/${schoolId2}`);
  assert.equal(missing.status, 404);
  assert.equal(
    (missing.body as { message: string }).message,
    "Không tìm thấy dữ liệu trong phạm vi được phép",
  );

  // DB error -> sanitized 503
  context.mock.method(console, "error", () => undefined);
  mode = "dbError";
  const dbErr = await http.request(`/api/supplier-schools/${schoolId1}`);
  assert.equal(dbErr.status, 503);
  assert(!JSON.stringify(dbErr.body).includes("secret"));
});

const contractKeys = [
  "activatedAt",
  "closeReason",
  "closedAt",
  "documents",
  "endsOn",
  "id",
  "ingredients",
  "number",
  "scopeNote",
  "signedOn",
  "startsOn",
  "status",
].sort();

const docMetaKeys = [
  "createdAt",
  "fileName",
  "id",
  "kind",
  "mimeType",
  "size",
].sort();

function makeContractRow(
  index: number,
  overrides: Partial<SchoolContractRow> = {},
): SchoolContractRow {
  return {
    id: `55555555-5555-4555-8555-${String(index).padStart(12, "0")}`,
    number: index % 2 === 0 ? null : `HD-${String(index).padStart(3, "0")}`,
    status: index % 2 === 0 ? "CLOSED" : "ACTIVE",
    signedOn: new Date("2026-10-01T00:00:00.000Z"),
    startsOn: new Date("2026-11-01T00:00:00.000Z"),
    endsOn: new Date("2026-12-31T00:00:00.000Z"),
    scopeNote: index % 2 === 0 ? null : "Cung cấp rau củ",
    activatedAt: new Date("2026-10-15T08:30:00.000Z"),
    closedAt: index % 2 === 0 ? new Date("2026-11-16T09:00:00.000Z") : null,
    closeReason: index % 2 === 0 ? "Đóng theo kế hoạch" : null,
    items: [
      {
        ingredient: {
          id: "77777777-7777-4777-8777-000000000001",
          name: "Gạo ST25",
        },
      },
    ],
    documents: [
      {
        id: `66666666-6666-4666-8666-${String(index).padStart(12, "0")}`,
        kind: "SIGNED_CONTRACT",
        fileName: "hop-dong.pdf",
        mimeType: "application/pdf",
        size: 1024,
        createdAt: new Date("2026-10-10T07:00:00.000Z"),
      },
    ],
    ...overrides,
  };
}

void test("US3 repository constructs nested relationship/contract/document predicates without selecting bytes, sha256 or uploader", async () => {
  const relQueries: unknown[] = [];
  const contractListQueries: unknown[] = [];
  const contractDetailQueries: unknown[] = [];
  const docContentQueries: unknown[] = [];
  const fakeTx = {
    schoolSupplierRelationship: {
      findFirst(args: unknown) {
        relQueries.push(args);
        return Promise.resolve({ id: "rel-1" });
      },
    },
    supplierContract: {
      findMany(args: unknown) {
        contractListQueries.push(args);
        return Promise.resolve([]);
      },
      findFirst(args: unknown) {
        contractDetailQueries.push(args);
        return Promise.resolve(null);
      },
    },
    supplierContractDocument: {
      findFirst(args: unknown) {
        docContentQueries.push(args);
        return Promise.resolve(null);
      },
    },
  } as unknown as Prisma.TransactionClient;

  const repo = createSupplierSchoolRepository() as unknown as {
    hasSchoolRelationship(
      tx: Prisma.TransactionClient,
      scope: { supplierId: string },
      schoolId: string,
    ): Promise<boolean>;
    listSchoolContracts(
      tx: Prisma.TransactionClient,
      scope: { supplierId: string },
      schoolId: string,
      offset: number,
      limit: number,
    ): Promise<unknown[]>;
    findSchoolContractDetail(
      tx: Prisma.TransactionClient,
      scope: { supplierId: string },
      schoolId: string,
      contractId: string,
    ): Promise<unknown>;
    findContractDocumentContent(
      tx: Prisma.TransactionClient,
      scope: { supplierId: string },
      schoolId: string,
      contractId: string,
      documentId: string,
    ): Promise<unknown>;
  };

  assert.equal(typeof repo.hasSchoolRelationship, "function");
  assert.equal(typeof repo.listSchoolContracts, "function");
  assert.equal(typeof repo.findSchoolContractDetail, "function");
  assert.equal(typeof repo.findContractDocumentContent, "function");

  assert.equal(
    await repo.hasSchoolRelationship(
      fakeTx,
      { supplierId: supplierIdA },
      schoolId1,
    ),
    true,
  );
  assert.deepEqual(relQueries[0], {
    where: { schoolId: schoolId1, supplierId: supplierIdA },
    select: { id: true },
  });

  await repo.listSchoolContracts(
    fakeTx,
    { supplierId: supplierIdA },
    schoolId1,
    20,
    21,
  );
  const listArgs = contractListQueries[0] as Record<string, unknown>;
  assert.deepEqual(listArgs.where, {
    schoolId: schoolId1,
    supplierId: supplierIdA,
    status: { in: ["ACTIVE", "CLOSED"] },
    school: {
      schoolSupplierRelationships: { some: { supplierId: supplierIdA } },
    },
  });
  assert.deepEqual(listArgs.orderBy, [{ createdAt: "desc" }, { id: "asc" }]);
  assert.equal(listArgs.skip, 20);
  assert.equal(listArgs.take, 21);
  const listSelectStr = JSON.stringify(listArgs.select);
  for (const forbidden of [
    "content",
    "sha256",
    "snapshot",
    "uploadedBy",
    "certification",
    "exemptionNote",
    "createdBy",
    "activatedBy",
    "relationshipId",
  ]) {
    assert(!listSelectStr.includes(forbidden), `Forbidden field ${forbidden}`);
  }
  const itemsSelect = (listArgs.select as Record<string, unknown>)
    .items as Record<string, unknown>;
  assert.deepEqual(itemsSelect.orderBy, { ingredientId: "asc" });
  const docsSelect = (listArgs.select as Record<string, unknown>)
    .documents as Record<string, unknown>;
  assert.deepEqual(docsSelect.where, {
    kind: { in: ["SIGNED_CONTRACT", "APPENDIX"] },
  });
  assert.deepEqual(docsSelect.orderBy, [{ createdAt: "asc" }, { id: "asc" }]);

  await repo.findSchoolContractDetail(
    fakeTx,
    { supplierId: supplierIdA },
    schoolId1,
    contractId1,
  );
  const detailArgs = contractDetailQueries[0] as Record<string, unknown>;
  assert.deepEqual(detailArgs.where, {
    id: contractId1,
    schoolId: schoolId1,
    supplierId: supplierIdA,
    status: { in: ["ACTIVE", "CLOSED"] },
    school: {
      schoolSupplierRelationships: { some: { supplierId: supplierIdA } },
    },
  });

  await repo.findContractDocumentContent(
    fakeTx,
    { supplierId: supplierIdA },
    schoolId1,
    contractId1,
    documentId1,
  );
  const docArgs = docContentQueries[0] as Record<string, unknown>;
  assert.deepEqual(docArgs.where, {
    id: documentId1,
    kind: { in: ["SIGNED_CONTRACT", "APPENDIX"] },
    contract: {
      id: contractId1,
      schoolId: schoolId1,
      supplierId: supplierIdA,
      status: { in: ["ACTIVE", "CLOSED"] },
      school: {
        schoolSupplierRelationships: { some: { supplierId: supplierIdA } },
      },
    },
  });
  assert.deepEqual(docArgs.select, {
    id: true,
    fileName: true,
    mimeType: true,
    content: true,
  });
});

void test("US3 service distinguishes parent 404 from empty contracts 200, maps dates/nulls/metadata safely and validates binary content", async () => {
  let hasParent = true;
  const rows = Array.from({ length: 21 }, (_, idx) => ({
    ...makeContractRow(idx + 1),
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    snapshot: { secret: "hidden" },
    relationshipId: "rel-1",
    documents: [
      {
        ...makeContractRow(idx + 1).documents[0],
        content: Uint8Array.from([1, 2, 3]),
        sha256: "abc",
      },
    ],
  }));
  let detailRow: (SchoolContractRow & Record<string, unknown>) | null = rows[0];
  let docRow: ContractDocumentContentRow | null = {
    id: documentId1,
    fileName: "Hợp đồng (2026).pdf",
    mimeType: "application/pdf",
    content: Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]),
  };
  const harness = createSupplierSchoolHarness((txHarness) => ({
    hasSchoolRelationship(tx: Prisma.TransactionClient) {
      txHarness.assertInTx(tx);
      return Promise.resolve(hasParent);
    },
    listSchoolContracts(
      tx: Prisma.TransactionClient,
      _scope: { supplierId: string },
      _schoolId: string,
      offset: number,
      limit: number,
    ) {
      txHarness.assertInTx(tx);
      return Promise.resolve(rows.slice(offset, offset + limit));
    },
    findSchoolContractDetail(tx: Prisma.TransactionClient) {
      txHarness.assertInTx(tx);
      return Promise.resolve(detailRow);
    },
    findContractDocumentContent(tx: Prisma.TransactionClient) {
      txHarness.assertInTx(tx);
      return Promise.resolve(docRow);
    },
  }));

  // Parent missing -> 404 on all 3 operations
  hasParent = false;
  for (const op of [
    () =>
      harness.service.listContracts(
        { schoolId: schoolId1 },
        { page: 1, limit: 20 },
        supplierSchoolPrincipal,
      ),
    () =>
      harness.service.getContractDetail(
        { schoolId: schoolId1, contractId: contractId1 },
        supplierSchoolPrincipal,
      ),
    () =>
      harness.service.getDocumentContent(
        {
          schoolId: schoolId1,
          contractId: contractId1,
          documentId: documentId1,
        },
        { disposition: "inline" },
        supplierSchoolPrincipal,
      ),
  ]) {
    await assert.rejects(
      op,
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 404 &&
        error.message === "Không tìm thấy dữ liệu trong phạm vi được phép",
    );
  }

  // Valid parent -> list page 1/2, allowlist mapping, date-only YYYY-MM-DD, no createdAt/content/sha256
  hasParent = true;
  const page1 = await harness.service.listContracts(
    { schoolId: schoolId1 },
    { page: 1, limit: 20 },
    supplierSchoolPrincipal,
  );
  assert.equal(page1.items.length, 20);
  assert.deepEqual(page1.pagination, { page: 1, limit: 20, hasNext: true });
  assert.deepEqual(Object.keys(page1.items[0]).sort(), contractKeys);
  assert.equal(page1.items[0].signedOn, "2026-10-01");
  assert.equal(page1.items[0].startsOn, "2026-11-01");
  assert.equal(page1.items[0].endsOn, "2026-12-31");
  assert.equal(page1.items[0].activatedAt, "2026-10-15T08:30:00.000Z");
  assert.equal(page1.items[0].closedAt, null);
  assert.equal(page1.items[1].number, null);
  assert.equal(page1.items[1].closedAt, "2026-11-16T09:00:00.000Z");
  assert.equal(page1.items[1].closeReason, "Đóng theo kế hoạch");
  assert.deepEqual(
    Object.keys(page1.items[0].documents[0]).sort(),
    docMetaKeys,
  );
  const serialized = JSON.stringify(page1);
  assert(!serialized.includes('createdAt":"2026-10-01T00:00:00.000Z'));
  assert(!serialized.includes("hidden"));
  assert(!serialized.includes("sha256"));
  assert(!serialized.includes("relationshipId"));

  const detail = await harness.service.getContractDetail(
    { schoolId: schoolId1, contractId: contractId1 },
    supplierSchoolPrincipal,
  );
  assert.deepEqual(Object.keys(detail).sort(), contractKeys);

  detailRow = null;
  await assert.rejects(
    () =>
      harness.service.getContractDetail(
        { schoolId: schoolId1, contractId: contractId1 },
        supplierSchoolPrincipal,
      ),
    errorStatus(404),
  );

  // Document binary DTO allowlist + empty/invalid MIME 503 + missing 404
  const binary = await harness.service.getDocumentContent(
    {
      schoolId: schoolId1,
      contractId: contractId1,
      documentId: documentId1,
    },
    { disposition: "inline" },
    supplierSchoolPrincipal,
  );
  assert.deepEqual(Object.keys(binary).sort(), [
    "content",
    "fileName",
    "mimeType",
  ]);
  assert(binary.content instanceof Uint8Array);
  assert.deepEqual(
    Buffer.from(binary.content),
    Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]),
  );

  docRow = null;
  await assert.rejects(
    () =>
      harness.service.getDocumentContent(
        {
          schoolId: schoolId1,
          contractId: contractId1,
          documentId: documentId1,
        },
        { disposition: "inline" },
        supplierSchoolPrincipal,
      ),
    errorStatus(404),
  );

  for (const invalidDoc of [
    {
      id: documentId1,
      fileName: "empty.pdf",
      mimeType: "application/pdf",
      content: new Uint8Array(0),
    },
    {
      id: documentId1,
      fileName: "bad.html",
      mimeType: "text/html",
      content: Uint8Array.from([1, 2, 3]),
    },
  ]) {
    docRow = invalidDoc;
    await assert.rejects(
      () =>
        harness.service.getDocumentContent(
          {
            schoolId: schoolId1,
            contractId: contractId1,
            documentId: documentId1,
          },
          { disposition: "inline" },
          supplierSchoolPrincipal,
        ),
      errorStatus(503),
    );
  }
});

void test("US3 HTTP contract list, contract detail and binary document endpoints enforce envelopes, RFC5987 headers and error separation", async (context) => {
  const sampleBytes = Buffer.from("%PDF-1.4\nSample PDF content\n");
  let mode:
    | "ok"
    | "emptyContracts"
    | "missingParent"
    | "missingDoc"
    | "emptyBytes"
    | "badMime"
    | "dbError" = "ok";

  const { service } = createSupplierSchoolHarness({
    hasSchoolRelationship() {
      if (mode === "dbError")
        return Promise.reject(new Error("postgresql://secret:pw@db/foodprint"));
      return Promise.resolve(mode !== "missingParent");
    },
    listSchoolContracts() {
      if (mode === "emptyContracts") return Promise.resolve([]);
      return Promise.resolve([makeContractRow(1)]);
    },
    findSchoolContractDetail() {
      return Promise.resolve(makeContractRow(1));
    },
    findContractDocumentContent() {
      if (mode === "missingDoc") return Promise.resolve(null);
      if (mode === "emptyBytes") {
        return Promise.resolve({
          id: documentId1,
          fileName: "empty.pdf",
          mimeType: "application/pdf",
          content: Uint8Array.from([]),
        });
      }
      if (mode === "badMime") {
        return Promise.resolve({
          id: documentId1,
          fileName: "bad.bin",
          mimeType: "application/octet-stream",
          content: Uint8Array.from(sampleBytes),
        });
      }
      return Promise.resolve({
        id: documentId1,
        fileName: 'Hợp đồng\r\n"2026"!.pdf',
        mimeType: "application/pdf",
        content: Uint8Array.from(sampleBytes),
      });
    },
  });

  const http = await startSupplierSchoolApi(context, service);

  const listOk = await http.request(
    `/api/supplier-schools/${schoolId1}/contracts`,
  );
  assert.equal(listOk.status, 200);
  assert.equal(listOk.headers.get("cache-control"), "private, no-store");
  assert.equal(
    (listOk.body as { message: string }).message,
    "Lấy danh sách hợp đồng thành công",
  );

  mode = "emptyContracts";
  const emptyList = await http.request(
    `/api/supplier-schools/${schoolId1}/contracts`,
  );
  assert.equal(emptyList.status, 200);
  assert.deepEqual((emptyList.body as { data: unknown }).data, {
    items: [],
    pagination: { page: 1, limit: 20, hasNext: false },
  });

  mode = "ok";
  const detailOk = await http.request(
    `/api/supplier-schools/${schoolId1}/contracts/${contractId1}`,
  );
  assert.equal(detailOk.status, 200);
  assert.equal(detailOk.headers.get("cache-control"), "private, no-store");
  assert.equal(
    (detailOk.body as { message: string }).message,
    "Lấy chi tiết hợp đồng thành công",
  );

  const badDetailQuery = await http.request(
    `/api/supplier-schools/${schoolId1}/contracts/${contractId1}?extra=1`,
  );
  assert.equal(badDetailQuery.status, 400);

  // Binary inline (default) & attachment -> exact same bytes, safe headers
  for (const [suffix, expectedDisp] of [
    ["", "inline"],
    ["?disposition=inline", "inline"],
    ["?disposition=attachment", "attachment"],
  ] as const) {
    const fileRes = await http.request(
      `/api/supplier-schools/${schoolId1}/contracts/${contractId1}/documents/${documentId1}${suffix}`,
    );
    assert.equal(fileRes.status, 200);
    assert.equal(fileRes.headers.get("content-type"), "application/pdf");
    assert.equal(
      fileRes.headers.get("content-length"),
      String(sampleBytes.byteLength),
    );
    assert.equal(fileRes.headers.get("x-content-type-options"), "nosniff");
    assert.equal(fileRes.headers.get("content-security-policy"), "sandbox");
    assert.equal(fileRes.headers.get("cache-control"), "private, no-store");
    const cd = fileRes.headers.get("content-disposition") ?? "";
    assert(cd.startsWith(`${expectedDisp}; filename="`), cd);
    assert(cd.includes("filename*=UTF-8''"), cd);
    assert(
      ![...cd].some((ch) => {
        const code = ch.charCodeAt(0);
        return code < 32 || code === 127 || code > 126;
      }),
      cd,
    );
    assert.deepEqual(fileRes.buffer, sampleBytes);
  }

  mode = "missingDoc";
  const doc404 = await http.request(
    `/api/supplier-schools/${schoolId1}/contracts/${contractId1}/documents/${documentId1}`,
  );
  assert.equal(doc404.status, 404);
  assert.match(doc404.headers.get("content-type") ?? "", /application\/json/);

  context.mock.method(console, "error", () => undefined);
  for (const errMode of ["emptyBytes", "badMime", "dbError"] as const) {
    mode = errMode;
    const errRes = await http.request(
      `/api/supplier-schools/${schoolId1}/contracts/${contractId1}/documents/${documentId1}`,
    );
    assert.equal(errRes.status, 503);
    assert.match(errRes.headers.get("content-type") ?? "", /application\/json/);
    assert.equal(errRes.headers.get("content-disposition"), null);
    assert(!JSON.stringify(errRes.body).includes("secret"));
  }
});
