import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { inventoryService, type InventoryService } from "./inventory.service";
import { validateInventoryListQuery } from "./inventory.validation";

export function createInventoryController(
  service: InventoryService = inventoryService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateInventoryListQuery(req.query);
      const result = await service.getAll(query);
      sendSuccess(res, result, "Lấy danh sách biến động tồn kho thành công");
    }),
  };
}
