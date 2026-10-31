import { redis } from "../config/redis";
import type { AuthRedisClient } from "./auth-session-store";
import { HttpError } from "./http-error";

export const EMAIL_CODE_TTL_SECONDS = 600;
export const EMAIL_RESEND_SECONDS = 60;
export const EMAIL_MAX_ATTEMPTS = 5;
export interface EmailChallenge {
  id: string;
  userId: string;
  codeHash: string;
  attempts: number;
  expiresAt: number;
}
export interface EmailVerificationStore {
  reserve(emailKey: string, ipKey: string, id: string): Promise<number>;
  issue(emailKey: string, record: EmailChallenge): Promise<boolean>;
  get(emailKey: string): Promise<EmailChallenge | null>;
  consume(emailKey: string, id: string, codeHash: string): Promise<boolean>;
  discard(emailKey: string, id: string): Promise<void>;
}
const reserveScript = `
local cooldown = redis.call('TTL', KEYS[1])
if cooldown > 0 then return cooldown end
if tonumber(redis.call('GET', KEYS[2]) or '0') >= 5 then return math.max(1, redis.call('TTL', KEYS[2])) end
if tonumber(redis.call('GET', KEYS[3]) or '0') >= 20 then return math.max(1, redis.call('TTL', KEYS[3])) end
if redis.call('INCR', KEYS[2]) == 1 then redis.call('EXPIRE', KEYS[2], 3600) end
if redis.call('INCR', KEYS[3]) == 1 then redis.call('EXPIRE', KEYS[3], 3600) end
redis.call('SET', KEYS[1], ARGV[1], 'EX', 60)
return 0
`;
const issueScript = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[2], ARGV[2], 'EXAT', ARGV[3])
return 1
`;
const consumeScript = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local challenge = cjson.decode(raw)
if challenge.id ~= ARGV[1] then return 0 end
if challenge.expiresAt <= tonumber(redis.call('TIME')[1]) then redis.call('DEL', KEYS[1]); return 0 end
if challenge.codeHash ~= ARGV[2] then
  challenge.attempts = challenge.attempts + 1
  if challenge.attempts >= 5 then redis.call('DEL', KEYS[1])
  else redis.call('SET', KEYS[1], cjson.encode(challenge), 'KEEPTTL') end
  return 0
end
redis.call('DEL', KEYS[1])
return 1
`;
const discardScript = `
local raw = redis.call('GET', KEYS[1])
if raw and cjson.decode(raw).id == ARGV[1] then redis.call('DEL', KEYS[1]) end
return 1
`;
function validChallenge(value: unknown): value is EmailChallenge {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    /^[a-f0-9]{32}$/.test(row.id) &&
    typeof row.userId === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      row.userId,
    ) &&
    typeof row.codeHash === "string" &&
    /^[a-f0-9]{64}$/.test(row.codeHash) &&
    typeof row.attempts === "number" &&
    Number.isSafeInteger(row.attempts) &&
    row.attempts >= 0 &&
    row.attempts < EMAIL_MAX_ATTEMPTS &&
    typeof row.expiresAt === "number" &&
    Number.isSafeInteger(row.expiresAt) &&
    row.expiresAt > 0
  );
}
export function createRedisEmailVerificationStore(
  client: AuthRedisClient = redis,
  prefix = "foodprint:email-verification:",
): EmailVerificationStore {
  if (!/^foodprint:email-verification:(?:[a-z0-9_-]+:)*$/i.test(prefix))
    throw new Error("Email verification prefix không hợp lệ");
  function key(kind: string, digest: string) {
    if (!/^[a-f0-9]{64}$/.test(digest))
      throw new Error("Invalid verification key");
    return prefix + kind + ":" + digest;
  }
  function nonce(id: string) {
    if (!/^[a-f0-9]{32}$/.test(id))
      throw new Error("Invalid verification nonce");
    return id;
  }
  async function command(args: string[]) {
    try {
      if (!client.isReady) throw new Error("Redis offline");
      return await client.sendCommand(args);
    } catch {
      throw new HttpError(
        503,
        "Dịch vụ xác minh email tạm thời không khả dụng",
      );
    }
  }
  return {
    async reserve(emailKey, ipKey, id) {
      const result = await command([
        "EVAL",
        reserveScript,
        "3",
        key("cooldown", emailKey),
        key("email-budget", emailKey),
        key("ip-budget", ipKey),
        nonce(id),
      ]);
      if (typeof result !== "number" || result < 0)
        throw new HttpError(
          503,
          "Dữ liệu giới hạn xác minh email không hợp lệ",
        );
      return result;
    },
    async issue(emailKey, record) {
      if (!validChallenge(record))
        throw new Error("Invalid verification challenge");
      return (
        (await command([
          "EVAL",
          issueScript,
          "2",
          key("cooldown", emailKey),
          key("challenge", emailKey),
          nonce(record.id),
          JSON.stringify(record),
          String(record.expiresAt),
        ])) === 1
      );
    },
    async get(emailKey) {
      const raw = await command(["GET", key("challenge", emailKey)]);
      if (raw === null) return null;
      try {
        if (typeof raw !== "string") throw new Error("Invalid Redis response");
        const record: unknown = JSON.parse(raw);
        if (!validChallenge(record)) throw new Error("Invalid challenge");
        return record;
      } catch {
        throw new HttpError(503, "Dữ liệu xác minh email không hợp lệ");
      }
    },
    async consume(emailKey, id, hash) {
      if (!/^[a-f0-9]{64}$/.test(hash))
        throw new Error("Invalid verification hash");
      return (
        (await command([
          "EVAL",
          consumeScript,
          "1",
          key("challenge", emailKey),
          nonce(id),
          hash,
        ])) === 1
      );
    },
    async discard(emailKey, id) {
      await command([
        "EVAL",
        discardScript,
        "1",
        key("challenge", emailKey),
        nonce(id),
      ]);
    },
  };
}
export const emailVerificationStore = createRedisEmailVerificationStore();
