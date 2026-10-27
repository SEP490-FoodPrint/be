import { sendError } from "../../utils/response.js"
import UserService from "./user.service.js"

export const checkExists = async (req, res, next) => {
  try {
    const id = req.params.id
    if (!id) {
      return sendError(res, "ID không hợp lệ", 400)
    }

    const record = await UserService.getById(id)
    if (!record) {
      return sendError(res, "Bản ghi không tồn tại trong hệ thống", 404)
    }

    req.record = record
    next()
  } catch (error) {
    next(error)
  }
}
