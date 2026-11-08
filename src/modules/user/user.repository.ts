import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import { listWindow, type ListQuery } from "../../utils/list-query";
export const select = {
  id: true,
  username: true,
  fullName: true,
  roleId: true,
  schoolId: true,
  supplierId: true,
  communeFoodSafetyUnitId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.UserSelect;

type ListRow = Prisma.UserGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.UserFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof select;
};
export type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.user.findMany(args);
};

const childSelect = {
  ...select,
  ...{ email: true, Role: { select: { code: true, name: true } } },
} as const satisfies Prisma.UserSelect;
export function createUserRepository(read: ListReader = readFromDatabase) {
  return {
    list(query: ListQuery, scope: Prisma.UserWhereInput) {
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
      scope: Prisma.UserWhereInput,
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
      const where: Prisma.UserWhereInput = { AND: [scope, { schoolId }] };
      const total = await tx.user.count({ where });
      const items = await tx.user.findMany({
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
export type UserRepository = ReturnType<typeof createUserRepository>;
