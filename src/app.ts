import express from "express";
import cors from "cors";
import morgan from "morgan";
import "./config/env";
import routes from "./routes";
import {
  notFoundHandler,
  globalErrorHandler,
} from "./middlewares/error.middleware";
import type { RateLimitRequestHandler } from "express-rate-limit";

export function createApp(apiRateLimiter: RateLimitRequestHandler) {
  const app = express();

  // 1. Global Middlewares
  app.use(
    cors({
      origin: process.env.CLIENT_URL || "http://localhost:3001",
      credentials: true,
    }),
  );
  app.use("/api", apiRateLimiter);
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  if (process.env.NODE_ENV === "development") {
    app.use(morgan("dev"));
  }

  // 2. Central API Routes
  app.use("/api", routes);

  // 3. Error Handling
  app.use(notFoundHandler);
  app.use(globalErrorHandler);

  return app;
}

export default createApp;
