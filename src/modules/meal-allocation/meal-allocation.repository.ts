import { portionsOrNull } from "../../utils/portions";
import type { Prisma } from "../../generated/prisma/client";

export async function readAllocationDay(
  tx: Prisma.TransactionClient,
  schoolId: string,
  date: Date,
  mealType?: "LUNCH" | "AFTERNOON",
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
              orderBy: { gradeId: "asc" },
              select: {
                gradeId: true,
                grade: {
                  select: {
                    name: true,
                    classes: {
                      where: { status: "ACTIVE" },
                      take: 1,
                      select: { id: true },
                    },
                  },
                },
              },
            },
          },
        },
        mealSeasonings: {
          where: { mealType },
          select: {
            mealType: true,
            ingredientEntry: {
              select: {
                ingredientId: true,
                Ingredient: { select: { name: true } },
              },
            },
          },
        },
        menuDayDishes: {
          where: { mealType },
          select: {
            dishId: true,
            mealType: true,
            Dish: { select: { name: true } },
            ingredients: {
              select: {
                ingredientId: true,
                ingredient: { select: { name: true } },
              },
            },
          },
          orderBy: [{ mealType: "asc" }, { dishId: "asc" }],
        },
        portionGroups: {
          where: { mealType },
          orderBy: { id: "asc" },
          select: {
            id: true,
            mealType: true,
            isDefault: true,
            dishes: { orderBy: { dishId: "asc" }, select: { dishId: true } },
          },
        },
      },
    }),
    tx.cookingBatch.findMany({
      where: {
        mealType,
        MenuDay: { menuDate: date, WeeklyMenu: { schoolId } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        batchCode: true,
        batchNumber: true,
        menuDayId: true,
        mealType: true,
        status: true,
        completedAt: true,
        plannedPortions: true,
        note: true,
        cookingBatchLots: {
          orderBy: { ingredientLotId: "asc" },
          select: {
            dishId: true,
            ingredientLotId: true,
            quantityUsed: true,
            IngredientLot: {
              select: {
                DeliveryItem: {
                  select: {
                    ingredientId: true,
                    Ingredient: { select: { name: true } },
                  },
                },
              },
            },
            unit: true,
          },
        },
        dishes: {
          orderBy: { dishId: "asc" },
          select: {
            dishId: true,
            plannedPortions: true,
            allocationRecipeSnapshot: true,
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
      where: { mealType, mealDate: date, Class: { schoolId } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        mealType: true,
        totalPortions: true,
        status: true,
        Class: {
          select: {
            id: true,
            name: true,
            gradeId: true,
            grade: { select: { name: true } },
          },
        },
        portionGroups: {
          orderBy: { portionGroupId: "asc" },
          select: { portionGroupId: true, portionCount: true },
        },
        dailyAllergyPortions: {
          where: { portionCount: { gt: 0 } },
          orderBy: [{ groupNo: "asc" }, { ingredientEntryId: "asc" }],
          select: {
            groupNo: true,
            ingredientEntryId: true,
            portionCount: true,
            IngredientEntry: {
              select: {
                ingredientId: true,
                Ingredient: { select: { name: true } },
              },
            },
          },
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
                allocationVersion: true,
                theoreticalPortions: true,
                materials: { orderBy: { ingredientLotId: "asc" } },
              },
              orderBy: [{ cookingBatchId: "asc" }, { dishId: "asc" }],
            },
          },
        },
      },
    }),
  ]);
  return {
    menus,
    // Số suất mẻ là numeric(20,2) (TASK-10 v8); phân bổ tính bằng số thực làm tròn 0,01.
    batches: batches.map((batch) => ({
      ...batch,
      plannedPortions: portionsOrNull(batch.plannedPortions),
      dishes: batch.dishes.map((dish) => ({
        ...dish,
        plannedPortions: portionsOrNull(dish.plannedPortions),
      })),
    })),
    demands: demands.map((demand) => ({
      ...demand,
      MealAllocation: demand.MealAllocation
        ? {
            ...demand.MealAllocation,
            mealAllocationBatches:
              demand.MealAllocation.mealAllocationBatches.map((row) => ({
                ...row,
                allocatedPortions: row.allocatedPortions.toNumber(),
              })),
          }
        : null,
    })),
  };
}

type RawAllocationDay = Awaited<ReturnType<typeof readAllocationDay>>;
type RawDemand = RawAllocationDay["demands"][number];
type RawRow = NonNullable<
  RawDemand["MealAllocation"]
>["mealAllocationBatches"][number];
type CompatibleRow = Omit<
  RawRow,
  "allocationVersion" | "theoreticalPortions" | "materials"
> &
  Partial<
    Pick<RawRow, "allocationVersion" | "theoreticalPortions" | "materials">
  >;
export type AllocationDay = Omit<
  RawAllocationDay,
  "menus" | "demands" | "batches"
> & {
  batches: (Omit<
    RawAllocationDay["batches"][number],
    "cookingBatchLots" | "dishes"
  > & {
    cookingBatchLots?: (Omit<
      RawAllocationDay["batches"][number]["cookingBatchLots"][number],
      "IngredientLot"
    > &
      Partial<
        Pick<
          RawAllocationDay["batches"][number]["cookingBatchLots"][number],
          "IngredientLot"
        >
      >)[];
    dishes: (Omit<
      RawAllocationDay["batches"][number]["dishes"][number],
      "allocationRecipeSnapshot"
    > & { allocationRecipeSnapshot?: Prisma.JsonValue })[];
  })[];
  menus: (Omit<
    RawAllocationDay["menus"][number],
    "WeeklyMenu" | "portionGroups" | "mealSeasonings" | "menuDayDishes"
  > & {
    mealSeasonings?: RawAllocationDay["menus"][number]["mealSeasonings"];
    menuDayDishes: (Omit<
      RawAllocationDay["menus"][number]["menuDayDishes"][number],
      "ingredients"
    > & {
      ingredients?: RawAllocationDay["menus"][number]["menuDayDishes"][number]["ingredients"];
    })[];
    WeeklyMenu?: Omit<
      NonNullable<RawAllocationDay["menus"][number]["WeeklyMenu"]>,
      "grades"
    > & {
      grades: {
        gradeId: string;
        grade: { name: string; classes?: { id: string }[] };
      }[];
    };
    portionGroups: (Omit<
      RawAllocationDay["menus"][number]["portionGroups"][number],
      "dishes"
    > & { dishes?: { dishId: string }[] })[];
  })[];
  demands: (Omit<
    RawAllocationDay["demands"][number],
    "Class" | "MealAllocation" | "dailyAllergyPortions"
  > & {
    dailyAllergyPortions: (Pick<
      RawDemand["dailyAllergyPortions"][number],
      "ingredientEntryId"
    > &
      Partial<RawDemand["dailyAllergyPortions"][number]>)[];
    MealAllocation:
      | (Omit<
          NonNullable<RawDemand["MealAllocation"]>,
          "mealAllocationBatches"
        > & { mealAllocationBatches: CompatibleRow[] })
      | null;
    Class: {
      id: string;
      name: string;
      gradeId?: string | null;
      grade?: { name: string } | null;
    };
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

export async function readMaterialAllocationData(
  tx: Prisma.TransactionClient,
  schoolId: string,
  date: Date,
  mealType: "LUNCH" | "AFTERNOON",
) {
  const day = await readAllocationDay(tx, schoolId, date, mealType);
  const batches = await tx.cookingBatch.findMany({
    where: { mealType, MenuDay: { menuDate: date, WeeklyMenu: { schoolId } } },
    orderBy: [{ batchNumber: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      menuDayId: true,
      batchNumber: true,
      status: true,
      supplyBatchNo: true,
      MenuDay: {
        select: {
          menuDayDishes: {
            where: { mealType },
            select: {
              dishId: true,
              ingredients: {
                orderBy: { ingredientId: "asc" },
                select: {
                  ingredientId: true,
                  quantityPerPortion: true,
                  unit: true,
                },
              },
            },
          },
        },
      },
      dishes: {
        select: {
          dishId: true,
          allocationRecipeSnapshot: true,
          Dish: {
            select: {
              standardQuantity: true,
              gradeRecipes: {
                orderBy: { gradeId: "asc" },
                select: { gradeId: true, portionQuantity: true },
              },
              dishIngredientEntries: {
                where: { ingredientRole: "MAIN" },
                orderBy: { ingredientEntryId: "asc" },
                select: {
                  requiredQuantity: true,
                  unit: true,
                  IngredientEntry: { select: { ingredientId: true } },
                },
              },
            },
          },
          retainedFoodSamples: { select: { id: true }, take: 1 },
        },
      },
      cookingBatchLots: {
        orderBy: { ingredientLotId: "asc" },
        select: {
          dishId: true,
          ingredientLotId: true,
          quantityUsed: true,
          unit: true,
          IngredientLot: {
            select: {
              DeliveryItem: {
                select: {
                  Ingredient: { select: { name: true } },
                  IngredientEntry: {
                    select: { ingredientId: true, wasteRate: true },
                  },
                  SupplyRequestItem: {
                    select: {
                      IngredientEntry: {
                        select: { ingredientId: true, wasteRate: true },
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
  });
  const allocations = await tx.mealAllocation.findMany({
    where: {
      DailyMealPortion: { mealDate: date, mealType, Class: { schoolId } },
    },
    orderBy: { id: "asc" },
    select: {
      id: true,
      dailyMealPortionId: true,
      status: true,
      mealAllocationBatches: {
        orderBy: [{ cookingBatchId: "asc" }, { dishId: "asc" }],
        include: { materials: { orderBy: { ingredientLotId: "asc" } } },
      },
    },
  });
  return { day, batches, allocations };
}

export async function writeMaterialAllocation(
  tx: Prisma.TransactionClient,
  schoolId: string,
  date: Date,
  actorId: string,
  entries: import("./material-allocation").MaterialEntry[],
  allocations: { id: string; dailyMealPortionId: string; status: string }[],
) {
  const demandIds = [...new Set(entries.map((entry) => entry.demandId))];
  await tx.mealAllocationBatch.deleteMany({
    where: {
      mealAllocationId: {
        in: allocations
          .filter((row) => row.status === "ALLOCATED")
          .map((row) => row.id),
      },
      MealAllocation: {
        status: "ALLOCATED",
        DailyMealPortion: { mealDate: date, Class: { schoolId } },
      },
    },
  });
  for (const demandId of demandIds) {
    const existing = allocations.find(
      (row) => row.dailyMealPortionId === demandId,
    );
    if (existing && existing.status !== "ALLOCATED")
      throw new Error("Locked allocation");
    const allocation =
      existing ??
      (await tx.mealAllocation.create({
        data: {
          DailyMealPortion: {
            connect: { id: demandId, mealDate: date, Class: { schoolId } },
          },
          createdByUser: { connect: { id: actorId } },
        },
        select: { id: true },
      }));
    for (const entry of entries.filter(
      (entry) => entry.demandId === demandId,
    )) {
      await tx.mealAllocationBatch.create({
        data: {
          mealAllocationId: allocation.id,
          cookingBatchId: entry.batchId,
          dishId: entry.dishId,
          allocatedPortions: entry.allocatedPortions,
          allocationVersion: 2,
          theoreticalPortions: entry.theoreticalPortions,
          materials: {
            create: entry.materials.map((material) => ({
              ingredientLotId: material.ingredientLotId,
              ingredientId: material.ingredientId,
              quantity: material.quantity,
              quantityPerPortion: material.quantityPerPortion,
              unit: material.unit,
            })),
          },
        },
      });
    }
  }
}
