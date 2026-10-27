import type { ErrorRequestHandler, RequestHandler } from "express";
import { Prisma } from "../generated/prisma/client";
import { sendError } from "../utils/response";

export const notFoundHandler: RequestHandler = (req, res) => {
  return sendError(
    res,
    `Endpoint không tồn tại: ${req.method} ${req.originalUrl}`,
    404,
  );
};

export const globalErrorHandler: ErrorRequestHandler = (
  err: unknown,
  _req,
  res,
  next,
) => {
  if (res.headersSent) return next(err);
  console.error("🔥 Global Error:", err);

  if (
    err instanceof Prisma.PrismaClientValidationError ||
    (err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002")
  ) {
    return sendError(res, "Dữ liệu không hợp lệ", 400);
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    return sendError(res, "Lỗi kết nối cơ sở dữ liệu PostgreSQL", 500);
  }

  const statusCode =
    typeof err === "object" &&
    err !== null &&
    "statusCode" in err &&
    typeof err.statusCode === "number"
      ? err.statusCode
      : 500;
  const message = err instanceof Error ? err.message : "Lỗi máy chủ nội bộ";
  return sendError(
    res,
    message,
    statusCode,
    process.env.NODE_ENV === "development" && err instanceof Error
      ? err.stack
      : null,
  );
};
