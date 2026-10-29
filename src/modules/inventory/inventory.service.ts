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
  ingredientLotId: true,
  movementType: true,
  quantity: true,
  unit: true,
  referenceType: true,
  referenceId: true,
  occurredAt: true,
  createdAt: true,
} as const satisfies Prisma.InventoryTransactionSelect;

type ListRow = Prisma.InventoryTransactionGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.InventoryTransactionFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.inventoryTransaction.findMany(args);
};

export function createInventoryService(read: ListReader = readFromDatabase) {
  return {
    getAll(query: ListQuery, principal: AuthPrincipal) {
      const where = listScopes["inventory"](principal);
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

export const inventoryService = createInventoryService();
export type InventoryService = ReturnType<typeof createInventoryService>;
