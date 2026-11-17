import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";

export const mealAllocationTraceInclude = {
  DailyMealPortion: {
    include: {
      Class: {
        include: {
          School: true,
        },
      },
    },
  },
  mealAllocationBatches: {
    include: {
      CookingBatch: {
        include: {
          dishes: {
            include: {
              Dish: {
                include: {
                  schoolCategory: true,
                },
              },
              retainedFoodSamples: true,
            },
          },
          cookingBatchLots: {
            include: {
              IngredientLot: {
                include: {
                  SourceFacility: true,
                  DeliveryItem: {
                    include: {
                      Delivery: {
                        include: {
                          Supplier: {
                            include: {
                              supplierCertifications: true,
                            },
                          },
                          deliveryApprovals: true,
                        },
                      },
                      SupplyRequestItem: {
                        include: {
                          IngredientEntry: {
                            include: {
                              Ingredient: true,
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.MealAllocationInclude;

export type MealAllocationTraceRecord = Prisma.MealAllocationGetPayload<{
  include: typeof mealAllocationTraceInclude;
}>;

export interface FindAllocationParams {
  mealAllocationId?: string;
  classId?: string;
  date?: string;
  mealType?: "LUNCH" | "AFTERNOON";
}

export const mealTraceabilityRepository = {
  async findAllocationRecord(
    params: FindAllocationParams,
  ): Promise<MealAllocationTraceRecord | null> {
    const prisma = await getPrisma();

    if (params.mealAllocationId) {
      return prisma.mealAllocation.findUnique({
        where: { id: params.mealAllocationId },
        include: mealAllocationTraceInclude,
      });
    }

    const where: Prisma.MealAllocationWhereInput = {};

    if (params.classId || params.date || params.mealType) {
      where.DailyMealPortion = {
        is: {
          ...(params.classId ? { classId: params.classId } : {}),
          ...(params.date ? { mealDate: new Date(params.date) } : {}),
          ...(params.mealType ? { mealType: params.mealType } : {}),
        },
      };
    }

    return prisma.mealAllocation.findFirst({
      where,
      orderBy: { createdAt: "desc" },
      include: mealAllocationTraceInclude,
    });
  },
};
