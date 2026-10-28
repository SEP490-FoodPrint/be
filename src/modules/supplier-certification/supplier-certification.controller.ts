import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  supplierCertificationService,
  type SupplierCertificationService,
} from "./supplier-certification.service";
import { validateSupplierCertificationListQuery } from "./supplier-certification.validation";

export function createSupplierCertificationController(
  service: SupplierCertificationService = supplierCertificationService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateSupplierCertificationListQuery(req.query);
      const result = await service.getAll(query);
      sendSuccess(
        res,
        result,
        "Lấy danh sách chứng nhận nhà cung cấp thành công",
      );
    }),
  };
}
