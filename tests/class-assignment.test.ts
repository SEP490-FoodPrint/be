import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpError } from "../src/utils/http-error";
import type { AuthPrincipal } from "../src/types/auth";
import type { PrismaClient } from "../src/generated/prisma/client";
import {
  currentAcademicYear,
  isAssignableAcademicYear,
  parseAcademicYear,
} from "../src/modules/class/academic-year";
import {
  validateClassListQuery,
  validateHomeroomAssignment,
} from "../src/modules/class/class.validation";
import { createClassService } from "../src/modules/class/class.service";

const isHttp = (status: number) => (error: unknown) =>
  error instanceof HttpError && error.statusCode === status;

// 01/11/2026 thuộc năm học 2026-2027
const NOV_2026 = new Date("2026-11-01T03:00:00Z");

const board: AuthPrincipal = {
  id: "00000000-0000-4000-8000-0000000000b1",
  username: "school_bgh",
  fullName: "BGH",
  roleId: "role",
  role: "SCHOOL_MANAGEMENT_BOARD",
  orgType: "SCHOOL",
  schoolId: "10000000-0000-4000-8000-000000000001",
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: ["class.view", "class_assignment.manage"],
};

void test("academic year starts in September in Vietnam time", () => {
  assert.equal(currentAcademicYear(NOV_2026), "2026-2027");
  assert.equal(
    currentAcademicYear(new Date("2027-08-31T10:00:00Z")),
    "2026-2027",
  );
  // 31/08 17:30 UTC đã là 01/09 tại Việt Nam
  assert.equal(
    currentAcademicYear(new Date("2027-08-31T17:30:00Z")),
    "2027-2028",
  );
});

void test("only current or upcoming academic years can be assigned", () => {
  assert.equal(isAssignableAcademicYear("2026-2027", NOV_2026), true);
  assert.equal(isAssignableAcademicYear("2027-2028", NOV_2026), true);
  assert.equal(isAssignableAcademicYear("2025-2026", NOV_2026), false);
  assert.equal(isAssignableAcademicYear(null, NOV_2026), false);
  assert.equal(isAssignableAcademicYear("2026-2028", NOV_2026), false);
});

void test("class list and assignment payloads are validated", () => {
  assert.deepEqual(validateClassListQuery({ academicYear: "2026-2027" }), {
    page: 1,
    limit: 20,
    academicYear: "2026-2027",
  });
  assert.equal(validateClassListQuery({}).academicYear, undefined);
  assert.throws(() => parseAcademicYear("2026"), isHttp(400));
  assert.throws(() => validateClassListQuery({ schoolId: "x" }), isHttp(400));
  assert.throws(() => validateHomeroomAssignment({}), isHttp(400));
  assert.throws(
    () =>
      validateHomeroomAssignment({
        teacherUserId: "00000000-0000-4000-8000-000000000001",
        schoolId: "x",
      }),
    isHttp(400),
  );
});

void test("class list exposes the current homeroom teacher and whether it can change", async () => {
  const base = {
    schoolId: board.schoolId as string,
    registeredMealPortions: 30,
    createdAt: NOV_2026,
    updatedAt: NOV_2026,
  };
  const teacher = { id: "t1", fullName: "Cô Lan", username: "gvcn_lan" };
  let where: unknown;
  const service = createClassService(
    (args) => {
      where = args.where;
      return Promise.resolve([
        {
          ...base,
          id: "c1",
          name: "3A1",
          academicYear: "2026-2027",
          status: "ACTIVE",
          homeroomAssignments: [{ assignedAt: NOV_2026, Teacher: teacher }],
        },
        {
          ...base,
          id: "c0",
          name: "3A1",
          academicYear: "2025-2026",
          status: "ACTIVE",
          homeroomAssignments: [],
        },
      ]);
    },
    undefined,
    () => NOV_2026,
  );
  const page = await service.getAll(
    { page: 1, limit: 20, academicYear: "2026-2027" },
    board,
  );
  assert.deepEqual(where, {
    AND: [{ schoolId: board.schoolId }, { academicYear: "2026-2027" }],
  });
  assert.deepEqual(page.items[0].homeroomTeacher, {
    ...teacher,
    assignedAt: NOV_2026,
  });
  assert.equal(page.items[0].canAssign, true);
  assert.equal(page.items[1].homeroomTeacher, null);
  assert.equal(page.items[1].canAssign, false);
});

void test("eligible teachers are ACTIVE homeroom accounts of the board's school only", async () => {
  let query: { where?: unknown } = {};
  const db = {
    user: {
      findMany: (args: { where?: unknown }) => {
        query = args;
        return Promise.resolve([
          {
            id: "t1",
            fullName: "Cô Lan",
            username: "gvcn_lan",
            homeroomAssignments: [{ Class: { id: "c1", name: "3A1" } }],
          },
        ]);
      },
    },
  } as unknown as PrismaClient;
  const service = createClassService(
    undefined,
    () => Promise.resolve(db),
    () => NOV_2026,
  );
  const result = await service.getEligibleTeachers(undefined, board);
  assert.deepEqual(query.where, {
    schoolId: board.schoolId,
    roleCode: "HOMEROOM_TEACHER",
    status: "ACTIVE",
  });
  assert.equal(result.academicYear, "2026-2027");
  assert.deepEqual(result.items[0].currentClass, { id: "c1", name: "3A1" });
  await assert.rejects(
    service.getEligibleTeachers(undefined, {
      ...board,
      permissions: ["class.view"],
    }),
    isHttp(403),
  );
});
