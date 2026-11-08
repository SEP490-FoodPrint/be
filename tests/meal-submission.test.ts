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

function database(status: "NONE" | "DRAFT" | "FINALIZED" = "NONE") {
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
  const service = createMealAttendanceService(undefined, () =>
    Promise.resolve(db),
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
  const service = createMealAttendanceService(undefined, () =>
    Promise.resolve(finalized.db),
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
