import { sendError } from "../../utils/response.js"
import MealAllocationBatchService from "./meal-allocation-batch.service.js"

export const checkExists = async (req, res, next) => {
  try {
    const pkValues = { meal_allocation_id: req.params.meal_allocation_id || req.query.meal_allocation_id, cooking_batch_id: req.params.cooking_batch_id || req.query.cooking_batch_id }
    for (const [k, v] of Object.entries(pkValues)) {
      if (!v) {
        return sendError(res, `Thiếu khóa nhận diện '${k}'`, 400)
      }
    }

    const record = await MealAllocationBatchService.getById(pkValues)
    if (!record) {
      return sendError(res, "Bản ghi không tồn tại trong hệ thống", 404)
    }

    req.record = record
    next()
  } catch (error) {
    next(error)
  }
}
