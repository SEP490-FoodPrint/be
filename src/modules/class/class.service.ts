import type { PrismaClient } from "../../generated/prisma/client";
import { ROLES } from "../../constants/roles";
import type { AuthPrincipal } from "../../types/auth";
import {
  assertPermission,
  withSchoolTransaction,
} from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import { readListPage } from "../../utils/list-query";
import { currentAcademicYear, isAssignableAcademicYear } from "./academic-year";
import {
  classRepository,
  type AssignableClassRow,
  type ClassListRow,
  type ClassRepository,
} from "./class.repository";
import type {
  ClassIdRequestDTO,
  ClassListRequestDTO,
  EligibleTeachersRequestDTO,
  HomeroomAssignmentRequestDTO,
} from "./class.request.dto";
import type {
  AcademicYearsResponseDTO,
  ClassListItemResponseDTO,
  ClassListResponseDTO,
  EligibleTeachersResponseDTO,
  HomeroomAssignmentResponseDTO,
} from "./class.response.dto";

const ASSIGN_PERMISSION = "class_assignment.manage";

function classDto(row: ClassListRow, now: Date): ClassListItemResponseDTO {
  const current = row.homeroomAssignments[0];
  return {
    id: row.id,
    schoolId: row.schoolId,
    name: row.name,
    academicYear: row.academicYear,
    registeredMealPortions: row.registeredMealPortions,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    homeroomTeacher: current
      ? {
          id: current.Teacher.id,
          fullName: current.Teacher.fullName,
          username: current.Teacher.username,
          assignedAt: current.assignedAt.toISOString(),
        }
      : null,
    canAssign:
      row.status === "ACTIVE" &&
      isAssignableAcademicYear(row.academicYear, now),
  };
}

function schoolOf(principal: AuthPrincipal): string {
  if (principal.orgType !== "SCHOOL" || !principal.schoolId) {
    throw new HttpError(403, "Thao tác yêu cầu phạm vi trường đã xác thực");
  }
  return principal.schoolId;
}

function assertManagementBoard(principal: AuthPrincipal): void {
  if (principal.role !== ROLES.SCHOOL_MANAGEMENT_BOARD) {
    throw new HttpError(403, "Chỉ Ban Giám hiệu được phân công GVCN");
  }
}

async function requireAssignableClass(
  repository: ClassRepository,
  tx: Parameters<ClassRepository["findAssignableClass"]>[0],
  classId: string,
  schoolId: string,
  now: Date,
): Promise<AssignableClassRow> {
  const target = await repository.findAssignableClass(tx, classId, schoolId);
  if (!target) throw new HttpError(404, "Không tìm thấy lớp học");
  if (target.status !== "ACTIVE") {
    throw new HttpError(409, "Lớp đã ngừng hoạt động, không thể phân công");
  }
  if (!isAssignableAcademicYear(target.academicYear, now)) {
    throw new HttpError(
      409,
      "Niên khóa của lớp đã kết thúc, chỉ được xem lịch sử phân công",
    );
  }
  return target;
}

export function createClassService(
  repository: ClassRepository = classRepository,
  connect: () => Promise<PrismaClient> = getPrisma,
  clock: () => Date = () => new Date(),
) {
  return {
    async getAll(
      query: ClassListRequestDTO,
      principal: AuthPrincipal,
    ): Promise<ClassListResponseDTO> {
      const now = clock();
      const page = await readListPage(
        () => repository.listClasses(query, principal),
        query,
      );
      return { ...page, items: page.items.map((row) => classDto(row, now)) };
    },

    async getAcademicYears(
      principal: AuthPrincipal,
    ): Promise<AcademicYearsResponseDTO> {
      const rows = await repository.listAcademicYears(principal);
      const current = currentAcademicYear(clock());
      const years = new Set(
        rows.filter((year): year is string => Boolean(year)),
      );
      years.add(current);
      return {
        current,
        items: [...years].sort((a, b) => b.localeCompare(a)),
      };
    },

    async getEligibleTeachers(
      query: EligibleTeachersRequestDTO,
      principal: AuthPrincipal,
    ): Promise<EligibleTeachersResponseDTO> {
      assertPermission(principal, ASSIGN_PERMISSION);
      assertManagementBoard(principal);
      const schoolId = schoolOf(principal);
      const academicYear = query.academicYear ?? currentAcademicYear(clock());
      const teachers = await repository.listEligibleTeachers(
        schoolId,
        academicYear,
      );
      return {
        academicYear,
        items: teachers.map(({ homeroomAssignments, ...teacher }) => ({
          ...teacher,
          currentClass: homeroomAssignments[0]?.Class ?? null,
        })),
      };
    },

    async assignHomeroomTeacher(
      params: ClassIdRequestDTO,
      body: HomeroomAssignmentRequestDTO,
      principal: AuthPrincipal,
    ): Promise<HomeroomAssignmentResponseDTO> {
      const db = await connect();
      const now = clock();
      return withSchoolTransaction(
        db,
        principal,
        ASSIGN_PERMISSION,
        async (tx, actor, schoolId) => {
          assertManagementBoard(actor);
          const target = await requireAssignableClass(
            repository,
            tx,
            params.classId,
            schoolId,
            now,
          );
          const teacher = await repository.findEligibleTeacher(
            tx,
            body.teacherUserId,
            schoolId,
          );
          if (!teacher) {
            throw new HttpError(
              400,
              "Chỉ được chọn tài khoản GVCN đang hoạt động của trường",
            );
          }
          const current = await repository.findCurrentAssignment(tx, target.id);
          if (current?.teacherUserId === body.teacherUserId) {
            return {
              classId: target.id,
              homeroomTeacher: {
                ...teacher,
                assignedAt: current.assignedAt.toISOString(),
              },
            };
          }
          if (current) {
            await repository.endAssignment(tx, current.id, now, actor.id);
          }
          const created = await repository.createAssignment(tx, {
            classId: target.id,
            teacherUserId: body.teacherUserId,
            assignedByUserId: actor.id,
            assignedAt: now,
          });
          return {
            classId: target.id,
            homeroomTeacher: {
              ...teacher,
              assignedAt: created.assignedAt.toISOString(),
            },
          };
        },
      );
    },

    async removeHomeroomTeacher(
      params: ClassIdRequestDTO,
      principal: AuthPrincipal,
    ): Promise<HomeroomAssignmentResponseDTO> {
      const db = await connect();
      const now = clock();
      return withSchoolTransaction(
        db,
        principal,
        ASSIGN_PERMISSION,
        async (tx, actor, schoolId) => {
          assertManagementBoard(actor);
          const target = await requireAssignableClass(
            repository,
            tx,
            params.classId,
            schoolId,
            now,
          );
          const current = await repository.findCurrentAssignment(tx, target.id);
          if (!current) throw new HttpError(404, "Lớp chưa có GVCN");
          await repository.endAssignment(tx, current.id, now, actor.id);
          return { classId: target.id, homeroomTeacher: null };
        },
      );
    },
  };
}

export const classService = createClassService();
export type ClassService = ReturnType<typeof createClassService>;
