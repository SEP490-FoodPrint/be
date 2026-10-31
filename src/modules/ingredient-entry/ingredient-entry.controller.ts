import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  ingredientEntryService,
  type IngredientEntryService,
} from "./ingredient-entry.service";
import { validateIngredientEntryListQuery } from "./ingredient-entry.validation";

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
  };
}
