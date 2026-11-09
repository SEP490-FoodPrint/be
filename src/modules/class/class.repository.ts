import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import { ROLES } from "../../constants/roles";
import { getPrisma } from "../../utils/database";
import { listWindow, type ListQuery } from "../../utils/list-query";
import { listScopes } from "../../utils/resource-access";
import type { ClassListRequestDTO } from "./class.request.dto";

const teacherSelect = {
  id: true,
  fullName: true,
  username: true,
} as const satisfies Prisma.UserSelect;

const classListSelect = {
  id: true,
  schoolId: true,
  name: true,
  academicYear: true,
  registeredMealPortions: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  homeroomAssignments: {
    where: { endedAt: null },
    select: { assignedAt: true, Teacher: { select: teacherSelect } },
    take: 1,
  },
} as const satisfies Prisma.ClassSelect;

const eligibleTeacherSelect = {
  ...teacherSelect,
  homeroomAssignments: {
    select: { Class: { select: { id: true, name: true } } },
    take: 1,
  },
} as const satisfies Prisma.UserSelect;

export type ClassListRow = Prisma.ClassGetPayload<{
  select: typeof classListSelect;
}>;
export type EligibleTeacherRow = Prisma.UserGetPayload<{
  select: typeof eligibleTeacherSelect;
}>;
export type AssignableClassRow = Pick<
  ClassListRow,
  "id" | "name" | "academicYear" | "status"
>;
export type TeacherRow = Prisma.UserGetPayload<{
  select: typeof teacherSelect;
}>;

export interface ClassRepository {
  listClasses(
    query: ClassListRequestDTO,
    principal: AuthPrincipal,
  ): Promise<ClassListRow[]>;
  listAcademicYears(principal: AuthPrincipal): Promise<Array<string | null>>;
  listEligibleTeachers(
    schoolId: string,
    academicYear: string,
  ): Promise<EligibleTeacherRow[]>;
  findAssignableClass(
    tx: Prisma.TransactionClient,
    classId: string,
    schoolId: string,
  ): Promise<AssignableClassRow | null>;
  findEligibleTeacher(
    tx: Prisma.TransactionClient,
    teacherUserId: string,
    schoolId: string,
  ): Promise<TeacherRow | null>;
  findCurrentAssignment(
    tx: Prisma.TransactionClient,
    classId: string,
  ): Promise<{
    id: string;
    teacherUserId: string;
    assignedAt: Date;
  } | null>;
  endAssignment(
    tx: Prisma.TransactionClient,
    assignmentId: string,
    endedAt: Date,
    endedByUserId: string,
  ): Promise<void>;
  schoolPage(
    tx: Prisma.TransactionClient,
    query: ListQuery,
    schoolId: string,
    scope: Prisma.ClassWhereInput,
    parent: { kind: "system" } | { kind: "school" | "supplier"; id: string },
  ): Promise<{ items: ClassListRow[]; total: number } | null>;
  createAssignment(
    tx: Prisma.TransactionClient,
    input: {
      classId: string;
      teacherUserId: string;
      assignedByUserId: string;
      assignedAt: Date;
    },
  ): Promise<{ assignedAt: Date }>;
}

export function createClassRepository(
  connect: () => Promise<PrismaClient> = getPrisma,
): ClassRepository {
  return {
    async listClasses(query, principal) {
      const db = await connect();
      return db.class.findMany({
        ...listWindow(query),
        where: {
          AND: [
            listScopes.class(principal),
            query.academicYear ? { academicYear: query.academicYear } : {},
          ],
        },
        select: classListSelect,
        orderBy: [{ academicYear: "desc" }, { name: "asc" }, { id: "asc" }],
      });
    },

    async listAcademicYears(principal) {
      const db = await connect();
      const rows = await db.class.findMany({
        where: {
          AND: [listScopes.class(principal), { academicYear: { not: null } }],
        },
        distinct: ["academicYear"],
        select: { academicYear: true },
      });
      return rows.map((row) => row.academicYear);
    },

    async listEligibleTeachers(schoolId, academicYear) {
      const db = await connect();
      return db.user.findMany({
        where: {
          schoolId,
          roleCode: ROLES.HOMEROOM_TEACHER,
          status: "ACTIVE",
        },
        select: {
          ...eligibleTeacherSelect,
          homeroomAssignments: {
            where: { endedAt: null, Class: { academicYear } },
            select: { Class: { select: { id: true, name: true } } },
            take: 1,
          },
        },
        orderBy: [{ fullName: "asc" }, { id: "asc" }],
      });
    },

    async schoolPage(tx, query, schoolId, scope, parent) {
      const parentFilter: Prisma.SchoolWhereInput =
        parent.kind === "system"
          ? {}
          : parent.kind === "school"
            ? { id: parent.id }
            : {
                schoolSupplierRelationships: {
                  some: { supplierId: parent.id },
                },
              };
      const school = await tx.school.findFirst({
        where: { AND: [{ id: schoolId }, parentFilter] },
        select: { id: true },
      });
      if (!school) return null;
      const where: Prisma.ClassWhereInput = { AND: [scope, { schoolId }] };
      const total = await tx.class.count({ where });
      const items = await tx.class.findMany({
        where,
        select: classListSelect,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ id: "asc" }],
      });
      return { items, total };
    },

    findAssignableClass(tx, classId, schoolId) {
      return tx.class.findFirst({
        where: { id: classId, schoolId },
        select: { id: true, name: true, academicYear: true, status: true },
      });
    },

    findEligibleTeacher(tx, teacherUserId, schoolId) {
      return tx.user.findFirst({
        where: {
          id: teacherUserId,
          schoolId,
          roleCode: ROLES.HOMEROOM_TEACHER,
          status: "ACTIVE",
        },
        select: teacherSelect,
      });
    },

    findCurrentAssignment(tx, classId) {
      return tx.classHomeroomAssignment.findFirst({
        where: { classId, endedAt: null },
        select: { id: true, teacherUserId: true, assignedAt: true },
      });
    },

    async endAssignment(tx, assignmentId, endedAt, endedByUserId) {
      await tx.classHomeroomAssignment.update({
        where: { id: assignmentId },
        data: { endedAt, endedByUserId },
      });
    },

    createAssignment(tx, input) {
      return tx.classHomeroomAssignment.create({
        data: input,
        select: { assignedAt: true },
      });
    },
  };
}

export const classRepository = createClassRepository();
