import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  supplyOrderService,
  type SupplyOrderService,
} from "./supply-order.service";
import { validateSupplyOrderListQuery } from "./supply-order.validation";

export function createSupplyOrderController(
  service: SupplyOrderService = supplyOrderService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateSupplyOrderListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(res, result, "Lấy danh sách yêu cầu cung ứng thành công");
    }),
  };
}
