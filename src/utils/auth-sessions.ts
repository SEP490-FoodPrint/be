import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { JwtPayload } from "jsonwebtoken";
import { readAuthConfig } from "../config/auth";
import { uuid } from "./auth-validation";
import {
  authSessionStore,
  type AuthSessionStore,
  type StoredSession,
} from "./auth-session-store";
import { HttpError } from "./http-error";
import { signToken, verifyToken } from "./jwt";

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
function parseRefreshToken(value: string | undefined): {
  id: string;
  hash: string;
} {
  if (!value || !/^[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/.test(value))
    throw new HttpError(401, "Refresh token không hợp lệ hoặc đã hết hạn");
  return { id: value.slice(0, 32), hash: hashRefreshToken(value) };
}

export function createAuthSessions(
  store: AuthSessionStore = authSessionStore,
  clock: () => number = Date.now,
) {
  async function live(id: string): Promise<StoredSession> {
    const record = await store.get(id);
    if (!record || record.expiresAt <= Math.floor(clock() / 1000))
      throw new HttpError(401, "Phiên đăng nhập đã hết hạn hoặc bị thu hồi");
    return record;
  }
  function tokens(userId: string, id: string, expiresAt: number) {
    const config = readAuthConfig();
    const refreshToken = `${id}.${randomBytes(32).toString("base64url")}`;
    return {
      accessToken: signToken({ sub: userId, sid: id }, config.accessTtlSeconds),
      refreshToken,
      accessTtlSeconds: config.accessTtlSeconds,
      refreshTtlSeconds: Math.max(1, expiresAt - Math.floor(clock() / 1000)),
    };
  }
  return {
    revokeUser(userId: string) {
      return store.revokeUser(uuid(userId));
    },
    async issue(userId: string) {
      userId = uuid(userId);
      const expiresAt =
        Math.floor(clock() / 1000) + readAuthConfig().refreshTtlSeconds;
      for (let attempt = 0; attempt < 3; attempt++) {
        const id = randomBytes(16).toString("hex");
        const result = tokens(userId, id, expiresAt);
        if (
          await store.create(id, {
            userId,
            tokenHash: hashRefreshToken(result.refreshToken),
            expiresAt,
          })
        )
          return result;
      }
      throw new HttpError(503, "Không thể tạo phiên đăng nhập");
    },
    async assertAccess(payload: JwtPayload): Promise<void> {
      if (
        typeof payload.sid !== "string" ||
        !/^[a-f0-9]{32}$/.test(payload.sid)
      )
        throw new HttpError(
          401,
          "Token thiếu phiên đăng nhập hợp lệ; vui lòng đăng nhập lại",
        );
      const record = await live(payload.sid);
      if (record.userId !== uuid(payload.sub))
        throw new HttpError(401, "Phiên đăng nhập không khớp tài khoản");
    },
    async refresh<T>(
      refreshToken: string | undefined,
      loadUser: (userId: string) => Promise<T>,
    ) {
      const { id, hash } = parseRefreshToken(refreshToken);
      const record = await live(id);
      if (
        !timingSafeEqual(
          Buffer.from(hash, "hex"),
          Buffer.from(record.tokenHash, "hex"),
        )
      ) {
        await store.revoke(id);
        throw new HttpError(
          401,
          "Refresh token đã được sử dụng; vui lòng đăng nhập lại",
        );
      }
      let user: T;
      try {
        user = await loadUser(record.userId);
      } catch (error) {
        if (error instanceof HttpError && [401, 403].includes(error.statusCode))
          await store.revoke(id);
        throw error;
      }
      const result = tokens(record.userId, id, record.expiresAt);
      if (
        !(await store.rotate(id, hash, hashRefreshToken(result.refreshToken)))
      )
        throw new HttpError(
          401,
          "Refresh token đã được sử dụng; vui lòng đăng nhập lại",
        );
      return { ...result, user };
    },
    async logout(refreshToken?: string, accessToken?: string): Promise<void> {
      if (refreshToken) {
        let parsed: ReturnType<typeof parseRefreshToken> | undefined;
        try {
          parsed = parseRefreshToken(refreshToken);
        } catch (error) {
          if (!(error instanceof HttpError) || error.statusCode !== 401)
            throw error;
        }
        if (parsed) {
          // Logging out with a rotated token must revoke its family as well.
          await store.revoke(parsed.id);
          return;
        }
      }
      if (!accessToken) return;
      let payload: JwtPayload;
      try {
        payload = verifyToken(accessToken);
      } catch {
        return;
      }
      if (
        typeof payload.sid !== "string" ||
        !/^[a-f0-9]{32}$/.test(payload.sid)
      )
        return;
      const record = await store.get(payload.sid);
      if (record && record.userId === payload.sub)
        await store.revoke(payload.sid);
    },
  };
}

export type AuthSessions = ReturnType<typeof createAuthSessions>;
export const authSessions = createAuthSessions();
