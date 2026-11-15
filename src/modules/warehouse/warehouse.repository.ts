import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";

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
