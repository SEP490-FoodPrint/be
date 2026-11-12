import { createApp } from "./app";
import { connectDB, prisma } from "./config/prisma";
import {
  connectRedis,
  createRedisRateLimitStore,
  disconnectRedis,
} from "./config/redis";
import { readRateLimitConfig } from "./config/env";
import { createApiRateLimiter } from "./middlewares/rate-limit.middleware";
import { startEmailRuntime } from "./utils/email-runtime";

const PORT = Number(process.env.PORT || 5000);
let emailRuntime: Awaited<ReturnType<typeof startEmailRuntime>> | undefined;
let closing: Promise<void> | undefined;

const closeConnections = (): Promise<void> => {
  closing ??= (async () => {
    const workerResults = await Promise.allSettled([emailRuntime?.stop()]);
    const results = await Promise.allSettled([
      prisma.$disconnect(),
      disconnectRedis(),
    ]);
    if (
      [...workerResults, ...results].some(
        (result) => result.status === "rejected",
      )
    ) {
      process.exitCode = 1;
    }
  })();
  return closing;
};

const startServer = async () => {
  const rateLimitConfig = readRateLimitConfig();
  // 1. Kiểm tra kết nối PostgreSQL
  await connectDB();
  await connectRedis();
  const app = createApp(
    createApiRateLimiter(createRedisRateLimitStore("api"), rateLimitConfig),
  );

  emailRuntime = await startEmailRuntime(prisma);

  // 2. Khởi chạy HTTP Server
  const server = app.listen(PORT, () => {
    console.log(`🚀 FoodPrint Backend đang chạy tại: http://localhost:${PORT}`);
    console.log("✉️ Bộ xử lý email hồ sơ đã khởi động cùng API.");
    console.log(
      `📡 Health check endpoint: http://localhost:${PORT}/api/health`,
    );
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `❌ Cổng ${PORT} đang bị chiếm bởi một tiến trình khác (EADDRINUSE). Hãy tắt tiến trình đang chiếm cổng hoặc đổi PORT trong file .env.`,
      );
    } else {
      console.error("Không thể mở HTTP server. Kiểm tra PORT:", err);
    }
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
  await closeConnections();
});
