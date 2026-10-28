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
  cookingBatchId: true,
  mealAllocationId: true,
  foodSafetyIncidentId: true,
  payloadHash: true,
  hashAlgorithm: true,
  networkName: true,
  transactionHash: true,
  blockNumber: true,
  anchorStatus: true,
  verificationStatus: true,
  verifiedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.TraceabilityAnchorSelect;

type ListRow = Prisma.TraceabilityAnchorGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.TraceabilityAnchorFindManyArgs,
  "skip" | "take" | "orderBy"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.traceabilityAnchor.findMany(args);
};

export function createTraceabilityService(read: ListReader = readFromDatabase) {
  return {
    async getAll(query: ListQuery) {
      const result = await readListPage(
        () => read({ ...listWindow(query), select, orderBy: [{ id: "asc" }] }),
        query,
      );
      return {
        ...result,
        items: result.items.map((row) => ({
          ...row,
          blockNumber:
            row.blockNumber === null ? null : row.blockNumber.toString(),
        })),
      };
    },
  };
}

export const traceabilityService = createTraceabilityService();
export type TraceabilityService = ReturnType<typeof createTraceabilityService>;
