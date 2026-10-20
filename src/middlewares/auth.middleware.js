import { verifyToken } from "../utils/jwt.js"
import { sendError } from "../utils/response.js"

export const authenticate = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return sendError(res, "Vui lòng đăng nhập để truy cập tài nguyên này", 401)
    }

    const token = authHeader.split(" ")[1]
    const decoded = verifyToken(token)

    req.user = decoded
    next()
  } catch (error) {
    return sendError(res, "Phiên đăng nhập không hợp lệ hoặc đã hết hạn", 401, error.message)
  }
}
