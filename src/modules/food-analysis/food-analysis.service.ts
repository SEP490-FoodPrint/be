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
  incidentId: true,
  ingredientLotId: true,
  retainedFoodSampleId: true,
  laboratoryName: true,
  reportNumber: true,
  testType: true,
  sampledAt: true,
  testedAt: true,
  resultSummary: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.FoodAnalysisResultSelect;

type ListRow = Prisma.FoodAnalysisResultGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.FoodAnalysisResultFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.foodAnalysisResult.findMany(args);
};

export function createFoodAnalysisService(read: ListReader = readFromDatabase) {
  return {
    getAll(query: ListQuery, principal: AuthPrincipal) {
      const where = listScopes["food-analysis"](principal);
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

export const foodAnalysisService = createFoodAnalysisService();
export type FoodAnalysisService = ReturnType<typeof createFoodAnalysisService>;
