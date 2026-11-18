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

/** Ngày hôm nay theo giờ Việt Nam (UTC+7), dạng YYYY-MM-DD. */
const vietnamToday = (now: Date) =>
  new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);

/**
 * Lô còn hàng nhưng đã quá hạn dùng được trả về với trạng thái EXPIRED để màn kho không tính vào tồn
 * khả dụng (bếp vốn đã không dùng lô quá hạn). Không ghi DB: trạng thái lưu trữ giữ nguyên.
 */
export function effectiveLotStatus<
  T extends { status: string; expiryDate: Date | null },
>(lot: T, today: string): T["status"] | "EXPIRED" {
  return lot.status === "AVAILABLE" &&
    lot.expiryDate !== null &&
    lot.expiryDate.toISOString().slice(0, 10) < today
    ? "EXPIRED"
    : lot.status;
}

export function createWarehouseService(
  read: WarehouseListReader = readWarehouseLotsFromDatabase,
  clock: () => Date = () => new Date(),
) {
  return {
    async getAll(query: ListQuery, principal: AuthPrincipal) {
      const where = listScopes["warehouse"](principal);
      const page = await readListPage(
        () =>
          read({
            ...listWindow(query),
            where,
            select: warehouseLotSelect,
            orderBy: [{ createdAt: "desc" }],
          }),
        query,
      );
      const today = vietnamToday(clock());
      return {
        ...page,
        items: page.items.map((lot) => ({
          ...lot,
          status: effectiveLotStatus(lot, today),
        })),
      };
    },
  };
}

export const warehouseService = createWarehouseService();
export type WarehouseService = ReturnType<typeof createWarehouseService>;
