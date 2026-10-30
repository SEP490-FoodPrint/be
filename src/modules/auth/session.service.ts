import bcrypt from "bcryptjs";
import type { PrismaClient } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import { databaseOperation, loadPrincipal } from "../../utils/authorization";
import { HttpError } from "../../utils/http-error";
import {
  signToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../../utils/jwt";
import {
  saveRefreshToken,
  getStoredRefreshToken,
  deleteRefreshToken,
} from "./refresh-token.store";

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
        const refreshToken = signRefreshToken({ sub: principal.id });

        // Lưu Refresh Token vào Redis
        await saveRefreshToken(principal.id, refreshToken);

        // Cập nhật lastLoginAt (bỏ qua lỗi nếu có)
        await db.user
          .update({
            where: { id: candidate.id },
            data: { lastLoginAt: new Date() },
          })
          .catch(() => {});

        return {
          accessToken,
          refreshToken,
          tokenType: "Bearer",
          user: principal,
        };
      });
    },

    async refreshToken(token: string) {
      let userId: string;
      try {
        const payload = verifyRefreshToken(token);
        if (typeof payload.sub !== "string") {
          throw new Error("Invalid sub");
        }
        userId = payload.sub;
      } catch {
        throw new HttpError(401, "Refresh token không hợp lệ hoặc đã hết hạn");
      }

      const storedToken = await getStoredRefreshToken(userId);
      if (!storedToken || storedToken !== token) {
        throw new HttpError(
          401,
          "Phiên đăng nhập đã bị thu hồi hoặc không tồn tại",
        );
      }

      return databaseOperation(async () => {
        const db = await connect();
        const principal = await loadPrincipal(userId, db);
        const newAccessToken = signToken({ sub: principal.id });
        const newRefreshToken = signRefreshToken({ sub: principal.id });

        // Token rotation: ghi đè token mới
        await saveRefreshToken(principal.id, newRefreshToken);

        return {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          tokenType: "Bearer",
          user: principal,
        };
      });
    },

    async logout(tokenOrUserId: string) {
      let userId = tokenOrUserId;
      try {
        const payload = verifyRefreshToken(tokenOrUserId);
        if (typeof payload.sub === "string") {
          userId = payload.sub;
        }
      } catch {
        // Nếu tokenOrUserId là userId thuần, tiếp tục
      }
      await deleteRefreshToken(userId);
    },

    async logoutByUserId(userId: string) {
      await deleteRefreshToken(userId);
    },
  };
}

export const sessionService = createSessionService();
export type SessionService = ReturnType<typeof createSessionService>;
