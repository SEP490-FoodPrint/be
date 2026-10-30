import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendError, sendSuccess } from "../../utils/response";
import { menuService, type MenuService } from "./menu.service";
import {
  validateApprovalPayload,
  validateMenuId,
  validateMenuListQuery,
  validateRevisionPayload,
} from "./menu.validation";

function reviewerIdFromRequest(subject: unknown): string | undefined {
  return typeof subject === "string" ? subject : undefined;
}

export function createMenuController(service: MenuService = menuService) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateMenuListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(res, result, "Lấy danh sách thực đơn tuần thành công");
    }),
    getApprovalDetail: asyncHandler(async (req, res) => {
      const result = await service.getApprovalDetail(
        validateMenuId(req.params.menuId),
        requirePrincipal(req),
      );
      if (!result) {
        sendError(res, "Không tìm thấy thực đơn", 404);
        return;
      }
      sendSuccess(res, result, "Lấy hồ sơ phê duyệt thực đơn thành công");
    }),
    approve: asyncHandler(async (req, res) => {
      const { notes, menuDayId } = validateApprovalPayload(req.body);
      const result = await service.approveMenu(
        validateMenuId(req.params.menuId),
        reviewerIdFromRequest(req.user?.sub),
        notes,
        menuDayId,
      );
      if (!result) {
        sendError(res, "Không tìm thấy thực đơn", 404);
        return;
      }
      sendSuccess(res, result, "Phê duyệt thực đơn thành công");
    }),
    requestRevision: asyncHandler(async (req, res) => {
      const { reason, menuDayId } = validateRevisionPayload(req.body);
      const result = await service.requestRevision(
        validateMenuId(req.params.menuId),
        reviewerIdFromRequest(req.user?.sub),
        reason,
        menuDayId,
      );
      if (!result) {
        sendError(res, "Không tìm thấy thực đơn", 404);
        return;
      }
      sendSuccess(res, result, "Gửi yêu cầu chỉnh sửa thực đơn thành công");
    }),
  };
}
