import { createClient } from "redis";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import { requireRedisUrl } from "./env";

export const redis = createClient({
  url: requireRedisUrl(),
  disableOfflineQueue: true,
  socket: {
    connectTimeout: 5000,
    reconnectStrategy: (retries: number) =>
      retries >= 3 ? false : Math.min(200 * 2 ** retries, 1000),
  },
});

redis.on("error", () => {
  console.error("Redis local không sẵn sàng.");
});

export class RedisUnavailableError extends Error {
  readonly statusCode = 503;

  constructor() {
    super("Dịch vụ giới hạn yêu cầu tạm thời không khả dụng.");
    this.name = "RedisUnavailableError";
  }
}

let connecting: Promise<void> | undefined;

export async function connectRedis(): Promise<void> {
  if (redis.isReady) return;
  connecting ??= (async () => {
    if (!redis.isOpen) await redis.connect();
    await redis.ping();
    console.log("⚡Kết nối Redis Cache & Rate-limit thành công!");
  })().finally(() => {
    connecting = undefined;
  });
  await connecting;
}

export async function disconnectRedis(): Promise<void> {
  if (!redis.isOpen) return;
  if (!redis.isReady) {
    redis.destroy();
    return;
  }
  await redis.close();
}

export function createRedisRateLimitStore(
  namespace: string,
  client: Pick<typeof redis, "isReady" | "sendCommand"> = redis,
): RedisStore {
  if (!/^[a-z0-9][a-z0-9:_-]*$/i.test(namespace)) {
    throw new Error("Redis rate limit namespace không hợp lệ");
  }
  return new RedisStore({
    prefix: `foodprint:rate-limit:${namespace}:`,
    sendCommand: async (...args: string[]): Promise<RedisReply> => {
      if (!client.isReady) throw new RedisUnavailableError();
      try {
        return await client.sendCommand<RedisReply>(args);
      } catch {
        throw new RedisUnavailableError();
      }
    },
  });
}
