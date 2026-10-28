import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";

const select = {
  id: true,
  weeklyMenuId: true,
  reviewerUserId: true,
  decision: true,
  feedback: true,
  reviewedAt: true,
  createdAt: true,
} as const satisfies Prisma.MenuReviewRecordSelect;

type ListRow = Prisma.MenuReviewRecordGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.MenuReviewRecordFindManyArgs,
  "skip" | "take" | "orderBy"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.menuReviewRecord.findMany(args);
};

export function createMenuReviewService(read: ListReader = readFromDatabase) {
  return {
    getAll(query: ListQuery) {
      return readListPage(
        () => read({ ...listWindow(query), select, orderBy: [{ id: "asc" }] }),
        query,
      );
    },
  };
}

export const menuReviewService = createMenuReviewService();
export type MenuReviewService = ReturnType<typeof createMenuReviewService>;
