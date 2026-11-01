import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  foodAnalysisService,
  type FoodAnalysisService,
} from "./food-analysis.service";
import { validateFoodAnalysisListQuery } from "./food-analysis.validation";

export function createFoodAnalysisController(
  service: FoodAnalysisService = foodAnalysisService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateFoodAnalysisListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(res, result, "Lấy danh sách kết quả kiểm nghiệm thành công");
    }),
  };
}
