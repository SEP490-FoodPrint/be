import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";

export const mealAllocationTraceInclude = {
  DailyMealPortion: {
    include: {
      Class: {
        include: {
          School: true,
          grade: { select: { id: true, name: true } },
        },
      },
    },
  },
  mealAllocationBatches: {
    include: {
      materials: true,
      CookingBatch: {
        include: {
          completedByUser: { select: { fullName: true } },
          dishes: {
            include: {
              Dish: {
                include: {
                  schoolCategory: true,
                },
              },
              retainedFoodSamples: {
                include: {
                  storageUnit: {
                    select: {
                      code: true,
                      name: true,
                      location: true,
                      temperatureRange: true,
                    },
                  },
                },
              },
            },
          },
          cookingBatchLots: {
            include: {
              IngredientLot: {
                include: {
                  SourceFacility: true,
                  DeliveryItem: {
                    include: {
                      Ingredient: { select: { name: true } },
                      SourceFacility: true,
                      Delivery: {
                        include: {
                          Supplier: {
                            include: {
                              supplierCertifications: {
                                where: { status: "ACTIVE" },
                                orderBy: { certificationType: "asc" },
                              },
                            },
                          },
                          deliveryApprovals: {
                            include: {
                              Role: { select: { code: true, name: true } },
                            },
                            orderBy: { decidedAt: "asc" },
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

export const mealTraceabilityRepository = {
  async findGradeAllocationRecords(params: {
    gradeId: string;
    date: string;
    mealType: "LUNCH" | "AFTERNOON";
    schoolCode?: string;
  }): Promise<MealAllocationTraceRecord[]> {
    const prisma = await getPrisma();
    return prisma.mealAllocation.findMany({
      where: {
        status: { not: "CANCELLED" },
        DailyMealPortion: {
          is: {
            mealDate: new Date(`${params.date}T00:00:00.000Z`),
            mealType: params.mealType,
            Class: {
              gradeId: params.gradeId,
              ...(params.schoolCode
                ? {
                    School: {
                      code: {
                        equals: params.schoolCode.trim(),
                        mode: "insensitive" as const,
                      },
                    },
                  }
                : {}),
            },
          },
        },
      },
      include: mealAllocationTraceInclude,
      orderBy: { id: "asc" },
    });
  },

  /** Lớp đang hoạt động của một trường đang hoạt động, cho trang công khai. */
};
