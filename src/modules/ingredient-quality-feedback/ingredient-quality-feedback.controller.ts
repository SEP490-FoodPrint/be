import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { requirePrincipal } from "../../utils/authorization";
import { evidenceFilesOf } from "../../utils/evidence-files";
import { sendSuccess } from "../../utils/response";
import {
  ingredientQualityFeedbackService,
  type IngredientQualityFeedbackService,
} from "./ingredient-quality-feedback.service";
import {
  validateCreateIngredientQualityFeedbackBody,
  validateFeedbackCommentBody,
  validateFeedbackEmptyBody,
  validateFeedbackReopenBody,
  validateFeedbackResolveBody,
  validateIngredientQualityFeedbackEmptyQuery,
  validateIngredientQualityFeedbackListQuery,
  validateIngredientQualityFeedbackParams,
} from "./ingredient-quality-feedback.validation";

function privateResult(
  res: Response,
  result: unknown,
  message: string,
  status = 200,
) {
  res.setHeader("Cache-Control", "private, no-store");
  sendSuccess(res, result, message, status);
}

function ticketInput(req: Request) {
  const params = validateIngredientQualityFeedbackParams(req.params);
  validateIngredientQualityFeedbackEmptyQuery(req.query);
  return { params, principal: requirePrincipal(req) };
}

export function createIngredientQualityFeedbackController(
  service: IngredientQualityFeedbackService = ingredientQualityFeedbackService,
) {
  return {
    create: asyncHandler(async (req, res) => {
      validateIngredientQualityFeedbackEmptyQuery(req.query);
      const body = validateCreateIngredientQualityFeedbackBody({
        ...req.body,
        files: evidenceFilesOf(req.files),
      });
      privateResult(
        res,
        await service.create(body, requirePrincipal(req)),
        "Gửi phản ánh chất lượng nguyên liệu thành công",
        201,
      );
    }),
    getAll: asyncHandler(async (req, res) => {
      const principal = requirePrincipal(req);
      const query = validateIngredientQualityFeedbackListQuery(req.query);
      const result = await service.getAll(query, principal);
      if (principal.orgType === "SUPPLIER") {
        res.setHeader("Cache-Control", "private, no-store");
      }
      sendSuccess(
        res,
        result,
        "Lấy danh sách phản hồi chất lượng nguyên liệu thành công",
      );
    }),
    getDetail: asyncHandler(async (req, res) => {
      const { params, principal } = ticketInput(req);
      privateResult(
        res,
        await service.getDetail(params, principal),
        "Lấy chi tiết phản hồi chất lượng nguyên liệu thành công",
      );
    }),
    accept: asyncHandler(async (req, res) => {
      const { params, principal } = ticketInput(req);
      validateFeedbackEmptyBody(req.body);
      privateResult(
        res,
        await service.accept(params, principal),
        "Tiếp nhận khiếu nại chất lượng nguyên liệu thành công",
      );
    }),
    comment: asyncHandler(async (req, res) => {
      const { params, principal } = ticketInput(req);
      const body = validateFeedbackCommentBody({
        ...req.body,
        files: evidenceFilesOf(req.files),
      });
      privateResult(
        res,
        await service.comment(params, body, principal),
        "Gửi bình luận thành công",
        201,
      );
    }),
    resolve: asyncHandler(async (req, res) => {
      const { params, principal } = ticketInput(req);
      const body = validateFeedbackResolveBody({
        ...req.body,
        files: evidenceFilesOf(req.files),
      });
      privateResult(
        res,
        await service.resolve(params, body, principal),
        "Cập nhật đã xử lý khiếu nại chất lượng nguyên liệu thành công",
      );
    }),
    satisfy: asyncHandler(async (req, res) => {
      const { params, principal } = ticketInput(req);
      validateFeedbackEmptyBody(req.body);
      privateResult(
        res,
        await service.satisfy(params, principal),
        "Đã ghi nhận hài lòng, khiếu nại được đóng",
      );
    }),
    reopen: asyncHandler(async (req, res) => {
      const { params, principal } = ticketInput(req);
      const body = validateFeedbackReopenBody(req.body);
      privateResult(
        res,
        await service.reopen(params, body, principal),
        "Đã gửi yêu cầu xử lý lại",
      );
    }),
  };
}
