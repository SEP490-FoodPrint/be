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
import { schoolGradeRepository } from "../school-grade/school-grade.repository";
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
  ImportClassesRequestDTO,
  ImportClassRowRequestDTO,
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
  ImportClassesResponseDTO,
  ImportRowResponseDTO,
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
    grade: row.grade ?? null,
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
  await assertTeacherFree(repository, tx, teacher, schoolId, academicYear);
  return teacher;
}

/** Từ chối khi giáo viên đang là GVCN hiện tại của lớp khác trong cùng niên khóa. */
async function assertTeacherFree(
  repository: ClassRepository,
  tx: ClassTx,
  teacher: { id: string; fullName: string },
  schoolId: string,
  academicYear: string,
  classId?: string,
): Promise<void> {
  const busy = await repository.findTeacherClassInYear(
    tx,
    teacher.id,
    schoolId,
    academicYear,
  );
  if (busy && busy.id !== classId) {
    throw new HttpError(
      409,
      `${teacher.fullName} đang chủ nhiệm lớp ${busy.name} trong niên khóa ${academicYear}`,
    );
  }
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

const MAX_PORTIONS = 2147483647;

/** Ô số suất từ Excel: trống là 0; chấp nhận số hoặc chuỗi chữ số. */
function parsePortions(
  value: ImportClassRowRequestDTO["registeredMealPortions"],
): number | null {
  if (value === undefined || value === null) return 0;
  const text = typeof value === "number" ? String(value) : value.trim();
  if (text === "") return 0;
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return parsed <= MAX_PORTIONS ? parsed : null;
}

export interface ImportLookup {
  existingNames: Set<string>;
  teachers: Map<string, { id: string; fullName: string; username: string }>;
  busyTeachers: Map<string, string>;
}

/** Tính trạng thái từng dòng nhập lớp từ dữ liệu đã truy vấn sẵn (không truy vấn DB). */
export function evaluateImportRows(
  rows: ImportClassRowRequestDTO[],
  lookup: ImportLookup,
): ImportRowResponseDTO[] {
  const seenNames = new Map<string, number>();
  const usedTeachers = new Map<string, number>();
  return rows.map((row) => {
    const name = row.name.trim();
    const username = row.teacherUsername?.trim() || null;
    const portions = parsePortions(row.registeredMealPortions);
    const errors: string[] = [];
    if (!name) errors.push("Tên lớp là bắt buộc");
    else if (name.length > 120) errors.push("Tên lớp tối đa 120 ký tự");
    if (portions === null) {
      errors.push("Số suất đăng ký phải là số nguyên không âm");
    }
    const key = nameKey(name);
    if (name) {
      const firstRow = seenNames.get(key);
      if (firstRow !== undefined) {
        errors.push(`Tên lớp trùng với dòng ${firstRow} trong file`);
      } else {
        seenNames.set(key, row.rowNumber);
      }
    }
    const base = {
      rowNumber: row.rowNumber,
      name,
      registeredMealPortions: portions,
    };
    if (!errors.length && lookup.existingNames.has(key)) {
      return {
        ...base,
        teacher: null,
        status: "SKIP" as const,
        errors: ["Lớp đã tồn tại trong niên khóa, bỏ qua dòng này"],
      };
    }
    let teacher: ImportRowResponseDTO["teacher"] = null;
    if (username) {
      const found = lookup.teachers.get(username.toLocaleLowerCase("vi"));
      const busyClass = found && lookup.busyTeachers.get(found.id);
      const usedRow = found && usedTeachers.get(found.id);
      if (!found) {
        errors.push(
          `Không tìm thấy GVCN đang hoạt động có tài khoản "${username}"`,
        );
      } else if (busyClass) {
        errors.push(
          `${found.fullName} đang chủ nhiệm lớp ${busyClass} trong niên khóa`,
        );
      } else if (usedRow !== undefined) {
        errors.push(
          `${found.fullName} đã được gán cho dòng ${usedRow} trong file`,
        );
      } else {
        teacher = found;
        if (!errors.length) usedTeachers.set(found.id, row.rowNumber);
      }
    }
    return {
      ...base,
      teacher,
      status: errors.length ? ("ERROR" as const) : ("CREATE" as const),
      errors,
    };
  });
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
          // Một GVCN chỉ chủ nhiệm một lớp mỗi niên khóa; kiểm tra trước khi đóng phân công cũ.
          await assertTeacherFree(
            repository,
            tx,
            teacher,
            schoolId,
            target.academicYear as string,
            target.id,
          );
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
          if (
            body.gradeId &&
            !(await schoolGradeRepository.find(tx, schoolId, body.gradeId))
          )
            throw new HttpError(404, "Không tìm thấy khối học");
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
              ...(body.gradeId !== undefined ? { gradeId: body.gradeId } : {}),
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
          // Grade reassignment also applies to classes in past academic years.
          if (
            body.gradeId &&
            !(await schoolGradeRepository.find(tx, schoolId, body.gradeId))
          )
            throw new HttpError(404, "Không tìm thấy khối học");
          if (
            body.name !== undefined ||
            body.registeredMealPortions !== undefined
          ) {
            const academicYear = await requireWritableYear(
              repository,
              tx,
              schoolId,
              target.academicYear,
              now,
            );
            if (body.name !== undefined)
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
              ...(body.gradeId !== undefined ? { gradeId: body.gradeId } : {}),
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
                ...(item.gradeId !== undefined
                  ? { gradeId: item.gradeId }
                  : {}),
              }),
            );
            created.push(classDto(row, now));
          }
          return { toAcademicYear, created, skipped };
        },
      );
    },

    async importClasses(
      body: ImportClassesRequestDTO,
      principal: AuthPrincipal,
    ): Promise<ImportClassesResponseDTO> {
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
          const names = [
            ...new Set(
              body.rows
                .map((row) => row.name.trim())
                .filter((name) => name && name.length <= 120),
            ),
          ];
          const usernames = [
            ...new Set(
              body.rows
                .map((row) => row.teacherUsername?.trim())
                .filter((value): value is string => Boolean(value)),
            ),
          ];
          if (usernames.length) assertPermission(actor, ASSIGN_PERMISSION);
          const existing = names.length
            ? await repository.findNameConflicts(
                tx,
                schoolId,
                academicYear,
                names,
              )
            : [];
          const teacherRows = usernames.length
            ? await repository.findTeachersByUsernames(tx, schoolId, usernames)
            : [];
          const busy = teacherRows.length
            ? await repository.findBusyTeachers(
                tx,
                teacherRows.map((teacher) => teacher.id),
                schoolId,
                academicYear,
              )
            : [];
          const rows = evaluateImportRows(body.rows, {
            existingNames: new Set(existing.map((item) => nameKey(item.name))),
            teachers: new Map(
              teacherRows.map((teacher) => [
                teacher.username.toLocaleLowerCase("vi"),
                teacher,
              ]),
            ),
            busyTeachers: new Map(
              busy.map((item) => [item.teacherUserId, item.className]),
            ),
          });
          const summary = {
            create: rows.filter((row) => row.status === "CREATE").length,
            skip: rows.filter((row) => row.status === "SKIP").length,
            error: rows.filter((row) => row.status === "ERROR").length,
          };
          const result = { academicYear, dryRun: body.dryRun, summary, rows };
          if (body.dryRun) return { ...result, created: [] };
          if (summary.error) {
            throw new HttpError(
              409,
              `File còn ${summary.error} dòng lỗi, hãy sửa rồi nhập lại`,
            );
          }
          const created: ClassListItemResponseDTO[] = [];
          for (const row of rows) {
            if (row.status !== "CREATE") continue;
            const classRow = await uniqueWrite(
              repository.createClass(tx, {
                schoolId,
                academicYear,
                name: row.name,
                registeredMealPortions: row.registeredMealPortions ?? 0,
              }),
            );
            const dto = classDto(classRow, now);
            if (!row.teacher) {
              created.push(dto);
              continue;
            }
            const assignment = await repository.createAssignment(tx, {
              classId: classRow.id,
              teacherUserId: row.teacher.id,
              assignedByUserId: actor.id,
              assignedAt: now,
            });
            created.push({
              ...dto,
              homeroomTeacher: {
                ...row.teacher,
                assignedAt: assignment.assignedAt.toISOString(),
              },
            });
          }
          return { ...result, created };
        },
      );
    },
  };
}

export const classService = createClassService();
export type ClassService = ReturnType<typeof createClassService>;
