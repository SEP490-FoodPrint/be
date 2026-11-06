import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import { listWindow, type ListQuery } from "../../utils/list-query";
export const select = {
  id: true,
  schoolId: true,
  name: true,
  academicYear: true,
  registeredMealPortions: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.ClassSelect;

type ListRow = Prisma.ClassGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.ClassFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof select;
};
export type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.class.findMany(args);
};

const childSelect = { ...select, ...{} } as const satisfies Prisma.ClassSelect;
export function createClassRepository(read: ListReader = readFromDatabase) {
  return {
    list(query: ListQuery, scope: Prisma.ClassWhereInput) {
      return read({
        ...listWindow(query),
        where: scope,
        select,
        orderBy: [{ id: "asc" }],
      });
    },
    async schoolPage(
      tx: Prisma.TransactionClient,
      query: ListQuery,
      schoolId: string,
      scope: Prisma.ClassWhereInput,
      parent: { kind: "system" } | { kind: "school" | "supplier"; id: string },
    ) {
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
        select: childSelect,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ id: "asc" }],
      });
      return { items, total };
    },
  };
}
export type ClassRepository = ReturnType<typeof createClassRepository>;
