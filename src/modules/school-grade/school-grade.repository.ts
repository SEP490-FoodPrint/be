import type { Prisma, PrismaClient } from "../../generated/prisma/client";

const projection = {
  id: true,
  code: true,
  name: true,
  _count: { select: { classes: true } },
} as const satisfies Prisma.SchoolGradeSelect;
export type SchoolGradeRow = Prisma.SchoolGradeGetPayload<{
  select: typeof projection;
}>;
type GradeFields = { code: string; name: string };

export const schoolGradeRepository = {
  list(db: PrismaClient, scope: Prisma.SchoolGradeWhereInput) {
    return db.schoolGrade.findMany({
      where: scope,
      orderBy: [{ code: "asc" }, { id: "asc" }],
      select: projection,
    });
  },
  find(tx: Prisma.TransactionClient, schoolId: string, id: string) {
    return tx.schoolGrade.findUnique({
      where: { schoolId_id: { schoolId, id } },
      select: projection,
    });
  },
  findByCode(tx: Prisma.TransactionClient, schoolId: string, code: string) {
    return tx.schoolGrade.findUnique({
      where: { schoolId_code: { schoolId, code } },
      select: { id: true },
    });
  },
  create(tx: Prisma.TransactionClient, schoolId: string, input: GradeFields) {
    return tx.schoolGrade.create({
      data: { ...input, schoolId },
      select: projection,
    });
  },
  update(
    tx: Prisma.TransactionClient,
    schoolId: string,
    id: string,
    input: Partial<GradeFields>,
  ) {
    return tx.schoolGrade.update({
      where: { schoolId_id: { schoolId, id } },
      data: input,
      select: projection,
    });
  },
  async remove(tx: Prisma.TransactionClient, schoolId: string, id: string) {
    await tx.schoolGrade.delete({ where: { schoolId_id: { schoolId, id } } });
  },
};
