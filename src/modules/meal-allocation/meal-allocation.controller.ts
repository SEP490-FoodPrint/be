import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  mealAllocationService,
  type MealAllocationService,
} from "./meal-allocation.service";
import { validateMealAllocationListQuery } from "./meal-allocation.validation";

export function createMealAllocationController(
  service: MealAllocationService = mealAllocationService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateMealAllocationListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(res, result, "Lấy danh sách phân bổ suất ăn thành công");
    }),
  };
}
