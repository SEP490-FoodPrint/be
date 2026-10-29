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
  batchCode: true,
  menuDayId: true,
  dishId: true,
  mealType: true,
  cookingModeApplied: true,
  status: true,
  plannedPortions: true,
  preparedPortions: true,
  confirmedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.CookingBatchSelect;

type ListRow = Prisma.CookingBatchGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.CookingBatchFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.cookingBatch.findMany(args);
};

export function createKitchenService(read: ListReader = readFromDatabase) {
  return {
    getAll(query: ListQuery, principal: AuthPrincipal) {
      const where = listScopes["kitchen"](principal);
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

export const kitchenService = createKitchenService();
export type KitchenService = ReturnType<typeof createKitchenService>;
