import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { ROLES } from "../../constants/roles";
import type { AuthPrincipal } from "../../types/auth";
import {
  assertPermission,
  withSchoolTransaction,
} from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import { withReadTransaction } from "../../utils/read-transaction";
import { listScopes } from "../../utils/resource-access";
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
  ClassSchoolRequestDTO,
  ClassStatusRequestDTO,
  CopyClassesRequestDTO,
  CreateClassRequestDTO,
  EligibleTeachersRequestDTO,
  HomeroomAssignmentRequestDTO,
  UpdateClassRequestDTO,
} from "./class.request.dto";
import type {
  AcademicYearsResponseDTO,
  ClassListItemResponseDTO,
  ClassListResponseDTO,
  ClassSchoolResponseDTO,
  CopyClassesResponseDTO,
  EligibleTeachersResponseDTO,
  HomeroomAssignmentResponseDTO,
} from "./class.response.dto";

const ASSIGN_PERMISSION = "class_assignment.manage";
const MANAGE_PERMISSION = "class.manage";
const MANAGE_ROLE_MESSAGE = "Chỉ Ban Giám hiệu được quản lý lớp học";
const DUPLICATE_NAME_MESSAGE =
  "Tên lớp đã tồn tại trong niên khóa (kể cả lớp đã ngừng hoạt động)";
type ClassTx = Parameters<ClassRepository["findAssignableClass"]>[0];

const nameKey = (name: string) => name.trim().toLocaleLowerCase("vi");

function classDto(row: ClassListRow, now: Date): ClassListItemResponseDTO {
  const current = row.homeroomAssignments?.[0];
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

function assertManagementBoard(
  principal: AuthPrincipal,
  message = "Chỉ Ban Giám hiệu được phân công GVCN",
): void {
  if (principal.role !== ROLES.SCHOOL_MANAGEMENT_BOARD) {
    throw new HttpError(403, message);
  }
}

/** Niên khóa phải còn là năm hiện tại/sắp tới và đã được trường cấu hình. */
async function requireWritableYear(
  repository: ClassRepository,
  tx: ClassTx,
  schoolId: string,
  academicYear: string | null,
  now: Date,
): Promise<string> {
  if (!academicYear || !isAssignableAcademicYear(academicYear, now)) {
    throw new HttpError(
      409,
      "Niên khóa đã kết thúc hoặc không hợp lệ, chỉ được xem lớp học",
    );
  }
  const configured = await repository.findConfiguredAcademicYear(
    tx,
    schoolId,
    academicYear,
  );
  if (!configured) {
    throw new HttpError(
      409,
      `Niên khóa ${academicYear} chưa được cấu hình năm học`,
    );
  }
  return academicYear;
}

async function requireClass(
  repository: ClassRepository,
  tx: ClassTx,
  classId: string,
  schoolId: string,
): Promise<AssignableClassRow> {
  const target = await repository.findAssignableClass(tx, classId, schoolId);
  if (!target) throw new HttpError(404, "Không tìm thấy lớp học");
  return target;
}

async function assertNameAvailable(
  repository: ClassRepository,
  tx: ClassTx,
  schoolId: string,
  academicYear: string,
  name: string,
  excludeClassId?: string,
): Promise<void> {
  const conflicts = await repository.findNameConflicts(
    tx,
    schoolId,
    academicYear,
    [name],
    excludeClassId,
  );
  if (conflicts.length) throw new HttpError(409, DUPLICATE_NAME_MESSAGE);
}

/** GVCN gán khi tạo lớp: cần quyền phân công, tài khoản GVCN ACTIVE của trường và chưa chủ nhiệm lớp khác trong niên khóa. */
async function requireAvailableTeacher(
  repository: ClassRepository,
  tx: ClassTx,
  actor: AuthPrincipal,
  teacherUserId: string,
  schoolId: string,
  academicYear: string,
): Promise<{ id: string; fullName: string; username: string }> {
  assertPermission(actor, ASSIGN_PERMISSION);
  const teacher = await repository.findEligibleTeacher(
    tx,
    teacherUserId,
    schoolId,
  );
  if (!teacher) {
    throw new HttpError(
      400,
      "Chỉ được chọn tài khoản GVCN đang hoạt động của trường",
    );
  }
  const busy = await repository.findTeacherClassInYear(
    tx,
    teacherUserId,
    schoolId,
    academicYear,
  );
  if (busy) {
    throw new HttpError(
      409,
      `${teacher.fullName} đang chủ nhiệm lớp ${busy.name} trong niên khóa ${academicYear}`,
    );
  }
  return teacher;
}

/** Vi phạm unique (school_id, name, academic_year) trả 409 thay vì để transaction thử lại. */
async function uniqueWrite<T>(write: Promise<T>): Promise<T> {
  try {
    return await write;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new HttpError(409, DUPLICATE_NAME_MESSAGE);
    }
    throw error;
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
  _read?: unknown,
  repository: ClassRepository = classRepository,
  run = withReadTransaction,
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

    async getBySchool(
      input: ClassSchoolRequestDTO,
      principal: AuthPrincipal,
    ): Promise<ClassSchoolResponseDTO> {
      const scope = listScopes["class"](principal);
      const parent =
        principal.orgType === "SYSTEM"
          ? { kind: "system" as const }
          : {
              kind:
                principal.orgType === "SCHOOL"
                  ? ("school" as const)
                  : ("supplier" as const),
              id: principal.schoolId ?? principal.supplierId!,
            };
      return run(async (tx) => {
        const result = await repository.schoolPage(
          tx,
          input.query,
          input.params.schoolId,
          scope,
          parent,
        );
        if (!result) throw new HttpError(404, "Không tìm thấy trường học");
        const now = clock();
        const items = result.items.map((row) => classDto(row, now));
        const { page, limit } = input.query;
        return {
          items,
          pagination: {
            page,
            limit,
            total: result.total,
            hasNext: (page - 1) * limit + items.length < result.total,
          },
        };
      });
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

    async createClass(
      body: CreateClassRequestDTO,
      principal: AuthPrincipal,
    ): Promise<ClassListItemResponseDTO> {
      const db = await connect();
      const now = clock();
      return withSchoolTransaction(
        db,
        principal,
        MANAGE_PERMISSION,
        async (tx, actor, schoolId) => {
          assertManagementBoard(actor, MANAGE_ROLE_MESSAGE);
          const academicYear = await requireWritableYear(
            repository,
            tx,
            schoolId,
            body.academicYear,
            now,
          );
          await assertNameAvailable(
            repository,
            tx,
            schoolId,
            academicYear,
            body.name,
          );
          const teacher = body.homeroomTeacherUserId
            ? await requireAvailableTeacher(
                repository,
                tx,
                actor,
                body.homeroomTeacherUserId,
                schoolId,
                academicYear,
              )
            : null;
          const created = await uniqueWrite(
            repository.createClass(tx, {
              schoolId,
              academicYear,
              name: body.name,
              registeredMealPortions: body.registeredMealPortions,
            }),
          );
          const dto = classDto(created, now);
          if (!teacher) return dto;
          const assignment = await repository.createAssignment(tx, {
            classId: created.id,
            teacherUserId: teacher.id,
            assignedByUserId: actor.id,
            assignedAt: now,
          });
          return {
            ...dto,
            homeroomTeacher: {
              ...teacher,
              assignedAt: assignment.assignedAt.toISOString(),
            },
          };
        },
      );
    },

    async updateClass(
      params: ClassIdRequestDTO,
      body: UpdateClassRequestDTO,
      principal: AuthPrincipal,
    ): Promise<ClassListItemResponseDTO> {
      const db = await connect();
      const now = clock();
      return withSchoolTransaction(
        db,
        principal,
        MANAGE_PERMISSION,
        async (tx, actor, schoolId) => {
          assertManagementBoard(actor, MANAGE_ROLE_MESSAGE);
          const target = await requireClass(
            repository,
            tx,
            params.classId,
            schoolId,
          );
          const academicYear = await requireWritableYear(
            repository,
            tx,
            schoolId,
            target.academicYear,
            now,
          );
          if (body.name !== undefined) {
            await assertNameAvailable(
              repository,
              tx,
              schoolId,
              academicYear,
              body.name,
              target.id,
            );
          }
          const updated = await uniqueWrite(
            repository.updateClass(tx, target.id, schoolId, {
              ...(body.name !== undefined ? { name: body.name } : {}),
              ...(body.registeredMealPortions !== undefined
                ? { registeredMealPortions: body.registeredMealPortions }
                : {}),
            }),
          );
          return classDto(updated, now);
        },
      );
    },

    async changeStatus(
      params: ClassIdRequestDTO,
      body: ClassStatusRequestDTO,
      principal: AuthPrincipal,
    ): Promise<ClassListItemResponseDTO> {
      const db = await connect();
      const now = clock();
      return withSchoolTransaction(
        db,
        principal,
        MANAGE_PERMISSION,
        async (tx, actor, schoolId) => {
          assertManagementBoard(actor, MANAGE_ROLE_MESSAGE);
          const target = await requireClass(
            repository,
            tx,
            params.classId,
            schoolId,
          );
          await requireWritableYear(
            repository,
            tx,
            schoolId,
            target.academicYear,
            now,
          );
          if (body.status === "INACTIVE") {
            const current = await repository.findCurrentAssignment(
              tx,
              target.id,
            );
            if (current) {
              await repository.endAssignment(tx, current.id, now, actor.id);
            }
          }
          const updated = await repository.updateStatus(
            tx,
            target.id,
            schoolId,
            body.status,
          );
          return classDto(updated, now);
        },
      );
    },

    async copyClasses(
      body: CopyClassesRequestDTO,
      principal: AuthPrincipal,
    ): Promise<CopyClassesResponseDTO> {
      const db = await connect();
      const now = clock();
      return withSchoolTransaction(
        db,
        principal,
        MANAGE_PERMISSION,
        async (tx, actor, schoolId) => {
          assertManagementBoard(actor, MANAGE_ROLE_MESSAGE);
          const toAcademicYear = await requireWritableYear(
            repository,
            tx,
            schoolId,
            body.toAcademicYear,
            now,
          );
          const source = await repository.listActiveClassesForCopy(
            tx,
            schoolId,
            body.fromAcademicYear,
          );
          if (!source.length) {
            throw new HttpError(
              404,
              `Niên khóa ${body.fromAcademicYear} không có lớp đang hoạt động`,
            );
          }
          const existing = await repository.findNameConflicts(
            tx,
            schoolId,
            toAcademicYear,
            source.map((item) => item.name),
          );
          const taken = new Set(existing.map((item) => nameKey(item.name)));
          const created: ClassListItemResponseDTO[] = [];
          const skipped: string[] = [];
          for (const item of source) {
            const key = nameKey(item.name);
            if (taken.has(key)) {
              skipped.push(item.name);
              continue;
            }
            taken.add(key);
            const row = await uniqueWrite(
              repository.createClass(tx, {
                schoolId,
                academicYear: toAcademicYear,
                name: item.name,
                registeredMealPortions: item.registeredMealPortions,
              }),
            );
            created.push(classDto(row, now));
          }
          return { toAcademicYear, created, skipped };
        },
      );
    },
  };
}

export const classService = createClassService();
export type ClassService = ReturnType<typeof createClassService>;
