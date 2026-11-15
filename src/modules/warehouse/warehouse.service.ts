import type { AuthPrincipal } from "../../types/auth";
import { listScopes } from "../../utils/resource-access";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";
import {
  readWarehouseLotsFromDatabase,
  warehouseLotSelect,
  type WarehouseListReader,
} from "./warehouse.repository";

export function createWarehouseService(
  read: WarehouseListReader = readWarehouseLotsFromDatabase,
) {
  return {
    getAll(query: ListQuery, principal: AuthPrincipal) {
      const where = listScopes["warehouse"](principal);
      return readListPage(
        () =>
          read({
            ...listWindow(query),
            where,
            select: warehouseLotSelect,
            orderBy: [{ createdAt: "desc" }],
          }),
        query,
      );
    },
  };
}

export const warehouseService = createWarehouseService();
export type WarehouseService = ReturnType<typeof createWarehouseService>;
