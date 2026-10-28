import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  ingredientService,
  type IngredientService,
} from "./ingredient.service";
import { validateIngredientListQuery } from "./ingredient.validation";

export function createIngredientController(
  service: IngredientService = ingredientService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateIngredientListQuery(req.query);
      const result = await service.getAll(query);
      sendSuccess(res, result, "Lấy danh sách nguyên liệu thành công");
    }),
  };
}
