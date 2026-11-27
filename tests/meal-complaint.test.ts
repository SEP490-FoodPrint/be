import assert from "node:assert/strict";
import test from "node:test";
import {
  validateComplaintComment,
  validateComplaintReopen,
  validateComplaintResolve,
  validateCreateComplaint,
  validateFeedbackListQuery,
} from "../src/modules/feedback/feedback.validation";
import { createFeedbackRepository } from "../src/modules/feedback/feedback.repository";
import { createFeedbackService } from "../src/modules/feedback/feedback.service";
import type { AuthPrincipal } from "../src/types/auth";
import { listScopes } from "../src/utils/resource-access";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import type { FeedbackRepository } from "../src/modules/feedback/feedback.repository";
import type { ComplaintTicketRepository } from "../src/modules/complaint-ticket/complaint-ticket.repository";
import type { EvidenceStorage } from "../src/utils/evidence-files";
import { HttpError } from "../src/utils/http-error";
import { RequestValidationError } from "../src/utils/request-validation";

const principal = (overrides: Partial<AuthPrincipal> = {}): AuthPrincipal => ({
  id: "10000000-0000-4000-8000-000000000001",
  username: "teacher",
  fullName: "Giáo viên",
  roleId: "10000000-0000-4000-8000-000000000002",
  role: "HOMEROOM_TEACHER",
  orgType: "SCHOOL",
  schoolId: "10000000-0000-4000-8000-000000000003",
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: ["meal_complaint.submit", "meal_complaint.view"],
  ...overrides,
});
const board = (overrides: Partial<AuthPrincipal> = {}) =>
  principal({
    id: "10000000-0000-4000-8000-000000000009",
    role: "SCHOOL_MANAGEMENT_BOARD",
    permissions: ["meal_complaint.view", "meal_complaint.respond"],
    ...overrides,
  });

void test("GVCN list scope is own MEAL complaints in own school", () => {
  const actor = principal();
  assert.deepEqual(listScopes.feedback(actor), {
    kind: "MEAL",
    mealComplaint: { is: { schoolId: actor.schoolId } },
    senderUserId: actor.id,
  });
});
void test("đại diện phụ huynh chỉ đọc đơn của mình", () => {
  const actor = principal({ role: "PARENTS_COMMITTEE" });
  assert.deepEqual(listScopes.feedback(actor), {
    kind: "MEAL",
    mealComplaint: { is: { schoolId: actor.schoolId } },
    senderUserId: actor.id,
  });
  assert.throws(() => listScopes.feedback({ ...actor, permissions: [] }), {
    statusCode: 403,
  });
});
void test("BGH list scope is school-wide", () => {
  const actor = board();
  assert.deepEqual(listScopes.feedback(actor), {
    kind: "MEAL",
    mealComplaint: { is: { schoolId: actor.schoolId } },
  });
});
void test("create rejects server-owned fields and HEALTH_ISSUE (Q21)", () => {
  const valid = {
    dailyMealPortionId: "10000000-0000-4000-8000-000000000020",
    complaintType: "MEAL_QUALITY",
    title: "Suất ăn có mùi lạ",
    description: "Suất ăn có mùi bất thường.",
  };
  assert.deepEqual(validateCreateComplaint(valid), valid);
  assert.equal(
    validateCreateComplaint({ ...valid, title: "  Cơm bị sống  " }).title,
    "Cơm bị sống",
  );
  for (const extra of [
    { senderUserId: principal().id },
    { status: "RESOLVED" },
    { code: "FP-MC-00001" },
    { title: undefined },
    { title: "Ngắn" },
    { title: "ạ".repeat(256) },
    { files: "not-a-file" },
  ])
    assert.throws(() => validateCreateComplaint({ ...valid, ...extra }), {
      statusCode: 400,
    });
  assert.throws(
    () => validateCreateComplaint({ ...valid, complaintType: "HEALTH_ISSUE" }),
    { statusCode: 400 },
  );
});
void test("ticket bodies trim content, require resolution text, reason optional", () => {
  assert.deepEqual(validateComplaintComment({ content: "  Xin chào  " }), {
    content: "Xin chào",
  });
  assert.throws(() => validateComplaintComment({ content: "   " }), {
    statusCode: 400,
  });
  assert.throws(() => validateComplaintResolve({}), { statusCode: 400 });
  assert.throws(() => validateComplaintResolve({ content: "x".repeat(5001) }), {
    statusCode: 400,
  });
  assert.deepEqual(validateComplaintReopen(undefined), {});
  assert.deepEqual(validateComplaintReopen({ reason: " Chưa ổn " }), {
    reason: "Chưa ổn",
  });
  assert.throws(() => validateComplaintReopen({ reason: "" }), {
    statusCode: 400,
  });
});
void test("list filters validate ticket statuses and range", () => {
  assert.deepEqual(
    validateFeedbackListQuery({
      page: "2",
      limit: "10",
      status: "IN_PROGRESS",
    }),
    { page: 2, limit: 10, status: "IN_PROGRESS" },
  );
  assert.throws(() =>
    validateFeedbackListQuery({ from: "2026-11-10", to: "2026-11-01" }),
  );
  for (const status of ["REJECTED", "SUBMITTED", "IN_REVIEW"])
    assert.throws(() => validateFeedbackListQuery({ status }));
});

const NOW = new Date("2026-11-20T03:00:00.000Z");
const row = (overrides: Record<string, unknown> = {}) => ({
  id: "c1",
  code: "FP-MC-58213",
  title: "Khiếu nại suất ăn lớp 5A - Bữa trưa ngày 19/11/2026",
  description: "Mô tả",
  status: "IN_PROGRESS",
  senderUserId: principal().id,
  lastResolvedAt: null,
  resolvedCount: 0,
  closeReason: null,
  closedAt: null,
  submittedAt: new Date("2026-11-19T01:00:00Z"),
  updatedAt: new Date("2026-11-19T01:00:00Z"),
  senderUser: { id: principal().id, fullName: "GV" },
  mealComplaint: {
    schoolId: principal().schoolId,
    complaintType: "OTHER",
    DailyMealPortion: {
      id: "p1",
      mealDate: new Date("2026-11-19T00:00:00Z"),
      mealType: "LUNCH",
      Class: { id: "k1", name: "5A", academicYear: "2026-2027" },
      MealAllocation: null,
    },
  },
  comments: [{ authorSide: "REQUESTER" }],
  ...overrides,
});

void test("hai lớp trạng thái: người gửi thấy Đang xử lý, BGH thấy nhãn tin nhắn mới", async () => {
  const service = createFeedbackService(
    {
      ...createFeedbackRepository(),
      list: () => Promise.resolve([row()]),
    } as never,
    () => Promise.resolve({} as never),
    () => NOW,
  );
  const [forBoard] = (await service.getAll({ page: 1, limit: 20 }, board()))
    .items;
  assert.equal(forBoard.status, "IN_PROGRESS");
  assert.equal(forBoard.displayStatus, "IN_PROGRESS");
  assert.equal(forBoard.hasNewMessage, true);
  assert.deepEqual(forBoard.allowedActions, ["COMMENT", "RESOLVE"]);
  assert.equal(forBoard.code, "FP-MC-58213");

  const [forSender] = (
    await service.getAll({ page: 1, limit: 20 }, principal())
  ).items;
  assert.equal(forSender.hasNewMessage, false);
  assert.deepEqual(forSender.allowedActions, ["COMMENT"]);
});

void test("lọc trạng thái: người gửi theo trạng thái hiển thị, BGH theo trạng thái thật", async () => {
  const seen: unknown[] = [];
  const service = createFeedbackService(
    {
      ...createFeedbackRepository(),
      list: (
        _db: unknown,
        _scope: unknown,
        _query: unknown,
        statuses?: unknown,
      ) => {
        seen.push(statuses);
        return Promise.resolve([]);
      },
    } as never,
    () => Promise.resolve({} as never),
    () => NOW,
  );
  const list = (status: string | undefined, actor: AuthPrincipal) =>
    service.getAll(
      { page: 1, limit: 20, ...(status ? { status: status as never } : {}) },
      actor,
    );
  await list("IN_PROGRESS", principal());
  await list("RESOLVED", principal({ role: "PARENTS_COMMITTEE" }));
  await list(undefined, principal());
  await list("IN_PROGRESS", board());
  await list("NEW", board());
  assert.deepEqual(seen, [
    ["NEW", "IN_PROGRESS", "REOPENED"],
    ["RESOLVED"],
    undefined,
    ["IN_PROGRESS"],
    ["NEW"],
  ]);
  for (const status of ["NEW", "REOPENED"])
    await assert.rejects(list(status, principal()), { statusCode: 400 });
  assert.equal(seen.length, 5);
});

void test("RESOLVED: người gửi có 48h để Hài lòng / Yêu cầu xử lý lại", async () => {
  const resolvedAt = new Date(NOW.getTime() - 47 * 3600 * 1000);
  const make = (lastResolvedAt: Date) =>
    createFeedbackService(
      {
        ...createFeedbackRepository(),
        findOne: () =>
          Promise.resolve(
            row({
              status: "RESOLVED",
              lastResolvedAt,
              resolvedCount: 1,
              attachments: [],
              comments: [],
            }),
          ),
      } as never,
      () => Promise.resolve({} as never),
      () => NOW,
    );
  const open = await make(resolvedAt).getOne("c1", principal());
  assert.equal(open.displayStatus, "RESOLVED");
  assert.deepEqual(open.allowedActions, ["SATISFY", "REOPEN"]);
  assert.equal(
    open.feedbackDeadlineAt,
    new Date(resolvedAt.getTime() + 48 * 3600 * 1000).toISOString(),
  );
  assert.deepEqual(open.comments, []);
  const expired = await make(new Date(NOW.getTime() - 48 * 3600 * 1000)).getOne(
    "c1",
    principal(),
  );
  assert.deepEqual(expired.allowedActions, []);
  const handlerView = await make(resolvedAt).getOne("c1", board());
  assert.deepEqual(handlerView.allowedActions, []);
});

// ---------------------------------------------------------------------------
// Unit test cho FeedbackService.create (tạo khiếu nại bữa ăn) theo ma trận UTCID.
// Precondition chung: GVCN lớp 5A đủ quyền `meal_complaint.submit`, trường ACTIVE,
// hôm nay (NOW) lớp có suất trưa đã giao (DISTRIBUTED) và suất chiều đã chốt (FINALIZED).
// Body đi qua `validateCreateComplaint` như controller trước khi vào service.
// ---------------------------------------------------------------------------
const LUNCH_ID = "10000000-0000-4000-8000-000000000021";
const AFTERNOON_ID = "10000000-0000-4000-8000-000000000022";
const CREATED_ID = "10000000-0000-4000-8000-000000000030";

function identityOf(actor: AuthPrincipal) {
  return {
    id: actor.id,
    username: actor.username,
    fullName: actor.fullName,
    status: "ACTIVE",
    roleId: actor.roleId,
    schoolId: actor.schoolId,
    supplierId: actor.supplierId,
    communeFoodSafetyUnitId: actor.communeFoodSafetyUnitId,
    Role: {
      code: actor.role,
      type: actor.orgType,
      rolePermissions: actor.permissions.map((code) => ({
        permission: { code, isActive: true },
      })),
    },
    permissionDenials: [],
  };
}

function createFixture(
  options: {
    actor?: AuthPrincipal;
    lunchStatus?: string;
    classes?: unknown[];
    schoolStatus?: string;
  } = {},
) {
  const actor = options.actor ?? principal();
  const created: Record<string, unknown>[] = [];
  const history: string[] = [];
  const emails: {
    complaintId: string;
    event: string;
    recipientEmail: string;
  }[] = [];
  const classes = options.classes ?? [
    {
      id: "k1",
      name: "5A",
      dailyMealPortions: [
        {
          id: LUNCH_ID,
          mealType: "LUNCH",
          MealAllocation: { status: options.lunchStatus ?? "DISTRIBUTED" },
        },
        {
          id: AFTERNOON_ID,
          mealType: "AFTERNOON",
          MealAllocation: { status: "FINALIZED" },
        },
      ],
    },
  ];
  const db = {
    $transaction: <T>(op: (tx: Prisma.TransactionClient) => Promise<T>) =>
      op({
        $queryRaw: () => Promise.resolve([]),
        school: {
          findUnique: () =>
            Promise.resolve({ status: options.schoolStatus ?? "ACTIVE" }),
        },
        user: { findUnique: () => Promise.resolve(identityOf(actor)) },
      } as unknown as Prisma.TransactionClient),
  } as unknown as PrismaClient;
  const repository = {
    ...createFeedbackRepository(),
    findMealOptions: () => Promise.resolve(classes),
    create: (_tx: unknown, data: Record<string, unknown>) => {
      created.push(data);
      return Promise.resolve({ id: CREATED_ID });
    },
    findOne: () => {
      const data = created[0] ?? {};
      const mealType =
        data.dailyMealPortionId === AFTERNOON_ID ? "AFTERNOON" : "LUNCH";
      return Promise.resolve(
        row({
          id: CREATED_ID,
          code: data.code,
          title: data.title,
          description: data.description,
          status: "NEW",
          senderUserId: actor.id,
          senderRoleCode: actor.role,
          submittedAt: NOW,
          updatedAt: NOW,
          mealComplaint: {
            schoolId: actor.schoolId,
            complaintType: data.complaintType,
            authorityEscalation: null,
            DailyMealPortion: {
              id: data.dailyMealPortionId,
              mealDate: new Date("2026-11-20T00:00:00Z"),
              mealType,
              Class: { id: "k1", name: "5A", academicYear: "2026-2027" },
              MealAllocation: {
                id: "a1",
                status: mealType === "LUNCH" ? "DISTRIBUTED" : "FINALIZED",
              },
            },
          },
          attachments: [],
          comments: [],
        }),
      );
    },
  } as unknown as FeedbackRepository;
  const tickets = {
    allocateCode: () => Promise.resolve("FP-MC-58213"),
    addAttachments: () => Promise.resolve(),
    recordCreated: (_tx: unknown, id: string) => {
      history.push(id);
      return Promise.resolve();
    },
    findEmailRecipient: () =>
      Promise.resolve({
        kind: "MEAL",
        code: "FP-MC-58213",
        title: "Suất ăn có mùi lạ",
        description: "Suất ăn có mùi bất thường.",
        senderUser: {
          email: "gvcn@example.test",
          fullName: actor.fullName,
          status: "ACTIVE",
        },
        comments: [],
      }),
    queueEmail: (
      _tx: unknown,
      input: { complaintId: string; event: string; recipientEmail: string },
    ) => {
      emails.push(input);
      return Promise.resolve();
    },
  } as unknown as ComplaintTicketRepository;
  const storage = {
    upload: () => Promise.reject(new Error("không dùng")),
    remove: () => Promise.resolve(),
    url: () => "https://example.test/file",
  } as unknown as EvidenceStorage;
  const service = createFeedbackService(
    repository,
    () => Promise.resolve(db),
    () => NOW,
    tickets,
    storage,
  );
  return {
    actor,
    created,
    history,
    emails,
    // Giống controller: body được validate trước khi vào service.
    create: (body: Record<string, unknown>, who: AuthPrincipal = actor) =>
      service.create(validateCreateComplaint(body), who),
  };
}
const complaintBody = (extra: Record<string, unknown> = {}) => ({
  dailyMealPortionId: LUNCH_ID,
  complaintType: "MEAL_QUALITY",
  title: "Suất ăn có mùi lạ",
  description: "Suất ăn có mùi bất thường.",
  ...extra,
});
const fieldError = (field: string, message: string) => (error: unknown) =>
  error instanceof RequestValidationError &&
  error.fields.some(
    (issue) => issue.field === field && issue.message === message,
  );
const statusError = (statusCode: number, message: string) => (error: unknown) =>
  error instanceof HttpError &&
  error.statusCode === statusCode &&
  error.message === message;

void test("UTCID01 [N] create: GVCN gửi MEAL_QUALITY cho suất trưa đã giao → tạo khiếu nại FP-MC, ghi lịch sử, gửi email", async () => {
  const fixture = createFixture();
  const result = await fixture.create(complaintBody());
  assert.equal(result.code, "FP-MC-58213");
  assert.equal(result.complaintType, "MEAL_QUALITY");
  assert.equal(result.meal.className, "5A");
  assert.equal(result.meal.mealType, "LUNCH");
  assert.deepEqual(fixture.created[0], {
    code: "FP-MC-58213",
    title: "Suất ăn có mùi lạ",
    description: "Suất ăn có mùi bất thường.",
    senderUserId: fixture.actor.id,
    senderRoleCode: "HOMEROOM_TEACHER",
    schoolId: fixture.actor.schoolId,
    dailyMealPortionId: LUNCH_ID,
    complaintType: "MEAL_QUALITY",
  });
  assert.deepEqual(fixture.history, [CREATED_ID]);
  assert.equal(fixture.emails.length, 1);
  assert.equal(fixture.emails[0]?.event, "CREATED");
});

void test("UTCID02 [N] create: Ban đại diện phụ huynh gửi FOOD_HYGIENE → tạo thành công", async () => {
  const fixture = createFixture({
    actor: principal({ role: "PARENTS_COMMITTEE" }),
  });
  const result = await fixture.create(
    complaintBody({ complaintType: "FOOD_HYGIENE" }),
  );
  assert.equal(result.complaintType, "FOOD_HYGIENE");
  assert.equal(fixture.created[0]?.senderRoleCode, "PARENTS_COMMITTEE");
});

void test("UTCID03 [N] create: loại OTHER cho suất chiều đã chốt (FINALIZED) → tạo thành công", async () => {
  const fixture = createFixture();
  const result = await fixture.create(
    complaintBody({ dailyMealPortionId: AFTERNOON_ID, complaintType: "OTHER" }),
  );
  assert.equal(result.complaintType, "OTHER");
  assert.equal(result.meal.mealType, "AFTERNOON");
});

void test("UTCID04 [B] create: tiêu đề đúng 5 ký tự → hợp lệ", async () => {
  const fixture = createFixture();
  const result = await fixture.create(complaintBody({ title: "Cơm s" }));
  assert.equal(result.title, "Cơm s");
});

void test("UTCID05 [B] create: tiêu đề 4 ký tự → lỗi 'Tiêu đề tối thiểu 5 ký tự'", async () => {
  const fixture = createFixture();
  await assert.rejects(
    async () => fixture.create(complaintBody({ title: "Cơmm" })),
    fieldError("title", "Tiêu đề tối thiểu 5 ký tự"),
  );
  assert.equal(fixture.created.length, 0);
});

void test("UTCID06 [B] create: tiêu đề đúng 255 ký tự → hợp lệ", async () => {
  const fixture = createFixture();
  const title = "ạ".repeat(255);
  const result = await fixture.create(complaintBody({ title }));
  assert.equal(result.title, title);
});

void test("UTCID07 [B] create: tiêu đề 256 ký tự → lỗi 'Tiêu đề chỉ nhận tối đa 255 ký tự'", async () => {
  const fixture = createFixture();
  await assert.rejects(
    async () => fixture.create(complaintBody({ title: "ạ".repeat(256) })),
    fieldError("title", "Tiêu đề chỉ nhận tối đa 255 ký tự"),
  );
  assert.equal(fixture.created.length, 0);
});

void test("UTCID08 [B] create: nội dung đúng 10 ký tự → hợp lệ", async () => {
  const fixture = createFixture();
  const result = await fixture.create(
    complaintBody({ description: "Cơm bị sốn" }),
  );
  assert.equal(result.description, "Cơm bị sốn");
});

void test("UTCID09 [B] create: nội dung 9 ký tự → lỗi 'Nội dung tối thiểu 10 ký tự'", async () => {
  const fixture = createFixture();
  await assert.rejects(
    async () => fixture.create(complaintBody({ description: "Cơm bị số" })),
    fieldError("description", "Nội dung tối thiểu 10 ký tự"),
  );
  assert.equal(fixture.created.length, 0);
});

void test("UTCID10 [A] create: loại HEALTH_ISSUE → lỗi, vấn đề sức khỏe gửi qua báo cáo sự cố", async () => {
  const fixture = createFixture();
  await assert.rejects(
    async () =>
      fixture.create(complaintBody({ complaintType: "HEALTH_ISSUE" })),
    fieldError(
      "complaintType",
      "Loại khiếu nại không hợp lệ; vấn đề sức khỏe gửi qua báo cáo sự cố",
    ),
  );
  assert.equal(fixture.created.length, 0);
});

void test("UTCID11 [A] create: dailyMealPortionId không phải UUID → lỗi 'Mục đã chọn không hợp lệ.'", async () => {
  const fixture = createFixture();
  await assert.rejects(
    async () => fixture.create(complaintBody({ dailyMealPortionId: "abc" })),
    fieldError("dailyMealPortionId", "Mục đã chọn không hợp lệ."),
  );
  assert.equal(fixture.created.length, 0);
});

void test("UTCID12 [A] create: Ban giám hiệu gửi khiếu nại → 403", async () => {
  const fixture = createFixture({ actor: board() });
  await assert.rejects(
    async () => fixture.create(complaintBody()),
    statusError(403, "Vai trò không được phép gửi khiếu nại"),
  );
  assert.equal(fixture.created.length, 0);
});

void test("UTCID13 [A] create: GVCN thiếu quyền meal_complaint.submit → 403", async () => {
  const fixture = createFixture({
    actor: principal({ permissions: ["meal_complaint.view"] }),
  });
  await assert.rejects(
    async () => fixture.create(complaintBody()),
    statusError(403, "Bạn không có quyền thực hiện thao tác này"),
  );
  assert.equal(fixture.created.length, 0);
});

void test("UTCID14 [A] create: suất ăn không thuộc lớp/hôm nay → 404", async () => {
  const fixture = createFixture();
  await assert.rejects(
    async () =>
      fixture.create(
        complaintBody({
          dailyMealPortionId: "10000000-0000-4000-8000-000000000099",
        }),
      ),
    statusError(404, "Suất ăn không thuộc phạm vi được gửi hôm nay"),
  );
  assert.equal(fixture.created.length, 0);
});

void test("UTCID15 [A] create: bữa ăn chưa xác nhận giao (ALLOCATED) → 409", async () => {
  const fixture = createFixture({ lunchStatus: "ALLOCATED" });
  await assert.rejects(
    async () => fixture.create(complaintBody()),
    statusError(409, "Bữa ăn chưa được xác nhận giao"),
  );
  assert.equal(fixture.created.length, 0);
});

void test("UTCID16 [A] create: GVCN chưa được phân công chủ nhiệm → 404", async () => {
  const fixture = createFixture({ classes: [] });
  await assert.rejects(
    async () => fixture.create(complaintBody()),
    statusError(404, "Chưa có phân công chủ nhiệm trong niên khóa hiện tại"),
  );
  assert.equal(fixture.created.length, 0);
});

void test("UTCID17 [A] create: trường không còn hoạt động → 409", async () => {
  const fixture = createFixture({ schoolStatus: "INACTIVE" });
  await assert.rejects(
    async () => fixture.create(complaintBody()),
    statusError(409, "Trường không còn hoạt động"),
  );
  assert.equal(fixture.created.length, 0);
});
