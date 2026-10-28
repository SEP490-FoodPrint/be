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
  "skip" | "take" | "orderBy"
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
    getAll(query: ListQuery) {
      return readListPage(
        () => read({ ...listWindow(query), select, orderBy: [{ id: "asc" }] }),
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
