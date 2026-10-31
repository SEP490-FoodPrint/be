import express, { type RequestHandler } from "express";
import { authenticate } from "./middlewares/auth.middleware";
import cors from "cors";
import morgan from "morgan";
import "./config/env";
import { createApiRouter } from "./routes";
import {
  notFoundHandler,
  globalErrorHandler,
} from "./middlewares/error.middleware";
import type { RateLimitRequestHandler } from "express-rate-limit";
import { readAuthConfig } from "./config/auth";
import { createCsrfProtection } from "./middlewares/csrf.middleware";
import type { AuthServices } from "./modules/auth/auth.routes";

export function createApp(
  apiRateLimiter: RateLimitRequestHandler,
  authHandler: RequestHandler = authenticate,
  authServices?: AuthServices,
) {
  const app = express();

  // 1. Global Middlewares
  app.use(
    cors({
      origin: readAuthConfig().clientOrigin,
      credentials: true,
      exposedHeaders: ["Retry-After"],
    }),
  );
  app.use("/api", apiRateLimiter);
  app.use("/api", createCsrfProtection());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  if (process.env.NODE_ENV === "development") {
    app.use(morgan("dev"));
  }

  // 2. Central API Routes
  app.use("/api", createApiRouter(authHandler, authServices));

  // 3. Error Handling
  app.use(notFoundHandler);
  app.use(globalErrorHandler);

  return app;
}

export default createApp;
