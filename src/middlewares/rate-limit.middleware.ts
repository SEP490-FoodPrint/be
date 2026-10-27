import {
  rateLimit,
  type Options,
  type RateLimitRequestHandler,
  type Store,
} from "express-rate-limit";
import { readRateLimitConfig, type RateLimitConfig } from "../config/env";
import { sendError } from "../utils/response";

export interface RateLimiterOptions extends RateLimitConfig {
  store: Store;
  skip?: Options["skip"];
}

export function createRateLimiter({
  windowMs,
  limit,
  store,
  skip,
}: RateLimiterOptions): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    limit,
    store,
    skip,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    passOnStoreError: false,
    handler: (_req, res) => {
      sendError(
        res,
        "Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.",
        429,
      );
    },
  });
}

export function createApiRateLimiter(
  store: Store,
  config: RateLimitConfig = readRateLimitConfig(),
): RateLimitRequestHandler {
  return createRateLimiter({
    ...config,
    store,
    skip: (req) =>
      req.method === "OPTIONS" ||
      (["GET", "HEAD"].includes(req.method) &&
        ["/health", "/health/"].includes(req.path)),
  });
}
