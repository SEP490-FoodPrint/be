import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";

const select = {
  id: true,
  mealAllocationId: true,
  submittedByUserId: true,
  complaintType: true,
  description: true,
  status: true,
  submittedAt: true,
  resolvedAt: true,
  updatedAt: true,
} as const satisfies Prisma.MealComplaintSelect;

type ListRow = Prisma.MealComplaintGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.MealComplaintFindManyArgs,
  "skip" | "take" | "orderBy"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.mealComplaint.findMany(args);
};

export function createFeedbackService(read: ListReader = readFromDatabase) {
  return {
    getAll(query: ListQuery) {
      return readListPage(
        () => read({ ...listWindow(query), select, orderBy: [{ id: "asc" }] }),
        query,
      );
    },
  };
}

export const feedbackService = createFeedbackService();
export type FeedbackService = ReturnType<typeof createFeedbackService>;
