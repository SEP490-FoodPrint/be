import { sendError } from "../../utils/response.js"
import AuthService from "./auth.service.js"

export const checkExists = async (req, res, next) => {
  try {
    const id = req.params.id
    if (!id) {
      return sendError(res, "ID phiên không hợp lệ", 400)
    }

    const session = await AuthService.getById(id)
    if (!session) {
      return sendError(res, "Phiên xác thực không tồn tại", 404)
    }

    req.sessionRecord = session
    next()
  } catch (error) {
    next(error)
  }
}
