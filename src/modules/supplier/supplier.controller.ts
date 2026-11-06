import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { supplierService, type SupplierService } from "./supplier.service";
import {
  validateSupplierListQuery,
  validateSupplierSummaryQuery,
  validateSupplierDetailParams,
} from "./supplier.validation";

export function createSupplierController(
  service: SupplierService = supplierService,
) {
  return {
    getSummary: asyncHandler(async (req, res) => {
      const q = validateSupplierSummaryQuery(req.query);
      sendSuccess(res, await service.getSummary(q, requirePrincipal(req)));
    }),
    getById: asyncHandler(async (req, res) => {
      validateSupplierSummaryQuery(req.query);
      const q = validateSupplierDetailParams(req.params);
      sendSuccess(res, await service.getById(q, requirePrincipal(req)));
    }),
    getAll: asyncHandler(async (req, res) => {
      const query = validateSupplierListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(res, result, "Lấy danh sách nhà cung cấp thành công");
    }),
  };
}
