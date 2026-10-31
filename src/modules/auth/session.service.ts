import bcrypt from "bcryptjs";
import type { PrismaClient } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import { databaseOperation } from "../../utils/authorization";
import { loadSessionUser } from "../../utils/session-identity";
import { HttpError } from "../../utils/http-error";
import { authSessions, type AuthSessions } from "../../utils/auth-sessions";
const dummyHash =
  "$2b$12$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
export function createSessionService(
  connect: () => Promise<PrismaClient> = getPrisma,
  sessions: AuthSessions = authSessions,
) {
  return {
    async login(
      identifier: string,
      password: string,
      previousRefreshToken?: string,
    ) {
      return databaseOperation(async () => {
        const db = await connect();
        const rows = await db.user.findMany({
          where: { OR: [{ username: identifier }, { email: identifier }] },
          take: 2,
          select: { id: true, passwordHash: true },
        });
        const candidate = rows.length === 1 ? rows[0] : undefined;
        const valid = await bcrypt.compare(
          password,
          candidate?.passwordHash ?? dummyHash,
        );
        if (!candidate || !valid)
          throw new HttpError(
            401,
            "Tên đăng nhập/email hoặc mật khẩu không đúng",
          );
        const principal = await loadSessionUser(candidate.id, db);
        if (previousRefreshToken) await sessions.logout(previousRefreshToken);
        return { ...(await sessions.issue(principal.id)), user: principal };
      });
    },
    refresh(refreshToken: string | undefined) {
      return sessions.refresh(refreshToken, async (userId) =>
        loadSessionUser(userId, await connect()),
      );
    },
    logout(refreshToken?: string, accessToken?: string) {
      return sessions.logout(refreshToken, accessToken);
    },
    async currentUser(userId: string) {
      return loadSessionUser(userId, await connect());
    },
  };
}
export const sessionService = createSessionService();
export type SessionService = ReturnType<typeof createSessionService>;
