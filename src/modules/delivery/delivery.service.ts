import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";

const select = {
  id: true,
  deliveryNo: true,
  supplyRequestId: true,
  supplierId: true,
  status: true,
  receivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.DeliverySelect;

type ListRow = Prisma.DeliveryGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.DeliveryFindManyArgs,
  "skip" | "take" | "orderBy"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.delivery.findMany(args);
};

export function createDeliveryService(read: ListReader = readFromDatabase) {
  return {
    getAll(query: ListQuery) {
      return readListPage(
        () => read({ ...listWindow(query), select, orderBy: [{ id: "asc" }] }),
        query,
      );
    },
  };
}

export const deliveryService = createDeliveryService();
export type DeliveryService = ReturnType<typeof createDeliveryService>;
