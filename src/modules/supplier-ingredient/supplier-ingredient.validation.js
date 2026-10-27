import { sendError } from "../../utils/response.js"

export const validateCreate = (req, res, next) => {
  const { supplier_id, ingredient_name, unit } = req.body
  const errors = []
  if (!supplier_id) errors.push("Trường 'supplier_id' là bắt buộc")
  if (!ingredient_name) errors.push("Trường 'ingredient_name' là bắt buộc")
  if (!unit) errors.push("Trường 'unit' là bắt buộc")

  if (errors.length > 0) {
    return sendError(res, "Dữ liệu không hợp lệ", 400, errors)
  }
  next()
}

export const validateUpdate = (req, res, next) => {
  if (!req.body || Object.keys(req.body).length === 0) {
    return sendError(res, "Payload cập nhật không được để trống", 400)
  }
  next()
}
