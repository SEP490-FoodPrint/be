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
  supplierId: true,
  certificationType: true,
  certificateNo: true,
  issuedDate: true,
  expiryDate: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.SupplierCertificationSelect;

type ListRow = Prisma.SupplierCertificationGetPayload<{
  select: typeof select;
}>;
type ListArguments = Pick<
  Prisma.SupplierCertificationFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.supplierCertification.findMany(args);
};

export function createSupplierCertificationService(
  read: ListReader = readFromDatabase,
) {
  return {
    getAll(query: ListQuery, principal: AuthPrincipal) {
      const where = listScopes["supplier-certification"](principal);
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

export const supplierCertificationService =
  createSupplierCertificationService();
export type SupplierCertificationService = ReturnType<
  typeof createSupplierCertificationService
>;
