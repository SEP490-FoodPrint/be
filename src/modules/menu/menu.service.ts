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
  weekStartDate: true,
  title: true,
  status: true,
  submittedAt: true,
  approvedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.WeeklyMenuSelect;

type ListRow = Prisma.WeeklyMenuGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.WeeklyMenuFindManyArgs,
  "skip" | "take" | "orderBy"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.weeklyMenu.findMany(args);
};

export function createMenuService(read: ListReader = readFromDatabase) {
  return {
    getAll(query: ListQuery) {
      return readListPage(
        () => read({ ...listWindow(query), select, orderBy: [{ id: "asc" }] }),
        query,
      );
    },
  };
}

export const menuService = createMenuService();
export type MenuService = ReturnType<typeof createMenuService>;
