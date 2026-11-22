import { serializeAllocationPortions } from "./meal-allocation.service";
import {
  materialAllocationService,
  type MaterialAllocationService,
} from "./material-allocation.service";
import { validateAllocationDraft } from "./meal-allocation.validation";
import { HttpError } from "../../utils/http-error";
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
    saveDraft: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await materials.writeDraft(
          validateAllocationDraft(req.body),
          requirePrincipal(req),
          false,
        ),
      );
    }),
    retryDraft: asyncHandler(async (req, res) => {
      const { mealType } = validateAllocationQuery(req.body);
      if (!mealType) throw new HttpError(400, "Cần chọn bữa ăn");
      sendSuccess(res, await materials.retry(mealType, requirePrincipal(req)));
    }),
    suggestDraft: asyncHandler(async (req, res) => {
      const { mealType } = validateAllocationQuery(req.body);
      if (!mealType) throw new HttpError(400, "Cần chọn bữa ăn");
      sendSuccess(
        res,
        await materials.suggest({ mealType }, requirePrincipal(req)),
        "Đã đề xuất phân bổ bằng GLPK",
      );
    }),
    apply: asyncHandler(async (req, res) => {
      if (
        req.body &&
        typeof req.body === "object" &&
        !("batches" in req.body)
      ) {
        sendSuccess(
          res,
          await materials.writeDraft(
            validateAllocationDraft(req.body),
            requirePrincipal(req),
            true,
          ),
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
