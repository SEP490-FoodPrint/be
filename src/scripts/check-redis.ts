import { connectRedis, disconnectRedis, redis } from "../config/redis";

async function main(): Promise<void> {
  try {
    await connectRedis();
    const result = await redis.ping();
    if (result !== "PONG") throw new Error("Redis ping không hợp lệ");
    console.log("PASS: Redis local PONG");
  } catch {
    console.error("FAIL: Kiểm tra Docker Redis local và REDIS_URL.");
    process.exitCode = 1;
  } finally {
    await disconnectRedis();
  }
}

void main();
