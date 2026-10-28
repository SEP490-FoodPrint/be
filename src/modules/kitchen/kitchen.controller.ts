import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { kitchenService, type KitchenService } from "./kitchen.service";
import { validateKitchenListQuery } from "./kitchen.validation";

export function createKitchenController(
  service: KitchenService = kitchenService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateKitchenListQuery(req.query);
      const result = await service.getAll(query);
      sendSuccess(res, result, "Lấy danh sách mẻ nấu thành công");
    }),
  };
}
