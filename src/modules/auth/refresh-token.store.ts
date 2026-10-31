import { redis } from "../../config/redis";

const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

// In-memory fallback if Redis is not connected during development
const memoryRefreshTokenStore = new Map<
  string,
  { token: string; expiresAt: number }
>();

export async function saveRefreshToken(
  userId: string,
  token: string,
): Promise<void> {
  const key = `foodprint:refresh_token:${userId}`;
  try {
    if (redis.isReady) {
      await redis.set(key, token, { EX: REFRESH_TOKEN_TTL_SECONDS });
      return;
    }
  } catch {
    // fallback to memory
  }
  memoryRefreshTokenStore.set(key, {
    token,
    expiresAt: Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000,
  });
}

export async function getStoredRefreshToken(
  userId: string,
): Promise<string | null> {
  const key = `foodprint:refresh_token:${userId}`;
  try {
    if (redis.isReady) {
      return await redis.get(key);
    }
  } catch {
    // fallback to memory
  }
  const entry = memoryRefreshTokenStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryRefreshTokenStore.delete(key);
    return null;
  }
  return entry.token;
}

export async function deleteRefreshToken(userId: string): Promise<void> {
  const key = `foodprint:refresh_token:${userId}`;
  try {
    if (redis.isReady) {
      await redis.del(key);
    }
  } catch {
    // ignore
  }
  memoryRefreshTokenStore.delete(key);
}
