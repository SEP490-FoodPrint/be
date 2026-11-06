import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  menuApprovalService,
  type MenuApprovalService,
} from "./menu-approval.service";
import {
  validateMenuApprovalDecision,
  validateMenuApprovalParams,
} from "./menu-approval.validation";

export function createMenuApprovalController(
  service: MenuApprovalService = menuApprovalService,
) {
  return {
    getDetail: asyncHandler(async (req, res) => {
      const { menuId } = validateMenuApprovalParams(req.params);
      sendSuccess(res, await service.getDetail(menuId, requirePrincipal(req)));
    }),

    decide: asyncHandler(async (req, res) => {
      const { menuId } = validateMenuApprovalParams(req.params);
      sendSuccess(
        res,
        await service.decide(
          menuId,
          validateMenuApprovalDecision(req.body),
          requirePrincipal(req),
        ),
        "Đã ghi nhận kết quả duyệt",
      );
    }),
  };
}
