import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { deliveryService, type DeliveryService } from "./delivery.service";
import { validateDeliveryListQuery } from "./delivery.validation";

export function createDeliveryController(
  service: DeliveryService = deliveryService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateDeliveryListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(res, result, "Lấy danh sách đợt giao hàng thành công");
    }),
  };
}
