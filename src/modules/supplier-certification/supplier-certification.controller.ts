import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  supplierCertificationService,
  type SupplierCertificationService,
} from "./supplier-certification.service";
import {
  validateSupplierCertificationListQuery,
  validateSupplierCertificationParams,
  validateCertificationDocumentParams,
  validateCertificationEmptyQuery,
} from "./supplier-certification.validation";

export function createSupplierCertificationController(
  service: SupplierCertificationService = supplierCertificationService,
) {
  return {
    getBySupplier: asyncHandler(async (req, res) => {
      const params = validateSupplierCertificationParams(req.params);
      const query = validateSupplierCertificationListQuery(req.query);
      sendSuccess(
        res,
        await service.getBySupplier(params, query, requirePrincipal(req)),
      );
    }),
    document: asyncHandler(async (req, res) => {
      const params = validateCertificationDocumentParams(req.params);
      validateCertificationEmptyQuery(req.query);
      const result = await service.document(params, requirePrincipal(req));
      res.setHeader("Cache-Control", "no-store");
      sendSuccess(res, result);
    }),
    getAll: asyncHandler(async (req, res) => {
      const query = validateSupplierCertificationListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(
        res,
        result,
        "Lấy danh sách chứng nhận nhà cung cấp thành công",
      );
    }),
  };
}
