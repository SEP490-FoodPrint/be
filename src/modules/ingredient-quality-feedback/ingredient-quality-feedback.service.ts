import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";

const select = {
  id: true,
  deliveryId: true,
  ingredientLotId: true,
  submittedByUserId: true,
  title: true,
  description: true,
  status: true,
  respondedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.IngredientQualityFeedbackSelect;

type ListRow = Prisma.IngredientQualityFeedbackGetPayload<{
  select: typeof select;
}>;
type ListArguments = Pick<
  Prisma.IngredientQualityFeedbackFindManyArgs,
  "skip" | "take" | "orderBy"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.ingredientQualityFeedback.findMany(args);
};

export function createIngredientQualityFeedbackService(
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

export const ingredientQualityFeedbackService =
  createIngredientQualityFeedbackService();
export type IngredientQualityFeedbackService = ReturnType<
  typeof createIngredientQualityFeedbackService
>;
