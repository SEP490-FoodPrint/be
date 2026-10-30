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
  cookingBatchId: true,
  recordedByUserId: true,
  sampledAt: true,
  quantity: true,
  unit: true,
  storageLocation: true,
  status: true,
  disposedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.RetainedFoodSampleSelect;

type ListRow = Prisma.RetainedFoodSampleGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.RetainedFoodSampleFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.retainedFoodSample.findMany(args);
};

export function createRetainedSampleService(
  read: ListReader = readFromDatabase,
) {
  return {
    getAll(query: ListQuery, principal: AuthPrincipal) {
      const where = listScopes["retained-sample"](principal);
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

export const retainedSampleService = createRetainedSampleService();
export type RetainedSampleService = ReturnType<
  typeof createRetainedSampleService
>;
