import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  ingredientQualityFeedbackService,
  type IngredientQualityFeedbackService,
} from "./ingredient-quality-feedback.service";
import { validateIngredientQualityFeedbackListQuery } from "./ingredient-quality-feedback.validation";

export function createIngredientQualityFeedbackController(
  service: IngredientQualityFeedbackService = ingredientQualityFeedbackService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateIngredientQualityFeedbackListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(
        res,
        result,
        "Lấy danh sách phản hồi chất lượng nguyên liệu thành công",
      );
    }),
  };
}
