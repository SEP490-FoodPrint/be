import { sendError } from "../../utils/response.js"

export const validateCreate = (req, res, next) => {
  const errors = []
  const requiredFields = ["batch_code","menu_day_id","dish_id","meal_type","cooking_mode_applied","created_by_user_id","AND","AND","AND","AND","AND","AND"]

  for (const field of requiredFields) {
    if (req.body[field] === undefined || req.body[field] === null || req.body[field] === "") {
      errors.push(`Trường '${field}' là bắt buộc`)
    }
  }

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
