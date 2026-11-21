import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { authorityService, type AuthorityService } from "./authority.service";
import {
  validateAssignAuthorityLocationBody,
  validateAuthorityListQuery,
  validateAuthorityParams,
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
