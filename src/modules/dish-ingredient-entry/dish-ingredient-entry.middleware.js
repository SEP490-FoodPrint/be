import { sendError } from "../../utils/response.js"
import DishIngredientEntryService from "./dish-ingredient-entry.service.js"

export const checkExists = async (req, res, next) => {
  try {
    const pkValues = { dish_id: req.params.dish_id || req.query.dish_id, ingredient_entry_id: req.params.ingredient_entry_id || req.query.ingredient_entry_id }
    for (const [k, v] of Object.entries(pkValues)) {
      if (!v) {
        return sendError(res, `Thiếu khóa nhận diện '${k}'`, 400)
      }
    }

    const record = await DishIngredientEntryService.getById(pkValues)
    if (!record) {
      return sendError(res, "Bản ghi không tồn tại trong hệ thống", 404)
    }

    req.record = record
    next()
  } catch (error) {
    next(error)
  }
}
