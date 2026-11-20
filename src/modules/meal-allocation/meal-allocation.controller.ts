import { serializeAllocationPortions } from "./meal-allocation.service";
import {
  materialAllocationService,
  type MaterialAllocationService,
} from "./material-allocation.service";
import { validateMaterialApply } from "./meal-allocation.validation";
import { asyncHandler } from "../../utils/async-handler";
import { requirePrincipal } from "../../utils/authorization";
import { sendSuccess } from "../../utils/response";
import type { MealAllocationService } from "./meal-allocation.service";
import {
  validateAllocationApply,
  validateAllocationQuery,
  validateConfirmDistribution,
} from "./meal-allocation.validation";

export function createMealAllocationController(
  service: MealAllocationService,
  materials: MaterialAllocationService = materialAllocationService,
) {
  return {
    getToday: asyncHandler(async (req, res) => {
      const query = validateAllocationQuery(req.query);
      sendSuccess(
        res,
        serializeAllocationPortions(
          await materials.getToday(requirePrincipal(req), query, service),
        ),
      );
    }),
    apply: asyncHandler(async (req, res) => {
      if (req.body && typeof req.body === "object" && "planId" in req.body) {
        const input = validateMaterialApply(req.body);
        sendSuccess(
          res,
          await materials.apply(input, requirePrincipal(req)),
          "Đã áp dụng phân bổ suất ăn",
        );
        return;
      }
      const input = validateAllocationApply(req.body);
      sendSuccess(
        res,
        serializeAllocationPortions(
          await service.apply(input, requirePrincipal(req)),
        ),
        "Đã áp dụng phân bổ suất ăn",
      );
    }),
    confirmDistribution: asyncHandler(async (req, res) => {
      const input = validateConfirmDistribution(req.body);
      sendSuccess(
        res,
        serializeAllocationPortions(
          await service.confirmDistribution(input, requirePrincipal(req)),
        ),
        "Đã xác nhận giao suất ăn trong ngày",
      );
    }),
  };
}
