import type { Prisma } from "../../generated/prisma/client";
export const retainedSampleSelect = {
  id: true,
  cookingBatchId: true,
  dishId: true,
  CookingBatchDish: {
    select: { plannedPortions: true, Dish: { select: { name: true } } },
  },
  recordedByUserId: true,
  sampledAt: true,
  quantity: true,
  unit: true,
  storageLocation: true,
  storageUnitId: true,
  storageUnit: { select: { name: true } },
  photoPublicId: true,
  photoHash: true,
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
      BatchGroup: { select: { id: true, batchCode: true } },
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
                  storageLocation: {
                    contains: query.search,
                    mode: "insensitive",
                  },
                },
                {
                  CookingBatch: {
                    batchCode: { contains: query.search, mode: "insensitive" },
                  },
                },
                {
                  CookingBatchDish: {
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
        orderBy: [{ sampledAt: "desc" as const }, { id: "asc" as const }],
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
        select: {
          id: true,
          status: true,
          completedAt: true,
          mealType: true,
          MenuDay: { select: { menuDate: true } },
          dishes: {
            select: { dishId: true, sampleQuantity: true, sampleUnit: true },
          },
        },
      });
    },
    listForBatch(tx: Tx, cookingBatchId: string) {
      return tx.retainedFoodSample.findMany({
        where: { cookingBatchId },
        select: retainedSampleSelect,
        orderBy: { dishId: "asc" },
      });
    },
    findForBatch(tx: Tx, cookingBatchId: string, dishId: string) {
      return tx.retainedFoodSample.findUnique({
        where: { cookingBatchId_dishId: { cookingBatchId, dishId } },
        select: retainedSampleSelect,
      });
    },
    create(
      tx: Tx,
      cookingBatchId: string,
      actorId: string,
      input: {
        dishId: string;
        quantity: string;
        unit: string;
        storageUnitId: string;
        storageLocation: string;
        sampledAt: Date;
        photoPublicId?: string;
        photoHash?: string;
      },
    ) {
      return tx.retainedFoodSample.create({
        data: { cookingBatchId, recordedByUserId: actorId, ...input },
        select: retainedSampleSelect,
      });
    },
    /** Khóa tủ trong transaction để hai lần ghi mẫu đồng thời không vượt sức chứa. */
    async lockStorageUnit(tx: Tx, id: string, schoolId: string) {
      await tx.$queryRaw`SELECT id FROM foodprint.sample_storage_units WHERE id = ${id}::uuid AND school_id = ${schoolId}::uuid FOR UPDATE`;
      return tx.sampleStorageUnit.findFirst({
        where: { id, schoolId },
        select: {
          id: true,
          name: true,
          status: true,
          capacity: true,
          compartmentCount: true,
          currentUsage: true,
        },
      });
    },
    countStoredInUnit(tx: Tx, storageUnitId: string) {
      return tx.retainedFoodSample.count({
        where: { storageUnitId, status: "STORED" },
      });
    },
    findStoredInCompartment(
      tx: Tx,
      storageUnitId: string,
      compartment: string,
    ) {
      return tx.retainedFoodSample.findFirst({
        where: {
          storageUnitId,
          status: "STORED",
          OR: [
            { storageLocation: { endsWith: ` – ${compartment}` } },
            { storageLocation: compartment },
          ],
        },
        select: { id: true },
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
          // Hồ sơ còn hiệu lực: mọi trạng thái trừ đã đóng/đã hủy (specs/food-safety-incident-workflow FR-010).
          status: { notIn: ["CLOSED", "CANCELLED_BY_SCHOOL"] },
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
