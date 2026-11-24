import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { authorityService, type AuthorityService } from "./authority.service";
import {
  validateAssignAuthorityLocationBody,
  validateAssignOrganizationLocationBody,
  validateAuthorityListQuery,
  validateAuthorityParams,
  validateAuthoritySchoolListQuery,
  validateAuthoritySchoolParams,
  validateSchoolLocationParams,
  validateSupplierLocationParams,
} from "./authority.validation";

export function createAuthorityController(
  service: AuthorityService = authorityService,
) {
  return {
    assignLocation: asyncHandler(async (req, res) => {
      const params = validateAuthorityParams(req.params);
      const body = validateAssignAuthorityLocationBody(req.body);
      sendSuccess(
        res,
        await service.assignLocation(params, body, requirePrincipal(req)),
        "Gắn phường/xã cho đơn vị ATTP thành công",
      );
    }),
    assignSchoolLocation: asyncHandler(async (req, res) => {
      const params = validateSchoolLocationParams(req.params);
      const body = validateAssignOrganizationLocationBody(req.body);
      sendSuccess(
        res,
        await service.assignSchoolLocation(params, body, requirePrincipal(req)),
        "Gắn phường/xã cho trường thành công",
      );
    }),
    assignSupplierLocation: asyncHandler(async (req, res) => {
      const params = validateSupplierLocationParams(req.params);
      const body = validateAssignOrganizationLocationBody(req.body);
      sendSuccess(
        res,
        await service.assignSupplierLocation(
          params,
          body,
          requirePrincipal(req),
        ),
        "Gắn phường/xã cho nhà cung cấp thành công",
      );
    }),
    listSchools: asyncHandler(async (req, res) => {
      const query = validateAuthoritySchoolListQuery(req.query);
      sendSuccess(
        res,
        await service.listSchools(query, requirePrincipal(req)),
        "Lấy danh sách trường thuộc địa bàn thành công",
      );
    }),
    getSchool: asyncHandler(async (req, res) => {
      const params = validateAuthoritySchoolParams(req.params);
      sendSuccess(
        res,
        await service.getSchool(params, requirePrincipal(req)),
        "Lấy chi tiết trường thuộc địa bàn thành công",
      );
    }),
    getAll: asyncHandler(async (req, res) => {
      const query = validateAuthorityListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(
        res,
        result,
        "Lấy danh sách đơn vị an toàn thực phẩm cấp xã thành công",
      );
    }),
  };
}
