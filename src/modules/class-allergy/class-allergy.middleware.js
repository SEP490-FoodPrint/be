import { sendError } from "../../utils/response.js"
import ClassAllergyService from "./class-allergy.service.js"

export const checkExists = async (req, res, next) => {
  try {
    const pkValues = { class_id: req.params.class_id || req.query.class_id, ingredient_entry_id: req.params.ingredient_entry_id || req.query.ingredient_entry_id }
    for (const [k, v] of Object.entries(pkValues)) {
      if (!v) {
        return sendError(res, `Thiếu khóa nhận diện '${k}'`, 400)
      }
    }

    const record = await ClassAllergyService.getById(pkValues)
    if (!record) {
      return sendError(res, "Bản ghi không tồn tại trong hệ thống", 404)
    }

    req.record = record
    next()
  } catch (error) {
    next(error)
  }
}
