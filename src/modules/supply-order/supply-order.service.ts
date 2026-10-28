import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";

const select = {
  id: true,
  requestNo: true,
  schoolId: true,
  supplierId: true,
  status: true,
  acceptedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.SupplyRequestSelect;

type ListRow = Prisma.SupplyRequestGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.SupplyRequestFindManyArgs,
  "skip" | "take" | "orderBy"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.supplyRequest.findMany(args);
};

export function createSupplyOrderService(read: ListReader = readFromDatabase) {
  return {
    getAll(query: ListQuery) {
      return readListPage(
        () => read({ ...listWindow(query), select, orderBy: [{ id: "asc" }] }),
        query,
      );
    },
  };
}

export const supplyOrderService = createSupplyOrderService();
export type SupplyOrderService = ReturnType<typeof createSupplyOrderService>;
