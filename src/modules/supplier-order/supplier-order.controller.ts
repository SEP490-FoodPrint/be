import { asyncHandler } from "../../utils/async-handler";
import { requirePrincipal } from "../../utils/authorization";
import { sendSuccess } from "../../utils/response";
import {
  supplierOrderService,
  type SupplierOrderService,
} from "./supplier-order.service";
import {
  validateCreateSupplierOrderBody,
  validateSupplierOrderDetailParams,
  validateSupplierOrderEmptyQuery,
  validateSupplierOrderIdempotencyKey,
  validateSupplierOrderLabelsQuery,
  validateSupplierOrderListQuery,
  validateSupplierOrderOptionsQuery,
} from "./supplier-order.validation";

export function createSupplierOrderController(
  service: SupplierOrderService = supplierOrderService,
) {
  return {
    create: asyncHandler(async (req, res) => {
      const idempotencyKey = validateSupplierOrderIdempotencyKey(
        req.headers["idempotency-key"],
      );
      validateSupplierOrderEmptyQuery(req.query);
      const body = validateCreateSupplierOrderBody(req.body);
      const { created, ...detail } = await service.create(
        { idempotencyKey, body },
        requirePrincipal(req),
      );
      sendSuccess(
        res,
        detail,
        created
          ? "Tạo đơn giao hàng thành công"
          : "Đơn giao hàng đã được tạo trước đó",
        created ? 201 : 200,
      );
    }),

    listSchoolOptions: asyncHandler(async (req, res) => {
      const query = validateSupplierOrderOptionsQuery(req.query);
      const result = await service.listSchoolOptions(
        query,
        requirePrincipal(req),
      );
      sendSuccess(res, result, "Lấy danh sách trường đủ điều kiện thành công");
    }),

    listIngredientOptions: asyncHandler(async (req, res) => {
      const query = validateSupplierOrderOptionsQuery(req.query);
      const result = await service.listIngredientOptions(
        query,
        requirePrincipal(req),
      );
      sendSuccess(res, result, "Lấy danh sách nguyên liệu hợp lệ thành công");
    }),

    listSourceFacilityOptions: asyncHandler(async (req, res) => {
      const query = validateSupplierOrderOptionsQuery(req.query);
      const result = await service.listSourceFacilityOptions(
        query,
        requirePrincipal(req),
      );
      sendSuccess(
        res,
        result,
        "Lấy danh sách cơ sở cung cấp hợp lệ thành công",
      );
    }),

    listLabels: asyncHandler(async (req, res) => {
      const params = validateSupplierOrderDetailParams(req.params);
      const query = validateSupplierOrderLabelsQuery(req.query);
      const result = await service.listLabels(
        params,
        query,
        requirePrincipal(req),
      );
      sendSuccess(res, result, "Lấy nhãn QR giao hàng thành công");
    }),

    list: asyncHandler(async (req, res) => {
      const query = validateSupplierOrderListQuery(req.query);
      const result = await service.list(query, requirePrincipal(req));
      sendSuccess(res, result, "Lấy danh sách đơn giao hàng thành công");
    }),

    detail: asyncHandler(async (req, res) => {
      const params = validateSupplierOrderDetailParams(req.params);
      validateSupplierOrderEmptyQuery(req.query);
      const result = await service.detail(params, requirePrincipal(req));
      sendSuccess(res, result, "Lấy chi tiết đơn giao hàng thành công");
    }),
  };
}
