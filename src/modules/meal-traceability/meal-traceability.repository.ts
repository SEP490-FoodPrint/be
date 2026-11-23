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

export interface FindAllocationParams {
  mealAllocationId?: string;
  classId?: string;
  date?: string;
  mealType?: "LUNCH" | "AFTERNOON";
  schoolCode?: string;
}

export const mealTraceabilityRepository = {
  /**
   * Đúng một suất ăn: theo id, hoặc theo khóa duy nhất (lớp, ngày, bữa) của
   * DailyMealPortion. Bỏ qua phân bổ đã huỷ và giới hạn theo trường nếu có mã.
   */
  async findAllocationRecord(
    params: FindAllocationParams,
  ): Promise<MealAllocationTraceRecord | null> {
    const prisma = await getPrisma();
    const school = params.schoolCode
      ? {
          Class: {
            School: {
              code: {
                equals: params.schoolCode.trim(),
                mode: "insensitive" as const,
              },
            },
          },
        }
      : {};

    if (params.mealAllocationId) {
      return prisma.mealAllocation.findFirst({
        where: {
          id: params.mealAllocationId,
          status: { not: "CANCELLED" },
          DailyMealPortion: { is: school },
        },
        include: mealAllocationTraceInclude,
      });
    }

    if (!params.classId || !params.date || !params.mealType) return null;

    return prisma.mealAllocation.findFirst({
      where: {
        status: { not: "CANCELLED" },
        DailyMealPortion: {
          is: {
            classId: params.classId,
            mealDate: new Date(`${params.date}T00:00:00.000Z`),
            mealType: params.mealType,
            ...school,
          },
        },
      },
      include: mealAllocationTraceInclude,
    });
  },

  /**
   * Mọi suất ăn (chưa huỷ) của các lớp thuộc một khối trong một ngày và bữa,
   * giới hạn theo trường nếu có mã. Khối luôn thuộc đúng một trường.
   */
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
  async listPublicSchoolClasses(schoolCode: string) {
    const prisma = await getPrisma();
    const school = await prisma.school.findFirst({
      where: {
        code: { equals: schoolCode.trim(), mode: "insensitive" },
        status: "ACTIVE",
      },
      select: { id: true },
    });
    if (!school) return null;
    return prisma.class.findMany({
      where: { schoolId: school.id, status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        gradeId: true,
        grade: { select: { name: true } },
      },
    });
  },
};
