import type { Response } from "express";

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
  const code = apiErrorCode(res.req?.originalUrl ?? "", statusCode);
  return res.status(statusCode).json({
    success: false,
    statusCode,
    message,
    ...(code ? { code } : {}),
    error: error || undefined,
  });
};

function apiErrorCode(url: string, status: number) {
  if (!/^\/api\/v1(?:\/|$)/.test(url)) return undefined;
  return (
    (
      {
        400: "INVALID_INPUT_DATA",
        401: "AUTHENTICATION_REQUIRED",
        403: "ACCESS_DENIED_WRONG_SCHOOL",
        404: "RESOURCE_NOT_FOUND",
        409: "INVALID_LIFECYCLE_STATE",
        422: "BUSINESS_RULE_VIOLATION",
        429: "RATE_LIMIT_EXCEEDED",
        503: "SERVICE_UNAVAILABLE",
      } as Record<number, string>
    )[status] ?? "INTERNAL_SERVER_ERROR"
  );
}
