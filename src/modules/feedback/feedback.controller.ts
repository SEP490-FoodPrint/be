import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { feedbackService, type FeedbackService } from "./feedback.service";
import {
  validateComplaintId,
  validateCreateComplaint,
  validateFeedbackListQuery,
  validateRespondComplaint,
} from "./feedback.validation";

export function createFeedbackController(
  service: FeedbackService = feedbackService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.getAll(
          validateFeedbackListQuery(req.query),
          requirePrincipal(req),
        ),
        "Lấy danh sách khiếu nại thành công",
      );
    }),
    getOne: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.getOne(
          validateComplaintId(req.params.id),
          requirePrincipal(req),
        ),
        "Lấy chi tiết khiếu nại thành công",
      );
    }),
    create: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.create(
          validateCreateComplaint(req.body),
          requirePrincipal(req),
        ),
        "Gửi khiếu nại thành công",
        201,
      );
    }),
    respond: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.respond(
          validateComplaintId(req.params.id),
          validateRespondComplaint(req.body),
          requirePrincipal(req),
        ),
        "Cập nhật xử lý khiếu nại thành công",
      );
    }),
  };
}
