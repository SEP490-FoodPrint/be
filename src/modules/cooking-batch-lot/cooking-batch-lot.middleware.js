import { sendError } from "../../utils/response.js"
import CookingBatchLotService from "./cooking-batch-lot.service.js"

export const checkExists = async (req, res, next) => {
  try {
    const pkValues = { cooking_batch_id: req.params.cooking_batch_id || req.query.cooking_batch_id, ingredient_lot_id: req.params.ingredient_lot_id || req.query.ingredient_lot_id }
    for (const [k, v] of Object.entries(pkValues)) {
      if (!v) {
        return sendError(res, `Thiếu khóa nhận diện '${k}'`, 400)
      }
    }

    const record = await CookingBatchLotService.getById(pkValues)
    if (!record) {
      return sendError(res, "Bản ghi không tồn tại trong hệ thống", 404)
    }

    req.record = record
    next()
  } catch (error) {
    next(error)
  }
}
