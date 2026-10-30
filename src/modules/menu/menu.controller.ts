import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { menuService, type MenuService } from "./menu.service";
import { validateMenuListQuery } from "./menu.validation";

export function createMenuController(service: MenuService = menuService) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateMenuListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(res, result, "Lấy danh sách thực đơn tuần thành công");
    }),
  };
}
