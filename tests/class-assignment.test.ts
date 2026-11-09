import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpError } from "../src/utils/http-error";
import type { AuthPrincipal } from "../src/types/auth";
import type { PrismaClient } from "../src/generated/prisma/client";
import {
  currentAcademicYear,
  isAssignableAcademicYear,
} from "../src/modules/class/academic-year";
import {
  validateClassListQuery,
  validateEligibleTeachersQuery,
  validateHomeroomAssignment,
} from "../src/modules/class/class.validation";
import { createClassRepository } from "../src/modules/class/class.repository";
import { createClassService } from "../src/modules/class/class.service";

const isHttp = (status: number) => (error: unknown) =>
  error instanceof HttpError && error.statusCode === status;

// 01/11/2026 thu瀹勫嫭鐛?n閼剁惡 h瀹勫嫬纭?2026-2027
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

const identity = {
  id: board.id,
  username: board.username,
  fullName: board.fullName,
  roleId: board.roleId,
  schoolId: board.schoolId,
  supplierId: null,
  communeFoodSafetyUnitId: null,
  status: "ACTIVE",
  Role: {
    code: board.role,
    type: "SCHOOL",
    rolePermissions: board.permissions.map((code) => ({
      permission: { code, isActive: true },
    })),
  },
  permissionDenials: [],
};

void test("academic year starts in September in Vietnam time", () => {
  assert.equal(currentAcademicYear(NOV_2026), "2026-2027");
  assert.equal(
    currentAcademicYear(new Date("2027-08-31T10:00:00Z")),
    "2026-2027",
  );
  // 31/08 17:30 UTC 閼跺€熷皸 l閼?01/09 t瀹€濂夋懆 Vi瀹勫嫬妾?Nam
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
  assert.throws(
    () => validateEligibleTeachersQuery({ academicYear: "2026" }),
    isHttp(400),
  );
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
  const teacher = { id: "t1", fullName: "C娑?Lan", username: "gvcn_lan" };
  let where: unknown;
  const db = {
    class: {
      findMany: (args: { where?: unknown }) => {
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
    },
  } as unknown as PrismaClient;
  const service = createClassService(
    undefined,
    createClassRepository(() => Promise.resolve(db)),
    undefined,
    () => Promise.resolve(db),
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
    assignedAt: NOV_2026.toISOString(),
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
            fullName: "C娑?Lan",
            username: "gvcn_lan",
            homeroomAssignments: [{ Class: { id: "c1", name: "3A1" } }],
          },
        ]);
      },
    },
  } as unknown as PrismaClient;
  const service = createClassService(
    undefined,
    createClassRepository(() => Promise.resolve(db)),
    undefined,
    () => Promise.resolve(db),
    () => NOV_2026,
  );
  const result = await service.getEligibleTeachers({}, board);
  assert.deepEqual(query.where, {
    schoolId: board.schoolId,
    roleCode: "HOMEROOM_TEACHER",
    status: "ACTIVE",
  });
  assert.equal(result.academicYear, "2026-2027");
  assert.deepEqual(result.items[0].currentClass, { id: "c1", name: "3A1" });
  await assert.rejects(
    service.getEligibleTeachers(
      {},
      {
        ...board,
        permissions: ["class.view"],
      },
    ),
    isHttp(403),
  );
  await assert.rejects(
    service.getEligibleTeachers(
      {},
      {
        ...board,
        role: "SCHOOL_ADMINISTRATION",
      },
    ),
    isHttp(403),
  );
});

function assignmentDatabase(options?: {
  teacherExists?: boolean;
  currentTeacherId?: string;
}) {
  const writes: Record<string, unknown>[] = [];
  const reads: Record<string, unknown>[] = [];
  const tx = {
    $queryRaw: () => Promise.resolve([]),
    school: { findUnique: () => Promise.resolve({ status: "ACTIVE" }) },
    class: {
      findFirst: (args: Record<string, unknown>) => {
        reads.push(args);
        return Promise.resolve({
          id: "00000000-0000-4000-8000-0000000000c1",
          name: "3A1",
          academicYear: "2026-2027",
          status: "ACTIVE",
        });
      },
    },
    user: {
      findUnique: () => Promise.resolve(identity),
      findFirst: (args: Record<string, unknown>) => {
        reads.push(args);
        return Promise.resolve(
          options?.teacherExists === false
            ? null
            : {
                id: "00000000-0000-4000-8000-0000000000f1",
                fullName: "C娑?Lan",
                username: "gvcn_lan",
              },
        );
      },
    },
    classHomeroomAssignment: {
      findFirst: (args: { where: { classId?: unknown } }) => {
        reads.push(args);
        if (typeof args.where.classId === "object")
          return Promise.resolve(null);
        return Promise.resolve(
          options?.currentTeacherId
            ? {
                id: "00000000-0000-4000-8000-0000000000a1",
                teacherUserId: options.currentTeacherId,
                assignedAt: new Date("2026-09-01T00:00:00Z"),
              }
            : null,
        );
      },
      update: (args: Record<string, unknown>) => {
        writes.push({ operation: "update", ...args });
        return Promise.resolve({});
      },
      create: (args: Record<string, unknown>) => {
        writes.push({ operation: "create", ...args });
        return Promise.resolve({ assignedAt: NOV_2026 });
      },
    },
  };
  const db = {
    $transaction: (operation: (client: typeof tx) => Promise<unknown>) =>
      operation(tx),
  } as unknown as PrismaClient;
  return { db, reads, writes };
}

void test("assignment is scoped to the board school and closes the previous teacher", async () => {
  const previousTeacherId = "00000000-0000-4000-8000-0000000000f0";
  const { db, reads, writes } = assignmentDatabase({
    currentTeacherId: previousTeacherId,
  });
  const service = createClassService(
    undefined,
    createClassRepository(() => Promise.resolve(db)),
    undefined,
    () => Promise.resolve(db),
    () => NOV_2026,
  );
  const result = await service.assignHomeroomTeacher(
    { classId: "00000000-0000-4000-8000-0000000000c1" },
    { teacherUserId: "00000000-0000-4000-8000-0000000000f1" },
    board,
  );
  assert.equal(result.classId, "00000000-0000-4000-8000-0000000000c1");
  assert.deepEqual((reads[0] as { where: unknown }).where, {
    id: "00000000-0000-4000-8000-0000000000c1",
    schoolId: board.schoolId,
  });
  assert.deepEqual((reads[1] as { where: unknown }).where, {
    id: "00000000-0000-4000-8000-0000000000f1",
    schoolId: board.schoolId,
    roleCode: "HOMEROOM_TEACHER",
    status: "ACTIVE",
  });
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0], {
    operation: "update",
    where: { id: "00000000-0000-4000-8000-0000000000a1" },
    data: { endedAt: NOV_2026, endedByUserId: board.id },
  });
  assert.deepEqual(writes[1], {
    operation: "create",
    data: {
      classId: "00000000-0000-4000-8000-0000000000c1",
      teacherUserId: "00000000-0000-4000-8000-0000000000f1",
      assignedByUserId: board.id,
      assignedAt: NOV_2026,
    },
    select: { assignedAt: true },
  });
});

void test("assignment rejects a teacher outside the eligible school role and keeps history unchanged", async () => {
  const { db, writes } = assignmentDatabase({ teacherExists: false });
  const service = createClassService(
    undefined,
    createClassRepository(() => Promise.resolve(db)),
    undefined,
    () => Promise.resolve(db),
    () => NOV_2026,
  );
  await assert.rejects(
    service.assignHomeroomTeacher(
      { classId: "00000000-0000-4000-8000-0000000000c1" },
      { teacherUserId: "00000000-0000-4000-8000-0000000000f2" },
      board,
    ),
    isHttp(400),
  );
  assert.equal(writes.length, 0);
});
