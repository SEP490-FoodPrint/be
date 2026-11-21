import type { AuthPrincipal } from "../../types/auth";
import { listScopes } from "../../utils/resource-access";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";
import { HttpError } from "../../utils/http-error";
import type { StockAlertsResponseDTO } from "./warehouse.response.dto";
import {
  buildStockAlertSource,
  computeStockAlerts,
} from "./warehouse.stock-alerts";
import {
  readStockAlertSource,
  readWarehouseLotsFromDatabase,
  warehouseLotSelect,
  type WarehouseListReader,
} from "./warehouse.repository";

/** Ngày hôm nay theo giờ Việt Nam (UTC+7), dạng YYYY-MM-DD. */
const vietnamToday = (now: Date) =>
  new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);

/**
 * Lô còn hàng nhưng đã quá hạn dùng được trả về với trạng thái EXPIRED để màn đồ lưu khong tính vào tồn
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
  readAlerts: typeof readStockAlertSource = readStockAlertSource,
) {
  return {
    /** Cảnh báo đồ lưu kho cần nhập thêm cho các thực đơn đã duyệt từ hôm nay. */
    async stockAlerts(
      principal: AuthPrincipal,
    ): Promise<StockAlertsResponseDTO> {
      listScopes["warehouse"](principal);
      if (principal.orgType !== "SCHOOL" || !principal.schoolId)
        throw new HttpError(403, "Cần phạm vi trường");
      const today = vietnamToday(clock());
      const rows = await readAlerts(
        principal.schoolId,
        new Date(today + "T00:00:00.000Z"),
      );
      return computeStockAlerts(buildStockAlertSource(rows, today), today);
    },
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
