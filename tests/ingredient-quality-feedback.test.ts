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
import { INITIAL_ROLE_PERMISSIONS } from "../src/constants/permission-catalog";
import {
  validateCreateIngredientQualityFeedbackBody,
  validateFeedbackCommentBody,
  validateFeedbackEmptyBody,
  validateFeedbackReopenBody,
  validateFeedbackResolveBody,
  validateIngredientQualityFeedbackListQuery,
  validateIngredientQualityFeedbackParams,
} from "../src/modules/ingredient-quality-feedback/ingredient-quality-feedback.validation";
import { createIngredientQualityFeedbackRouter } from "../src/modules/ingredient-quality-feedback/ingredient-quality-feedback.routes";
import { testAdmin, testStaff } from "./helpers/authorization";
import type { EvidenceStorage } from "../src/utils/evidence-files";

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
      issueType: "OTHER",
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
    attachments: [],
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
  storage?: EvidenceStorage;
}) {
  const record = { isolation: [] as (string | undefined)[] };
  const client = fakeClient(record);
  const transitions: TransitionInput[] = [];
  const comments: { side: string; type: string; content: string }[] = [];
  const emails: { complaintId: string; event: string; subject: string }[] = [];
  const tickets: ComplaintTicketRepository = {
    ...createComplaintTicketRepository(),
    findEmailRecipient: () =>
      Promise.resolve({
        kind: "INGREDIENT" as const,
        code: "FP-CP-48213",
        title: "Phản ánh chất lượng nguyên liệu",
        description: "Mô tả",
        comments: [],
        senderUser: {
          email: "sender@example.test",
          fullName: "Người gửi",
          status: "ACTIVE" as const,
        },
      }),
    queueEmail: (_tx, input) => {
      emails.push({
        complaintId: input.complaintId,
        event: input.event,
        subject: input.subject,
      });
      return Promise.resolve({});
    },
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
      return Promise.resolve({ id: "30000000-0000-4000-8000-0000000000c1" });
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
    options.storage,
  );
  return { service, transitions, comments, emails, record };
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
      attachments: [],
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
      attachments: [],
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
  // PR-E: email "Đã xử lý" cho người gửi; Tiếp nhận không gửi email.
  assert.deepEqual(accept.emails, []);
  assert.deepEqual(resolve.emails, [
    {
      complaintId: feedbackId1,
      event: "RESOLVED",
      subject: "[FoodPrint] Đơn FP-CP-48213 đã được xử lý",
    },
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

void test("validation: create body is strict, trims description 10–2000 and accepts optional lot", () => {
  assert.deepEqual(
    validateCreateIngredientQualityFeedbackBody({
      deliveryId: deliveryId1,
      title: "  Rau cải dập  ",
      issueType: "SPOILED_OR_NOT_FRESH",
      description: "  Rau cải bị dập úng  ",
    }),
    {
      deliveryId: deliveryId1,
      title: "Rau cải dập",
      issueType: "SPOILED_OR_NOT_FRESH",
      description: "Rau cải bị dập úng",
    },
  );
  assert.deepEqual(
    validateCreateIngredientQualityFeedbackBody({
      deliveryId: deliveryId1,
      ingredientLotId: null,
      title: "Lô thịt lỗi",
      issueType: "OTHER",
      description: "ạ".repeat(2000),
    }).ingredientLotId,
    null,
  );
  // multipart: chuỗi rỗng = không chọn lô.
  assert.equal(
    validateCreateIngredientQualityFeedbackBody({
      deliveryId: deliveryId1,
      ingredientLotId: "",
      title: "Lô thịt lỗi",
      issueType: "LATE_DELIVERY",
      description: "Giao trễ hai tiếng",
    }).ingredientLotId,
    null,
  );
  const valid = {
    deliveryId: deliveryId1,
    title: "Thịt có mùi lạ",
    issueType: "OTHER",
    description: "Thịt có mùi lạ khi nhận",
  };
  for (const body of [
    { ...valid, title: "Ngắn" },
    { ...valid, title: undefined },
    { ...valid, issueType: undefined },
    { ...valid, issueType: "BROKEN" },
    { ...valid, status: "RESOLVED" },
    { ...valid, code: "FP-CP-00001" },
    { ...valid, senderUserId: schoolSender.id },
    { ...valid, supplierId: supplierIdA },
    { ...valid, deliveryId: "FP-DE-00010" },
    { ...valid, ingredientLotId: "lot-1" },
    { ...valid, description: "   ngắn   " },
    { ...valid, description: "x".repeat(2001) },
    { description: valid.description },
  ])
    assert.throws(() => validateCreateIngredientQualityFeedbackBody(body), {
      statusCode: 400,
    });
});

function createHarness(
  delivery: { id: string; deliveryNo: string; status: string } | null,
  lot: { id: string; lotCode: string } | null = null,
  storage?: EvidenceStorage,
) {
  const calls: string[] = [];
  const created: unknown[] = [];
  const attachments: unknown[] = [];
  const h = harness({
    storage,
    repository: {
      findDeliveryForFeedback: (_tx, deliveryId, schoolId) => {
        calls.push(`delivery:${deliveryId}:${schoolId}`);
        return Promise.resolve(delivery);
      },
      findLotInDelivery: (_tx, lotId, deliveryId, scope) => {
        calls.push(`lot:${lotId}:${deliveryId}:${scope.kind}`);
        return Promise.resolve(lot);
      },
      create: (_tx, data) => {
        calls.push("create");
        created.push(data);
        return Promise.resolve({ id: feedbackId1 });
      },
      findDetail: (_tx, id) => {
        calls.push(`detail:${id}`);
        return Promise.resolve(detailRow());
      },
    },
    tickets: {
      allocateCode: (_tx, type) => {
        calls.push(`code:${type}`);
        return Promise.resolve("FP-CP-48213");
      },
      recordCreated: (_tx, id, actor) => {
        calls.push(`history:${id}:${actor.roleCode}`);
        return Promise.resolve({});
      },
      addAttachments: (_tx, input) => {
        attachments.push(input);
        return Promise.resolve();
      },
    },
  });
  return { ...h, calls, created, attachments };
}

void test("create: checks delivery and lot in the sender's school, allocates FP-CP and records NEW", async () => {
  const { service, calls, created, record, emails } = createHarness({
    id: deliveryId1,
    deliveryNo: "FP-DE-00010",
    status: "RECEIVED",
  });
  const detail = await service.create(
    {
      deliveryId: deliveryId1,
      title: "Cải bị dập",
      issueType: "SPOILED_OR_NOT_FRESH",
      description: "Một thùng cải bị dập",
    },
    schoolSender,
  );
  assert.deepEqual(record.isolation, ["Serializable"]);
  assert.deepEqual(calls, [
    `delivery:${deliveryId1}:${schoolIdX}`,
    "code:CP",
    "create",
    `history:${feedbackId1}:SCHOOL_KITCHEN_STAFF`,
    `detail:${feedbackId1}`,
  ]);
  assert.deepEqual(created, [
    {
      code: "FP-CP-48213",
      title: "Cải bị dập",
      description: "Một thùng cải bị dập",
      senderUserId: schoolSender.id,
      senderRoleCode: "SCHOOL_KITCHEN_STAFF",
      senderSchoolId: schoolIdX,
      deliveryId: deliveryId1,
      ingredientLotId: null,
      issueType: "SPOILED_OR_NOT_FRESH",
    },
  ]);
  assert.equal(detail.displayStatus, "IN_PROGRESS");
  assert.deepEqual(
    emails.map((email) => [email.complaintId, email.event]),
    [[feedbackId1, "CREATED"]],
  );

  const withLot = createHarness(
    { id: deliveryId1, deliveryNo: "FP-DE-00010", status: "REJECTED" },
    { id: lotId1, lotCode: "LOT-1" },
  );
  await withLot.service.create(
    {
      deliveryId: deliveryId1,
      ingredientLotId: lotId1,
      title: "Thịt có mùi lạ",
      issueType: "OTHER" as const,
      description: "Lô thịt có mùi lạ",
    },
    schoolSender,
  );
  assert.ok(withLot.calls.includes(`lot:${lotId1}:${deliveryId1}:SCHOOL`));
  assert.equal(
    (withLot.created[0] as { ingredientLotId: string }).ingredientLotId,
    lotId1,
  );
});

void test("create: rejects foreign/unknown delivery, unreceived delivery and lot outside the delivery", async () => {
  const body = {
    deliveryId: deliveryId1,
    title: "Cải bị dập",
    issueType: "OTHER" as const,
    description: "Một thùng cải bị dập",
  };
  const missing = createHarness(null);
  await assert.rejects(missing.service.create(body, schoolSender), {
    statusCode: 404,
  });
  for (const status of [
    "CREATED",
    "IN_TRANSIT",
    "ARRIVED",
    "APPROVED",
    "CANCELLED",
  ]) {
    const early = createHarness({ id: deliveryId1, deliveryNo: "D1", status });
    await assert.rejects(early.service.create(body, schoolSender), {
      statusCode: 409,
    });
    assert.ok(!early.calls.includes("create"), status);
  }
  const wrongLot = createHarness(
    { id: deliveryId1, deliveryNo: "D1", status: "RECEIVED" },
    null,
  );
  await assert.rejects(
    wrongLot.service.create({ ...body, ingredientLotId: lotId1 }, schoolSender),
    (error: { statusCode: number; fields: { field: string }[] }) =>
      error.statusCode === 400 && error.fields[0].field === "ingredientLotId",
  );
  assert.ok(!wrongLot.calls.includes("create"));
  assert.ok(!wrongLot.calls.includes("code:CP"));

  const noSubmit = createHarness({
    id: deliveryId1,
    deliveryNo: "D1",
    status: "RECEIVED",
  });
  await assert.rejects(
    noSubmit.service.create(body, {
      ...schoolSender,
      permissions: ["ingredient_quality_feedback.view_own"],
    }),
    { statusCode: 403 },
  );
  await assert.rejects(noSubmit.service.create(body, supplierAdminA), {
    statusCode: 403,
  });
  assert.equal(noSubmit.calls.length, 0);
});

void test("routes: POST / requires submit permission and returns 201 no-store", async (context) => {
  context.mock.method(console, "error", () => undefined);
  const { service } = createHarness({
    id: deliveryId1,
    deliveryNo: "FP-DE-00010",
    status: "RECEIVED",
  });
  const body = JSON.stringify({
    deliveryId: deliveryId1,
    title: "Cải bị dập",
    issueType: "SPOILED_OR_NOT_FRESH",
    description: "Một thùng cải bị dập",
  });
  const init = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  };
  const asSchool = await startApi(context, service, schoolSender);
  const created = await asSchool("", init);
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("cache-control"), "private, no-store");
  assert.equal(
    (created.body?.data as { code: string } | undefined)?.code,
    "FP-CP-00088",
  );
  const asSupplier = await startApi(context, service, supplierAdminA);
  assert.equal((await asSupplier("", init)).status, 403);
});

void test("catalog Q11: BGH submits and sees the whole school; kitchen/nutrition see only their own", () => {
  const grants: readonly (readonly [string, string])[] =
    INITIAL_ROLE_PERMISSIONS;
  const of = (role: string) =>
    grants
      .filter(
        ([r, code]) =>
          r === role && code.startsWith("ingredient_quality_feedback."),
      )
      .map(([, code]) => code)
      .sort();
  assert.deepEqual(of("SCHOOL_MANAGEMENT_BOARD"), [
    "ingredient_quality_feedback.submit",
    "ingredient_quality_feedback.view_details",
    "ingredient_quality_feedback.view_own",
  ]);
  for (const role of ["SCHOOL_KITCHEN_STAFF", "SCHOOL_NUTRITION_OFFICER"])
    assert.deepEqual(of(role), [
      "ingredient_quality_feedback.submit",
      "ingredient_quality_feedback.view_own",
    ]);
});

/** Lưu trữ giả: ghi lại upload/xóa, URL ký giả (specs/complaint-attachments). */
function memoryStorage(failOnUpload?: number) {
  const uploaded: string[] = [];
  const removed: string[] = [];
  const storage: EvidenceStorage = {
    upload: (_file, publicId) => {
      if (failOnUpload === uploaded.length)
        return Promise.reject(new Error("down"));
      uploaded.push(publicId);
      return Promise.resolve();
    },
    remove: (publicId) => {
      removed.push(publicId);
      return Promise.resolve();
    },
    url: (publicId) => `https://signed.example.test/${publicId}`,
  };
  return { storage, uploaded, removed };
}

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
const PDF = Buffer.from("%PDF-1.7\n%test\n");
const pngFile = {
  buffer: PNG,
  size: PNG.length,
  mimeType: "image/png",
  originalName: "rau-dap.png",
};
const pdfFile = {
  buffer: PDF,
  size: PDF.length,
  mimeType: "application/pdf",
  originalName: "phieu-giao.pdf",
};
const createBody = {
  deliveryId: deliveryId1,
  title: "Cải bị dập",
  issueType: "SPOILED_OR_NOT_FRESH" as const,
  description: "Một thùng cải bị dập",
};

void test("create with files: uploads before the transaction and records root attachments", async () => {
  const memory = memoryStorage();
  const h = createHarness(
    { id: deliveryId1, deliveryNo: "FP-DE-00010", status: "RECEIVED" },
    null,
    memory.storage,
  );
  await h.service.create(
    { ...createBody, files: [pngFile, pdfFile] },
    schoolSender,
  );
  assert.equal(memory.uploaded.length, 2);
  assert.ok(
    memory.uploaded.every((id) =>
      id.startsWith(`foodprint/complaints/${schoolSender.id}/`),
    ),
  );
  assert.match(memory.uploaded[0], /\.png$/);
  assert.match(memory.uploaded[1], /\.pdf$/);
  assert.deepEqual(memory.removed, []);
  assert.equal(h.attachments.length, 1);
  const input = h.attachments[0] as {
    complaintId: string;
    commentId: string | null;
    side: string;
    uploaderUserId: string;
    files: { publicId: string; mimeType: string; fileName: string }[];
  };
  assert.equal(input.complaintId, feedbackId1);
  assert.equal(input.commentId, null);
  assert.equal(input.side, "REQUESTER");
  assert.equal(input.uploaderUserId, schoolSender.id);
  assert.deepEqual(
    input.files.map((file) => [file.publicId, file.mimeType, file.fileName]),
    [
      [memory.uploaded[0], "image/png", "rau-dap.png"],
      [memory.uploaded[1], "application/pdf", "phieu-giao.pdf"],
    ],
  );
});

void test("create with files: business rejection removes the uploaded files", async () => {
  const memory = memoryStorage();
  const h = createHarness(
    { id: deliveryId1, deliveryNo: "D1", status: "IN_TRANSIT" },
    null,
    memory.storage,
  );
  await assert.rejects(
    h.service.create({ ...createBody, files: [pngFile] }, schoolSender),
    { statusCode: 409 },
  );
  assert.equal(memory.uploaded.length, 1);
  assert.deepEqual(memory.removed, memory.uploaded);
  assert.ok(!h.calls.includes("create"));
});

void test("create with files: invalid file content is rejected before any upload", async () => {
  const memory = memoryStorage();
  const h = createHarness(
    { id: deliveryId1, deliveryNo: "D1", status: "RECEIVED" },
    null,
    memory.storage,
  );
  await assert.rejects(
    h.service.create(
      {
        ...createBody,
        files: [pngFile, { ...pdfFile, mimeType: "image/png" }],
      },
      schoolSender,
    ),
    (error: { statusCode: number; fields: { field: string }[] }) =>
      error.statusCode === 400 && error.fields[0].field === "files.1",
  );
  assert.deepEqual(memory.uploaded, []);
  assert.equal(h.calls.length, 0);
});

void test("resolve with files: attachments belong to the RESOLUTION comment", async () => {
  const memory = memoryStorage();
  const attachments: { commentId: string | null; side: string }[] = [];
  const { service, comments } = harness({
    storage: memory.storage,
    repository: supplierRepository(target({ status: "IN_PROGRESS" })),
    tickets: {
      addAttachments: (_tx, input) => {
        attachments.push({ commentId: input.commentId, side: input.side });
        return Promise.resolve();
      },
    },
  });
  await service.resolve(
    { feedbackId: feedbackId1 },
    { content: "Đã đổi hàng", files: [pdfFile] },
    supplierAdminA,
  );
  assert.deepEqual(
    comments.map((comment) => comment.type),
    ["RESOLUTION"],
  );
  assert.deepEqual(attachments, [
    { commentId: "30000000-0000-4000-8000-0000000000c1", side: "HANDLER" },
  ]);
  assert.equal(memory.uploaded.length, 1);
});

void test("detail maps attachments with signed URLs and hides storage ids", async () => {
  const memory = memoryStorage();
  const file = {
    id: "40000000-0000-4000-8000-000000000001",
    storagePublicId: "foodprint/complaints/u/f.png",
    mimeType: "image/png",
    sizeBytes: 12,
    originalFilename: "rau-dap.png",
    uploaderSide: "REQUESTER" as const,
    createdAt: new Date("2026-11-19T01:00:00Z"),
  };
  const { service } = harness({
    storage: memory.storage,
    repository: {
      findDetail: () => Promise.resolve(detailRow({ attachments: [file] })),
    },
  });
  const detail = await service.getDetail(
    { feedbackId: feedbackId1 },
    supplierAdminA,
  );
  assert.equal(detail.issueType, "OTHER");
  assert.deepEqual(detail.attachments, [
    {
      id: file.id,
      fileName: "rau-dap.png",
      mimeType: "image/png",
      sizeBytes: 12,
      uploaderSide: "REQUESTER",
      createdAt: "2026-11-19T01:00:00.000Z",
      url: "https://signed.example.test/foodprint/complaints/u/f.png",
    },
  ]);
});

void test("routes: multipart create forwards text fields and files", async (context) => {
  const memory = memoryStorage();
  const h = createHarness(
    { id: deliveryId1, deliveryNo: "FP-DE-00010", status: "RECEIVED" },
    null,
    memory.storage,
  );
  const request = await startApi(context, h.service, schoolSender);
  const form = new FormData();
  form.set("deliveryId", deliveryId1);
  form.set("ingredientLotId", "");
  form.set("title", "Cải bị dập");
  form.set("issueType", "SPOILED_OR_NOT_FRESH");
  form.set("description", "Một thùng cải bị dập");
  form.append("files", new Blob([PNG], { type: "image/png" }), "a.png");
  const created = await request("", { method: "POST", body: form });
  assert.equal(created.status, 201);
  assert.equal(memory.uploaded.length, 1);
  assert.equal(
    (h.created[0] as { issueType: string }).issueType,
    "SPOILED_OR_NOT_FRESH",
  );

  const tooMany = new FormData();
  for (const [key, value] of Object.entries(createBody))
    tooMany.set(key, value);
  for (let index = 0; index < 6; index += 1)
    tooMany.append("files", new Blob([PNG], { type: "image/png" }), "a.png");
  const rejected = await request("", { method: "POST", body: tooMany });
  assert.equal(rejected.status, 400);
  assert.equal(memory.uploaded.length, 1);
});
