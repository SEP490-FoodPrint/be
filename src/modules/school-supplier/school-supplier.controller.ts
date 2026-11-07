import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  schoolSupplierService,
  type SchoolSupplierService,
} from "./school-supplier.service";
import {
  validateSchoolSupplierListQuery,
  validateSchoolSupplierSchoolParams,
} from "./school-supplier.validation";

export function createSchoolSupplierController(
  service: SchoolSupplierService = schoolSupplierService,
) {
  return {
    getBySchool: asyncHandler(async (req, res) => {
      const params = validateSchoolSupplierSchoolParams(req.params);
      const query = validateSchoolSupplierListQuery(req.query);
      sendSuccess(
        res,
        await service.getBySchool({ params, query }, requirePrincipal(req)),
      );
    }),
    getAll: asyncHandler(async (req, res) => {
      const query = validateSchoolSupplierListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(
        res,
        result,
        "Lấy danh sách liên kết trường và nhà cung cấp thành công",
      );
    }),
  };
}
