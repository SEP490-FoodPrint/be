import { createHash } from "node:crypto";
import { redis } from "../config/redis";
import type { AuthRedisClient } from "./auth-session-store";
import { createRedisEmailVerificationStore } from "./email-verification-store";
import { HttpError } from "./http-error";

export const RESET_TOKEN_TTL_SECONDS = 300;
export interface PasswordResetGrant {
  userId: string;
  emailKey: string;
  credentialHash: string;
  expiresAt: number;
}
export interface PasswordResetGrants {
  issue(token: string, grant: PasswordResetGrant): Promise<void>;
  consume(token: string): Promise<PasswordResetGrant | null>;
  limitChange(userKey: string): Promise<number>;
}
function validGrant(value: unknown): value is PasswordResetGrant {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.userId === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      row.userId,
    ) &&
    [row.emailKey, row.credentialHash].every(
      (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v),
    ) &&
    typeof row.expiresAt === "number" &&
    Number.isSafeInteger(row.expiresAt) &&
    row.expiresAt > 0
  );
}
const limitScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], 900) end
if count > 5 then return math.max(1, redis.call('TTL', KEYS[1])) end
return 0
`;
export function createRedisPasswordResetStore(
  client: AuthRedisClient = redis,
  prefix = "foodprint:password-reset:",
) {
  if (!/^foodprint:password-reset:(?:[a-z0-9_-]+:)*$/i.test(prefix))
    throw new Error("Password reset prefix không hợp lệ");
  async function command(args: string[]) {
    try {
      if (!client.isReady) throw new Error("Redis offline");
      return await client.sendCommand(args);
    } catch {
      throw new HttpError(
        503,
        "Dịch vụ đặt lại mật khẩu tạm thời không khả dụng",
      );
    }
  }
  function key(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new HttpError(
        400,
        "Phiên đặt lại mật khẩu không hợp lệ hoặc đã hết hạn",
      );
    return prefix + "grant:" + createHash("sha256").update(token).digest("hex");
  }
  const grants: PasswordResetGrants = {
    async issue(token, grant) {
      if (!validGrant(grant)) throw new Error("Invalid password reset grant");
      if (
        (await command([
          "SET",
          key(token),
          JSON.stringify(grant),
          "EXAT",
          String(grant.expiresAt),
          "NX",
        ])) !== "OK"
      )
        throw new HttpError(503, "Không thể tạo phiên đặt lại mật khẩu");
    },
    async consume(token) {
      const raw = await command(["GETDEL", key(token)]);
      if (raw === null) return null;
      try {
        if (typeof raw !== "string") throw new Error("Invalid Redis response");
        const grant: unknown = JSON.parse(raw);
        if (!validGrant(grant)) throw new Error("Invalid reset grant");
        return grant;
      } catch {
        throw new HttpError(503, "Dữ liệu đặt lại mật khẩu không hợp lệ");
      }
    },
    async limitChange(userKey) {
      if (!/^[a-f0-9]{64}$/.test(userKey))
        throw new Error("Invalid password change key");
      const wait = await command([
        "EVAL",
        limitScript,
        "1",
        prefix + "change-budget:" + userKey,
      ]);
      if (typeof wait !== "number" || wait < 0)
        throw new HttpError(503, "Dữ liệu giới hạn đổi mật khẩu không hợp lệ");
      return wait;
    },
  };
  return { codes: createRedisEmailVerificationStore(client, prefix), grants };
}
export const passwordResetStore = createRedisPasswordResetStore();
