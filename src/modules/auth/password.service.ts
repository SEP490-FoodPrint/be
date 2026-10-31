import bcrypt from "bcryptjs";
import { createHmac, randomBytes, randomInt } from "node:crypto";
import { ipKeyGenerator } from "express-rate-limit";
import type { PrismaClient } from "../../generated/prisma/client";
import type { SessionUser } from "../../types/session-user";
import { getPrisma } from "../../utils/database";
import {
  authorizationTransaction,
  databaseOperation,
} from "../../utils/authorization";
import { authSessions, type AuthSessions } from "../../utils/auth-sessions";
import { loadSessionUser } from "../../utils/session-identity";
import { HttpError } from "../../utils/http-error";
import { requireJwtSecret } from "../../utils/jwt";
import {
  EMAIL_CODE_TTL_SECONDS,
  type EmailVerificationStore,
} from "../../utils/email-verification-store";
import {
  passwordResetStore,
  RESET_TOKEN_TTL_SECONDS,
  type PasswordResetGrants,
} from "../../utils/password-reset-store";
import { passwordResetMailer } from "../../utils/password-reset-email";
import type { VerificationMailer } from "../../utils/verification-email";

export interface PasswordAccount {
  id: string;
  email: string;
  passwordHash: string;
  status: string;
}
export interface PasswordRepository {
  find(email: string): Promise<PasswordAccount | null>;
  replace(
    userId: string,
    verifyAndHash: (current: PasswordAccount) => Promise<string>,
    signedIn: boolean,
  ): Promise<void>;
}
const passwordSelect = {
  id: true,
  email: true,
  passwordHash: true,
  status: true,
} as const;
export function createPasswordRepository(
  connect: () => Promise<PrismaClient> = getPrisma,
  sessions: AuthSessions = authSessions,
): PasswordRepository {
  return {
    find: (email) =>
      databaseOperation(async () =>
        (await connect()).user.findUnique({
          where: { email },
          select: passwordSelect,
        }),
      ),
    async replace(userId, verifyAndHash, signedIn) {
      const db = await connect();
      await authorizationTransaction(db, async (tx) => {
        await tx.$queryRaw`SELECT id FROM foodprint.users WHERE id = ${userId}::uuid FOR UPDATE`;
        const current = await tx.user.findUnique({
          where: { id: userId },
          select: passwordSelect,
        });
        if (!current) throw new HttpError(400, "Không thể cập nhật mật khẩu");
        if (signedIn) await loadSessionUser(userId, tx);
        const passwordHash = await verifyAndHash(current);
        // Fail closed: revoke before the DB write while holding the same row lock
        // as login. A rollback may log the user out, but cannot keep old sessions live.
        await sessions.revokeUser(userId);
        await tx.user.update({
          where: { id: userId },
          data: { passwordHash },
          select: { id: true },
        });
      });
    },
  };
}
export class PasswordRateLimitError extends HttpError {
  constructor(readonly retryAfterSeconds: number) {
    super(429, "Bạn đã yêu cầu quá nhiều lần. Vui lòng thử lại sau.");
  }
}
export function passwordFingerprint(...values: string[]) {
  return createHmac("sha256", requireJwtSecret())
    .update(JSON.stringify(["foodprint:password-reset", ...values]))
    .digest("hex");
}
const eligible = (user: PasswordAccount | null): user is PasswordAccount =>
  Boolean(user && ["ACTIVE", "UNVERIFIED"].includes(user.status));
const invalidCode = () =>
  new HttpError(
    400,
    "Mã đặt lại mật khẩu không hợp lệ, đã hết hạn hoặc đã được sử dụng",
  );
const invalidGrant = () =>
  new HttpError(400, "Phiên đặt lại mật khẩu không hợp lệ hoặc đã hết hạn");
async function newHash(password: string, currentHash: string) {
  if (await bcrypt.compare(password, currentHash))
    throw new HttpError(400, "Mật khẩu mới phải khác mật khẩu hiện tại");
  return bcrypt.hash(password, 12);
}

export function createPasswordService(
  codes: EmailVerificationStore = passwordResetStore.codes,
  grants: PasswordResetGrants = passwordResetStore.grants,
  mailer: VerificationMailer = passwordResetMailer,
  db: PasswordRepository = createPasswordRepository(),
  clock: () => number = Date.now,
) {
  const emailKey = (email: string) =>
    passwordFingerprint("email", email.trim().toLowerCase());
  const codeHash = (
    user: PasswordAccount,
    key: string,
    id: string,
    code: string,
  ) => passwordFingerprint("code", user.id, key, id, user.passwordHash, code);
  return {
    async request(email: string, ip = "unknown"): Promise<void> {
      mailer.assertConfigured();
      const key = emailKey(email);
      const id = randomBytes(16).toString("hex");
      const wait = await codes.reserve(
        key,
        passwordFingerprint("ip", ipKeyGenerator(ip)),
        id,
      );
      if (wait > 0) throw new PasswordRateLimitError(wait);
      const user = await db.find(email);
      // Preserve the same successful response and limits for unknown/locked accounts.
      if (!eligible(user)) return;
      const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
      if (
        !(await codes.issue(key, {
          id,
          userId: user.id,
          codeHash: codeHash(user, key, id, code),
          attempts: 0,
          expiresAt: Math.floor(clock() / 1000) + EMAIL_CODE_TTL_SECONDS,
        }))
      )
        throw new PasswordRateLimitError(60);
      try {
        await mailer.send(user.email, code, id);
      } catch {
        try {
          await codes.discard(key, id);
        } catch {
          console.error("Could not discard failed password reset challenge");
        }
        throw new HttpError(
          503,
          "Chưa thể gửi mã đặt lại mật khẩu. Vui lòng thử lại sau.",
        );
      }
    },
    async verify(email: string, code: string) {
      const key = emailKey(email);
      const record = await codes.get(key);
      if (!record || record.expiresAt <= Math.floor(clock() / 1000))
        throw invalidCode();
      const user = await db.find(email);
      if (
        !eligible(user) ||
        user.id !== record.userId ||
        !(await codes.consume(
          key,
          record.id,
          codeHash(user, key, record.id, code),
        ))
      )
        throw invalidCode();
      const resetToken = randomBytes(32).toString("base64url");
      await grants.issue(resetToken, {
        userId: user.id,
        emailKey: key,
        credentialHash: passwordFingerprint("credential", user.passwordHash),
        expiresAt: Math.floor(clock() / 1000) + RESET_TOKEN_TTL_SECONDS,
      });
      return { resetToken, expiresIn: RESET_TOKEN_TTL_SECONDS };
    },
    async reset(resetToken: string, newPassword: string): Promise<void> {
      const grant = await grants.consume(resetToken);
      if (!grant || grant.expiresAt <= Math.floor(clock() / 1000))
        throw invalidGrant();
      await db.replace(
        grant.userId,
        async (user) => {
          if (
            !eligible(user) ||
            emailKey(user.email) !== grant.emailKey ||
            passwordFingerprint("credential", user.passwordHash) !==
              grant.credentialHash
          )
            throw invalidGrant();
          return newHash(newPassword, user.passwordHash);
        },
        false,
      );
    },
    // This read-only step gates the form; change() still verifies again under the row lock.
    async verifyCurrent(
      user: SessionUser,
      currentPassword: string,
    ): Promise<void> {
      const wait = await grants.limitChange(
        passwordFingerprint("change", user.id),
      );
      if (wait > 0) throw new PasswordRateLimitError(wait);
      const current = await db.find(user.email);
      if (!eligible(current) || current.id !== user.id)
        throw new HttpError(403, "Không thể xác minh tài khoản hiện tại");
      if (!(await bcrypt.compare(currentPassword, current.passwordHash)))
        throw new HttpError(400, "Mật khẩu hiện tại không đúng");
    },
    async change(
      user: SessionUser,
      currentPassword: string,
      newPassword: string,
    ): Promise<void> {
      const wait = await grants.limitChange(
        passwordFingerprint("change", user.id),
      );
      if (wait > 0) throw new PasswordRateLimitError(wait);
      await db.replace(
        user.id,
        async (current) => {
          if (!eligible(current))
            throw new HttpError(
              403,
              "Tài khoản đã bị khóa hoặc ngừng hoạt động",
            );
          if (!(await bcrypt.compare(currentPassword, current.passwordHash)))
            throw new HttpError(400, "Mật khẩu hiện tại không đúng");
          return newHash(newPassword, current.passwordHash);
        },
        true,
      );
    },
  };
}
export const passwordService = createPasswordService();
export type PasswordService = ReturnType<typeof createPasswordService>;
