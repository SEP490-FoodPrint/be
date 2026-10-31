import type { RequestHandler } from "express";
import { readAuthConfig } from "../config/auth";
import { sendError } from "../utils/response";

/** A custom header forces cross-origin browser requests through CORS preflight. */
export function createCsrfProtection(
  clientOrigin = readAuthConfig().clientOrigin,
): RequestHandler {
  return (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const origin = req.get("origin");
    if (
      req.get("X-CSRF-Protection") !== "1" ||
      (origin !== undefined && origin !== clientOrigin)
    ) {
      sendError(res, "Yêu cầu không vượt qua kiểm tra CSRF/origin", 403);
      return;
    }
    next();
  };
}
