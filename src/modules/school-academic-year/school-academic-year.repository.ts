import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";

export const academicYearSelect = {
  id: true,
  schoolId: true,
  academicYear: true,
  startDate: true,
  endDate: true,
  holidays: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.SchoolAcademicYearSelect;

export type AcademicYearRow = Prisma.SchoolAcademicYearGetPayload<{
  select: typeof academicYearSelect;
}>;

type DbClient = Pick<Prisma.TransactionClient, "schoolAcademicYear">;

export interface AcademicYearWriteInput {
  startDate: Date;
  endDate: Date;
  holidays: Prisma.InputJsonValue;
}

export function createSchoolAcademicYearRepository() {
  return {
    async list(schoolId: string, client?: DbClient) {
      const db = client ?? (await getPrisma());
      return db.schoolAcademicYear.findMany({
        where: { schoolId },
        select: academicYearSelect,
        orderBy: [{ startDate: "desc" }, { academicYear: "desc" }],
      });
    },
    async findById(schoolId: string, id: string, client?: DbClient) {
      const db = client ?? (await getPrisma());
      return db.schoolAcademicYear.findFirst({
        where: { id, schoolId },
        select: academicYearSelect,
      });
    },
    async create(
      schoolId: string,
      academicYear: string,
      input: AcademicYearWriteInput,
      client: DbClient,
    ) {
      return client.schoolAcademicYear.create({
        data: { schoolId, academicYear, ...input },
        select: academicYearSelect,
      });
    },
    async update(
      schoolId: string,
      id: string,
      input: AcademicYearWriteInput,
      client: DbClient,
    ) {
      return client.schoolAcademicYear.update({
        where: { id, schoolId },
        data: input,
        select: academicYearSelect,
      });
    },
  };
}

export const schoolAcademicYearRepository =
  createSchoolAcademicYearRepository();
export type SchoolAcademicYearRepository = ReturnType<
  typeof createSchoolAcademicYearRepository
>;
