import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { warehouseService, type WarehouseService } from "./warehouse.service";
import { validateWarehouseListQuery } from "./warehouse.validation";

export function createWarehouseController(
  service: WarehouseService = warehouseService,
) {
  return {
    stockAlerts: asyncHandler(async (req, res) => {
      sendSuccess(res, await service.stockAlerts(requirePrincipal(req)));
    }),
    getAll: asyncHandler(async (req, res) => {
      const query = validateWarehouseListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(res, result, "Lấy danh sách lô nguyên liệu thành công");
    }),
  };
}
