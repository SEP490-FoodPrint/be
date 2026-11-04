import type { AuthPrincipal } from "../../types/auth";
import { listScopes } from "../../utils/resource-access";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import {
  assertPermission,
  withSchoolTransaction,
} from "../../utils/authorization";
import { HttpError } from "../../utils/http-error";
import { listWindow, readListPage } from "../../utils/list-query";
import { ROLES } from "../../constants/roles";
import { currentAcademicYear, isAssignableAcademicYear } from "./academic-year";
import type { ClassListQuery } from "./class.validation";

const ASSIGN_PERMISSION = "class_assignment.manage";

const teacherSelect = {
  id: true,
  fullName: true,
  username: true,
} as const satisfies Prisma.UserSelect;

const select = {
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

type ListRow = Prisma.ClassGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.ClassFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.class.findMany(args);
};

function classDto(row: ListRow, now: Date) {
  const { homeroomAssignments, ...rest } = row;
  const current = homeroomAssignments[0];
  return {
    ...rest,
    homeroomTeacher: current
      ? { ...current.Teacher, assignedAt: current.assignedAt }
      : null,
    canAssign:
      row.status === "ACTIVE" &&
      isAssignableAcademicYear(row.academicYear, now),
  };
}

function schoolOf(principal: AuthPrincipal): string {
  if (principal.orgType !== "SCHOOL" || !principal.schoolId)
    throw new HttpError(403, "Thao tác yêu cầu phạm vi trường đã xác thực");
  return principal.schoolId;
}

/** Lớp phải thuộc trường, đang hoạt động và ở niên khóa hiện tại/sắp tới. */
async function lockAssignableClass(
  tx: Prisma.TransactionClient,
  classId: string,
  schoolId: string,
  now: Date,
) {
  const target = await tx.class.findFirst({
    where: { id: classId, schoolId },
    select: { id: true, name: true, academicYear: true, status: true },
  });
  if (!target) throw new HttpError(404, "Không tìm thấy lớp học");
  if (target.status !== "ACTIVE")
    throw new HttpError(409, "Lớp đã ngừng hoạt động, không thể phân công");
  if (!isAssignableAcademicYear(target.academicYear, now))
    throw new HttpError(
      409,
      "Niên khóa của lớp đã kết thúc, chỉ được xem lịch sử phân công",
    );
  return target;
}

export function createClassService(
  read: ListReader = readFromDatabase,
  connect: () => Promise<PrismaClient> = getPrisma,
  clock: () => Date = () => new Date(),
) {
  return {
    async getAll(query: ClassListQuery, principal: AuthPrincipal) {
      const scope = listScopes["class"](principal);
      const now = clock();
      const page = await readListPage(
        () =>
          read({
            ...listWindow(query),
            where: {
              AND: [
                scope,
                query.academicYear ? { academicYear: query.academicYear } : {},
              ],
            },
            select,
            orderBy: [{ academicYear: "desc" }, { name: "asc" }, { id: "asc" }],
          }),
        query,
      );
      return { ...page, items: page.items.map((row) => classDto(row, now)) };
    },

    async getAcademicYears(principal: AuthPrincipal) {
      const scope = listScopes["class"](principal);
      const db = await connect();
      const rows = await db.class.findMany({
        where: { AND: [scope, { academicYear: { not: null } }] },
        distinct: ["academicYear"],
        select: { academicYear: true },
      });
      const current = currentAcademicYear(clock());
      const years = new Set(rows.map((row) => row.academicYear as string));
      years.add(current);
      return {
        current,
        items: [...years].sort((a, b) => b.localeCompare(a)),
      };
    },

    /** Chỉ tài khoản GVCN đang ACTIVE cùng trường; không mở API quản trị tài khoản cho BGH. */
    async getEligibleTeachers(
      academicYear: string | undefined,
      principal: AuthPrincipal,
    ) {
      assertPermission(principal, ASSIGN_PERMISSION);
      const schoolId = schoolOf(principal);
      const year = academicYear ?? currentAcademicYear(clock());
      const db = await connect();
      const teachers = await db.user.findMany({
        where: {
          schoolId,
          roleCode: ROLES.HOMEROOM_TEACHER,
          status: "ACTIVE",
        },
        select: {
          ...teacherSelect,
          homeroomAssignments: {
            where: { endedAt: null, Class: { academicYear: year } },
            select: { Class: { select: { id: true, name: true } } },
            take: 1,
          },
        },
        orderBy: [{ fullName: "asc" }, { id: "asc" }],
      });
      return {
        academicYear: year,
        items: teachers.map(({ homeroomAssignments, ...teacher }) => ({
          ...teacher,
          currentClass: homeroomAssignments[0]?.Class ?? null,
        })),
      };
    },

    async assignHomeroomTeacher(
      classId: string,
      teacherUserId: string,
      principal: AuthPrincipal,
    ) {
      const db = await connect();
      const now = clock();
      return withSchoolTransaction(
        db,
        principal,
        ASSIGN_PERMISSION,
        async (tx, actor, schoolId) => {
          const target = await lockAssignableClass(tx, classId, schoolId, now);
          const teacher = await tx.user.findFirst({
            where: {
              id: teacherUserId,
              schoolId,
              roleCode: ROLES.HOMEROOM_TEACHER,
              status: "ACTIVE",
            },
            select: teacherSelect,
          });
          if (!teacher)
            throw new HttpError(
              400,
              "Chỉ được chọn tài khoản GVCN đang hoạt động của trường",
            );
          const otherClass = await tx.classHomeroomAssignment.findFirst({
            where: {
              teacherUserId,
              endedAt: null,
              classId: { not: target.id },
              Class: { academicYear: target.academicYear },
            },
            select: { Class: { select: { name: true } } },
          });
          if (otherClass)
            throw new HttpError(
              409,
              `Giáo viên đang chủ nhiệm lớp ${otherClass.Class.name} trong niên khóa ${target.academicYear}`,
            );
          const current = await tx.classHomeroomAssignment.findFirst({
            where: { classId: target.id, endedAt: null },
            select: { id: true, teacherUserId: true, assignedAt: true },
          });
          if (current?.teacherUserId === teacherUserId)
            return {
              classId: target.id,
              homeroomTeacher: { ...teacher, assignedAt: current.assignedAt },
            };
          if (current)
            await tx.classHomeroomAssignment.update({
              where: { id: current.id },
              data: { endedAt: now, endedByUserId: actor.id },
            });
          const created = await tx.classHomeroomAssignment.create({
            data: {
              classId: target.id,
              teacherUserId,
              assignedByUserId: actor.id,
              assignedAt: now,
            },
            select: { assignedAt: true },
          });
          return {
            classId: target.id,
            homeroomTeacher: { ...teacher, assignedAt: created.assignedAt },
          };
        },
      );
    },

    async removeHomeroomTeacher(classId: string, principal: AuthPrincipal) {
      const db = await connect();
      const now = clock();
      return withSchoolTransaction(
        db,
        principal,
        ASSIGN_PERMISSION,
        async (tx, actor, schoolId) => {
          const target = await lockAssignableClass(tx, classId, schoolId, now);
          const current = await tx.classHomeroomAssignment.findFirst({
            where: { classId: target.id, endedAt: null },
            select: { id: true },
          });
          if (!current) throw new HttpError(404, "Lớp chưa có GVCN");
          await tx.classHomeroomAssignment.update({
            where: { id: current.id },
            data: { endedAt: now, endedByUserId: actor.id },
          });
          return { classId: target.id, homeroomTeacher: null };
        },
      );
    },
  };
}

export const classService = createClassService();
export type ClassService = ReturnType<typeof createClassService>;
