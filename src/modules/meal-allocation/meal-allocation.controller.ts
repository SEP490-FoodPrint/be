import { asyncHandler } from "../../utils/async-handler";
import { requirePrincipal } from "../../utils/authorization";
import { sendSuccess } from "../../utils/response";
import type { MealAllocationService } from "./meal-allocation.service";
import {
  validateAllocationApply,
  validateAllocationQuery,
} from "./meal-allocation.validation";

export function createMealAllocationController(service: MealAllocationService) {
  return {
    getToday: asyncHandler(async (req, res) => {
      validateAllocationQuery(req.query);
      sendSuccess(res, await service.getToday(requirePrincipal(req)));
    }),
    apply: asyncHandler(async (req, res) => {
      const input = validateAllocationApply(req.body);
      sendSuccess(
        res,
        await service.apply(input, requirePrincipal(req)),
        "Đã áp dụng phân bổ suất ăn",
      );
    }),
  };
}
