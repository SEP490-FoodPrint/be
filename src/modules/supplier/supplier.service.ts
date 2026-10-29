import type { AuthPrincipal } from "../../types/auth";
import { listScopes } from "../../utils/resource-access";
import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";

const select = {
  id: true,
  name: true,
  taxCode: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.SupplierSelect;

type ListRow = Prisma.SupplierGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.SupplierFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.supplier.findMany(args);
};

export function createSupplierService(read: ListReader = readFromDatabase) {
  return {
    getAll(query: ListQuery, principal: AuthPrincipal) {
      const where = listScopes["supplier"](principal);
      return readListPage(
        () =>
          read({
            ...listWindow(query),
            where,
            select,
            orderBy: [{ id: "asc" }],
          }),
        query,
      );
    },
  };
}

export const supplierService = createSupplierService();
export type SupplierService = ReturnType<typeof createSupplierService>;
