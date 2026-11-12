import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpError } from "../src/utils/http-error";
import type { AuthPrincipal } from "../src/types/auth";
import { Prisma, type PrismaClient } from "../src/generated/prisma/client";
import {
  currentAcademicYear,
  isAssignableAcademicYear,
} from "../src/modules/class/academic-year";
import {
  validateClassListQuery,
  validateEligibleTeachersQuery,
  validateHomeroomAssignment,
  validateCreateClass,
  validateUpdateClass,
  validateClassStatus,
  validateCopyClasses,
  validateImportClasses,
} from "../src/modules/class/class.validation";
import {
  createClassRepository,
  type ClassRepository,
} from "../src/modules/class/class.repository";
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

// ---- Quản lý lớp học (spec 016) ----

const SCHOOL_ID = board.schoolId as string;
const CLASS_ID = "00000000-0000-4000-8000-0000000000c1";

function principalWith(role: string, permissions: string[]): AuthPrincipal {
  return { ...board, role, permissions };
}

const manager = principalWith("SCHOOL_MANAGEMENT_BOARD", [
  "class.view",
  "class_assignment.manage",
  "class.manage",
]);

function identityOf(principal: AuthPrincipal) {
  return {
    ...identity,
    Role: {
      code: principal.role,
      type: "SCHOOL",
      rolePermissions: principal.permissions.map((code) => ({
        permission: { code, isActive: true },
      })),
    },
  };
}

function transactionDatabase(principal: AuthPrincipal) {
  const tx = {
    $queryRaw: () => Promise.resolve([]),
    school: { findUnique: () => Promise.resolve({ status: "ACTIVE" }) },
    user: { findUnique: () => Promise.resolve(identityOf(principal)) },
  };
  return {
    $transaction: (operation: (client: typeof tx) => Promise<unknown>) =>
      operation(tx),
  } as unknown as PrismaClient;
}

function classRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CLASS_ID,
    schoolId: SCHOOL_ID,
    name: "1A",
    academicYear: "2026-2027",
    registeredMealPortions: 30,
    status: "ACTIVE",
    createdAt: NOV_2026,
    updatedAt: NOV_2026,
    homeroomAssignments: [],
    ...overrides,
  };
}

function fakeRepository(options?: {
  configuredYears?: string[];
  existingNames?: string[];
  target?: Record<string, unknown> | null;
  currentAssignment?: boolean;
  source?: Array<{ name: string; registeredMealPortions: number }>;
  createError?: Error;
  teacherExists?: boolean;
  teacherBusyIn?: string;
  teachers?: Array<{ id: string; fullName: string; username: string }>;
  busyTeachers?: Record<string, string>;
}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const record =
    <T>(method: string, result: (...args: unknown[]) => T) =>
    (...args: unknown[]) => {
      calls.push({ method, args: args.slice(1) });
      return Promise.resolve(result(...args));
    };
  const configured = options?.configuredYears ?? ["2026-2027", "2027-2028"];
  const repository = {
    findConfiguredAcademicYear: record(
      "findConfiguredAcademicYear",
      (_tx, _school, year) =>
        configured.includes(year as string)
          ? { academicYear: year as string }
          : null,
    ),
    findNameConflicts: record("findNameConflicts", (_tx, _s, _y, names) => {
      const wanted = (names as string[]).map((name) => name.toLowerCase());
      return (options?.existingNames ?? [])
        .filter((name) => wanted.includes(name.toLowerCase()))
        .map((name) => ({ name }));
    }),
    findAssignableClass: record("findAssignableClass", () =>
      options?.target === undefined
        ? {
            id: CLASS_ID,
            name: "1A",
            academicYear: "2026-2027",
            status: "ACTIVE",
          }
        : options.target,
    ),
    findCurrentAssignment: record("findCurrentAssignment", () =>
      options?.currentAssignment
        ? {
            id: "00000000-0000-4000-8000-0000000000a1",
            teacherUserId: "t1",
            assignedAt: NOV_2026,
          }
        : null,
    ),
    endAssignment: record("endAssignment", () => undefined),
    createClass: (...args: unknown[]) => {
      calls.push({ method: "createClass", args: args.slice(1) });
      if (options?.createError) return Promise.reject(options.createError);
      const input = args[1] as Record<string, unknown>;
      return Promise.resolve(
        classRow({ id: `new-${String(input.name)}`, ...input }),
      );
    },
    updateClass: record("updateClass", (_tx, _id, _school, input) =>
      classRow(input as Record<string, unknown>),
    ),
    updateStatus: record("updateStatus", (_tx, _id, _school, status) =>
      classRow({ status }),
    ),
    listActiveClassesForCopy: record(
      "listActiveClassesForCopy",
      () => options?.source ?? [],
    ),
    findEligibleTeacher: record("findEligibleTeacher", (_tx, id) =>
      options?.teacherExists === false
        ? null
        : { id: id as string, fullName: "Cô Lan", username: "gvcn_lan" },
    ),
    findTeacherClassInYear: record("findTeacherClassInYear", () =>
      options?.teacherBusyIn
        ? { id: "other-class", name: options.teacherBusyIn }
        : null,
    ),
    createAssignment: record("createAssignment", () => ({
      assignedAt: NOV_2026,
    })),
    findTeachersByUsernames: record(
      "findTeachersByUsernames",
      (_tx, _school, usernames) => {
        const wanted = (usernames as string[]).map((name) =>
          name.toLowerCase(),
        );
        return (options?.teachers ?? []).filter((teacher) =>
          wanted.includes(teacher.username.toLowerCase()),
        );
      },
    ),
    findBusyTeachers: record("findBusyTeachers", (_tx, ids) =>
      Object.entries(options?.busyTeachers ?? {})
        .filter(([id]) => (ids as string[]).includes(id))
        .map(([teacherUserId, className]) => ({ teacherUserId, className })),
    ),
  } as unknown as ClassRepository;
  const called = (method: string) =>
    calls.filter((call) => call.method === method);
  return { repository, calls, called };
}

function managementService(
  repository: ClassRepository,
  principal: AuthPrincipal = manager,
) {
  const db = transactionDatabase(principal);
  return createClassService(
    undefined,
    repository,
    undefined,
    () => Promise.resolve(db),
    () => NOV_2026,
  );
}

void test("class management payloads are validated", () => {
  assert.deepEqual(
    validateCreateClass({ name: "  1A ", academicYear: "2026-2027" }),
    { name: "1A", academicYear: "2026-2027", registeredMealPortions: 0 },
  );
  assert.throws(
    () => validateCreateClass({ name: "", academicYear: "2026-2027" }),
    isHttp(400),
  );
  assert.throws(
    () =>
      validateCreateClass({ name: "x".repeat(121), academicYear: "2026-2027" }),
    isHttp(400),
  );
  assert.throws(
    () =>
      validateCreateClass({
        name: "1A",
        academicYear: "2026-2027",
        registeredMealPortions: -1,
      }),
    isHttp(400),
  );
  assert.throws(
    () =>
      validateCreateClass({
        name: "1A",
        academicYear: "2026-2027",
        schoolId: SCHOOL_ID,
      }),
    isHttp(400),
  );
  assert.throws(() => validateUpdateClass({}), isHttp(400));
  assert.deepEqual(validateUpdateClass({ registeredMealPortions: 25 }), {
    registeredMealPortions: 25,
  });
  assert.throws(() => validateClassStatus({ status: "DELETED" }), isHttp(400));
  assert.throws(
    () =>
      validateCopyClasses({
        fromAcademicYear: "2026-2027",
        toAcademicYear: "2026-2027",
      }),
    isHttp(400),
  );
});

void test("board creates a class in a configured academic year of its own school", async () => {
  const { repository, called } = fakeRepository();
  const result = await managementService(repository).createClass(
    { name: "1A", academicYear: "2026-2027", registeredMealPortions: 32 },
    manager,
  );
  assert.deepEqual(called("createClass")[0].args[0], {
    schoolId: SCHOOL_ID,
    academicYear: "2026-2027",
    name: "1A",
    registeredMealPortions: 32,
  });
  assert.equal(result.status, "ACTIVE");
  assert.equal(result.homeroomTeacher, null);
  assert.equal(result.canAssign, true);
});

void test("duplicate class names are rejected case-insensitively, including inactive classes", async () => {
  const { repository, called } = fakeRepository({ existingNames: ["1A"] });
  await assert.rejects(
    managementService(repository).createClass(
      { name: "1a", academicYear: "2026-2027", registeredMealPortions: 0 },
      manager,
    ),
    isHttp(409),
  );
  assert.equal(called("createClass").length, 0);
});

void test("unique violations from the database are reported as 409", async () => {
  const { repository } = fakeRepository({
    createError: new Prisma.PrismaClientKnownRequestError("duplicate", {
      code: "P2002",
      clientVersion: "test",
    }),
  });
  await assert.rejects(
    managementService(repository).createClass(
      { name: "1A", academicYear: "2026-2027", registeredMealPortions: 0 },
      manager,
    ),
    isHttp(409),
  );
});

void test("classes require a configured, current or upcoming academic year", async () => {
  const unconfigured = fakeRepository({ configuredYears: [] });
  await assert.rejects(
    managementService(unconfigured.repository).createClass(
      { name: "1A", academicYear: "2026-2027", registeredMealPortions: 0 },
      manager,
    ),
    isHttp(409),
  );
  const past = fakeRepository({ configuredYears: ["2025-2026"] });
  await assert.rejects(
    managementService(past.repository).createClass(
      { name: "1A", academicYear: "2025-2026", registeredMealPortions: 0 },
      manager,
    ),
    isHttp(409),
  );
  assert.equal(past.called("createClass").length, 0);
});

void test("only the management board can manage classes", async () => {
  const teacher = principalWith("HOMEROOM_TEACHER", ["class.manage"]);
  const { repository, called } = fakeRepository();
  await assert.rejects(
    managementService(repository, teacher).createClass(
      { name: "1A", academicYear: "2026-2027", registeredMealPortions: 0 },
      teacher,
    ),
    isHttp(403),
  );
  await assert.rejects(
    managementService(repository).createClass(
      { name: "1A", academicYear: "2026-2027", registeredMealPortions: 0 },
      board,
    ),
    isHttp(403),
  );
  assert.equal(called("createClass").length, 0);
});

void test("updating a class outside the board school returns 404", async () => {
  const { repository, called } = fakeRepository({ target: null });
  await assert.rejects(
    managementService(repository).updateClass(
      { classId: CLASS_ID },
      { registeredMealPortions: 20 },
      manager,
    ),
    isHttp(404),
  );
  assert.deepEqual(called("findAssignableClass")[0].args, [
    CLASS_ID,
    SCHOOL_ID,
  ]);
  assert.equal(called("updateClass").length, 0);
});

void test("renaming checks duplicates excluding the class itself", async () => {
  const { repository, called } = fakeRepository();
  const result = await managementService(repository).updateClass(
    { classId: CLASS_ID },
    { name: "1B" },
    manager,
  );
  assert.deepEqual(called("findNameConflicts")[0].args, [
    SCHOOL_ID,
    "2026-2027",
    ["1B"],
    CLASS_ID,
  ]);
  assert.deepEqual(called("updateClass")[0].args, [
    CLASS_ID,
    SCHOOL_ID,
    { name: "1B" },
  ]);
  assert.equal(result.name, "1B");
});

void test("deactivating a class closes its current homeroom assignment; reactivating does not reassign", async () => {
  const inactive = fakeRepository({ currentAssignment: true });
  const result = await managementService(inactive.repository).changeStatus(
    { classId: CLASS_ID },
    { status: "INACTIVE" },
    manager,
  );
  assert.deepEqual(inactive.called("endAssignment")[0].args, [
    "00000000-0000-4000-8000-0000000000a1",
    NOV_2026,
    manager.id,
  ]);
  assert.equal(result.status, "INACTIVE");

  const active = fakeRepository({
    currentAssignment: true,
    target: {
      id: CLASS_ID,
      name: "1A",
      academicYear: "2026-2027",
      status: "INACTIVE",
    },
  });
  const reactivated = await managementService(active.repository).changeStatus(
    { classId: CLASS_ID },
    { status: "ACTIVE" },
    manager,
  );
  assert.equal(active.called("endAssignment").length, 0);
  assert.equal(reactivated.homeroomTeacher, null);
});

void test("past academic year classes are read-only", async () => {
  const { repository, called } = fakeRepository({
    configuredYears: ["2025-2026"],
    target: {
      id: CLASS_ID,
      name: "1A",
      academicYear: "2025-2026",
      status: "ACTIVE",
    },
  });
  await assert.rejects(
    managementService(repository).changeStatus(
      { classId: CLASS_ID },
      { status: "INACTIVE" },
      manager,
    ),
    isHttp(409),
  );
  assert.equal(called("updateStatus").length, 0);
});

void test("copying classes skips existing names and never copies homeroom teachers", async () => {
  const { repository, called } = fakeRepository({
    existingNames: ["1a"],
    source: [
      { name: "1A", registeredMealPortions: 30 },
      { name: "1B", registeredMealPortions: 28 },
      { name: "2A", registeredMealPortions: 31 },
    ],
  });
  const result = await managementService(repository).copyClasses(
    { fromAcademicYear: "2025-2026", toAcademicYear: "2027-2028" },
    manager,
  );
  assert.deepEqual(called("listActiveClassesForCopy")[0].args, [
    SCHOOL_ID,
    "2025-2026",
  ]);
  assert.deepEqual(result.skipped, ["1A"]);
  assert.deepEqual(
    called("createClass").map((call) => call.args[0]),
    [
      {
        schoolId: SCHOOL_ID,
        academicYear: "2027-2028",
        name: "1B",
        registeredMealPortions: 28,
      },
      {
        schoolId: SCHOOL_ID,
        academicYear: "2027-2028",
        name: "2A",
        registeredMealPortions: 31,
      },
    ],
  );
  assert.equal(result.toAcademicYear, "2027-2028");
  assert.ok(result.created.every((item) => item.homeroomTeacher === null));
  assert.equal(called("findCurrentAssignment").length, 0);
});

void test("copying from a year without active classes returns 404", async () => {
  const { repository } = fakeRepository({ source: [] });
  await assert.rejects(
    managementService(repository).copyClasses(
      { fromAcademicYear: "2025-2026", toAcademicYear: "2026-2027" },
      manager,
    ),
    isHttp(404),
  );
});

void test("class name conflicts are queried case-insensitively within the school and year", async () => {
  let where: unknown;
  const tx = {
    class: {
      findMany: (args: { where?: unknown }) => {
        where = args.where;
        return Promise.resolve([]);
      },
    },
  } as unknown as Parameters<ClassRepository["findNameConflicts"]>[0];
  await createClassRepository().findNameConflicts(
    tx,
    SCHOOL_ID,
    "2026-2027",
    ["1A"],
    CLASS_ID,
  );
  assert.deepEqual(where, {
    schoolId: SCHOOL_ID,
    academicYear: "2026-2027",
    OR: [{ name: { equals: "1A", mode: "insensitive" } }],
    id: { not: CLASS_ID },
  });
});

const TEACHER_ID = "00000000-0000-4000-8000-0000000000f1";

void test("creating a class can assign an available homeroom teacher in the same transaction", async () => {
  const { repository, called } = fakeRepository();
  const result = await managementService(repository).createClass(
    {
      name: "1A",
      academicYear: "2026-2027",
      registeredMealPortions: 30,
      homeroomTeacherUserId: TEACHER_ID,
    },
    manager,
  );
  assert.deepEqual(called("findEligibleTeacher")[0].args, [
    TEACHER_ID,
    SCHOOL_ID,
  ]);
  assert.deepEqual(called("findTeacherClassInYear")[0].args, [
    TEACHER_ID,
    SCHOOL_ID,
    "2026-2027",
  ]);
  assert.deepEqual(called("createAssignment")[0].args[0], {
    classId: "new-1A",
    teacherUserId: TEACHER_ID,
    assignedByUserId: manager.id,
    assignedAt: NOV_2026,
  });
  assert.deepEqual(result.homeroomTeacher, {
    id: TEACHER_ID,
    fullName: "Cô Lan",
    username: "gvcn_lan",
    assignedAt: NOV_2026.toISOString(),
  });
});

void test("an invalid or busy homeroom teacher prevents the class from being created", async () => {
  const create = (
    repository: ClassRepository,
    principal: AuthPrincipal = manager,
  ) =>
    managementService(repository, principal).createClass(
      {
        name: "1A",
        academicYear: "2026-2027",
        registeredMealPortions: 0,
        homeroomTeacherUserId: TEACHER_ID,
      },
      principal,
    );

  const missing = fakeRepository({ teacherExists: false });
  await assert.rejects(create(missing.repository), isHttp(400));
  assert.equal(missing.called("createClass").length, 0);

  const busy = fakeRepository({ teacherBusyIn: "2B" });
  await assert.rejects(create(busy.repository), isHttp(409));
  assert.equal(busy.called("createClass").length, 0);

  const noAssignPermission = principalWith("SCHOOL_MANAGEMENT_BOARD", [
    "class.view",
    "class.manage",
  ]);
  const forbidden = fakeRepository();
  await assert.rejects(
    create(forbidden.repository, noAssignPermission),
    isHttp(403),
  );
  assert.equal(forbidden.called("createClass").length, 0);
  assert.equal(forbidden.called("createAssignment").length, 0);
});

void test("homeroom teacher id must be a uuid when creating a class", () => {
  assert.throws(
    () =>
      validateCreateClass({
        name: "1A",
        academicYear: "2026-2027",
        homeroomTeacherUserId: "abc",
      }),
    isHttp(400),
  );
});

void test("assigning a teacher who already leads another class in the year is rejected", async () => {
  const { repository, called } = fakeRepository({
    currentAssignment: true,
    teacherBusyIn: "2B",
  });
  await assert.rejects(
    managementService(repository).assignHomeroomTeacher(
      { classId: CLASS_ID },
      { teacherUserId: TEACHER_ID },
      manager,
    ),
    (error: unknown) =>
      isHttp(409)(error) && (error as Error).message.includes("2B"),
  );
  assert.deepEqual(called("findTeacherClassInYear")[0].args, [
    TEACHER_ID,
    SCHOOL_ID,
    "2026-2027",
  ]);
  assert.equal(called("endAssignment").length, 0);
  assert.equal(called("createAssignment").length, 0);
});

void test("assigning a free teacher still replaces the current homeroom teacher", async () => {
  const { repository, called } = fakeRepository({ currentAssignment: true });
  const result = await managementService(repository).assignHomeroomTeacher(
    { classId: CLASS_ID },
    { teacherUserId: TEACHER_ID },
    manager,
  );
  assert.equal(called("endAssignment").length, 1);
  assert.equal(called("createAssignment").length, 1);
  assert.equal(result.homeroomTeacher?.id, TEACHER_ID);
});

const LAN = {
  id: "00000000-0000-4000-8000-0000000000f2",
  fullName: "Cô Lan",
  username: "gvcn_lan",
};
const HOA = {
  id: "00000000-0000-4000-8000-0000000000f3",
  fullName: "Cô Hoa",
  username: "gvcn_hoa",
};
const importBody = (rows: Array<Record<string, unknown>>, dryRun = true) =>
  validateImportClasses({ academicYear: "2026-2027", dryRun, rows });

void test("class import payload is validated structurally", () => {
  assert.throws(
    () =>
      validateImportClasses({
        academicYear: "2026-2027",
        dryRun: true,
        rows: [],
      }),
    isHttp(400),
  );
  assert.throws(
    () =>
      validateImportClasses({
        academicYear: "2026-2027",
        dryRun: true,
        rows: Array.from({ length: 301 }, (_, index) => ({
          rowNumber: index + 2,
          name: `L${index}`,
        })),
      }),
    isHttp(400),
  );
  assert.throws(
    () => importBody([{ rowNumber: 2, name: "1A", extra: true }]),
    isHttp(400),
  );
  assert.throws(
    () =>
      validateImportClasses({
        academicYear: "2026-2027",
        dryRun: true,
        schoolId: SCHOOL_ID,
        rows: [{ rowNumber: 2, name: "1A" }],
      }),
    isHttp(400),
  );
});

void test("class import preview reports every row without writing", async () => {
  const { repository, called } = fakeRepository({ teachers: [LAN] });
  const result = await managementService(repository).importClasses(
    importBody([
      { rowNumber: 2, name: " 1A ", registeredMealPortions: 30 },
      {
        rowNumber: 3,
        name: "1B",
        registeredMealPortions: "32",
        teacherUsername: "GVCN_LAN",
      },
      { rowNumber: 4, name: "1C", registeredMealPortions: null },
    ]),
    manager,
  );
  assert.deepEqual(result.summary, { create: 3, skip: 0, error: 0 });
  assert.deepEqual(
    result.rows.map((row) => [
      row.name,
      row.registeredMealPortions,
      row.status,
    ]),
    [
      ["1A", 30, "CREATE"],
      ["1B", 32, "CREATE"],
      ["1C", 0, "CREATE"],
    ],
  );
  assert.equal(result.rows[1].teacher?.id, LAN.id);
  assert.equal(called("createClass").length, 0);
  assert.equal(called("createAssignment").length, 0);
  assert.deepEqual(result.created, []);
});

void test("class import commit creates classes and assignments", async () => {
  const { repository, called } = fakeRepository({ teachers: [LAN] });
  const result = await managementService(repository).importClasses(
    importBody(
      [
        { rowNumber: 2, name: "1A" },
        { rowNumber: 3, name: "1B", teacherUsername: "gvcn_lan" },
      ],
      false,
    ),
    manager,
  );
  assert.equal(called("createClass").length, 2);
  assert.deepEqual(called("createAssignment")[0].args[0], {
    classId: "new-1B",
    teacherUserId: LAN.id,
    assignedByUserId: manager.id,
    assignedAt: NOV_2026,
  });
  assert.deepEqual(
    result.created.map((item) => [
      item.name,
      item.homeroomTeacher?.username ?? null,
    ]),
    [
      ["1A", null],
      ["1B", "gvcn_lan"],
    ],
  );
});

void test("class import skips names that already exist in the academic year", async () => {
  const { repository, called } = fakeRepository({
    existingNames: ["1A"],
    teachers: [LAN],
  });
  const result = await managementService(repository).importClasses(
    importBody(
      [
        { rowNumber: 2, name: "1a", teacherUsername: "gvcn_lan" },
        { rowNumber: 3, name: "1B" },
      ],
      false,
    ),
    manager,
  );
  assert.deepEqual(
    result.rows.map((row) => [row.status, row.teacher]),
    [
      ["SKIP", null],
      ["CREATE", null],
    ],
  );
  assert.deepEqual(result.summary, { create: 1, skip: 1, error: 0 });
  assert.equal(called("createClass").length, 1);
  assert.equal(called("createAssignment").length, 0);
});

void test("class import reports row errors with reasons", async () => {
  const { repository } = fakeRepository({
    teachers: [LAN, HOA],
    busyTeachers: { [HOA.id]: "2B" },
  });
  const result = await managementService(repository).importClasses(
    importBody([
      { rowNumber: 2, name: "   " },
      { rowNumber: 3, name: "x".repeat(121) },
      { rowNumber: 4, name: "1A", registeredMealPortions: -1 },
      { rowNumber: 5, name: "1B", registeredMealPortions: "ba mươi" },
      { rowNumber: 6, name: "1C", registeredMealPortions: 2.5 },
      { rowNumber: 7, name: "1D" },
      { rowNumber: 8, name: "1d" },
      { rowNumber: 9, name: "1E", teacherUsername: "khong_ton_tai" },
      { rowNumber: 10, name: "1F", teacherUsername: "gvcn_hoa" },
      { rowNumber: 11, name: "1G", teacherUsername: "gvcn_lan" },
      { rowNumber: 12, name: "1H", teacherUsername: "gvcn_lan" },
    ]),
    manager,
  );
  const byRow = new Map(result.rows.map((row) => [row.rowNumber, row]));
  const reason = (rowNumber: number) =>
    byRow.get(rowNumber)?.errors.join(" ") ?? "";
  assert.match(reason(2), /bắt buộc/);
  assert.match(reason(3), /120/);
  assert.match(reason(4), /số nguyên không âm/);
  assert.match(reason(5), /số nguyên không âm/);
  assert.match(reason(6), /số nguyên không âm/);
  assert.equal(byRow.get(7)?.status, "CREATE");
  assert.match(reason(8), /trùng với dòng 7/);
  assert.match(reason(9), /khong_ton_tai/);
  assert.match(reason(10), /đang chủ nhiệm lớp 2B/);
  assert.equal(byRow.get(11)?.status, "CREATE");
  assert.match(reason(12), /đã được gán cho dòng 11/);
  assert.deepEqual(result.summary, { create: 2, skip: 0, error: 9 });
});

void test("class import commit with errors is rejected without writes", async () => {
  const { repository, called } = fakeRepository();
  await assert.rejects(
    managementService(repository).importClasses(
      importBody(
        [
          { rowNumber: 2, name: "1A" },
          { rowNumber: 3, name: "" },
        ],
        false,
      ),
      manager,
    ),
    (error: unknown) =>
      isHttp(409)(error) && (error as Error).message.includes("1 dòng lỗi"),
  );
  assert.equal(called("createClass").length, 0);
});

void test("class import requires a writable year, the board role and assignment permission for teachers", async () => {
  const { repository, called } = fakeRepository({ configuredYears: [] });
  await assert.rejects(
    managementService(repository).importClasses(
      importBody([{ rowNumber: 2, name: "1A" }]),
      manager,
    ),
    isHttp(409),
  );
  assert.equal(called("createClass").length, 0);

  const teacher = principalWith("HOMEROOM_TEACHER", [
    "class.view",
    "class.manage",
  ]);
  await assert.rejects(
    managementService(fakeRepository().repository, teacher).importClasses(
      importBody([{ rowNumber: 2, name: "1A" }]),
      teacher,
    ),
    isHttp(403),
  );

  const withoutAssign = principalWith("SCHOOL_MANAGEMENT_BOARD", [
    "class.view",
    "class.manage",
  ]);
  const plain = fakeRepository({ teachers: [LAN] });
  const preview = await managementService(
    plain.repository,
    withoutAssign,
  ).importClasses(importBody([{ rowNumber: 2, name: "1A" }]), withoutAssign);
  assert.equal(preview.summary.create, 1);
  await assert.rejects(
    managementService(plain.repository, withoutAssign).importClasses(
      importBody([{ rowNumber: 2, name: "1A", teacherUsername: "gvcn_lan" }]),
      withoutAssign,
    ),
    isHttp(403),
  );
});

void test("teacher lookup for import is scoped to active homeroom teachers of the school", async () => {
  let where: unknown;
  const repository = createClassRepository();
  const tx = {
    user: {
      findMany: (args: { where: unknown }) => {
        where = args.where;
        return Promise.resolve([]);
      },
    },
  } as unknown as Prisma.TransactionClient;
  await repository.findTeachersByUsernames(tx, SCHOOL_ID, ["GVCN_Lan"]);
  assert.deepEqual(where, {
    schoolId: SCHOOL_ID,
    roleCode: "HOMEROOM_TEACHER",
    status: "ACTIVE",
    OR: [{ username: { equals: "GVCN_Lan", mode: "insensitive" } }],
  });
});
