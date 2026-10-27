import { sendError } from "../../utils/response.js"
import FoodSafetyIncidentAllocationService from "./food-safety-incident-allocation.service.js"

export const checkExists = async (req, res, next) => {
  try {
    const pkValues = { incident_id: req.params.incident_id || req.query.incident_id, meal_allocation_id: req.params.meal_allocation_id || req.query.meal_allocation_id }
    for (const [k, v] of Object.entries(pkValues)) {
      if (!v) {
        return sendError(res, `Thiếu khóa nhận diện '${k}'`, 400)
      }
    }

    const record = await FoodSafetyIncidentAllocationService.getById(pkValues)
    if (!record) {
      return sendError(res, "Bản ghi không tồn tại trong hệ thống", 404)
    }

    req.record = record
    next()
  } catch (error) {
    next(error)
  }
}
