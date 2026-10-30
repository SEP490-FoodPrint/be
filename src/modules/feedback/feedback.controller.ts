import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { feedbackService, type FeedbackService } from "./feedback.service";
import { validateFeedbackListQuery } from "./feedback.validation";

export function createFeedbackController(
  service: FeedbackService = feedbackService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateFeedbackListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(res, result, "Lấy danh sách phản ánh bữa ăn thành công");
    }),
  };
}
