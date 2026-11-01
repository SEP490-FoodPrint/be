import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { authorityService, type AuthorityService } from "./authority.service";
import { validateAuthorityListQuery } from "./authority.validation";

export function createAuthorityController(
  service: AuthorityService = authorityService,
) {
  return {
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
