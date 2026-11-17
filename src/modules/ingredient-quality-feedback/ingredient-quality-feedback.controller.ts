import { asyncHandler } from "../../utils/async-handler";
import { requirePrincipal } from "../../utils/authorization";
import { sendSuccess } from "../../utils/response";
import {
  ingredientQualityFeedbackService,
  type IngredientQualityFeedbackService,
} from "./ingredient-quality-feedback.service";
import {
  validateIngredientQualityFeedbackEmptyQuery,
  validateIngredientQualityFeedbackListQuery,
  validateIngredientQualityFeedbackParams,
  validateIngredientQualityFeedbackResponseBody,
} from "./ingredient-quality-feedback.validation";

export function createIngredientQualityFeedbackController(
  service: IngredientQualityFeedbackService = ingredientQualityFeedbackService,
) {
  return {
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
      const principal = requirePrincipal(req);
      const params = validateIngredientQualityFeedbackParams(req.params);
      validateIngredientQualityFeedbackEmptyQuery(req.query);
      const result = await service.getDetail(params, principal);
      res.setHeader("Cache-Control", "private, no-store");
      sendSuccess(
        res,
        result,
        "Lấy chi tiết phản hồi chất lượng nguyên liệu thành công",
      );
    }),
    respond: asyncHandler(async (req, res) => {
      const principal = requirePrincipal(req);
      const params = validateIngredientQualityFeedbackParams(req.params);
      validateIngredientQualityFeedbackEmptyQuery(req.query);
      const body = validateIngredientQualityFeedbackResponseBody(req.body);
      const result = await service.respond(params, body, principal);
      res.setHeader("Cache-Control", "private, no-store");
      sendSuccess(
        res,
        result,
        "Phản hồi khiếu nại chất lượng nguyên liệu thành công",
      );
    }),
  };
}
