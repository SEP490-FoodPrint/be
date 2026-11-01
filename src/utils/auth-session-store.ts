import { randomBytes } from "node:crypto";
import { redis } from "../config/redis";
import { HttpError } from "./http-error";

export interface StoredSession {
  userId: string;
  tokenHash: string;
  expiresAt: number;
  generation?: string;
}
export interface AuthSessionStore {
  create(id: string, value: StoredSession): Promise<boolean>;
  get(id: string): Promise<StoredSession | null>;
  rotate(id: string, previousHash: string, nextHash: string): Promise<boolean>;
  revoke(id: string, expectedHash?: string): Promise<void>;
  revokeUser(userId: string): Promise<void>;
}
export interface AuthRedisClient {
  readonly isReady: boolean;
  sendCommand(args: string[]): Promise<unknown>;
}

const rotateScript = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local session = cjson.decode(raw)
local generation = redis.call('GET', ARGV[3] .. session.userId) or ''
if (session.generation or '') ~= generation then redis.call('DEL', KEYS[1]); return 0 end
if session.tokenHash ~= ARGV[1] then
  redis.call('DEL', KEYS[1])
  return -1
end
session.tokenHash = ARGV[2]
redis.call('SET', KEYS[1], cjson.encode(session), 'KEEPTTL')
return 1
`;
const createScript = `
local session = cjson.decode(ARGV[1])
session.generation = redis.call('GET', ARGV[3] .. session.userId) or ''
return redis.call('SET', KEYS[1], cjson.encode(session), 'EXAT', ARGV[2], 'NX')
`;
const getScript = `
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local session = cjson.decode(raw)
local generation = redis.call('GET', ARGV[1] .. session.userId) or ''
if (session.generation or '') ~= generation then redis.call('DEL', KEYS[1]); return nil end
return raw
`;
const revokeScript = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
if ARGV[1] == '' or cjson.decode(raw).tokenHash == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

function isSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.userId === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      record.userId,
    ) &&
    typeof record.tokenHash === "string" &&
    /^[a-f0-9]{64}$/.test(record.tokenHash) &&
    typeof record.expiresAt === "number" &&
    Number.isSafeInteger(record.expiresAt) &&
    record.expiresAt > 0 &&
    (record.generation === undefined ||
      record.generation === "" ||
      (typeof record.generation === "string" &&
        /^[a-f0-9]{32}$/.test(record.generation)))
  );
}

export function createRedisAuthSessionStore(
  client: AuthRedisClient = redis,
  prefix = "foodprint:auth:session:",
): AuthSessionStore {
  if (!/^foodprint:auth:[a-z0-9:_-]+:$/i.test(prefix))
    throw new Error("Auth Redis prefix không hợp lệ");
  function key(id: string): string {
    if (!/^[a-f0-9]{32}$/.test(id))
      throw new HttpError(401, "Phiên đăng nhập không hợp lệ");
    return prefix + id;
  }
  async function command(args: string[]): Promise<unknown> {
    try {
      if (!client.isReady) throw new Error("Redis offline");
      return await client.sendCommand(args);
    } catch {
      throw new HttpError(
        503,
        "Dịch vụ phiên đăng nhập tạm thời không khả dụng",
      );
    }
  }
  return {
    async create(id, value) {
      if (!isSession(value)) throw new Error("Invalid session state");
      return (
        (await command([
          "EVAL",
          createScript,
          "1",
          key(id),
          JSON.stringify(value),
          String(value.expiresAt),
          prefix + "user:",
        ])) === "OK"
      );
    },
    async get(id) {
      const raw = await command([
        "EVAL",
        getScript,
        "1",
        key(id),
        prefix + "user:",
      ]);
      if (raw === null) return null;
      try {
        if (typeof raw !== "string") throw new Error("Invalid Redis response");
        const value: unknown = JSON.parse(raw);
        if (!isSession(value)) throw new Error("Invalid session state");
        return value;
      } catch {
        throw new HttpError(503, "Dữ liệu phiên đăng nhập không hợp lệ");
      }
    },
    async rotate(id, previousHash, nextHash) {
      if (
        ![previousHash, nextHash].every((hash) => /^[a-f0-9]{64}$/.test(hash))
      )
        throw new Error("Invalid token hash");
      return (
        (await command([
          "EVAL",
          rotateScript,
          "1",
          key(id),
          previousHash,
          nextHash,
          prefix + "user:",
        ])) === 1
      );
    },
    async revoke(id, expectedHash) {
      if (expectedHash !== undefined && !/^[a-f0-9]{64}$/.test(expectedHash))
        throw new Error("Invalid token hash");
      await command(["EVAL", revokeScript, "1", key(id), expectedHash ?? ""]);
    },
    async revokeUser(userId) {
      if (
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
          userId,
        )
      )
        throw new Error("Invalid session user");
      // Keep a durable generation marker; expiring it could revive legacy sessions.
      await command([
        "SET",
        prefix + "user:" + userId,
        randomBytes(16).toString("hex"),
      ]);
    },
  };
}

export const authSessionStore = createRedisAuthSessionStore();
