/**
 * Chuẩn hóa phản hồi thành công (JSON)
 */
export const sendSuccess = (
  res: Response,
  data: unknown = null,
  message = "Thành công",
  statusCode = 200,
): Response => {
  return res.status(statusCode).json({
    success: true,
    statusCode,
    message,
    data,
  });
};

/**
 * Chuẩn hóa phản hồi lỗi (JSON)
 */
export const sendError = (
  res: Response,
  message = "Đã xảy ra lỗi",
  statusCode = 500,
  error: unknown = null,
): Response => {
  return res.status(statusCode).json({
    success: false,
    statusCode,
    message,
    error: error || undefined,
  });
};
import type { Response } from "express";
