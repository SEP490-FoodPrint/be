import { sendError } from "../../utils/response.js"
import SupplierIngredientService from "./supplier-ingredient.service.js"

export const checkExists = async (req, res, next) => {
  try {
    const id = req.params.id
    if (!id) return sendError(res, "ID không hợp lệ", 400)

    const record = await SupplierIngredientService.getById(id)
    if (!record) {
      return sendError(res, "Nguyên liệu NCC không tồn tại", 404)
    }

    req.record = record
    next()
  } catch (error) {
    next(error)
  }
}
