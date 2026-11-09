import type { Prisma } from "../../generated/prisma/client";
export const retainedSampleSelect = {
  id: true,
  cookingBatchId: true,
  recordedByUserId: true,
  sampledAt: true,
  quantity: true,
  unit: true,
  storageLocation: true,
  status: true,
  disposedAt: true,
  disposalNote: true,
  createdAt: true,
  updatedAt: true,
  CookingBatch: {
    select: {
      batchCode: true,
      mealType: true,
      plannedPortions: true,
      Dish: { select: { name: true } },
    },
  },
} as const satisfies Prisma.RetainedFoodSampleSelect;
export type SampleRow = Prisma.RetainedFoodSampleGetPayload<{
  select: typeof retainedSampleSelect;
}>;
type ListArguments = Pick<
  Prisma.RetainedFoodSampleFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & { select: typeof retainedSampleSelect };
export type ListReader = (args: ListArguments) => Promise<SampleRow[]>;
type Tx = Prisma.TransactionClient;
type SampleListFilter = {
  page: number;
  limit: number;
  status?: "STORED" | "DISPOSED";
  search?: string;
};
function filtered(
  query: SampleListFilter,
  scope: Prisma.RetainedFoodSampleWhereInput,
): Prisma.RetainedFoodSampleWhereInput {
  return {
    AND: [
      scope,
      {
        ...(query.status ? { status: query.status } : {}),
        ...(query.search
          ? {
              OR: [
                {
                  CookingBatch: {
                    batchCode: { contains: query.search, mode: "insensitive" },
                  },
                },
                {
                  CookingBatch: {
                    Dish: {
                      name: { contains: query.search, mode: "insensitive" },
                    },
                  },
                },
              ],
            }
          : {}),
      },
    ],
  };
}
export function createRetainedSampleRepository(read?: ListReader) {
  return {
    list(
      tx: Tx,
      query: SampleListFilter,
      scope: Prisma.RetainedFoodSampleWhereInput,
    ) {
      const args = {
        where: filtered(query, scope),
        select: retainedSampleSelect,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ id: "asc" as const }],
      };
      return read ? read(args) : tx.retainedFoodSample.findMany(args);
    },
    count(
      tx: Tx,
      query: SampleListFilter,
      scope: Prisma.RetainedFoodSampleWhereInput,
    ) {
      return tx.retainedFoodSample.count({ where: filtered(query, scope) });
    },
    findBatch(tx: Tx, cookingBatchId: string, schoolId: string) {
      return tx.cookingBatch.findFirst({
        where: { id: cookingBatchId, MenuDay: { WeeklyMenu: { schoolId } } },
        select: { id: true, status: true, completedAt: true },
      });
    },
    findForBatch(tx: Tx, cookingBatchId: string) {
      return tx.retainedFoodSample.findUnique({
        where: { cookingBatchId },
        select: retainedSampleSelect,
      });
    },
    create(
      tx: Tx,
      cookingBatchId: string,
      actorId: string,
      input: {
        quantity: string;
        unit: string;
        storageLocation: string;
        sampledAt: Date;
      },
    ) {
      return tx.retainedFoodSample.create({
        data: { cookingBatchId, recordedByUserId: actorId, ...input },
        select: retainedSampleSelect,
      });
    },
    findInSchool(tx: Tx, id: string, schoolId: string) {
      return tx.retainedFoodSample.findFirst({
        where: { id, CookingBatch: { MenuDay: { WeeklyMenu: { schoolId } } } },
        select: retainedSampleSelect,
      });
    },
    findActiveIncident(
      tx: Tx,
      id: string,
      cookingBatchId: string,
      schoolId: string,
    ) {
      return tx.foodSafetyIncident.findFirst({
        where: {
          schoolId,
          status: { in: ["OPEN", "INVESTIGATING"] },
          OR: [
            { foodAnalysisResults: { some: { retainedFoodSampleId: id } } },
            {
              foodSafetyIncidentAllocations: {
                some: {
                  MealAllocation: {
                    mealAllocationBatches: { some: { cookingBatchId } },
                  },
                },
              },
            },
          ],
        },
        select: { id: true },
      });
    },
    dispose(
      tx: Tx,
      id: string,
      input: { disposedAt: Date; disposalNote: string },
    ) {
      return tx.retainedFoodSample.update({
        where: { id },
        data: { status: "DISPOSED", ...input },
        select: retainedSampleSelect,
      });
    },
  };
}
