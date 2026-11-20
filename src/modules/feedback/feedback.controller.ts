import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { feedbackService, type FeedbackService } from "./feedback.service";
import {
  validateComplaintComment,
  validateComplaintEmptyBody,
  validateComplaintId,
  validateComplaintReopen,
  validateComplaintResolve,
  validateMealOptionsQuery,
  validateCreateComplaint,
  validateFeedbackListQuery,
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
    mealOptions: asyncHandler(async (req, res) => {
      validateMealOptionsQuery(req.query);
      sendSuccess(res, await service.mealOptions(requirePrincipal(req)));
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
    accept: asyncHandler(async (req, res) => {
      const id = validateComplaintId(req.params.id);
      validateComplaintEmptyBody(req.body);
      sendSuccess(
        res,
        await service.accept(id, requirePrincipal(req)),
        "Tiếp nhận khiếu nại thành công",
      );
    }),
    comment: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.comment(
          validateComplaintId(req.params.id),
          validateComplaintComment(req.body),
          requirePrincipal(req),
        ),
        "Gửi bình luận thành công",
        201,
      );
    }),
    resolve: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.resolve(
          validateComplaintId(req.params.id),
          validateComplaintResolve(req.body),
          requirePrincipal(req),
        ),
        "Cập nhật đã xử lý khiếu nại thành công",
      );
    }),
    satisfy: asyncHandler(async (req, res) => {
      const id = validateComplaintId(req.params.id);
      validateComplaintEmptyBody(req.body);
      sendSuccess(
        res,
        await service.satisfy(id, requirePrincipal(req)),
        "Đã ghi nhận hài lòng, khiếu nại được đóng",
      );
    }),
    reopen: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.reopen(
          validateComplaintId(req.params.id),
          validateComplaintReopen(req.body),
          requirePrincipal(req),
        ),
        "Đã gửi yêu cầu xử lý lại",
      );
    }),
  };
}
