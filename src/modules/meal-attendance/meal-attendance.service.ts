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
  classId: true,
  confirmedByUserId: true,
  mealDate: true,
  mealType: true,
  totalPortions: true,
  status: true,
  finalizedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.DailyMealPortionSelect;

type ListRow = Prisma.DailyMealPortionGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.DailyMealPortionFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.dailyMealPortion.findMany(args);
};

export function createMealAttendanceService(
  read: ListReader = readFromDatabase,
) {
  return {
    getAll(query: ListQuery, principal: AuthPrincipal) {
      const where = listScopes["meal-attendance"](principal);
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

export const mealAttendanceService = createMealAttendanceService();
export type MealAttendanceService = ReturnType<
  typeof createMealAttendanceService
>;
