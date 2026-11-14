import type { AuthPrincipal } from "../../types/auth";
import { listScopes } from "../../utils/resource-access";
import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";

const select = {
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
      actualQuantity: true,
      unit: true,
      Delivery: {
        select: {
          id: true,
          deliveryNo: true,
          status: true,
          expectedArrivalAt: true,
          arrivedAt: true,
          receivedAt: true,
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

type ListRow = Prisma.IngredientLotGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.IngredientLotFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.ingredientLot.findMany(args);
};

export function createWarehouseService(read: ListReader = readFromDatabase) {
  return {
    getAll(query: ListQuery, principal: AuthPrincipal) {
      const where = listScopes["warehouse"](principal);
      return readListPage(
        () =>
          read({
            ...listWindow(query),
            where,
            select,
            orderBy: [{ createdAt: "desc" }],
          }),
        query,
      );
    },
  };
}

export const warehouseService = createWarehouseService();
export type WarehouseService = ReturnType<typeof createWarehouseService>;
