import type { ErrorRequestHandler, RequestHandler } from "express";
import { Prisma } from "../generated/prisma/client";
import { HttpError } from "../utils/http-error";
import { sendError } from "../utils/response";

export const notFoundHandler: RequestHandler = (req, res) => {
  return sendError(
    res,
    `Endpoint không tồn tại: ${req.method} ${req.path}`,
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
  // Never log request bodies, raw driver errors or error messages containing credentials.
  const code =
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    typeof err.code === "string" &&
    /^[A-Z0-9_]{1,32}$/.test(err.code)
      ? err.code
      : undefined;
  console.error("Request failed", {
    name: err instanceof Error ? err.name : "Error",
    code,
  });
  if (err instanceof HttpError)
    return sendError(res, err.message, err.statusCode);
  if (
    err instanceof Prisma.PrismaClientValidationError ||
    (err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002")
  )
    return sendError(res, "Dữ liệu không hợp lệ", 400);
  if (
    err !== null &&
    typeof err === "object" &&
    "statusCode" in err &&
    typeof err.statusCode === "number" &&
    err.statusCode >= 400 &&
    err.statusCode < 500
  )
    return sendError(res, "Nội dung yêu cầu không hợp lệ", err.statusCode);
  return sendError(res, "Lỗi máy chủ nội bộ", 500);
};
