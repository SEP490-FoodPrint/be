import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  menuReviewService,
  type MenuReviewService,
} from "./menu-review.service";
import { validateMenuReviewListQuery } from "./menu-review.validation";

export function createMenuReviewController(
  service: MenuReviewService = menuReviewService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateMenuReviewListQuery(req.query);
      const result = await service.getAll(query);
      sendSuccess(res, result, "Lấy danh sách lượt duyệt thực đơn thành công");
    }),
  };
}
