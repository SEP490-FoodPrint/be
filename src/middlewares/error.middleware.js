import { sendError } from "../utils/response.js"

export const notFoundHandler = (req, res) => {
  return sendError(res, `Endpoint không tồn tại: ${req.method} ${req.originalUrl}`, 404)
}

export const globalErrorHandler = (err, req, res, next) => {
  console.error("🔥 Global Error:", err)

  // Lỗi xác thực của Sequelize
  if (err.name === "SequelizeValidationError" || err.name === "SequelizeUniqueConstraintError") {
    const messages = err.errors?.map((e) => e.message) || [err.message]
    return sendError(res, "Dữ liệu không hợp lệ", 400, messages)
  }

  // Lỗi kết nối CSDL
  if (err.name === "SequelizeConnectionError") {
    return sendError(res, "Lỗi kết nối cơ sở dữ liệu PostgreSQL", 500)
  }

  const statusCode = err.statusCode || 500
  const message = err.message || "Lỗi máy chủ nội bộ"
  return sendError(res, message, statusCode, process.env.NODE_ENV === "development" ? err.stack : null)
}
