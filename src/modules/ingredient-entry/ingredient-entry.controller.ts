import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  ingredientEntryService,
  type IngredientEntryService,
} from "./ingredient-entry.service";
import {
  validateIngredientEntryListQuery,
  validateIngredientWasteRateBody,
  validateIngredientWasteRateParams,
} from "./ingredient-entry.validation";

export function createIngredientEntryController(
  service: IngredientEntryService = ingredientEntryService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateIngredientEntryListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(
        res,
        result,
        "Lấy danh sách nguyên liệu tại trường thành công",
      );
    }),
    listWasteRates: asyncHandler(async (req, res) => {
      const result = await service.listWasteRates(requirePrincipal(req));
      sendSuccess(res, result, "Lấy tỷ lệ hao hụt nguyên liệu thành công");
    }),
    updateWasteRate: asyncHandler(async (req, res) => {
      const params = validateIngredientWasteRateParams(req.params);
      const input = validateIngredientWasteRateBody(req.body);
      const result = await service.updateWasteRate(
        params,
        input,
        requirePrincipal(req),
      );
      sendSuccess(res, result, "Cập nhật tỷ lệ hao hụt thành công");
    }),
  };
}
