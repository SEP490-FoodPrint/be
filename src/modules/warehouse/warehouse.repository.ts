import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import { classScopeForMenuDay } from "../menu/menu.repository";

export const warehouseLotSelect = {
  id: true,
  deliveryItemId: true,
  sourceFacilityId: true,
  lotCode: true,
  manufactureDate: true,
  expiryDate: true,
  receivedQuantity: true,
  availableQuantity: true,
  unit: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  DeliveryItem: {
    select: {
      id: true,
      ingredientId: true,
      ingredientEntryId: true,
      actualQuantity: true,
      unit: true,
      Delivery: {
        select: {
          id: true,
          deliveryNo: true,
          schoolId: true,
          creationMode: true,
          status: true,
          expectedArrivalAt: true,
          arrivedAt: true,
          receivedAt: true,
        },
      },
      Ingredient: {
        select: {
          id: true,
          name: true,
          defaultUnit: true,
          description: true,
          ingredientCategory: {
            select: {
              id: true,
              categoryName: true,
            },
          },
          Supplier: {
            select: {
              id: true,
              name: true,
              phone: true,
            },
          },
        },
      },
      IngredientEntry: {
        select: {
          id: true,
          handlingType: true,
          storageRequirements: true,
          shelfLifeDays: true,
        },
      },
      SupplyRequestItem: {
        select: {
          id: true,
          ingredientEntryId: true,
          requestedQuantity: true,
          unit: true,
          IngredientEntry: {
            select: {
              id: true,
              handlingType: true,
              storageRequirements: true,
              shelfLifeDays: true,
              Ingredient: {
                select: {
                  id: true,
                  name: true,
                  defaultUnit: true,
                  description: true,
                  ingredientCategory: {
                    select: {
                      id: true,
                      categoryName: true,
                    },
                  },
                  Supplier: {
                    select: {
                      id: true,
                      name: true,
                      phone: true,
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
  SourceFacility: {
    select: {
      id: true,
      name: true,
      facilityCode: true,
    },
  },
} as const satisfies Prisma.IngredientLotSelect;

export type WarehouseListRow = Prisma.IngredientLotGetPayload<{
  select: typeof warehouseLotSelect;
}>;
export type WarehouseListArguments = Pick<
  Prisma.IngredientLotFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof warehouseLotSelect;
};
export type WarehouseListReader = (
  args: WarehouseListArguments,
) => Promise<WarehouseListRow[]>;

export const readWarehouseLotsFromDatabase: WarehouseListReader = async (
  args,
) => {
  const prisma = await getPrisma();
  return prisma.ingredientLot.findMany(args);
};

/**
 * Dữ liệu tính cảnh báo đồ lưu kho của một trường từ ngày `from`: thực đơn đã duyệt (món, định mức,
 * gia vị chung, nhóm suất), số suất các lớp, phần đã phân bổ cho mẻ nấu / gia vị, lô trong kho và
 * yêu cầu nhập đồ lưu kho đang chờ giao.
 */
export async function readStockAlertSource(schoolId: string, from: Date) {
  const prisma = await getPrisma();
  const entries = await prisma.ingredientEntry.findMany({
    where: { schoolId, status: "ACTIVE" },
    select: {
      id: true,
      ingredientId: true,
      handlingType: true,
      Ingredient: { select: { name: true, defaultUnit: true } },
    },
  });
  const menuDays = await prisma.menuDay.findMany({
    where: {
      menuDate: { gte: from },
      approvalStatus: "APPROVED",
      WeeklyMenu: { schoolId },
    },
    select: { id: true, menuDate: true },
  });
  const menuDayIds = menuDays.map((day) => day.id);
  const [dishLines, seasonings, groups, batchLots, seasoningLots] =
    await Promise.all([
      prisma.menuDayDishIngredient.findMany({
        where: { menuDayId: { in: menuDayIds } },
        select: {
          menuDayId: true,
          dishId: true,
          mealType: true,
          ingredientId: true,
          quantityPerPortion: true,
          unit: true,
        },
      }),
      prisma.menuMealSeasoning.findMany({
        where: { menuDayId: { in: menuDayIds } },
        select: {
          menuDayId: true,
          mealType: true,
          quantityPerPortion: true,
          unit: true,
          ingredientEntry: { select: { ingredientId: true } },
        },
      }),
      prisma.menuMealPortionGroup.findMany({
        where: { menuDayId: { in: menuDayIds } },
        select: {
          id: true,
          menuDayId: true,
          mealType: true,
          isDefault: true,
          dishes: { select: { dishId: true } },
        },
      }),
      prisma.cookingBatchLot.findMany({
        where: { CookingBatch: { menuDayId: { in: menuDayIds } } },
        select: {
          quantityUsed: true,
          unit: true,
          CookingBatch: { select: { menuDayId: true, mealType: true } },
          IngredientLot: {
            select: { DeliveryItem: { select: { ingredientId: true } } },
          },
        },
      }),
      prisma.menuMealSeasoningLot.findMany({
        where: { menuDayId: { in: menuDayIds } },
        select: {
          menuDayId: true,
          mealType: true,
          quantityUsed: true,
          unit: true,
          ingredientLot: {
            select: { DeliveryItem: { select: { ingredientId: true } } },
          },
        },
      }),
    ]);
  const classes = await Promise.all(
    menuDays.map(async (day) => ({
      menuDayId: day.id,
      rows: await prisma.class.findMany({
        where: {
          ...classScopeForMenuDay(schoolId, day.id),
          status: "ACTIVE",
        },
        select: {
          registeredMealPortions: true,
          dailyMealPortions: {
            where: { mealDate: day.menuDate, status: "FINALIZED" },
            select: {
              mealType: true,
              totalPortions: true,
              portionGroups: {
                select: { portionGroupId: true, portionCount: true },
              },
            },
          },
        },
      }),
    })),
  );
  const lots = await prisma.ingredientLot.findMany({
    where: {
      status: "AVAILABLE",
      availableQuantity: { gt: 0 },
      DeliveryItem: { Delivery: { status: "RECEIVED", schoolId } },
    },
    select: {
      id: true,
      unit: true,
      availableQuantity: true,
      expiryDate: true,
      DeliveryItem: { select: { ingredientId: true } },
    },
  });
  // Phần đang giữ trên lô (mẻ chưa nấu xong, gia vị chung chưa dùng): chưa trừ vào tồn kho
  const lotIds = lots.map((lot) => lot.id);
  const reservations = [
    ...(await prisma.cookingBatchLot.findMany({
      where: {
        ingredientLotId: { in: lotIds },
        CookingBatch: { status: { in: ["UNCONFIRMED", "CONFIRMED"] } },
      },
      select: { ingredientLotId: true, quantityUsed: true, unit: true },
    })),
    ...(await prisma.menuMealSeasoningLot.findMany({
      where: { ingredientLotId: { in: lotIds }, usedAt: null },
      select: { ingredientLotId: true, quantityUsed: true, unit: true },
    })),
  ];
  const pendingItems = await prisma.supplyRequestItem.findMany({
    where: {
      SupplyRequest: {
        schoolId,
        orderType: "DRY_STOCK",
        status: { in: ["SENT", "ACCEPTED", "IN_PROGRESS"] },
      },
    },
    select: {
      requestedQuantity: true,
      unit: true,
      IngredientEntry: { select: { ingredientId: true } },
      SupplyRequest: { select: { requestedDeliveryDate: true } },
      deliveryItems: {
        where: { Delivery: { status: "RECEIVED" } },
        select: { actualQuantity: true, unit: true },
      },
    },
  });
  return {
    entries,
    menuDays,
    dishLines,
    seasonings,
    groups,
    classes,
    batchLots,
    seasoningLots,
    lots,
    reservations,
    pendingItems,
  };
}
export type StockAlertSourceRows = Awaited<
  ReturnType<typeof readStockAlertSource>
>;
