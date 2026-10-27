import { sendError } from "../../utils/response.js"
import MenuDayDishService from "./menu-day-dish.service.js"

export const checkExists = async (req, res, next) => {
  try {
    const pkValues = { menu_day_id: req.params.menu_day_id || req.query.menu_day_id, dish_id: req.params.dish_id || req.query.dish_id, meal_type: req.params.meal_type || req.query.meal_type }
    for (const [k, v] of Object.entries(pkValues)) {
      if (!v) {
        return sendError(res, `Thiếu khóa nhận diện '${k}'`, 400)
      }
    }

    const record = await MenuDayDishService.getById(pkValues)
    if (!record) {
      return sendError(res, "Bản ghi không tồn tại trong hệ thống", 404)
    }

    req.record = record
    next()
  } catch (error) {
    next(error)
  }
}
