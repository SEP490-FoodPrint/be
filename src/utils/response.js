/**
 * Chuẩn hóa phản hồi thành công (JSON)
 */
export const sendSuccess = (res, data = null, message = "Thành công", statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    statusCode,
    message,
    data,
  })
}

/**
 * Chuẩn hóa phản hồi lỗi (JSON)
 */
export const sendError = (res, message = "Đã xảy ra lỗi", statusCode = 500, error = null) => {
  return res.status(statusCode).json({
    success: false,
    statusCode,
    message,
    error: error || undefined,
  })
}
