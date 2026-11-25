import {
  assertMenuDaysEditable,
  assertMenuWeekOpen,
  assertNoHolidayMenuDays,
  menuWeekLock,
} from "../src/utils/menu-week";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import { ROLES } from "../src/constants/roles";
import {
  createMenuApprovalService,
  type MenuApprovalService,
} from "../src/modules/menu-approval/menu-approval.service";
import type {
  ApprovalDecisionRow,
  ApprovalDetailRow,
  MenuApprovalRepository,
} from "../src/modules/menu-approval/menu-approval.repository";
import { validateMenuApprovalDecision } from "../src/modules/menu-approval/menu-approval.validation";
import type { AuthPrincipal } from "../src/types/auth";
import { HttpError } from "../src/utils/http-error";
import { RequestValidationError } from "../src/utils/request-validation";

const schoolId = "00000000-0000-4000-8000-0000000000a1";
const menuId = "00000000-0000-4000-8000-0000000000a2";
const reviewerId = "00000000-0000-4000-8000-0000000000b1";

const board: AuthPrincipal = {
  id: reviewerId,
  username: "school_bgh",
  fullName: "Ban Giám hiệu",
  roleId: "00000000-0000-4000-8000-0000000000b2",
  role: ROLES.SCHOOL_MANAGEMENT_BOARD,
  orgType: "SCHOOL",
  schoolId,
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: ["menu.view", "menu.review", "menu.approve"],
};

function transactionDatabase(actor: AuthPrincipal): PrismaClient {
  const identity = {
    id: actor.id,
    username: actor.username,
    fullName: actor.fullName,
    roleId: actor.roleId,
    schoolId: actor.schoolId,
    supplierId: null,
    communeFoodSafetyUnitId: null,
    status: "ACTIVE",
    Role: {
      code: actor.role,
      type: "SCHOOL",
      rolePermissions: actor.permissions.map((code) => ({
        permission: { code, isActive: true },
      })),
    },
    permissionDenials: [],
  };
  const tx = {
    $queryRaw: () => Promise.resolve([]),
    user: { findUnique: () => Promise.resolve(identity) },
    school: { findUnique: () => Promise.resolve({ status: "ACTIVE" }) },
  };
  return {
    $transaction: (operation: (client: typeof tx) => Promise<unknown>) =>
      operation(tx),
  } as unknown as PrismaClient;
}

function decisionWeek(
  status: ApprovalDecisionRow["status"] = "PENDING_APPROVAL",
  ready = true,
): ApprovalDecisionRow {
  return {
    id: menuId,
    schoolId,
    status,
    weekStartDate: new Date("2026-11-02"),
    menuDays: ready
      ? Array.from({ length: 5 }, (_, index) => ({
          menuDate: new Date(Date.UTC(2026, 10, 2 + index)),
          approvalStatus: "PENDING_APPROVAL",
          menuDayDishes: ["LUNCH", "AFTERNOON"].map((mealType) => ({
            mealType,
            Dish: { status: "ACTIVE" },
            ingredients: [{}],
          })),
        }))
      : [],
  } as unknown as ApprovalDecisionRow;
}

function decisionHarness(options?: {
  actor?: AuthPrincipal;
  week?: ApprovalDecisionRow;
  years?: Awaited<ReturnType<MenuApprovalRepository["academicYears"]>>;
}) {
  const actor = options?.actor ?? board;
  const writes = {
    reviews: [] as Array<Record<string, unknown>>,
    days: [] as Array<{ id: string; status: string }>,
    weeks: [] as Array<{
      id: string;
      status: string;
      approvedAt: Date | null;
    }>,
  };
  const repository: MenuApprovalRepository = {
    connect: () => Promise.resolve(transactionDatabase(actor)),
    academicYears: (_tx, requestedSchoolId) => {
      assert.equal(requestedSchoolId, actor.schoolId);
      return Promise.resolve(options?.years ?? []);
    },
    findDetail: () => Promise.resolve(null),
    findFinalizedPortions: () => Promise.resolve([]),
    findWeekDetails: () => Promise.resolve([]),
    listSubmittedWeeks: () => Promise.resolve([]),
    findForDecision: () => Promise.resolve(options?.week ?? decisionWeek()),
    createReview: (_tx, input) => {
      writes.reviews.push(input);
      return Promise.resolve({
        reviewedAt: new Date("2026-11-04T01:00:00.000Z"),
        User: { id: reviewerId, fullName: "Ban Giám hiệu" },
      });
    },
    updateAllDays: (_tx, id, status) => {
      writes.days.push({ id, status });
      return Promise.resolve();
    },
    updateWeek: (_tx, id, status, approvedAt) => {
      writes.weeks.push({ id, status, approvedAt });
      return Promise.resolve();
    },
  };
  return { writes, service: createMenuApprovalService(repository) };
}

void test("decision validation rejects menuDayId and requires revision feedback", () => {
  assert.throws(
    () =>
      validateMenuApprovalDecision({
        menuDayId: "00000000-0000-4000-8000-0000000000d1",
        decision: "APPROVED",
      }),
    RequestValidationError,
  );
  assert.throws(
    () => validateMenuApprovalDecision({ decision: "REVISION_REQUESTED" }),
    RequestValidationError,
  );
  assert.deepEqual(validateMenuApprovalDecision({ decision: "APPROVED" }), {
    decision: "APPROVED",
    feedback: null,
  });
});

void test("review refuses a stale submission version before recording a decision", async () => {
  const week = {
    ...decisionWeek(),
    submittedAt: new Date("2026-11-13T10:00:00Z"),
  };
  const { service, writes } = decisionHarness({ week });
  await assert.rejects(
    () =>
      service.decide(
        menuId,
        validateMenuApprovalDecision({
          decision: "APPROVED",
          submissionVersion: "2026-11-13T09:00:00.000Z",
        }),
        board,
      ),
    { statusCode: 409 },
  );
  assert.deepEqual(writes, { reviews: [], days: [], weeks: [] });
  await service.decide(
    menuId,
    validateMenuApprovalDecision({
      decision: "APPROVED",
      submissionVersion: week.submittedAt.toISOString(),
    }),
    board,
  );
  assert.equal(writes.reviews.length, 1);
});

void test("revision request records one week decision and updates every day", async () => {
  const { service, writes } = decisionHarness();
  const result = await service.decide(
    menuId,
    { decision: "REVISION_REQUESTED", feedback: "Đổi món thứ Ba" },
    board,
  );
  assert.equal(result.weeklyStatus, "REVISION_REQUIRED");
  assert.deepEqual(writes.days, [{ id: menuId, status: "REVISION_REQUIRED" }]);
  assert.deepEqual(writes.weeks, [
    { id: menuId, status: "REVISION_REQUIRED", approvedAt: null },
  ]);
  assert.deepEqual(writes.reviews, [
    {
      weeklyMenuId: menuId,
      reviewerUserId: reviewerId,
      decision: "REVISION_REQUESTED",
      feedback: "Đổi món thứ Ba",
    },
  ]);
});

void test("approval synchronizes the week and stores the review timestamp", async () => {
  const { service, writes } = decisionHarness();
  const result = await service.decide(
    menuId,
    { decision: "APPROVED", feedback: null },
    board,
  );
  const reviewedAt = new Date("2026-11-04T01:00:00.000Z");
  assert.equal(result.weeklyStatus, "APPROVED");
  assert.equal(result.reviewedAt, reviewedAt.toISOString());
  assert.deepEqual(writes.days, [{ id: menuId, status: "APPROVED" }]);
  assert.deepEqual(writes.weeks, [
    { id: menuId, status: "APPROVED", approvedAt: reviewedAt },
  ]);
});

void test("approval refuses an incomplete week before writing", async () => {
  const { service, writes } = decisionHarness({
    week: decisionWeek("PENDING_APPROVAL", false),
  });
  await assert.rejects(
    service.decide(menuId, { decision: "APPROVED", feedback: null }, board),
    (error: unknown) => error instanceof HttpError && error.statusCode === 422,
  );
  assert.equal(writes.reviews.length, 0);
  assert.equal(writes.days.length, 0);
  assert.equal(writes.weeks.length, 0);
});

void test("approval rejects one saved day and a full week missing afternoon meals without recording a review", async () => {
  for (const mode of ["one-day", "lunch-only"]) {
    const week = decisionWeek();
    if (mode === "one-day") week.menuDays = week.menuDays.slice(0, 1);
    else
      week.menuDays.forEach((day) => {
        day.menuDayDishes = day.menuDayDishes.filter(
          (dish) => dish.mealType === "LUNCH",
        );
      });
    const { service, writes } = decisionHarness({ week });
    await assert.rejects(
      service.decide(menuId, { decision: "APPROVED", feedback: null }, board),
      { statusCode: 422 },
    );
    assert.deepEqual(writes, { reviews: [], days: [], weeks: [] });
  }
});

void test("school holidays exempt missing weekdays but not a missing meal on an open day", async () => {
  const week = decisionWeek();
  week.menuDays = week.menuDays.slice(0, 1);
  const years = [
    {
      startDate: new Date("2026-09-01"),
      endDate: new Date("2027-06-01"),
      holidays: [
        {
          startDate: "2026-11-03",
          endDate: "2026-11-06",
          reason: "School closure",
        },
      ],
    },
  ];
  const { service, writes } = decisionHarness({ week, years });
  assert.equal(
    (
      await service.decide(
        menuId,
        { decision: "APPROVED", feedback: null },
        board,
      )
    ).weeklyStatus,
    "APPROVED",
  );
  assert.equal(writes.reviews.length, 1);
  week.menuDays[0].menuDayDishes = week.menuDays[0].menuDayDishes.slice(0, 1);
  const invalid = decisionHarness({ week, years });
  await assert.rejects(
    invalid.service.decide(
      menuId,
      { decision: "APPROVED", feedback: null },
      board,
    ),
    { statusCode: 422 },
  );
  assert.equal(invalid.writes.reviews.length, 0);
});

void test("only a pending week can be decided", async () => {
  const { service, writes } = decisionHarness({
    week: decisionWeek("APPROVED"),
  });
  await assert.rejects(
    service.decide(
      menuId,
      { decision: "REVISION_REQUESTED", feedback: "Sửa lại" },
      board,
    ),
    (error: unknown) => error instanceof HttpError && error.statusCode === 409,
  );
  assert.equal(writes.reviews.length, 0);
});

void test("a non-board account cannot decide even with the permission", async () => {
  const nonBoard = { ...board, role: ROLES.SCHOOL_ADMINISTRATION };
  const { service, writes } = decisionHarness({ actor: nonBoard });
  await assert.rejects(
    service.decide(
      menuId,
      { decision: "REVISION_REQUESTED", feedback: "Sửa lại" },
      nonBoard,
    ),
    (error: unknown) => error instanceof HttpError && error.statusCode === 403,
  );
  assert.equal(writes.reviews.length, 0);
});

function detailRow(): ApprovalDetailRow {
  const monday = new Date("2026-11-02T00:00:00.000Z");
  return {
    id: menuId,
    title: "Tuần 45",
    status: "PENDING_APPROVAL",
    submittedAt: new Date("2026-10-30T01:00:00.000Z"),
    weekStartDate: monday,
    School: { name: "Trường A" },
    User: { fullName: "Nguyễn Dinh Dưỡng" },
    menuDays: [
      {
        id: "00000000-0000-4000-8000-0000000000d1",
        menuDate: monday,
        menuDayDishes: [],
      },
    ],
    menuReviewRecords: [
      {
        decision: "REVISION_REQUESTED",
        feedback: "Nhận xét cũ",
        reviewedAt: new Date("2026-10-20T01:00:00.000Z"),
        User: {
          fullName: "Ban Giám hiệu",
          Role: { code: ROLES.SCHOOL_MANAGEMENT_BOARD },
        },
      },
    ],
  } as unknown as ApprovalDetailRow;
}

void test("approval detail stays in school scope and uses finalized class demand", async () => {
  let requestedScope: { id: string; schoolId: string } | undefined;
  const repository = {
    connect: () => Promise.resolve(transactionDatabase(board)),
    findDetail: (id: string, requestedSchoolId: string) => {
      requestedScope = { id, schoolId: requestedSchoolId };
      return Promise.resolve(detailRow());
    },
    findFinalizedPortions: () =>
      Promise.resolve([
        {
          mealDate: new Date("2026-11-02T00:00:00.000Z"),
          mealType: "LUNCH" as const,
          totalPortions: 420,
        },
        {
          mealDate: new Date("2026-11-02T00:00:00.000Z"),
          mealType: "AFTERNOON" as const,
          totalPortions: 390,
        },
      ]),
    findWeekDetails: () => Promise.resolve([]),
    listSubmittedWeeks: () => Promise.resolve([]),
    findForDecision: () => Promise.resolve(null),
    academicYears: () => Promise.resolve([]),
    createReview: () => Promise.reject(new Error("not used")),
    updateAllDays: () => Promise.reject(new Error("not used")),
    updateWeek: () => Promise.reject(new Error("not used")),
  } satisfies MenuApprovalRepository;
  const service: MenuApprovalService = createMenuApprovalService(repository);
  const detail = await service.getDetail(menuId, board);
  assert.deepEqual(requestedScope, { id: menuId, schoolId });
  assert.equal(detail.days[0]?.portions, 420);
  assert.equal(detail.canDecide, true);
  assert.equal(detail.approval.approver, null);
  assert.equal(detail.approval.note, "");
  assert.equal(detail.summary.proposer, "Nguyễn Dinh Dưỡng");
  assert.equal(
    detail.summary.proposerDetail,
    "Nhân viên Dinh dưỡng · Trường A",
  );
  assert.equal(detail.medicalReview.role, "Nhân viên Dinh dưỡng");
});

void test("approval uses selected grades for demand and suppliers from the saved menu ingredients", async () => {
  const menu = detailRow();
  menu.grades = [{ gradeId: "grade-one", grade: { name: "Khối 1" } }] as never;
  menu.menuDays[0].menuDayDishes = [
    {
      mealType: "LUNCH",
      Dish: { name: "Thịt", description: null, dishIngredientEntries: [] },
      ingredients: [
        {
          ingredient: {
            Supplier: { id: "supplier-snapshot", name: "NCC đã chọn" },
          },
        },
      ],
    },
  ] as never;
  let selectedGrades: string[] | undefined;
  const repository = {
    findDetail: () => Promise.resolve(menu),
    findFinalizedPortions: (
      _dates: Date[],
      requestedSchoolId: string,
      gradeIds?: string[],
    ) => {
      assert.equal(requestedSchoolId, schoolId);
      selectedGrades = gradeIds;
      return Promise.resolve([]);
    },
  } as unknown as MenuApprovalRepository;
  const detail = await createMenuApprovalService(repository).getDetail(
    menuId,
    board,
  );
  assert.deepEqual(selectedGrades, ["grade-one"]);
  assert.equal(detail.summary.audience, "Khối 1");
  assert.equal(detail.summary.supplier, "1 nhà cung cấp");
  assert.equal(detail.days[0].lunch[0].supplier, "NCC đã chọn");
});

void test("approval detail is restricted to the school management board", async () => {
  let reads = 0;
  const repository = {
    connect: () => Promise.resolve(transactionDatabase(board)),
    findDetail: () => {
      reads += 1;
      return Promise.resolve(detailRow());
    },
    findFinalizedPortions: () => Promise.resolve([]),
    findWeekDetails: () => Promise.resolve([]),
    listSubmittedWeeks: () => Promise.resolve([]),
    findForDecision: () => Promise.resolve(null),
    academicYears: () => Promise.resolve([]),
    createReview: () => Promise.reject(new Error("not used")),
    updateAllDays: () => Promise.reject(new Error("not used")),
    updateWeek: () => Promise.reject(new Error("not used")),
  } satisfies MenuApprovalRepository;
  const service = createMenuApprovalService(repository);
  await assert.rejects(
    service.getDetail(menuId, {
      ...board,
      role: ROLES.SCHOOL_ADMINISTRATION,
    }),
    (error: unknown) => error instanceof HttpError && error.statusCode === 403,
  );
  assert.equal(reads, 0);
});

void test("BE từ chối lập thực đơn vào ngày nghỉ đã cấu hình", () => {
  const years = [
    {
      startDate: new Date("2026-09-07T00:00:00Z"),
      endDate: new Date("2027-05-28T00:00:00Z"),
      holidays: [
        { date: "2026-11-20", reason: "Ngày Nhà giáo Việt Nam" },
        { startDate: "2027-02-08", endDate: "2027-02-12", reason: "Tết" },
      ],
    },
  ];
  const day = (iso: string) => ({ menuDate: new Date(`${iso}T00:00:00Z`) });
  assert.doesNotThrow(() =>
    assertNoHolidayMenuDays([day("2026-11-16"), day("2026-11-19")], years),
  );
  assert.throws(
    () =>
      assertNoHolidayMenuDays([day("2026-11-19"), day("2026-11-20")], years),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 422 &&
      error.message.includes("20/11/2026 (Ngày Nhà giáo Việt Nam)"),
  );
  assert.throws(
    () => assertNoHolidayMenuDays([day("2027-02-10")], years),
    HttpError,
  );
});

void test("không lập hoặc đổi món cho ngày đã qua, không lập ngoài năm học", () => {
  const years = [
    {
      startDate: new Date("2026-09-07T00:00:00Z"),
      endDate: new Date("2027-05-28T00:00:00Z"),
      holidays: [],
    },
  ];
  const today = "2026-11-18";
  const day = (iso: string, dishIds: string[]) => ({
    menuDate: new Date(`${iso}T00:00:00Z`),
    meals: [
      { mealType: "LUNCH", dishes: dishIds.map((dishId) => ({ dishId })) },
    ],
  });
  const stored = [
    {
      menuDate: new Date("2026-11-16T00:00:00Z"),
      menuDayDishes: [{ mealType: "LUNCH", dishId: "rice" }],
    },
  ];
  const rejects = (fn: () => void, pattern: RegExp) =>
    assert.throws(
      fn,
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 422 &&
        pattern.test(error.message),
    );
  // Tuần hiện tại: gửi lại thứ Hai (đã qua) y nguyên và sửa thứ Năm là hợp lệ.
  assert.doesNotThrow(() =>
    assertMenuDaysEditable(
      [day("2026-11-16", ["rice"]), day("2026-11-19", ["soup"])],
      stored,
      years,
      today,
    ),
  );
  rejects(
    () =>
      assertMenuDaysEditable(
        [day("2026-11-17", ["rice"])],
        stored,
        years,
        today,
      ),
    /Không lập thực đơn cho ngày đã qua: 17\/11\/2026/,
  );
  rejects(
    () =>
      assertMenuDaysEditable(
        [day("2026-11-16", ["fish"])],
        stored,
        years,
        today,
      ),
    /Không sửa thực đơn của ngày đã qua: 16\/11\/2026/,
  );
  rejects(
    () =>
      assertMenuDaysEditable([day("2027-06-07", ["rice"])], [], years, today),
    /ngoài năm học: 07\/06\/2027/,
  );
});

void test("thực đơn tuần phải tạo và gửi duyệt trước hết Chủ nhật trước tuần đó", () => {
  const week = new Date("2026-11-23T00:00:00Z");
  // Đến hết Chủ nhật 22/11 vẫn được tạo, sửa, gửi duyệt.
  assert.doesNotThrow(() => assertMenuWeekOpen(week, "2026-11-22", false));
  // Từ thứ Hai 23/11 tuần bị khóa.
  assert.throws(
    () => assertMenuWeekOpen(week, "2026-11-23", false),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 422 &&
      error.message ===
        "Đã quá hạn lập và gửi duyệt thực đơn tuần 23/11/2026–27/11/2026 (hạn chót hết Chủ nhật 22/11/2026)",
  );
  // BGH đã yêu cầu sửa thì vẫn được sửa và gửi lại trong tuần.
  assert.doesNotThrow(() => assertMenuWeekOpen(week, "2026-11-25", true));
  // week-schedule trả hạn chót và trạng thái khóa cho FE.
  assert.deepEqual(menuWeekLock(week, "2026-11-22", false), {
    deadline: "2026-11-22",
    locked: false,
    reason: null,
  });
  assert.equal(menuWeekLock(week, "2026-11-24", false).locked, true);
  assert.equal(menuWeekLock(week, "2026-11-24", true).locked, false);
});

void test("approval week returns every submitted grade menu of the week in one call", async () => {
  const gradeRow = (id: string, gradeId: string, name: string) =>
    ({
      ...detailRow(),
      id,
      isSchoolWide: false,
      grades: [{ gradeId, grade: { name } }],
    }) as unknown as ApprovalDetailRow;
  let requestedWeek: string | undefined;
  const portionScopes: string[][] = [];
  const repository = {
    connect: () => Promise.resolve(transactionDatabase(board)),
    findDetail: () => Promise.resolve(null),
    findWeekDetails: (
      scope: Prisma.WeeklyMenuWhereInput,
      weekStartDate: Date,
    ) => {
      assert.deepEqual(scope, { schoolId });
      requestedWeek = weekStartDate.toISOString().slice(0, 10);
      return Promise.resolve([
        gradeRow("00000000-0000-4000-8000-0000000000e2", "g10", "Khối 10"),
        gradeRow("00000000-0000-4000-8000-0000000000e1", "g2", "Khối 2"),
      ]);
    },
    listSubmittedWeeks: () =>
      Promise.resolve([
        {
          weekStartDate: new Date("2026-11-09T00:00:00.000Z"),
          status: "APPROVED" as const,
          count: 1,
        },
        {
          weekStartDate: new Date("2026-11-02T00:00:00.000Z"),
          status: "PENDING_APPROVAL" as const,
          count: 2,
        },
      ]),
    findFinalizedPortions: (
      _dates: Date[],
      _schoolId: string,
      gradeIds = [],
    ) => {
      portionScopes.push(gradeIds);
      return Promise.resolve([]);
    },
    findForDecision: () => Promise.resolve(null),
    academicYears: () =>
      Promise.resolve([
        {
          startDate: new Date("2026-09-07T00:00:00.000Z"),
          endDate: new Date("2027-05-28T00:00:00.000Z"),
          holidays: [],
        },
      ]),
    createReview: () => Promise.reject(new Error("not used")),
    updateAllDays: () => Promise.reject(new Error("not used")),
    updateWeek: () => Promise.reject(new Error("not used")),
  } satisfies MenuApprovalRepository;
  const service = createMenuApprovalService(repository);

  // Không truyền ngày: chọn tuần còn chờ duyệt mới nhất
  const week = await service.getWeek({}, board);
  assert.equal(requestedWeek, "2026-11-02");
  assert.equal(week.weekEndDate, "2026-11-06");
  assert.equal(week.weekNumber, 9);
  assert.deepEqual(
    week.weeks.map((item) => [
      item.weekStartDate,
      item.weekNumber,
      item.total,
      item.pending,
    ]),
    [
      ["2026-11-09", 10, 1, 0],
      ["2026-11-02", 9, 2, 2],
    ],
  );
  assert.deepEqual(
    week.menus.map((menu) => menu.grades.map((grade) => grade.name)),
    [["Khối 2"], ["Khối 10"]],
  );
  assert.deepEqual(portionScopes.sort(), [["g10"], ["g2"]]);

  // Ngày bất kỳ trong tuần (thứ Sáu) được quy về thứ Hai
  await service.getWeek({ date: new Date("2026-11-13T00:00:00.000Z") }, board);
  assert.equal(requestedWeek, "2026-11-09");
});

void test("approval week is empty when nothing has been submitted", async () => {
  const repository = {
    connect: () => Promise.reject(new Error("not used")),
    findDetail: () => Promise.resolve(null),
    findWeekDetails: () => Promise.reject(new Error("not used")),
    listSubmittedWeeks: () => Promise.resolve([]),
    findFinalizedPortions: () => Promise.resolve([]),
    findForDecision: () => Promise.resolve(null),
    academicYears: () => Promise.resolve([]),
    createReview: () => Promise.reject(new Error("not used")),
    updateAllDays: () => Promise.reject(new Error("not used")),
    updateWeek: () => Promise.reject(new Error("not used")),
  } satisfies MenuApprovalRepository;
  const week = await createMenuApprovalService(repository).getWeek({}, board);
  assert.equal(week.weekStartDate, null);
  assert.deepEqual(week.menus, []);
});
