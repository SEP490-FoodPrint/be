import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "../src/generated/prisma/client";
import type { AuthPrincipal } from "../src/types/auth";
import { HttpError } from "../src/utils/http-error";
import { createMealAttendanceService } from "../src/modules/meal-attendance/meal-attendance.service";
import { validateDailyMealPortion } from "../src/modules/meal-attendance/meal-attendance.validation";

const SCHOOL_ID = "10000000-0000-4000-8000-000000000001";
const TEACHER_ID = "10000000-0000-4000-8000-000000000002";
const CLASS_ID = "10000000-0000-4000-8000-000000000003";
const DEMAND_ID = "10000000-0000-4000-8000-000000000004";
const ENTRY_ID = "10000000-0000-4000-8000-000000000005";
const DATE = new Date("2026-11-04T00:00:00.000Z");

const teacher: AuthPrincipal = {
  id: TEACHER_ID,
  username: "homeroom_teacher",
  fullName: "Giáo viên chủ nhiệm",
  roleId: "role",
  role: "HOMEROOM_TEACHER",
  orgType: "SCHOOL",
  schoolId: SCHOOL_ID,
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: ["daily_meal_portion.view", "daily_meal_portion.update"],
};

const identity = {
  id: teacher.id,
  username: teacher.username,
  fullName: teacher.fullName,
  roleId: teacher.roleId,
  schoolId: teacher.schoolId,
  supplierId: null,
  communeFoodSafetyUnitId: null,
  status: "ACTIVE",
  Role: {
    code: teacher.role,
    type: "SCHOOL",
    rolePermissions: teacher.permissions.map((code) => ({
      permission: { code, isActive: true },
    })),
  },
  permissionDenials: [],
};

const isHttp = (status: number) => (error: unknown) =>
  error instanceof HttpError && error.statusCode === status;

void test("daily portion input is aggregate-only and strictly validated", () => {
  assert.deepEqual(
    validateDailyMealPortion({
      date: "2026-11-04",
      mealType: "LUNCH",
      totalPortions: 25,
      allergyNotes: "  Không dùng lạc  ",
      allergies: [{ ingredientEntryId: ENTRY_ID, portionCount: 2 }],
    }),
    {
      date: DATE,
      mealType: "LUNCH",
      totalPortions: 25,
      allergyNotes: "Không dùng lạc",
      allergies: [{ ingredientEntryId: ENTRY_ID, portionCount: 2 }],
    },
  );
  assert.throws(
    () =>
      validateDailyMealPortion({
        date: "2026-11-04",
        mealType: "LUNCH",
        totalPortions: 1,
        allergies: [],
        studentIds: [],
      }),
    isHttp(400),
  );
  assert.throws(
    () =>
      validateDailyMealPortion({
        date: "2026-11-04",
        mealType: "LUNCH",
        totalPortions: 1,
        allergies: [{ ingredientEntryId: ENTRY_ID, portionCount: 2 }],
      }),
    isHttp(400),
  );
});

// 04/11/2026 (thứ Tư) lúc 08:00 giờ Việt Nam.
const NOW = new Date("2026-11-04T01:00:00.000Z");
const clock = () => NOW;

interface CalendarFixture {
  holidays?: unknown[];
  hasYear?: boolean;
  hasMenu?: boolean;
}

function database(
  status: "NONE" | "DRAFT" | "FINALIZED" = "NONE",
  calendar: CalendarFixture = {},
) {
  const writes: Array<{ operation: string; args: unknown }> = [];
  const assignedClass = {
    id: CLASS_ID,
    name: "3A1",
    academicYear: "2026-2027",
    registeredMealPortions: 30,
    classAllergies: [
      {
        ingredientEntryId: ENTRY_ID,
        affectedCount: 3,
        IngredientEntry: { Ingredient: { name: "Lạc" } },
      },
    ],
  };
  const demand = {
    id: DEMAND_ID,
    classId: CLASS_ID,
    confirmedByUserId: TEACHER_ID,
    mealDate: DATE,
    mealType: "LUNCH",
    totalPortions: 25,
    allergyNotes: null,
    status: status === "NONE" ? "DRAFT" : status,
    finalizedAt: status === "FINALIZED" ? DATE : null,
    createdAt: DATE,
    updatedAt: DATE,
    portionGroups: [],
    dailyAllergyPortions: [],
  };
  const tx = {
    $queryRaw: () => Promise.resolve([]),
    school: { findUnique: () => Promise.resolve({ status: "ACTIVE" }) },
    user: { findUnique: () => Promise.resolve(identity) },
    schoolAcademicYear: {
      findFirst: () =>
        Promise.resolve(
          calendar.hasYear === false
            ? null
            : { academicYear: "2026-2027", holidays: calendar.holidays ?? [] },
        ),
    },
    menuDay: {
      findFirst: () =>
        Promise.resolve(calendar.hasMenu === false ? null : { id: "menu-day" }),
    },
    classHomeroomAssignment: {
      findFirst: (args: { select?: { Class?: unknown } }) =>
        Promise.resolve(
          args.select?.Class ? { Class: assignedClass } : { id: "assignment" },
        ),
    },
    dailyMealPortion: {
      findFirst: () => Promise.resolve(demand),
      findUnique: () =>
        Promise.resolve(status === "NONE" ? null : { id: DEMAND_ID, status }),
      create: (args: unknown) => {
        writes.push({ operation: "create", args });
        return Promise.resolve({ id: DEMAND_ID });
      },
      update: (args: unknown) => {
        writes.push({ operation: "update", args });
        return Promise.resolve({ ...demand, status: "FINALIZED" });
      },
      findUniqueOrThrow: () => Promise.resolve(demand),
    },
    dailyAllergyPortion: {
      deleteMany: (args: unknown) => {
        writes.push({ operation: "deleteAllergies", args });
        return Promise.resolve({ count: 0 });
      },
      createMany: (args: unknown) => {
        writes.push({ operation: "createAllergies", args });
        return Promise.resolve({ count: 1 });
      },
    },
  };
  const db = {
    $transaction: (operation: (client: typeof tx) => Promise<unknown>) =>
      operation(tx),
  } as unknown as PrismaClient;
  return { db, writes };
}

void test("GVCN creates a draft for the assigned academic-year class", async () => {
  const { db, writes } = database();
  const service = createMealAttendanceService(
    undefined,
    () => Promise.resolve(db),
    undefined,
    clock,
  );
  const result = await service.saveDraft(
    {
      date: DATE,
      mealType: "LUNCH",
      totalPortions: 25,
      allergyNotes: null,
      allergies: [{ ingredientEntryId: ENTRY_ID, portionCount: 2 }],
    },
    teacher,
  );
  assert.equal(result.id, DEMAND_ID);
  assert.deepEqual(
    writes.map((row) => row.operation),
    ["create", "deleteAllergies", "createAllergies"],
  );
});

void test("finalized portions are immutable and finalization is idempotent", async () => {
  const finalized = database("FINALIZED");
  const service = createMealAttendanceService(
    undefined,
    () => Promise.resolve(finalized.db),
    undefined,
    clock,
  );
  await assert.rejects(
    service.saveDraft(
      {
        date: DATE,
        mealType: "LUNCH",
        totalPortions: 20,
        allergyNotes: null,
        allergies: [],
      },
      teacher,
    ),
    isHttp(409),
  );
  const result = await service.finalize(DEMAND_ID, teacher);
  assert.equal(result.status, "FINALIZED");
  assert.equal(finalized.writes.length, 0);
});

const draftInput = (overrides: Record<string, unknown> = {}) => ({
  date: DATE,
  mealType: "LUNCH" as const,
  totalPortions: 25,
  allergyNotes: null,
  // Lớp trong fixture có 1 dị ứng; GVCN bắt buộc khai số suất (kể cả 0).
  allergies: [{ ingredientEntryId: ENTRY_ID, portionCount: 0 }],
  ...overrides,
});

void test("GVCN không khai vượt số suất đăng ký của lớp", async () => {
  const { db, writes } = database();
  const service = createMealAttendanceService(
    undefined,
    () => Promise.resolve(db),
    undefined,
    clock,
  );
  // registeredMealPortions của lớp trong fixture là 30.
  await assert.rejects(
    service.saveDraft(draftInput({ totalPortions: 31 }), teacher),
    (error: unknown) =>
      isHttp(422)(error) && /vượt số suất đăng ký/.test(String(error)),
  );
  assert.equal(writes.length, 0);
  const result = await service.saveDraft(
    draftInput({ totalPortions: 30 }),
    teacher,
  );
  assert.equal(result.id, DEMAND_ID);
});

void test("GVCN chỉ khai và chốt cho hôm nay, đúng ngày học có thực đơn", async () => {
  const build = (
    calendar: CalendarFixture = {},
    status: "NONE" | "DRAFT" = "NONE",
  ) => {
    const { db, writes } = database(status, calendar);
    return {
      writes,
      service: createMealAttendanceService(
        undefined,
        () => Promise.resolve(db),
        undefined,
        clock,
      ),
    };
  };
  const rejects = async (promise: Promise<unknown>, pattern: RegExp) =>
    assert.rejects(
      promise,
      (error: unknown) => isHttp(422)(error) && pattern.test(String(error)),
    );

  const yesterday = new Date("2026-11-03T00:00:00.000Z");
  const tomorrow = new Date("2026-11-05T00:00:00.000Z");
  await rejects(
    build().service.saveDraft(draftInput({ date: yesterday }), teacher),
    /hôm nay \(04\/11\/2026\)/,
  );
  await rejects(
    build().service.saveDraft(draftInput({ date: tomorrow }), teacher),
    /hôm nay/,
  );
  await rejects(
    build({
      holidays: [{ date: "2026-11-04", reason: "Nghỉ bù" }],
    }).service.saveDraft(draftInput(), teacher),
    /ngày nghỉ \(Nghỉ bù\)/,
  );
  await rejects(
    build({ hasYear: false }).service.saveDraft(draftInput(), teacher),
    /ngoài năm học/,
  );
  await rejects(
    build({ hasMenu: false }).service.saveDraft(draftInput(), teacher),
    /chưa có thực đơn bữa trưa/,
  );
  // Chốt cũng đi qua cùng bước kiểm tra ngày (ở đây: không có thực đơn).
  const stale = build({ hasMenu: false }, "DRAFT");
  await rejects(stale.service.finalize(DEMAND_ID, teacher), /chưa có thực đơn/);
  assert.equal(stale.writes.length, 0);
});

void test("GVCN phải nhập số suất cho mọi nguyên liệu dị ứng của lớp", async () => {
  const { db, writes } = database();
  const service = createMealAttendanceService(
    undefined,
    () => Promise.resolve(db),
    undefined,
    clock,
  );
  await assert.rejects(
    service.saveDraft(draftInput({ allergies: [] }), teacher),
    (error: unknown) =>
      isHttp(422)(error) && /Chưa nhập số suất dị ứng/.test(String(error)),
  );
  assert.equal(writes.length, 0);
});
