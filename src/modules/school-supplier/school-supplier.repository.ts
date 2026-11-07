import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import { listWindow, type ListQuery } from "../../utils/list-query";
export const select = {
  id: true,
  schoolId: true,
  supplierId: true,
  status: true,
  linkedAt: true,
  unlinkedAt: true,
  suspendedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.SchoolSupplierRelationshipSelect;

type ListRow = Prisma.SchoolSupplierRelationshipGetPayload<{
  select: typeof select;
}>;
type ListArguments = Pick<
  Prisma.SchoolSupplierRelationshipFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof select;
};
export type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.schoolSupplierRelationship.findMany(args);
};

const childSelect = {
  ...select,
  ...{ Supplier: { select: { name: true, status: true } } },
} as const satisfies Prisma.SchoolSupplierRelationshipSelect;
export function createSchoolSupplierRepository(
  read: ListReader = readFromDatabase,
) {
  return {
    list(query: ListQuery, scope: Prisma.SchoolSupplierRelationshipWhereInput) {
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
      scope: Prisma.SchoolSupplierRelationshipWhereInput,
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
      const where: Prisma.SchoolSupplierRelationshipWhereInput = {
        AND: [scope, { schoolId }],
      };
      const total = await tx.schoolSupplierRelationship.count({ where });
      const items = await tx.schoolSupplierRelationship.findMany({
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
export type SchoolSupplierRepository = ReturnType<
  typeof createSchoolSupplierRepository
>;
