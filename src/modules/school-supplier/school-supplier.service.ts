import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";

const select = {
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
  "skip" | "take" | "orderBy"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.schoolSupplierRelationship.findMany(args);
};

export function createSchoolSupplierService(
  read: ListReader = readFromDatabase,
) {
  return {
    getAll(query: ListQuery) {
      return readListPage(
        () => read({ ...listWindow(query), select, orderBy: [{ id: "asc" }] }),
        query,
      );
    },
  };
}

export const schoolSupplierService = createSchoolSupplierService();
export type SchoolSupplierService = ReturnType<
  typeof createSchoolSupplierService
>;
