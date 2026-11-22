import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  supplyOrderService,
  type SupplyOrderService,
} from "./supply-order.service";
import {
  validateSupplyOrderListQuery,
  validateSupplyOrderDetailParams,
  validateSupplyOrderDetailQuery,
  validateSupplyOrderAcceptParams,
  validateSupplyOrderAcceptBody,
  validateSupplyOrderAcceptQuery,
  validateFreshDemandQuery,
} from "./supply-order.validation";
import { getFreshDemand } from "./fresh-demand.service";

export function createSupplyOrderController(
  service: SupplyOrderService = supplyOrderService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateSupplyOrderListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(res, result, "Lấy danh sách yêu cầu cung ứng thành công");
    }),
    getDetail: asyncHandler(async (req, res) => {
      const params = validateSupplyOrderDetailParams(req.params);
      validateSupplyOrderDetailQuery(req.query);
      const result = await service.getDetail(params, requirePrincipal(req));
      sendSuccess(res, result, "Lấy chi tiết yêu cầu cung ứng thành công");
    }),
    freshDemand: asyncHandler(async (req, res) => {
      const query = validateFreshDemandQuery(req.query);
      const result = await getFreshDemand(requirePrincipal(req), query);
      sendSuccess(
        res,
        result,
        "Tính nhu cầu nguyên liệu tươi theo khối thành công",
      );
    }),
    accept: asyncHandler(async (req, res) => {
      const params = validateSupplyOrderAcceptParams(req.params);
      validateSupplyOrderAcceptQuery(req.query);
      validateSupplyOrderAcceptBody(req.body);
      sendSuccess(res, await service.accept(params, requirePrincipal(req)));
    }),
  };
}
