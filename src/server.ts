import { createApp } from "./app";
import { connectDB, prisma } from "./config/prisma";
import {
  connectRedis,
  createRedisRateLimitStore,
  disconnectRedis,
} from "./config/redis";
import { readRateLimitConfig } from "./config/env";
import { createApiRateLimiter } from "./middlewares/rate-limit.middleware";

const PORT = Number(process.env.PORT || 5000);

const startServer = async () => {
  const rateLimitConfig = readRateLimitConfig();
  // 1. Kiểm tra kết nối PostgreSQL
  await connectDB();
  await connectRedis();
  const app = createApp(
    createApiRateLimiter(createRedisRateLimitStore("api"), rateLimitConfig),
  );

  const closeConnections = async () => {
    const results = await Promise.allSettled([
      prisma.$disconnect(),
      disconnectRedis(),
    ]);
    if (results.some((result) => result.status === "rejected")) {
      process.exitCode = 1;
    }
  };

  // 2. Khởi chạy HTTP Server
  const server = app.listen(PORT, () => {
    console.log(`🚀 FoodPrint Backend đang chạy tại: http://localhost:${PORT}`);
    console.log(
      `📡 Health check endpoint: http://localhost:${PORT}/api/health`,
    );
  });

  server.on("error", () => {
    console.error("Không thể mở HTTP server. Kiểm tra PORT.");
    void closeConnections().finally(() => {
      process.exitCode = 1;
    });
  });

  const shutdown = () => {
    server.close(() => {
      void closeConnections().catch(() => {
        process.exitCode = 1;
      });
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
};

void startServer().catch(async () => {
  console.error(
    "Không thể khởi động API. Kiểm tra cấu hình và PostgreSQL/Redis local.",
  );
  process.exitCode = 1;
  await Promise.allSettled([prisma.$disconnect(), disconnectRedis()]);
});
