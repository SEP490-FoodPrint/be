import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { supplierService, type SupplierService } from "./supplier.service";
import { validateSupplierListQuery } from "./supplier.validation";

export function createSupplierController(
  service: SupplierService = supplierService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateSupplierListQuery(req.query);
      const result = await service.getAll(query);
      sendSuccess(res, result, "Lấy danh sách nhà cung cấp thành công");
    }),
  };
}
