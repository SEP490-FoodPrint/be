import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { ROLES } from "../../constants/roles";
import type { AuthPrincipal } from "../../types/auth";
import {
  assertPermission,
  withSchoolTransaction,
} from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import { isAssignableAcademicYear } from "../class/academic-year";
import type {
  CreateAcademicYearRequestDTO,
  UpdateAcademicYearRequestDTO,
} from "./school-academic-year.request.dto";
import type {
  AcademicYearResponseDTO,
  HolidayResponseDTO,
} from "./school-academic-year.response.dto";
import {
  schoolAcademicYearRepository,
  type AcademicYearRow,
  type AcademicYearWriteInput,
  type SchoolAcademicYearRepository,
} from "./school-academic-year.repository";

const VIEW_PERMISSION = "school_academic_year.view";
const MANAGE_PERMISSION = "school_academic_year.manage";

function requireBoard(principal: AuthPrincipal, permission: string) {
  assertPermission(principal, permission);
  if (
    principal.role !== ROLES.SCHOOL_MANAGEMENT_BOARD ||
    principal.orgType !== "SCHOOL" ||
    !principal.schoolId
  )
    throw new HttpError(
      403,
      "Chỉ Ban Giám hiệu của trường được quản lý niên khóa",
    );
  return principal.schoolId;
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function mapHoliday(value: Prisma.JsonValue): HolidayResponseDTO[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const holiday = item as {
      date?: string;
      startDate?: string;
      endDate?: string;
      reason: string;
    };
    const startDate = holiday.startDate ?? holiday.date ?? "";
    return {
      startDate,
      endDate: holiday.endDate ?? startDate,
      reason: holiday.reason,
    };
  });
}

function mapResponse(row: AcademicYearRow): AcademicYearResponseDTO {
  return {
    id: row.id,
    academicYear: row.academicYear,
    startDate: dateOnly(row.startDate),
    endDate: dateOnly(row.endDate),
    holidays: mapHoliday(row.holidays),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function writeInput(
  input: Pick<
    UpdateAcademicYearRequestDTO,
    "startDate" | "endDate" | "holidays"
  >,
): AcademicYearWriteInput {
  return {
    startDate: new Date(`${input.startDate}T00:00:00.000Z`),
    endDate: new Date(`${input.endDate}T00:00:00.000Z`),
    holidays: input.holidays,
  };
}

function duplicateError(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  )
    throw new HttpError(409, "Niên khóa này đã tồn tại trong trường");
  throw error;
}

export function createSchoolAcademicYearService(
  repository: SchoolAcademicYearRepository = schoolAcademicYearRepository,
  connect: () => Promise<PrismaClient> = getPrisma,
  clock: () => Date = () => new Date(),
) {
  return {
    async list(principal: AuthPrincipal) {
      const schoolId = requireBoard(principal, VIEW_PERMISSION);
      return (await repository.list(schoolId)).map(mapResponse);
    },
    async get(id: string, principal: AuthPrincipal) {
      const schoolId = requireBoard(principal, VIEW_PERMISSION);
      const row = await repository.findById(schoolId, id);
      if (!row) throw new HttpError(404, "Không tìm thấy cấu hình niên khóa");
      return mapResponse(row);
    },
    async create(
      input: CreateAcademicYearRequestDTO,
      principal: AuthPrincipal,
    ) {
      requireBoard(principal, MANAGE_PERMISSION);
      if (!isAssignableAcademicYear(input.academicYear, clock()))
        throw new HttpError(
          409,
          "Không thể tạo niên khóa đã qua, chỉ được tạo niên khóa hiện tại hoặc sắp tới",
        );
      try {
        return await withSchoolTransaction(
          await connect(),
          principal,
          MANAGE_PERMISSION,
          async (tx, actor, schoolId) => {
            requireBoard(actor, MANAGE_PERMISSION);
            return mapResponse(
              await repository.create(
                schoolId,
                input.academicYear,
                writeInput(input),
                tx,
              ),
            );
          },
        );
      } catch (error) {
        duplicateError(error);
      }
    },
    async update(
      id: string,
      input: UpdateAcademicYearRequestDTO,
      principal: AuthPrincipal,
    ) {
      requireBoard(principal, MANAGE_PERMISSION);
      return withSchoolTransaction(
        await connect(),
        principal,
        MANAGE_PERMISSION,
        async (tx, actor, schoolId) => {
          requireBoard(actor, MANAGE_PERMISSION);
          if (!(await repository.findById(schoolId, id, tx)))
            throw new HttpError(404, "Không tìm thấy cấu hình niên khóa");
          return mapResponse(
            await repository.update(schoolId, id, writeInput(input), tx),
          );
        },
      );
    },
  };
}

export const schoolAcademicYearService = createSchoolAcademicYearService();
export type SchoolAcademicYearService = ReturnType<
  typeof createSchoolAcademicYearService
>;
