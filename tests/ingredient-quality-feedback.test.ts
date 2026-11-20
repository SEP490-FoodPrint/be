import assert from "node:assert/strict";
import { once } from "node:events";
import { test, type TestContext } from "node:test";
import express from "express";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import type { AuthPrincipal } from "../src/types/auth";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import {
  createIngredientQualityFeedbackRepository,
  type FeedbackDetailRow,
  type FeedbackListRow,
  type FeedbackTicketTargetRow,
  type IngredientQualityFeedbackRepository,
} from "../src/modules/ingredient-quality-feedback/ingredient-quality-feedback.repository";
import {
  createIngredientQualityFeedbackService,
  type IngredientQualityFeedbackService,
} from "../src/modules/ingredient-quality-feedback/ingredient-quality-feedback.service";
import {
  createComplaintTicketRepository,
  type ComplaintTicketRepository,
  type TransitionInput,
} from "../src/modules/complaint-ticket/complaint-ticket.repository";
import {
  validateFeedbackCommentBody,
  validateFeedbackEmptyBody,
  validateFeedbackReopenBody,
  validateFeedbackResolveBody,
  validateIngredientQualityFeedbackListQuery,
  validateIngredientQualityFeedbackParams,
} from "../src/modules/ingredient-quality-feedback/ingredient-quality-feedback.validation";
import { createIngredientQualityFeedbackRouter } from "../src/modules/ingredient-quality-feedback/ingredient-quality-feedback.routes";
import { testAdmin, testStaff } from "./helpers/authorization";

const supplierIdA = "22222222-2222-4222-8222-222222222222";
const schoolIdX = "44444444-4444-4444-8444-444444444441";
const deliveryId1 = "55555555-5555-4555-8555-555555555551";
const feedbackId1 = "66666666-6666-4666-8666-666666666661";
const lotId1 = "77777777-7777-4777-8777-777777777771";
const NOW = new Date("2026-11-20T03:00:00.000Z");

const supplierAdminA: AuthPrincipal = {
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

const schoolSender: AuthPrincipal = {
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
  permissions: [
    "ingredient_quality_feedback.submit",
    "ingredient_quality_feedback.view_own",
    "ingredient_quality_feedback.view_details",
  ],
};

function listRow(overrides: Partial<FeedbackListRow> = {}): FeedbackListRow {
  return {
    id: feedbackId1,
    code: "FP-CP-00088",
    title: "Phản ánh chất lượng nguyên liệu chuyến giao FP-DE-00010",
    status: "NEW",
    senderUserId: schoolSender.id,
    lastResolvedAt: null,
    resolvedCount: 0,
    closeReason: null,
    closedAt: null,
    submittedAt: new Date("2026-11-19T01:00:00Z"),
    updatedAt: new Date("2026-11-19T01:00:00Z"),
    ingredientQualityFeedback: {
      deliveryId: deliveryId1,
      ingredientLotId: null,
      Delivery: {
        id: deliveryId1,
        deliveryNo: "FP-DE-00010",
        School: { id: schoolIdX, name: "Trường X", code: "SCH-X" },
      },
    },
    comments: [],
    ...overrides,
  };
}

function detailRow(
  overrides: Partial<FeedbackDetailRow> = {},
): FeedbackDetailRow {
  return {
    ...listRow(),
    description: "Một thùng cải bị dập",
    senderUser: { id: schoolSender.id, fullName: "School Staff X" },
    comments: [],
    ...overrides,
  };
}

function target(
  overrides: Partial<FeedbackTicketTargetRow> = {},
): FeedbackTicketTargetRow {
  return {
    id: feedbackId1,
    deliveryId: deliveryId1,
    schoolId: schoolIdX,
    status: "NEW",
    senderUserId: schoolSender.id,
    lastResolvedAt: null,
    ...overrides,
  };
}

/** Prisma client giả: ghi lại isolation level, mỗi transaction một tx object riêng. */
function fakeClient(record: { isolation: (string | undefined)[] }) {
  let count = 0;
  const client = {
    async $transaction<T>(
      op: (tx: Prisma.TransactionClient) => Promise<T>,
      options?: { isolationLevel?: string },
    ): Promise<T> {
      record.isolation.push(options?.isolationLevel);
      count++;
      const tx = {
        txNo: count,
        // withSchoolTransaction khóa và đọc trạng thái trường trong cùng tx.
        $queryRaw: () => Promise.resolve([]),
        school: {
          findUnique: () => Promise.resolve({ status: "ACTIVE" }),
        },
        user: {
          findUnique: () => Promise.resolve(identityOf(schoolSender)),
        },
      } as unknown as Prisma.TransactionClient;
      return op(tx);
    },
  } as unknown as PrismaClient;
  return client;
}

/** Bản ghi identity tương ứng `schoolSender` để `loadPrincipal` dựng lại principal. */
function identityOf(principal: AuthPrincipal) {
  return {
    id: principal.id,
    username: principal.username,
    fullName: principal.fullName,
    status: "ACTIVE",
    roleId: principal.roleId,
    schoolId: principal.schoolId,
    supplierId: principal.supplierId,
    communeFoodSafetyUnitId: principal.communeFoodSafetyUnitId,
    Role: {
      code: principal.role,
      type: principal.orgType,
      rolePermissions: principal.permissions.map((code) => ({
        permission: { code, isActive: true },
      })),
    },
    permissionDenials: [],
  };
}

function harness(options: {
  repository?: Partial<IngredientQualityFeedbackRepository>;
  tickets?: Partial<ComplaintTicketRepository>;
}) {
  const record = { isolation: [] as (string | undefined)[] };
  const client = fakeClient(record);
  const transitions: TransitionInput[] = [];
  const comments: { side: string; type: string; content: string }[] = [];
  const tickets: ComplaintTicketRepository = {
    ...createComplaintTicketRepository(),
    transition: (_tx, input) => {
      transitions.push(input);
      return Promise.resolve(true);
    },
    addComment: (_tx, input) => {
      comments.push({
        side: input.side,
        type: input.type,
        content: input.content,
      });
      return Promise.resolve({});
    },
    ...options.tickets,
  };
  const repository: IngredientQualityFeedbackRepository = {
    ...createIngredientQualityFeedbackRepository(),
    findDetail: () => Promise.resolve(detailRow()),
    findLotInDelivery: () => Promise.resolve(null),
    ...options.repository,
  };
  const service = createIngredientQualityFeedbackService(
    repository,
    () => Promise.resolve(client),
    () => NOW,
    tickets,
  );
  return { service, transitions, comments, record };
}

function supplierRepository(
  current: FeedbackTicketTargetRow,
  calls: string[] = [],
): Partial<IngredientQualityFeedbackRepository> {
  return {
    readActor: () => {
      calls.push("readActor");
      return Promise.resolve(supplierAdminA);
    },
    findResponseMetadata: (_tx, feedbackId) => {
      calls.push("metadata");
      return Promise.resolve({
        id: feedbackId,
        deliveryId: deliveryId1,
        schoolId: schoolIdX,
      });
    },
    lockResponseContext: (_tx, _scope, context) => {
      calls.push(`lock:${context.schoolId}:${context.deliveryId}`);
      return Promise.resolve();
    },
    findSupplierTarget: () => {
      calls.push("target");
      return Promise.resolve(current);
    },
  };
}

async function startApi(
  context: TestContext,
  service: IngredientQualityFeedbackService,
  actor: AuthPrincipal | null,
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
  return async (path: string, init?: RequestInit) => {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/ingredient-quality-feedback${path}`,
      init,
    );
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      body:
        text && response.headers.get("content-type")?.includes("json")
          ? (JSON.parse(text) as Record<string, unknown>)
          : null,
    };
  };
}

void test("validation: params UUID, strict bodies, trimmed content, optional reopen reason", () => {
  assert.deepEqual(validateIngredientQualityFeedbackListQuery(undefined), {
    page: 1,
    limit: 20,
  });
  assert.throws(
    () => validateIngredientQualityFeedbackParams({ feedbackId: "FP-CP-1" }),
    { statusCode: 400 },
  );
  assert.deepEqual(validateFeedbackCommentBody({ content: "  Đã nhận  " }), {
    content: "Đã nhận",
  });
  for (const body of [{}, { content: " " }, { content: "x", extra: 1 }])
    assert.throws(() => validateFeedbackCommentBody(body), {
      statusCode: 400,
    });
  assert.throws(() => validateFeedbackResolveBody({}), { statusCode: 400 });
  assert.deepEqual(validateFeedbackReopenBody(undefined), {});
  assert.deepEqual(validateFeedbackEmptyBody(undefined), {});
  assert.throws(() => validateFeedbackEmptyBody({ status: "CLOSED" }), {
    statusCode: 400,
  });
  // Contract cũ (Q28) không còn được nhận.
  assert.throws(() => validateFeedbackResolveBody({ supplierResponse: "x" }), {
    statusCode: 400,
  });
});

void test("list maps ticket fields per viewer and keeps stored FP-CP code", async () => {
  const rows = [
    listRow({ status: "IN_PROGRESS", comments: [{ authorSide: "REQUESTER" }] }),
  ];
  const { service } = harness({
    repository: { list: () => Promise.resolve(rows) },
  });
  const [supplierView] = (
    await service.getAll({ page: 1, limit: 20 }, supplierAdminA)
  ).items;
  assert.equal(supplierView.code, "FP-CP-00088");
  assert.equal(supplierView.displayStatus, "IN_PROGRESS");
  assert.equal(supplierView.hasNewMessage, true);
  assert.deepEqual(supplierView.allowedActions, ["COMMENT", "RESOLVE"]);
  assert.deepEqual(supplierView.school, {
    id: schoolIdX,
    name: "Trường X",
    code: "SCH-X",
  });
  const [senderView] = (
    await service.getAll({ page: 1, limit: 20 }, schoolSender)
  ).items;
  assert.equal(senderView.hasNewMessage, false);
  assert.deepEqual(senderView.allowedActions, ["COMMENT"]);
  await assert.rejects(
    () =>
      createIngredientQualityFeedbackService(
        {
          ...createIngredientQualityFeedbackRepository(),
          list: () => Promise.resolve([listRow({ code: "FP-MC-12345" })]),
        },
        () => Promise.resolve({} as PrismaClient),
      ).getAll({ page: 1, limit: 20 }, supplierAdminA),
    { statusCode: 503 },
  );
});

void test("detail returns comments in order and rejects missing lot", async (context) => {
  const comments = [
    {
      id: "c1",
      authorSide: "REQUESTER" as const,
      commentType: "MESSAGE" as const,
      content: "Thùng bị dập",
      createdAt: new Date("2026-11-19T02:00:00Z"),
      authorUser: { id: schoolSender.id, fullName: "School Staff X" },
    },
  ];
  const { service } = harness({
    repository: {
      findDetail: () => Promise.resolve(detailRow({ comments })),
    },
  });
  const detail = await service.getDetail(
    { feedbackId: feedbackId1 },
    supplierAdminA,
  );
  assert.deepEqual(detail.comments, [
    {
      id: "c1",
      authorSide: "REQUESTER",
      commentType: "MESSAGE",
      content: "Thùng bị dập",
      createdAt: "2026-11-19T02:00:00.000Z",
      author: { id: schoolSender.id, fullName: "School Staff X" },
    },
  ]);
  assert.deepEqual(detail.allowedActions, ["ACCEPT"]);
  context.mock.method(console, "error", () => undefined);
  const missingLot = harness({
    repository: {
      findDetail: () =>
        Promise.resolve(
          detailRow({
            ingredientQualityFeedback: {
              ...listRow().ingredientQualityFeedback!,
              ingredientLotId: lotId1,
            },
          }),
        ),
    },
  });
  await assert.rejects(
    () =>
      missingLot.service.getDetail({ feedbackId: feedbackId1 }, supplierAdminA),
    { statusCode: 503 },
  );
});

void test("supplier accept → resolve: lock order, actor recheck, Serializable, conditional transition", async () => {
  const calls: string[] = [];
  const accept = harness({
    repository: supplierRepository(target({ status: "NEW" }), calls),
  });
  await accept.service.accept({ feedbackId: feedbackId1 }, supplierAdminA);
  assert.deepEqual(calls, [
    "readActor",
    "metadata",
    `lock:${schoolIdX}:${deliveryId1}`,
    "readActor",
    "target",
  ]);
  assert.deepEqual(accept.record.isolation, ["Serializable"]);
  assert.equal(accept.transitions.length, 1);
  assert.equal(accept.transitions[0].fromStatus, "NEW");
  assert.equal(accept.transitions[0].toStatus, "IN_PROGRESS");
  assert.equal(accept.transitions[0].kind, "INGREDIENT");

  const resolve = harness({
    repository: supplierRepository(target({ status: "IN_PROGRESS" })),
  });
  await resolve.service.resolve(
    { feedbackId: feedbackId1 },
    { content: "Đã đổi lô mới" },
    supplierAdminA,
  );
  assert.equal(resolve.transitions[0].toStatus, "RESOLVED");
  assert.equal(resolve.transitions[0].markResolved, true);
  assert.deepEqual(resolve.comments, [
    { side: "HANDLER", type: "RESOLUTION", content: "Đã đổi lô mới" },
  ]);
});

void test("supplier cannot comment before accepting and lost races return 409", async () => {
  const early = harness({
    repository: supplierRepository(target({ status: "NEW" })),
  });
  await assert.rejects(
    () =>
      early.service.comment(
        { feedbackId: feedbackId1 },
        { content: "Xin chào" },
        supplierAdminA,
      ),
    { statusCode: 409 },
  );
  assert.equal(early.comments.length, 0);
  const race = harness({
    repository: supplierRepository(target({ status: "NEW" })),
    tickets: { transition: () => Promise.resolve(false) },
  });
  await assert.rejects(
    () => race.service.accept({ feedbackId: feedbackId1 }, supplierAdminA),
    { statusCode: 409 },
  );
  const scopeChanged = harness({
    repository: {
      ...supplierRepository(target()),
      readActor: () =>
        Promise.resolve({ ...supplierAdminA, supplierId: "other" }),
    },
  });
  await assert.rejects(
    () =>
      scopeChanged.service.accept({ feedbackId: feedbackId1 }, supplierAdminA),
    { statusCode: 403 },
  );
});

void test("requester satisfies or reopens only within 48h of the latest resolve", async () => {
  const fresh = new Date(NOW.getTime() - 47 * 3600 * 1000);
  const requesterRepository = (lastResolvedAt: Date) => ({
    findRequesterTarget: (
      _tx: Prisma.TransactionClient,
      _id: string,
      scope: { schoolId: string; senderUserId: string },
    ) => {
      assert.deepEqual(scope, {
        schoolId: schoolIdX,
        senderUserId: schoolSender.id,
      });
      return Promise.resolve(target({ status: "RESOLVED", lastResolvedAt }));
    },
  });
  const satisfy = harness({ repository: requesterRepository(fresh) });
  await satisfy.service.satisfy({ feedbackId: feedbackId1 }, schoolSender);
  assert.equal(satisfy.transitions[0].toStatus, "CLOSED");
  assert.equal(satisfy.transitions[0].closeReason, "SATISFIED");
  assert.equal(
    satisfy.transitions[0].resolvedAfter?.toISOString(),
    new Date(NOW.getTime() - 48 * 3600 * 1000).toISOString(),
  );

  const reopen = harness({ repository: requesterRepository(fresh) });
  await reopen.service.reopen(
    { feedbackId: feedbackId1 },
    { reason: "Lô mới vẫn dập" },
    schoolSender,
  );
  assert.equal(reopen.transitions[0].toStatus, "REOPENED");
  assert.deepEqual(reopen.comments, [
    { side: "REQUESTER", type: "REOPEN_NOTE", content: "Lô mới vẫn dập" },
  ]);

  const expired = harness({
    repository: requesterRepository(new Date(NOW.getTime() - 48 * 3600 * 1000)),
  });
  await assert.rejects(
    () => expired.service.satisfy({ feedbackId: feedbackId1 }, schoolSender),
    { statusCode: 409 },
  );
  assert.equal(expired.transitions.length, 0);
});

void test("routes: removed /response, role guards per action, no-store headers", async (context) => {
  context.mock.method(console, "error", () => undefined);
  const { service } = harness({
    repository: supplierRepository(target({ status: "NEW" })),
  });
  const asSupplier = await startApi(context, service, supplierAdminA);
  const legacy = await asSupplier(`/${feedbackId1}/response`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ supplierResponse: "x" }),
  });
  assert.equal(legacy.status, 404);
  const accepted = await asSupplier(`/${feedbackId1}/accept`, {
    method: "POST",
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get("cache-control"), "private, no-store");
  const supplierSatisfy = await asSupplier(`/${feedbackId1}/satisfy`, {
    method: "POST",
  });
  assert.equal(supplierSatisfy.status, 403);

  const asSchool = await startApi(context, service, schoolSender);
  const schoolAccept = await asSchool(`/${feedbackId1}/accept`, {
    method: "POST",
  });
  assert.equal(schoolAccept.status, 403);
  const anonymous = await startApi(context, service, null);
  assert.equal(
    (await anonymous(`/${feedbackId1}/accept`, { method: "POST" })).status,
    401,
  );
});
