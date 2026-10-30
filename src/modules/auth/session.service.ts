import bcrypt from "bcryptjs";
import type { PrismaClient } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import { databaseOperation, loadPrincipal } from "../../utils/authorization";
import { HttpError } from "../../utils/http-error";
import { signToken } from "../../utils/jwt";
const dummyHash =
  "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
export function createSessionService(
  connect: () => Promise<PrismaClient> = getPrisma,
) {
  return {
    async login(identifier: string, password: string) {
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
        const principal = await loadPrincipal(candidate.id, db);
        const accessToken = signToken({ sub: principal.id });
        return { accessToken, tokenType: "Bearer", user: principal };
      });
    },
  };
}
export const sessionService = createSessionService();
export type SessionService = ReturnType<typeof createSessionService>;
