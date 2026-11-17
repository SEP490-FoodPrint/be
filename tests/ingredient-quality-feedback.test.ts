import assert from "node:assert/strict";
import { once } from "node:events";
import { test, type TestContext } from "node:test";
import express from "express";
import { MemoryStore } from "express-rate-limit";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import type { AuthPrincipal } from "../src/types/auth";
import { createApp } from "../src/app";
import { createApiRateLimiter } from "../src/middlewares/rate-limit.middleware";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import {
  createIngredientQualityFeedbackRepository,
  type IngredientQualityFeedbackRepository,
  type SupplierFeedbackListRow,
} from "../src/modules/ingredient-quality-feedback/ingredient-quality-feedback.repository";
import {
  createIngredientQualityFeedbackService,
  type IngredientQualityFeedbackService,
} from "../src/modules/ingredient-quality-feedback/ingredient-quality-feedback.service";
import { HttpError } from "../src/utils/http-error";
import { RequestValidationError } from "../src/utils/request-validation";
import {
  validateIngredientQualityFeedbackEmptyQuery,
  validateIngredientQualityFeedbackListQuery,
  validateIngredientQualityFeedbackParams,
  validateIngredientQualityFeedbackResponseBody,
} from "../src/modules/ingredient-quality-feedback/ingredient-quality-feedback.validation";
import { createIngredientQualityFeedbackRouter } from "../src/modules/ingredient-quality-feedback/ingredient-quality-feedback.routes";
import { testAdmin, testStaff } from "./helpers/authorization";

export const supplierIdA = "22222222-2222-4222-8222-222222222222";
export const supplierIdB = "33333333-3333-4333-8333-333333333333";
export const schoolIdX = "44444444-4444-4444-8444-444444444441";
export const schoolIdY = "44444444-4444-4444-8444-444444444442";
export const deliveryId1 = "55555555-5555-4555-8555-555555555551";
export const feedbackId1 = "66666666-6666-4666-8666-666666666661";
export const lotId1 = "77777777-7777-4777-8777-777777777771";

export const supplierAdminA: AuthPrincipal = {
  ...testAdmin,
  id: "11111111-1111-4111-8111-111111111111",
  username: "supplier-admin-a",
  fullName: "Supplier Admin A",
  roleId: "11111111-1111-4111-8111-111111111191",
  role: "INGREDIENT_SUPPLIER_ADMIN",
  orgType: "SUPPLIER",
  schoolId: null,
  supplierId: supplierIdA,
  communeFoodSafetyUnitId: null,
  permissions: [
    "ingredient_quality_feedback.view_details",
    "ingredient_quality_feedback.respond",
  ],
};

export const supplierStaffA: AuthPrincipal = {
  ...supplierAdminA,
  id: "11111111-1111-4111-8111-111111111112",
  username: "supplier-staff-a",
  fullName: "Supplier Staff A",
  roleId: "11111111-1111-4111-8111-111111111192",
  role: "INGREDIENT_SUPPLIER_STAFF",
};

export const schoolUserX: AuthPrincipal = {
  ...testStaff,
  id: "11111111-1111-4111-8111-111111111113",
  username: "school-staff-x",
  fullName: "School Staff X",
  roleId: "11111111-1111-4111-8111-111111111193",
  role: "SCHOOL_KITCHEN_STAFF",
  orgType: "SCHOOL",
  schoolId: schoolIdX,
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: ["ingredient_quality_feedback.view_details"],
};

export function createTransactionHarness() {
  let activeTx: Prisma.TransactionClient | undefined;
  const isolationLevels: string[] = [];
  let transactions = 0;

  const client = {
    async $transaction<T>(
      operation: (tx: Prisma.TransactionClient) => Promise<T>,
      options?: { isolationLevel?: string },
    ): Promise<T> {
      assert.equal(activeTx, undefined, "No nested transactions in harness");
      if (options?.isolationLevel) {
        isolationLevels.push(options.isolationLevel);
      }
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
    client,
    assertInTx(tx?: Prisma.TransactionClient) {
      assert(activeTx, "Repository call must run inside active transaction");
      assert.equal(tx, activeTx, "Operations must share one transaction");
    },
    transactions: () => transactions,
    isolationLevels,
  };
}

export function createIngredientQualityFeedbackHarness(
  overrides:
    | Partial<IngredientQualityFeedbackRepository>
    | ((
        txHarness: ReturnType<typeof createTransactionHarness>,
      ) => Partial<IngredientQualityFeedbackRepository>) = {},
) {
  const txHarness = createTransactionHarness();
  const resolved =
    typeof overrides === "function" ? overrides(txHarness) : overrides;
  const repository: IngredientQualityFeedbackRepository = {
    ...createIngredientQualityFeedbackRepository(),
    ...resolved,
  };
  const service = createIngredientQualityFeedbackService(
    repository,
    txHarness.connect,
  );
  return { service, repository, txHarness };
}

export async function startIngredientQualityFeedbackApi(
  context: TestContext,
  service: IngredientQualityFeedbackService,
  actor: AuthPrincipal | null = supplierAdminA,
) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/ingredient-quality-feedback",
    createIngredientQualityFeedbackRouter(service, (req, _res, next) => {
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
      const text = await response.text();
      const contentType = response.headers.get("content-type") ?? "";
      const isJson = contentType.includes("application/json");
      const body: unknown = isJson && text ? JSON.parse(text) : null;
      return {
        status: response.status,
        headers: response.headers,
        body,
      };
    },
  };
}

void test("Setup baseline harness mounts GET /api/ingredient-quality-feedback cleanly", async (context) => {
  const { service } = createIngredientQualityFeedbackHarness({
    listLegacy: async () => Promise.resolve([]),
  });
  const api = await startIngredientQualityFeedbackApi(
    context,
    service,
    schoolUserX,
  );
  const res = await api.request("/api/ingredient-quality-feedback");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    success: true,
    statusCode: 200,
    message: "Lấy danh sách phản hồi chất lượng nguyên liệu thành công",
    data: {
      items: [],
      pagination: { page: 1, limit: 20, hasNext: false },
    },
  });
});

void test("T016 validation rejects unknown fields, non-UUID FP-CP paths, invalid pagination, and non-compliant supplierResponse without reflecting raw input", () => {
  assert.deepEqual(validateIngredientQualityFeedbackListQuery(undefined), {
    page: 1,
    limit: 20,
  });
  assert.deepEqual(
    validateIngredientQualityFeedbackListQuery({
      page: "214748365",
      limit: "10",
    }),
    { page: 214748365, limit: 10 },
  );
  assert.deepEqual(
    validateIngredientQualityFeedbackListQuery({ page: "1", limit: "100" }),
    { page: 1, limit: 100 },
  );
  assert.deepEqual(
    validateIngredientQualityFeedbackParams({
      feedbackId: feedbackId1.toUpperCase(),
    }),
    { feedbackId: feedbackId1 },
  );
  assert.deepEqual(validateIngredientQualityFeedbackEmptyQuery(undefined), {});
  assert.deepEqual(validateIngredientQualityFeedbackEmptyQuery({}), {});

  // Trim outer whitespace only, keep internal newlines and precomposed/decomposed Unicode as-is, count code points.
  const decomposedUnicode = "Ph\u0061\u0302n ho\u0302\u0300i";
  assert.deepEqual(
    validateIngredientQualityFeedbackResponseBody({
      supplierResponse: ` \t\n ${decomposedUnicode}\nDòng 2 \r\n `,
    }),
    { supplierResponse: `${decomposedUnicode}\nDòng 2` },
  );
  assert.deepEqual(
    validateIngredientQualityFeedbackResponseBody({ supplierResponse: "A" }),
    { supplierResponse: "A" },
  );
  // 5000 emoji code points = 10000 UTF-16 code units -> must PASS Unicode code point limit 5000.
  const maxEmoji = "😀".repeat(5000);
  assert.equal(
    validateIngredientQualityFeedbackResponseBody({
      supplierResponse: maxEmoji,
    }).supplierResponse,
    maxEmoji,
  );
  assert.equal(
    validateIngredientQualityFeedbackResponseBody({
      supplierResponse: `  ${maxEmoji}  `,
    }).supplierResponse,
    maxEmoji,
  );

  // Over limit 5001 code points rejected without reflecting input text.
  const sensitiveOver = `SECRET_TOKEN_${"😀".repeat(5001)}`;
  assert.throws(
    () =>
      validateIngredientQualityFeedbackResponseBody({
        supplierResponse: sensitiveOver,
      }),
    (error: unknown) => {
      assert(error instanceof RequestValidationError);
      assert.equal(error.statusCode, 400);
      assert.deepEqual(error.fields, [
        {
          field: "supplierResponse",
          message: "Phản hồi nhà cung cấp chỉ nhận tối đa 5000 ký tự",
        },
      ]);
      assert(!JSON.stringify(error).includes("SECRET_TOKEN"));
      return true;
    },
  );

  // Reject blank, whitespace-only, null, non-string, and non-object bodies.
  for (const badBody of [
    undefined,
    null,
    "text",
    [],
    {},
    { supplierResponse: null },
    { supplierResponse: 123 },
    { supplierResponse: "" },
    { supplierResponse: "  \n\t  " },
    { supplierResponse: true },
  ]) {
    assert.throws(
      () => validateIngredientQualityFeedbackResponseBody(badBody),
      (error: unknown) =>
        error instanceof RequestValidationError && error.statusCode === 400,
    );
  }

  // Multi-field errors report exact field paths in Vietnamese without echoing raw secrets.
  assert.throws(
    () =>
      validateIngredientQualityFeedbackResponseBody({
        supplierResponse: "   ",
        complaintCode: "FP-CP-00001",
        status: "RESPONDED",
        respondedByUserId: "spoof-actor",
        respondedAt: "2026-01-01T00:00:00Z",
        schoolId: schoolIdX,
        supplierId: supplierIdA,
      }),
    (error: unknown) => {
      assert(error instanceof RequestValidationError);
      const fields = error.fields.map((f) => f.field);
      assert(fields.includes("supplierResponse"));
      assert(fields.includes("complaintCode"));
      assert(fields.includes("status"));
      assert(fields.includes("respondedByUserId"));
      assert(fields.includes("respondedAt"));
      assert(fields.includes("schoolId"));
      assert(fields.includes("supplierId"));
      assert(error.fields.every((f) => /[^\u0020-\u007E]/.test(f.message)));
      assert(!JSON.stringify(error.fields).includes("spoof-actor"));
      assert(!JSON.stringify(error.fields).includes("FP-CP-00001"));
      return true;
    },
  );

  // FP-CP code cannot replace UUID path; strict list query and empty query reject unknown keys & overflow.
  for (const badFeedbackId of [
    "FP-CP-00001",
    "fp-cp-00001",
    "not-a-uuid",
    "66666666-6666-4666-8666-66666666666",
  ]) {
    assert.throws(
      () =>
        validateIngredientQualityFeedbackParams({ feedbackId: badFeedbackId }),
      (error: unknown) =>
        error instanceof RequestValidationError &&
        error.statusCode === 400 &&
        error.fields.some((f) => f.field === "feedbackId") &&
        !JSON.stringify(error.fields).includes(badFeedbackId),
    );
  }
  assert.throws(
    () =>
      validateIngredientQualityFeedbackParams({
        feedbackId: feedbackId1,
        extra: "forbidden",
      }),
    (error: unknown) =>
      error instanceof RequestValidationError &&
      error.fields.some((f) => f.field === "extra"),
  );
  for (const badQuery of [
    { page: "0" },
    { limit: "101" },
    { page: "214748366", limit: "10" },
    { page: ["1", "2"] },
    { complaintCode: "FP-CP-00001" },
    { schoolId: schoolIdX },
    { supplierId: supplierIdA },
    { status: "SUBMITTED" },
  ]) {
    assert.throws(
      () => validateIngredientQualityFeedbackListQuery(badQuery),
      (error: unknown) =>
        error instanceof RequestValidationError && error.statusCode === 400,
    );
  }
  assert.throws(
    () =>
      validateIngredientQualityFeedbackListQuery({
        page: "0",
        limit: "101",
        complaintCode: "FP-CP-00001",
      }),
    (error: unknown) => {
      assert(error instanceof RequestValidationError);
      const fields = error.fields.map((f) => f.field);
      assert(fields.includes("page"));
      assert(fields.includes("limit"));
      assert(fields.includes("complaintCode"));
      return true;
    },
  );
  assert.throws(
    () => validateIngredientQualityFeedbackEmptyQuery({ page: "1" }),
    (error: unknown) =>
      error instanceof RequestValidationError &&
      error.fields.some((f) => f.field === "page"),
  );
});

void test("T018 baseline legacy SCHOOL and SYSTEM list keeps 10 fields, explicit ISO serialization, id ASC ordering and pagination without exposing supplierResponse or complaintCode", async (context) => {
  const created = new Date("2026-10-01T08:00:00.000Z");
  const updated = new Date("2026-10-02T09:00:00.000Z");
  const responded = new Date("2026-10-02T08:30:00.000Z");
  const observedScopes: unknown[] = [];
  const { service } = createIngredientQualityFeedbackHarness({
    listLegacy: async (scope, skip, take) => {
      observedScopes.push({ scope, skip, take });
      return Promise.resolve([
        {
          id: feedbackId1,
          deliveryId: deliveryId1,
          ingredientLotId: lotId1,
          submittedByUserId: schoolUserX.id,
          title: "Cải bó xôi bị dập",
          description: "Một số thùng có lá úa",
          status: "RESPONDED",
          respondedAt: responded,
          createdAt: created,
          updatedAt: updated,
        },
        {
          id: "66666666-6666-4666-8666-666666666662",
          deliveryId: deliveryId1,
          ingredientLotId: null,
          submittedByUserId: schoolUserX.id,
          title: "Thiếu chứng từ",
          description: "Bổ sung hóa đơn",
          status: "SUBMITTED",
          respondedAt: null,
          createdAt: created,
          updatedAt: updated,
        },
      ]);
    },
  });

  // School with view_own -> submittedByUserId restricted
  const schoolOwn = {
    ...schoolUserX,
    permissions: ["ingredient_quality_feedback.view_own"],
  };
  const apiOwn = await startIngredientQualityFeedbackApi(
    context,
    service,
    schoolOwn,
  );
  const resOwn = await apiOwn.request(
    "/api/ingredient-quality-feedback?page=1&limit=1",
  );
  assert.equal(resOwn.status, 200);
  assert.deepEqual(observedScopes[0], {
    scope: {
      kind: "SCHOOL",
      schoolId: schoolIdX,
      submittedByUserId: schoolUserX.id,
    },
    skip: 0,
    take: 2,
  });
  const bodyOwn = resOwn.body as {
    data: { items: Record<string, unknown>[]; pagination: unknown };
  };
  assert.equal(bodyOwn.data.items.length, 1);
  assert.deepEqual(Object.keys(bodyOwn.data.items[0]).sort(), [
    "createdAt",
    "deliveryId",
    "description",
    "id",
    "ingredientLotId",
    "respondedAt",
    "status",
    "submittedByUserId",
    "title",
    "updatedAt",
  ]);
  assert.deepEqual(bodyOwn.data.items[0], {
    id: feedbackId1,
    deliveryId: deliveryId1,
    ingredientLotId: lotId1,
    submittedByUserId: schoolUserX.id,
    title: "Cải bó xôi bị dập",
    description: "Một số thùng có lá úa",
    status: "RESPONDED",
    respondedAt: responded.toISOString(),
    createdAt: created.toISOString(),
    updatedAt: updated.toISOString(),
  });
  assert.deepEqual(bodyOwn.data.pagination, {
    page: 1,
    limit: 1,
    hasNext: true,
  });

  // SYSTEM with permission -> SYSTEM scope legacy projection
  const systemAdmin = {
    ...testAdmin,
    permissions: ["ingredient_quality_feedback.view_details"],
  };
  const apiSystem = await startIngredientQualityFeedbackApi(
    context,
    service,
    systemAdmin,
  );
  const resSys = await apiSystem.request("/api/ingredient-quality-feedback");
  assert.equal(resSys.status, 200);
  assert.deepEqual(observedScopes[1], {
    scope: { kind: "SYSTEM" },
    skip: 0,
    take: 21,
  });

  // Read rejection returns safe 503 via readListPage without raw connection leak
  const failing = createIngredientQualityFeedbackHarness({
    listLegacy: async () =>
      Promise.reject(new Error("postgresql://secret:pass@db/foodprint")),
  });
  const apiFail = await startIngredientQualityFeedbackApi(
    context,
    failing.service,
    schoolUserX,
  );
  const resFail = await apiFail.request("/api/ingredient-quality-feedback");
  assert.equal(resFail.status, 503);
  assert(!JSON.stringify(resFail.body).includes("secret"));
});

void test("T019 US1 supplier GET list returns exact allowlist with UUID + stored complaintCode, enforces 401/403/no-store and never invokes allocator", async (context) => {
  const created1 = new Date("2026-10-10T10:00:00.000Z");
  const responded1 = new Date("2026-10-10T11:00:00.000Z");
  const created2 = new Date("2026-10-09T09:00:00.000Z");
  let allocatorCalls = 0;
  const repoCalls: unknown[] = [];
  const sampleRows: SupplierFeedbackListRow[] = [
    {
      id: feedbackId1,
      complaintCode: "FP-CP-00012",
      title: "Rau cải bị úa",
      status: "RESPONDED",
      createdAt: created1,
      respondedAt: responded1,
      Delivery: {
        id: deliveryId1,
        deliveryNo: "FP-DE-00001",
        School: { id: schoolIdX, name: "Trường X", code: "SCH-DUP" },
      },
    },
    {
      id: "66666666-6666-4666-8666-666666666662",
      complaintCode: "FP-CP-100001",
      title: "Thiếu chứng từ lô gạo",
      status: "SUBMITTED",
      createdAt: created2,
      respondedAt: null,
      Delivery: {
        id: "55555555-5555-4555-8555-555555555552",
        deliveryNo: "FP-DE-00002",
        School: { id: schoolIdY, name: "Trường Y", code: null },
      },
    },
    {
      id: "66666666-6666-4666-8666-666666666663",
      complaintCode: "FP-CP-00003",
      title: "Trang sau",
      status: "SUBMITTED",
      createdAt: created2,
      respondedAt: null,
      Delivery: {
        id: deliveryId1,
        deliveryNo: "FP-DE-00001",
        School: { id: schoolIdX, name: "Trường X", code: "SCH-DUP" },
      },
    },
  ];

  const { service } = createIngredientQualityFeedbackHarness({
    nextComplaintCodeSequence: async () => {
      allocatorCalls++;
      return Promise.resolve(999n);
    },
    listSupplier: async (scope, skip, take) => {
      repoCalls.push({ scope, skip, take });
      return Promise.resolve(sampleRows.slice(skip, skip + take));
    },
  });

  for (const actor of [
    supplierAdminA,
    {
      ...supplierStaffA,
      permissions: ["ingredient_quality_feedback.view_details"],
    },
  ]) {
    const api = await startIngredientQualityFeedbackApi(
      context,
      service,
      actor,
    );
    const res = await api.request(
      "/api/ingredient-quality-feedback?page=1&limit=2",
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(res.body, {
      success: true,
      statusCode: 200,
      message: "Lấy danh sách phản hồi chất lượng nguyên liệu thành công",
      data: {
        items: [
          {
            id: feedbackId1,
            complaintCode: "FP-CP-00012",
            title: "Rau cải bị úa",
            school: { id: schoolIdX, name: "Trường X", code: "SCH-DUP" },
            delivery: { id: deliveryId1, deliveryNo: "FP-DE-00001" },
            status: "RESPONDED",
            createdAt: created1.toISOString(),
            respondedAt: responded1.toISOString(),
          },
          {
            id: "66666666-6666-4666-8666-666666666662",
            complaintCode: "FP-CP-100001",
            title: "Thiếu chứng từ lô gạo",
            school: { id: schoolIdY, name: "Trường Y", code: null },
            delivery: {
              id: "55555555-5555-4555-8555-555555555552",
              deliveryNo: "FP-DE-00002",
            },
            status: "SUBMITTED",
            createdAt: created2.toISOString(),
            respondedAt: null,
          },
        ],
        pagination: { page: 1, limit: 2, hasNext: true },
      },
    });
    const resPage2 = await api.request(
      "/api/ingredient-quality-feedback?page=2&limit=2",
    );
    assert.equal(resPage2.status, 200);
    assert.equal(
      (resPage2.body as { data: { pagination: { hasNext: boolean } } }).data
        .pagination.hasNext,
      false,
    );
    const resBeyond = await api.request(
      "/api/ingredient-quality-feedback?page=10&limit=2",
    );
    assert.equal(resBeyond.status, 200);
    assert.deepEqual((resBeyond.body as { data: unknown }).data, {
      items: [],
      pagination: { page: 10, limit: 2, hasNext: false },
    });
  }
  assert.equal(allocatorCalls, 0);
  assert(
    repoCalls.every(
      (c) =>
        (c as { scope: { kind: string; supplierId: string } }).scope.kind ===
          "SUPPLIER" &&
        (c as { scope: { supplierId: string } }).scope.supplierId ===
          supplierIdA,
    ),
  );

  // Unauthenticated 401 and forbidden roles/permissions 403 before repository access.
  let deniedRepoCalls = 0;
  const { service: guardService } = createIngredientQualityFeedbackHarness({
    listSupplier: async () => {
      deniedRepoCalls++;
      return Promise.resolve([]);
    },
  });
  const unauthApi = await startIngredientQualityFeedbackApi(
    context,
    guardService,
    null,
  );
  assert.equal(
    (await unauthApi.request("/api/ingredient-quality-feedback")).status,
    401,
  );
  for (const denied of [
    { ...supplierAdminA, permissions: [] },
    {
      ...supplierStaffA,
      permissions: ["ingredient_quality_feedback.view_own"],
    },
    { ...supplierStaffA, permissions: ["ingredient_quality_feedback.respond"] },
    { ...supplierAdminA, role: "FUTURE_SUPPLIER_ROLE" },
  ]) {
    const api = await startIngredientQualityFeedbackApi(
      context,
      guardService,
      denied,
    );
    assert.equal(
      (await api.request("/api/ingredient-quality-feedback")).status,
      403,
    );
  }
  assert.equal(deniedRepoCalls, 0);

  // Invalid / missing stored complaintCode returns safe 503 without UUID fallback or allocator call.
  for (const badCode of ["", "FP-CP-00000", "invalid", "fp-cp-00001"]) {
    const { service: badService } = createIngredientQualityFeedbackHarness({
      nextComplaintCodeSequence: async () => {
        allocatorCalls++;
        return Promise.resolve(1n);
      },
      listSupplier: async () =>
        Promise.resolve([
          {
            ...sampleRows[0],
            complaintCode: badCode,
          },
        ]),
    });
    const api = await startIngredientQualityFeedbackApi(
      context,
      badService,
      supplierAdminA,
    );
    const badRes = await api.request("/api/ingredient-quality-feedback");
    assert.equal(badRes.status, 503);
    assert(!JSON.stringify(badRes.body).includes(feedbackId1));
  }
  assert.equal(allocatorCalls, 0);

  // Repository failure returns safe 503 without SQL leak.
  const { service: dbErrService } = createIngredientQualityFeedbackHarness({
    listSupplier: async () =>
      Promise.reject(new Error("postgresql://user:secret@host/db SELECT *")),
  });
  const dbErrApi = await startIngredientQualityFeedbackApi(
    context,
    dbErrService,
    supplierAdminA,
  );
  const dbErrRes = await dbErrApi.request("/api/ingredient-quality-feedback");
  assert.equal(dbErrRes.status, 503);
  assert(!JSON.stringify(dbErrRes.body).includes("secret"));
  assert(!JSON.stringify(dbErrRes.body).includes("SELECT"));
});

void test("T025 US2 GET detail returns exact FeedbackDetail in one RepeatableRead tx, verifies lot/tuple/complaintCode invariants, enforces SCHOOL/SYSTEM/SUPPLIER scopes and never calls allocator", async (context) => {
  const created = new Date("2026-10-10T08:00:00.000Z");
  const updated = new Date("2026-10-11T09:00:00.000Z");
  const responded = new Date("2026-10-11T08:30:00.000Z");
  let allocatorCalls = 0;

  // 1. RESPONDED complaint with verified lot in delivery + SUBMITTED complaint with null lot
  const baseRespondedRow = {
    id: feedbackId1,
    complaintCode: "FP-CP-00042",
    deliveryId: deliveryId1,
    ingredientLotId: lotId1,
    title: "Cà rốt bị dập",
    description: "Thùng số 2 bị dập phần đầu",
    status: "RESPONDED" as const,
    supplierResponse: "Nhà cung cấp sẽ bù lô mới trong ngày mai.",
    respondedAt: responded,
    createdAt: created,
    updatedAt: updated,
    Delivery: {
      id: deliveryId1,
      deliveryNo: "FP-DE-00001",
      School: { id: schoolIdX, name: "Trường X", code: null },
    },
    submittedByUser: { id: schoolUserX.id, fullName: "Nhân viên trường X" },
    respondedByUser: { id: supplierStaffA.id, fullName: "Nhân viên NCC A" },
  };
  const submittedNullLotRow = {
    ...baseRespondedRow,
    id: "66666666-6666-4666-8666-666666666662",
    complaintCode: "FP-CP-100005",
    ingredientLotId: null,
    status: "SUBMITTED" as const,
    supplierResponse: null,
    respondedAt: null,
    respondedByUser: null,
    updatedAt: created,
  };

  let lotQueries = 0;
  const observedDetailScopes: unknown[] = [];
  const { service, txHarness } = createIngredientQualityFeedbackHarness(
    (tx) => ({
      nextComplaintCodeSequence: async () => {
        allocatorCalls++;
        return Promise.resolve(1n);
      },
      findDetail: async (clientTx, feedbackId, scope) => {
        tx.assertInTx(clientTx);
        observedDetailScopes.push(scope);
        if (feedbackId === feedbackId1 && scope.kind === "SUPPLIER") {
          return Promise.resolve(baseRespondedRow);
        }
        if (
          feedbackId === submittedNullLotRow.id &&
          scope.kind === "SUPPLIER"
        ) {
          return Promise.resolve(submittedNullLotRow);
        }
        if (
          feedbackId === feedbackId1 &&
          scope.kind === "SCHOOL" &&
          scope.schoolId === schoolIdX
        ) {
          if (
            scope.submittedByUserId &&
            scope.submittedByUserId !== baseRespondedRow.submittedByUser.id
          ) {
            return Promise.resolve(null);
          }
          return Promise.resolve(baseRespondedRow);
        }
        return Promise.resolve(null);
      },
      findLotInDelivery: async (clientTx, lotId, deliveryId, scope) => {
        tx.assertInTx(clientTx);
        lotQueries++;
        assert.equal(lotId, lotId1);
        assert.equal(deliveryId, deliveryId1);
        assert(scope.kind === "SUPPLIER" || scope.kind === "SCHOOL");
        return Promise.resolve({ id: lotId1, lotCode: "LOT-CR-01" });
      },
    }),
  );

  // Supplier gets RESPONDED detail with lot in 1 RepeatableRead transaction
  const apiSup = await startIngredientQualityFeedbackApi(
    context,
    service,
    supplierAdminA,
  );
  const resSup = await apiSup.request(
    `/api/ingredient-quality-feedback/${feedbackId1.toUpperCase()}`,
  );
  assert.equal(resSup.status, 200);
  assert.equal(resSup.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(resSup.body, {
    success: true,
    statusCode: 200,
    message: "Lấy chi tiết phản hồi chất lượng nguyên liệu thành công",
    data: {
      id: feedbackId1,
      complaintCode: "FP-CP-00042",
      title: "Cà rốt bị dập",
      school: { id: schoolIdX, name: "Trường X", code: null },
      delivery: { id: deliveryId1, deliveryNo: "FP-DE-00001" },
      status: "RESPONDED",
      createdAt: created.toISOString(),
      respondedAt: responded.toISOString(),
      description: "Thùng số 2 bị dập phần đầu",
      updatedAt: updated.toISOString(),
      submittedBy: { id: schoolUserX.id, fullName: "Nhân viên trường X" },
      ingredientLot: { id: lotId1, lotCode: "LOT-CR-01" },
      supplierResponse: "Nhà cung cấp sẽ bù lô mới trong ngày mai.",
      respondedBy: { id: supplierStaffA.id, fullName: "Nhân viên NCC A" },
    },
  });
  assert.equal(txHarness.transactions(), 1);
  assert.deepEqual(txHarness.isolationLevels, ["RepeatableRead"]);
  assert.equal(lotQueries, 1);

  // SUBMITTED complaint with null ingredientLotId skips findLotInDelivery cleanly
  const resSub = await apiSup.request(
    `/api/ingredient-quality-feedback/${submittedNullLotRow.id}`,
  );
  assert.equal(resSub.status, 200);
  const subData = (resSub.body as { data: Record<string, unknown> }).data;
  assert.equal(subData.complaintCode, "FP-CP-100005");
  assert.equal(subData.ingredientLot, null);
  assert.equal(subData.supplierResponse, null);
  assert.equal(subData.respondedBy, null);
  assert.equal(subData.respondedAt, null);
  assert.equal(lotQueries, 1);

  // SCHOOL view_details and view_own readback for FR-011; other user own-only -> 404
  const apiSchoolDetails = await startIngredientQualityFeedbackApi(
    context,
    service,
    schoolUserX,
  );
  const resSchool = await apiSchoolDetails.request(
    `/api/ingredient-quality-feedback/${feedbackId1}`,
  );
  assert.equal(resSchool.status, 200);
  assert.equal(resSchool.headers.get("cache-control"), "private, no-store");
  assert.equal(
    (resSchool.body as { data: { supplierResponse: string } }).data
      .supplierResponse,
    baseRespondedRow.supplierResponse,
  );
  const apiSchoolOwnOther = await startIngredientQualityFeedbackApi(
    context,
    service,
    {
      ...schoolUserX,
      id: "11111111-1111-4111-8111-111111111199",
      permissions: ["ingredient_quality_feedback.view_own"],
    },
  );
  const resOwnMiss = await apiSchoolOwnOther.request(
    `/api/ingredient-quality-feedback/${feedbackId1}`,
  );
  assert.equal(resOwnMiss.status, 404);
  const resNotFound = await apiSup.request(
    "/api/ingredient-quality-feedback/99999999-9999-4999-8999-999999999999",
  );
  assert.equal(resNotFound.status, 404);
  assert.deepEqual(resOwnMiss.body, resNotFound.body);

  // Strict params & query: FP-CP code path -> 400; extra query -> 400
  const fpPathRes = await apiSup.request(
    "/api/ingredient-quality-feedback/FP-CP-00042",
  );
  assert.equal(fpPathRes.status, 400);
  const extraQueryRes = await apiSup.request(
    `/api/ingredient-quality-feedback/${feedbackId1}?extra=1`,
  );
  assert.equal(extraQueryRes.status, 400);

  // SYSTEM / AUTHORITY / supplier missing view_details -> 403 before DB
  let guardCalls = 0;
  const { service: guardService } = createIngredientQualityFeedbackHarness({
    findDetail: async () => {
      guardCalls++;
      return Promise.resolve(null);
    },
  });
  for (const denied of [
    { ...testAdmin, permissions: ["ingredient_quality_feedback.view_details"] },
    {
      ...schoolUserX,
      role: "COMMUNE_FOOD_SAFETY_OFFICER",
      orgType: "AUTHORITY" as const,
      schoolId: null,
      communeFoodSafetyUnitId: testAdmin.id,
      permissions: ["ingredient_quality_feedback.view_details"],
    },
    {
      ...supplierAdminA,
      permissions: ["ingredient_quality_feedback.view_own"],
    },
    { ...supplierStaffA, permissions: ["ingredient_quality_feedback.respond"] },
  ]) {
    const api = await startIngredientQualityFeedbackApi(
      context,
      guardService,
      denied,
    );
    assert.equal(
      (await api.request(`/api/ingredient-quality-feedback/${feedbackId1}`))
        .status,
      403,
    );
  }
  assert.equal(guardCalls, 0);

  // Mismatched lot (ingredientLotId present but findLotInDelivery returns null) -> 503 without leaking lotId1
  const { service: badLotService } = createIngredientQualityFeedbackHarness({
    findDetail: async () => Promise.resolve(baseRespondedRow),
    findLotInDelivery: async () => Promise.resolve(null),
  });
  const badLotApi = await startIngredientQualityFeedbackApi(
    context,
    badLotService,
    supplierAdminA,
  );
  const badLotRes = await badLotApi.request(
    `/api/ingredient-quality-feedback/${feedbackId1}`,
  );
  assert.equal(badLotRes.status, 503);
  assert(!JSON.stringify(badLotRes.body).includes(lotId1));

  // Corrupt response tuple / corrupt complaintCode -> 503 without partial leak or allocator call
  for (const corruptRow of [
    { ...baseRespondedRow, respondedByUser: null },
    { ...submittedNullLotRow, supplierResponse: "Orphan reply" },
    { ...baseRespondedRow, complaintCode: "FP-CP-00000" },
  ]) {
    const { service: corruptService } = createIngredientQualityFeedbackHarness({
      nextComplaintCodeSequence: async () => {
        allocatorCalls++;
        return Promise.resolve(1n);
      },
      findDetail: async () => Promise.resolve(corruptRow),
      findLotInDelivery: async () =>
        Promise.resolve({ id: lotId1, lotCode: "LOT-CR-01" }),
    });
    const corruptApi = await startIngredientQualityFeedbackApi(
      context,
      corruptService,
      supplierAdminA,
    );
    assert.equal(
      (
        await corruptApi.request(
          `/api/ingredient-quality-feedback/${feedbackId1}`,
        )
      ).status,
      503,
    );
  }
  assert.equal(allocatorCalls, 0);
  void observedDetailScopes;
});

void test("T031 US3 supplier POST response enforces AND permissions, Serializable actor/metadata/target recheck, rollback on readback error, actor/COMMIT retries, CSRF/session/rate-limit and zero allocator calls", async (context) => {
  context.mock.method(console, "error", () => undefined);
  const created = new Date("2026-10-10T08:00:00.000Z");
  const updated = new Date("2026-10-12T10:00:00.000Z");
  const respondedAt = new Date("2026-10-12T10:00:00.000Z");
  const validText = "Chúng tôi đã tiếp nhận và sẽ đổi lô trong sáng mai.";
  let allocatorCalls = 0;

  const baseSubmittedDetail = {
    id: feedbackId1,
    complaintCode: "FP-CP-00088",
    deliveryId: deliveryId1,
    ingredientLotId: lotId1,
    title: "Cải bị dập",
    description: "Một thùng bị dập",
    status: "SUBMITTED" as const,
    supplierResponse: null,
    respondedAt: null,
    createdAt: created,
    updatedAt: created,
    Delivery: {
      id: deliveryId1,
      deliveryNo: "FP-DE-00010",
      School: { id: schoolIdX, name: "Trường X", code: "SCH-X" },
    },
    submittedByUser: { id: schoolUserX.id, fullName: "Trường X" },
    respondedByUser: null,
  };

  // 1. Happy path for ADMIN and STAFF + shared tx + server-owned actor/time/status + zero allocator calls
  for (const actor of [supplierAdminA, supplierStaffA]) {
    let txCount = 0;
    let committed = false;
    let rolledBack = false;
    let savedInput: Record<string, unknown> | undefined;
    const callOrder: string[] = [];
    let currentTx: Prisma.TransactionClient | undefined;

    const fakeClient = {
      async $transaction<T>(
        op: (tx: Prisma.TransactionClient) => Promise<T>,
        options?: { isolationLevel?: string },
      ): Promise<T> {
        assert.equal(options?.isolationLevel, "Serializable");
        txCount++;
        currentTx = { txNo: txCount } as unknown as Prisma.TransactionClient;
        try {
          const out = await op(currentTx);
          committed = true;
          return out;
        } catch (err) {
          rolledBack = true;
          throw err;
        } finally {
          currentTx = undefined;
        }
      },
    } as unknown as PrismaClient;

    const repo: IngredientQualityFeedbackRepository = {
      ...createIngredientQualityFeedbackRepository(),
      nextComplaintCodeSequence: async () => {
        allocatorCalls++;
        return Promise.resolve(1n);
      },
      readActor: async (tx, userId) => {
        assert.equal(tx, currentTx);
        assert.equal(userId, actor.id);
        callOrder.push("readActor");
        return Promise.resolve(actor);
      },
      findResponseMetadata: async (tx, feedbackId, scope) => {
        assert.equal(tx, currentTx);
        assert.equal(scope.supplierId, supplierIdA);
        callOrder.push("findResponseMetadata");
        return Promise.resolve({
          id: feedbackId,
          deliveryId: deliveryId1,
          schoolId: schoolIdX,
        });
      },
      lockResponseContext: (tx, scope, ctx) => {
        assert.equal(tx, currentTx);
        assert.equal(scope.supplierId, supplierIdA);
        assert.equal(ctx.schoolId, schoolIdX);
        assert.equal(ctx.deliveryId, deliveryId1);
        assert.equal(ctx.actorUserId, actor.id);
        assert.equal(ctx.actorRoleId, actor.roleId);
        callOrder.push("lockResponseContext");
        return Promise.resolve();
      },
      findResponseTarget: async (tx) => {
        assert.equal(tx, currentTx);
        callOrder.push("findResponseTarget");
        return Promise.resolve({
          id: feedbackId1,
          deliveryId: deliveryId1,
          schoolId: schoolIdX,
          status: "SUBMITTED",
        });
      },
      respondIfSubmitted: async (tx, input) => {
        assert.equal(tx, currentTx);
        callOrder.push("respondIfSubmitted");
        savedInput = input as unknown as Record<string, unknown>;
        return Promise.resolve(1);
      },
      findDetail: async (tx) => {
        assert.equal(tx, currentTx);
        callOrder.push("findDetail");
        return Promise.resolve({
          ...baseSubmittedDetail,
          status: "RESPONDED",
          supplierResponse: String(savedInput?.supplierResponse),
          respondedAt,
          updatedAt: updated,
          respondedByUser: { id: actor.id, fullName: actor.fullName },
        });
      },
      findLotInDelivery: async (tx) => {
        assert.equal(tx, currentTx);
        callOrder.push("findLotInDelivery");
        return Promise.resolve({ id: lotId1, lotCode: "LOT-01" });
      },
    };
    const svc = createIngredientQualityFeedbackService(repo, () =>
      Promise.resolve(fakeClient),
    );
    const api = await startIngredientQualityFeedbackApi(context, svc, actor);
    const res = await api.request(
      `/api/ingredient-quality-feedback/${feedbackId1}/response`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierResponse: `  ${validText}  ` }),
      },
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    assert.equal(committed, true);
    assert.equal(rolledBack, false);
    assert.equal(txCount, 1);
    assert.equal(savedInput?.respondedByUserId, actor.id);
    assert.equal(savedInput?.supplierResponse, validText);
    assert(savedInput?.respondedAt instanceof Date);
    assert(!("complaintCode" in (savedInput ?? {})));
    assert.deepEqual(callOrder, [
      "readActor",
      "findResponseMetadata",
      "lockResponseContext",
      "readActor",
      "findResponseTarget",
      "respondIfSubmitted",
      "findDetail",
      "findLotInDelivery",
    ]);
    assert.equal(
      (res.body as { data: { complaintCode: string; status: string } }).data
        .complaintCode,
      "FP-CP-00088",
    );
    assert.equal(
      (res.body as { data: { status: string } }).data.status,
      "RESPONDED",
    );
  }

  // 2. Actor permission/role/scope rejection & spoofed body rejection BEFORE DB writes
  let writeAttempts = 0;
  const guardClient = {
    $transaction() {
      writeAttempts++;
      return Promise.reject(
        new Error("Should not enter tx when pre-check fails"),
      );
    },
  } as unknown as PrismaClient;
  const guardSvc = createIngredientQualityFeedbackService(
    createIngredientQualityFeedbackRepository(),
    () => Promise.resolve(guardClient),
  );
  for (const denied of [
    {
      ...supplierAdminA,
      permissions: ["ingredient_quality_feedback.view_details"],
    },
    { ...supplierStaffA, permissions: ["ingredient_quality_feedback.respond"] },
    {
      ...supplierStaffA,
      permissions: [
        "ingredient_quality_feedback.view_own",
        "ingredient_quality_feedback.respond",
      ],
    },
    {
      ...schoolUserX,
      permissions: [
        "ingredient_quality_feedback.view_details",
        "ingredient_quality_feedback.respond",
      ],
    },
    {
      ...testAdmin,
      permissions: [
        "ingredient_quality_feedback.view_details",
        "ingredient_quality_feedback.respond",
      ],
    },
  ]) {
    const api = await startIngredientQualityFeedbackApi(
      context,
      guardSvc,
      denied,
    );
    assert.equal(
      (
        await api.request(
          `/api/ingredient-quality-feedback/${feedbackId1}/response`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ supplierResponse: validText }),
          },
        )
      ).status,
      403,
    );
  }
  const spoofApi = await startIngredientQualityFeedbackApi(
    context,
    guardSvc,
    supplierAdminA,
  );
  assert.equal(
    (
      await spoofApi.request(
        `/api/ingredient-quality-feedback/${feedbackId1}/response`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            supplierResponse: validText,
            complaintCode: "FP-CP-99999",
            status: "RESPONDED",
            respondedByUserId: supplierStaffA.id,
            respondedAt: "2026-01-01T00:00:00.000Z",
          }),
        },
      )
    ).status,
    400,
  );
  assert.equal(writeAttempts, 0);

  // 3. Stale actor inside tx (locked / role changed / supplier changed / permission revoked) -> 403 without write
  for (const staleActor of [
    { ...supplierAdminA, roleId: "00000000-0000-4000-8000-000000000999" },
    { ...supplierAdminA, role: "INGREDIENT_SUPPLIER_STAFF" },
    { ...supplierAdminA, supplierId: supplierIdB },
    {
      ...supplierAdminA,
      permissions: ["ingredient_quality_feedback.view_details"],
    },
  ]) {
    let writes = 0;
    const txClient = {
      async $transaction<T>(op: (tx: Prisma.TransactionClient) => Promise<T>) {
        return op({} as Prisma.TransactionClient);
      },
    } as unknown as PrismaClient;
    const svc = createIngredientQualityFeedbackService(
      {
        ...createIngredientQualityFeedbackRepository(),
        readActor: async () => Promise.resolve(staleActor),
        respondIfSubmitted: async () => {
          writes++;
          return Promise.resolve(1);
        },
      },
      () => Promise.resolve(txClient),
    );
    await assert.rejects(
      () =>
        svc.respond(
          { feedbackId: feedbackId1 },
          { supplierResponse: validText },
          supplierAdminA,
        ),
      (err: unknown) => err instanceof HttpError && err.statusCode === 403,
    );
    assert.equal(writes, 0);
  }

  // 4. Out-of-scope 404, RESPONDED / count=0 409, metadata drift 503, and readback rollback 503
  const singleTxClient = (onRollback: () => void) =>
    ({
      async $transaction<T>(op: (tx: Prisma.TransactionClient) => Promise<T>) {
        try {
          return await op({} as Prisma.TransactionClient);
        } catch (e) {
          onRollback();
          throw e;
        }
      },
    }) as unknown as PrismaClient;

  // 404 when metadata null
  {
    let rb = false;
    const svc404 = createIngredientQualityFeedbackService(
      {
        ...createIngredientQualityFeedbackRepository(),
        readActor: async () => Promise.resolve(supplierAdminA),
        findResponseMetadata: async () => Promise.resolve(null),
        lockResponseContext: async () => Promise.resolve(),
      },
      () =>
        Promise.resolve(
          singleTxClient(() => {
            rb = true;
          }),
        ),
    );
    await assert.rejects(
      () =>
        svc404.respond(
          { feedbackId: feedbackId1 },
          { supplierResponse: validText },
          supplierAdminA,
        ),
      (err: unknown) => err instanceof HttpError && err.statusCode === 404,
    );
    assert.equal(rb, true);
  }

  // 409 when already RESPONDED or count=0
  for (const mode of ["already-responded", "count-zero"] as const) {
    const svc409 = createIngredientQualityFeedbackService(
      {
        ...createIngredientQualityFeedbackRepository(),
        readActor: async () => Promise.resolve(supplierAdminA),
        findResponseMetadata: async () =>
          Promise.resolve({
            id: feedbackId1,
            deliveryId: deliveryId1,
            schoolId: schoolIdX,
          }),
        lockResponseContext: async () => Promise.resolve(),
        findResponseTarget: async () =>
          Promise.resolve({
            id: feedbackId1,
            deliveryId: deliveryId1,
            schoolId: schoolIdX,
            status: mode === "already-responded" ? "RESPONDED" : "SUBMITTED",
          }),
        respondIfSubmitted: async () => Promise.resolve(0),
      },
      () => Promise.resolve(singleTxClient(() => undefined)),
    );
    await assert.rejects(
      () =>
        svc409.respond(
          { feedbackId: feedbackId1 },
          { supplierResponse: validText },
          supplierAdminA,
        ),
      (err: unknown) => err instanceof HttpError && err.statusCode === 409,
    );
  }

  // Readback failure (e.g., bad lot / bad code) triggers tx rollback & 503
  {
    let rb = false;
    let writeDone = false;
    const svcRb = createIngredientQualityFeedbackService(
      {
        ...createIngredientQualityFeedbackRepository(),
        readActor: async () => Promise.resolve(supplierAdminA),
        findResponseMetadata: async () =>
          Promise.resolve({
            id: feedbackId1,
            deliveryId: deliveryId1,
            schoolId: schoolIdX,
          }),
        lockResponseContext: async () => Promise.resolve(),
        findResponseTarget: async () =>
          Promise.resolve({
            id: feedbackId1,
            deliveryId: deliveryId1,
            schoolId: schoolIdX,
            status: "SUBMITTED",
          }),
        respondIfSubmitted: async () => {
          writeDone = true;
          return Promise.resolve(1);
        },
        findDetail: async () =>
          Promise.resolve({
            ...baseSubmittedDetail,
            status: "RESPONDED",
            supplierResponse: validText,
            respondedAt,
            respondedByUser: {
              id: supplierAdminA.id,
              fullName: supplierAdminA.fullName,
            },
          }),
        findLotInDelivery: async () => Promise.resolve(null),
      },
      () =>
        Promise.resolve(
          singleTxClient(() => {
            rb = true;
          }),
        ),
    );
    await assert.rejects(
      () =>
        svcRb.respond(
          { feedbackId: feedbackId1 },
          { supplierResponse: validText },
          supplierAdminA,
        ),
      (err: unknown) => err instanceof HttpError && err.statusCode === 503,
    );
    assert.equal(writeDone, true);
    assert.equal(rb, true);
  }

  // 5. Actor-query serialization conflict & direct COMMIT DriverAdapterError retry max 3 attempts without allocator calls
  {
    let attempts = 0;
    const identityRow = {
      id: supplierAdminA.id,
      username: supplierAdminA.username,
      fullName: supplierAdminA.fullName,
      status: "ACTIVE" as const,
      roleId: supplierAdminA.roleId,
      schoolId: null,
      supplierId: supplierIdA,
      communeFoodSafetyUnitId: null,
      Role: {
        code: "INGREDIENT_SUPPLIER_ADMIN",
        type: "SUPPLIER" as const,
        rolePermissions: [
          {
            permission: {
              code: "ingredient_quality_feedback.view_details",
              isActive: true,
            },
          },
          {
            permission: {
              code: "ingredient_quality_feedback.respond",
              isActive: true,
            },
          },
        ],
      },
      permissionDenials: [],
    };
    const conflictError = Object.assign(new Error("private commit details"), {
      name: "DriverAdapterError",
      cause: { kind: "TransactionWriteConflict" },
    });
    const retryTx = {
      user: {
        findUnique: () => {
          if (attempts === 1) {
            return Promise.reject(
              Object.assign(new Error("actor query P2034"), { code: "P2034" }),
            );
          }
          return Promise.resolve(identityRow);
        },
      },
    } as unknown as Prisma.TransactionClient;
    const retryClient = {
      async $transaction<T>(op: (tx: Prisma.TransactionClient) => Promise<T>) {
        attempts++;
        const res = await op(retryTx);
        if (attempts === 2) throw conflictError;
        return res;
      },
    } as unknown as PrismaClient;

    const retrySvc = createIngredientQualityFeedbackService(
      {
        ...createIngredientQualityFeedbackRepository(),
        nextComplaintCodeSequence: async () => {
          allocatorCalls++;
          return Promise.resolve(1n);
        },
        findResponseMetadata: async () =>
          Promise.resolve({
            id: feedbackId1,
            deliveryId: deliveryId1,
            schoolId: schoolIdX,
          }),
        lockResponseContext: async () => Promise.resolve(),
        findResponseTarget: async () =>
          Promise.resolve({
            id: feedbackId1,
            deliveryId: deliveryId1,
            schoolId: schoolIdX,
            status: "SUBMITTED",
          }),
        respondIfSubmitted: async () => Promise.resolve(1),
        findDetail: async () =>
          Promise.resolve({
            ...baseSubmittedDetail,
            ingredientLotId: null,
            status: "RESPONDED",
            supplierResponse: validText,
            respondedAt,
            respondedByUser: {
              id: supplierAdminA.id,
              fullName: supplierAdminA.fullName,
            },
          }),
      },
      () => Promise.resolve(retryClient),
    );
    const out = await retrySvc.respond(
      { feedbackId: feedbackId1 },
      { supplierResponse: validText },
      supplierAdminA,
    );
    assert.equal(attempts, 3);
    assert.equal(out.complaintCode, "FP-CP-00088");
  }

  // Exhausted retries -> safe 503 without exposing internal SQL/commit details
  {
    let attempts = 0;
    const failClient = {
      $transaction() {
        attempts++;
        return Promise.reject(
          Object.assign(new Error("private COMMIT SQL leak"), {
            name: "DriverAdapterError",
            cause: { kind: "TransactionWriteConflict" },
          }),
        );
      },
    } as unknown as PrismaClient;
    const failSvc = createIngredientQualityFeedbackService(
      {
        ...createIngredientQualityFeedbackRepository(),
        readActor: async () => Promise.resolve(supplierAdminA),
      },
      () => Promise.resolve(failClient),
    );
    await assert.rejects(
      () =>
        failSvc.respond(
          { feedbackId: feedbackId1 },
          { supplierResponse: validText },
          supplierAdminA,
        ),
      (err: unknown) =>
        err instanceof HttpError &&
        err.statusCode === 503 &&
        !err.message.includes("SQL"),
    );
    assert.equal(attempts, 3);
  }

  // 6. Full app middleware verification: CSRF (missing -> 403), missing session -> 401, unsupported PUT/PATCH/DELETE -> 404, rate limit -> 429
  {
    const store = new MemoryStore();
    const app = createApp(
      createApiRateLimiter(store, { windowMs: 60_000, limit: 5 }),
      (req, _res, next) => {
        if (req.headers["x-test-auth"] === "sup") req.auth = supplierAdminA;
        next();
      },
    );
    const srv = app.listen(0, "127.0.0.1");
    await once(srv, "listening");
    const addr = srv.address();
    assert(addr && typeof addr !== "string");
    const urlBase = `http://127.0.0.1:${addr.port}/api/ingredient-quality-feedback/${feedbackId1}/response`;
    try {
      const noCsrf = await fetch(urlBase, {
        method: "POST",
        headers: { "x-test-auth": "sup", "Content-Type": "application/json" },
        body: JSON.stringify({ supplierResponse: validText }),
      });
      assert.equal(noCsrf.status, 403);
      const noAuth = await fetch(urlBase, {
        method: "POST",
        headers: {
          "X-CSRF-Protection": "1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ supplierResponse: validText }),
      });
      assert.equal(noAuth.status, 401);
      for (const method of ["PUT", "PATCH", "DELETE"]) {
        const unsupported = await fetch(urlBase, {
          method,
          headers: {
            "x-test-auth": "sup",
            "X-CSRF-Protection": "1",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ supplierResponse: validText }),
        });
        assert.equal(unsupported.status, 404);
      }
      const rateLimited = await fetch(urlBase, {
        method: "POST",
        headers: {
          "x-test-auth": "sup",
          "X-CSRF-Protection": "1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ supplierResponse: validText }),
      });
      assert.equal(rateLimited.status, 429);
    } finally {
      store.shutdown();
      await new Promise<void>((resolve, reject) => {
        srv.close((err) => (err ? reject(err) : resolve()));
        srv.closeAllConnections();
      });
    }
  }
  assert.equal(allocatorCalls, 0);
});
