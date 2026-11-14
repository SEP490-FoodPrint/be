import type { Prisma } from "../../generated/prisma/client";

export async function readAllocationDay(
  tx: Prisma.TransactionClient,
  schoolId: string,
  date: Date,
) {
  const [menus, batches, demands] = await Promise.all([
    tx.menuDay.findMany({
      where: {
        menuDate: date,
        WeeklyMenu: { schoolId },
        approvalStatus: "APPROVED",
      },
      orderBy: { id: "asc" },
      select: {
        id: true,
        WeeklyMenu: {
          select: {
            isSchoolWide: true,
            grades: {
              select: { gradeId: true, grade: { select: { name: true } } },
            },
          },
        },
        menuDayDishes: {
          select: { dishId: true, mealType: true },
          orderBy: [{ mealType: "asc" }, { dishId: "asc" }],
        },
        portionGroups: {
          orderBy: { id: "asc" },
          select: { id: true, mealType: true, isDefault: true },
        },
      },
    }),
    tx.cookingBatch.findMany({
      where: { MenuDay: { menuDate: date, WeeklyMenu: { schoolId } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        menuDayId: true,
        mealType: true,
        status: true,
        completedAt: true,
        plannedPortions: true,
        note: true,
        dishes: {
          orderBy: { dishId: "asc" },
          select: {
            dishId: true,
            plannedPortions: true,
            retainedFoodSamples: { take: 1, select: { id: true } },
            mealAllocationBatches: {
              orderBy: { mealAllocationId: "asc" },
              select: {
                MealAllocation: { select: { dailyMealPortionId: true } },
              },
            },
          },
        },
      },
    }),
    tx.dailyMealPortion.findMany({
      where: { mealDate: date, Class: { schoolId } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        mealType: true,
        totalPortions: true,
        status: true,
        Class: { select: { id: true, name: true, gradeId: true } },
        portionGroups: {
          orderBy: { portionGroupId: "asc" },
          select: { portionGroupId: true, portionCount: true },
        },
        dailyAllergyPortions: {
          where: { portionCount: { gt: 0 } },
          take: 1,
          select: { ingredientEntryId: true },
        },
        MealAllocation: {
          select: {
            id: true,
            status: true,
            mealAllocationBatches: {
              select: {
                cookingBatchId: true,
                dishId: true,
                allocatedPortions: true,
              },
              orderBy: [{ cookingBatchId: "asc" }, { dishId: "asc" }],
            },
          },
        },
      },
    }),
  ]);
  return { menus, batches, demands };
}

type RawAllocationDay = Awaited<ReturnType<typeof readAllocationDay>>;
export type AllocationDay = Omit<RawAllocationDay, "menus" | "demands"> & {
  menus: (Omit<RawAllocationDay["menus"][number], "WeeklyMenu"> & {
    WeeklyMenu?: RawAllocationDay["menus"][number]["WeeklyMenu"];
  })[];
  demands: (Omit<RawAllocationDay["demands"][number], "Class"> & {
    Class: { id: string; name: string; gradeId?: string | null };
  })[];
};

export async function confirmAllocationDistribution(
  tx: Prisma.TransactionClient,
  schoolId: string,
  date: Date,
  allocationIds: string[],
  actorId: string,
  distributedAt: Date,
) {
  return tx.mealAllocation.updateMany({
    where: {
      id: { in: allocationIds },
      status: "ALLOCATED",
      DailyMealPortion: { mealDate: date, Class: { schoolId } },
    },
    data: {
      status: "DISTRIBUTED",
      distributedAt,
      distributedByUserId: actorId,
    },
  });
}

interface AllocationChange {
  demandId: string;
  allocationId?: string;
  rows: { cookingBatchId: string; dishId: string; allocatedPortions: number }[];
}

export async function writeAllocationDay(
  tx: Prisma.TransactionClient,
  actorId: string,
  schoolId: string,
  date: Date,
  changes: AllocationChange[],
) {
  for (const change of changes) {
    const { allocationId } = change;
    if (allocationId) {
      await tx.mealAllocation.update({
        where: {
          id: allocationId,
          status: "ALLOCATED",
          DailyMealPortion: {
            id: change.demandId,
            mealDate: date,
            Class: { schoolId },
          },
        },
        data: { mealAllocationBatches: { deleteMany: {} } },
      });
      if (change.rows.length) {
        await tx.mealAllocationBatch.createMany({
          data: change.rows.map((row) => ({
            ...row,
            mealAllocationId: allocationId,
          })),
        });
      }
    } else {
      await tx.mealAllocation.create({
        data: {
          DailyMealPortion: {
            connect: {
              id: change.demandId,
              mealDate: date,
              Class: { schoolId },
            },
          },
          createdByUser: { connect: { id: actorId } },
          mealAllocationBatches: { createMany: { data: change.rows } },
        },
      });
    }
  }
}
