import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";

const select = {
  id: true,
  dailyMealPortionId: true,
  createdByUserId: true,
  status: true,
  allocatedAt: true,
  distributedAt: true,
  finalizedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.MealAllocationSelect;

type ListRow = Prisma.MealAllocationGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.MealAllocationFindManyArgs,
  "skip" | "take" | "orderBy"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.mealAllocation.findMany(args);
};

export function createMealAllocationService(
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

export const mealAllocationService = createMealAllocationService();
export type MealAllocationService = ReturnType<
  typeof createMealAllocationService
>;
