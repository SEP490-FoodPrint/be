import { createHmac, randomBytes, randomInt } from "node:crypto";
import { ipKeyGenerator } from "express-rate-limit";
import type { PrismaClient } from "../../generated/prisma/client";
import type { SessionUser } from "../../types/session-user";
import { authSessions, type AuthSessions } from "../../utils/auth-sessions";
import {
  authorizationTransaction,
  databaseOperation,
} from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import {
  emailVerificationStore,
  EMAIL_CODE_TTL_SECONDS,
  type EmailVerificationStore,
} from "../../utils/email-verification-store";
import { HttpError } from "../../utils/http-error";
import { requireJwtSecret } from "../../utils/jwt";
import {
  loadSessionUser,
  requiresEmailSetup,
} from "../../utils/session-identity";
import {
  verificationMailer,
  type VerificationMailer,
} from "../../utils/verification-email";
import {
  EmailVerificationRateLimitError,
  verificationFingerprint,
} from "./email-verification.service";
import {
  emailSetupRepository,
  type EmailSetupRepository,
} from "./email-setup.repository";
import { toSessionUserResponseDTO } from "./session.service";
import type {
  EmailSetupRequestDTO,
  EmailSetupVerifyDTO,
} from "./auth.request.dto";

const notPending = () =>
  new HttpError(
    409,
    "Tài khoản không cần cập nhật email",
    "EMAIL_SETUP_NOT_REQUIRED",
  );
const emailTaken = () =>
  new HttpError(409, "Email đã được sử dụng bởi tài khoản khác", "EMAIL_TAKEN");
const invalidCode = () =>
  new HttpError(
    400,
    "Mã xác minh không hợp lệ, đã hết hạn hoặc đã được sử dụng",
  );

/** Một thử thách OTP cho mỗi tài khoản; mã gắn với email đích nên không dùng được cho email khác. */
const challengeKey = (userId: string) =>
  verificationFingerprint("email-setup:" + userId);
function codeHash(userId: string, email: string, id: string, code: string) {
  return createHmac("sha256", requireJwtSecret())
    .update(
      JSON.stringify(["foodprint:email-setup:code", userId, email, id, code]),
    )
    .digest("hex");
}

export function createEmailSetupService(
  store: EmailVerificationStore = emailVerificationStore,
  mailer: VerificationMailer = verificationMailer,
  repository: EmailSetupRepository = emailSetupRepository,
  sessions: AuthSessions = authSessions,
  connect: () => Promise<PrismaClient> = getPrisma,
  clock: () => number = Date.now,
) {
  return {
    /** FR-005: gửi OTP tới email mới của cán bộ ATTP chưa có email. */
    async request(
      user: SessionUser,
      input: EmailSetupRequestDTO,
      ip = "unknown",
    ): Promise<void> {
      if (!requiresEmailSetup(user)) throw notPending();
      mailer.assertConfigured();
      const key = challengeKey(user.id);
      const id = randomBytes(16).toString("hex");
      const wait = await store.reserve(
        key,
        verificationFingerprint("ip:" + ipKeyGenerator(ip)),
        id,
      );
      if (wait > 0) throw new EmailVerificationRateLimitError(wait);
      if (
        await databaseOperation(async () =>
          repository.emailTaken(await connect(), input.email),
        )
      )
        throw emailTaken();
      const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
      const issued = await store.issue(key, {
        id,
        userId: user.id,
        codeHash: codeHash(user.id, input.email, id, code),
        attempts: 0,
        expiresAt: Math.floor(clock() / 1000) + EMAIL_CODE_TTL_SECONDS,
      });
      if (!issued) throw new EmailVerificationRateLimitError(60);
      try {
        await mailer.send(input.email, code, id);
      } catch (error) {
        try {
          await store.discard(key, id);
        } catch {
          console.error("Could not discard failed email setup challenge");
        }
        if (error instanceof HttpError) throw error;
        throw new HttpError(
          503,
          "Chưa thể gửi mã xác minh. Vui lòng thử gửi lại sau.",
        );
      }
    },
    /**
     * FR-005: kiểm OTP rồi, trong một transaction, ghi email + `email_verified_at` + `ACTIVE`;
     * thu hồi mọi phiên cũ và cấp phiên mới.
     */
    async verify(user: SessionUser, input: EmailSetupVerifyDTO) {
      if (!requiresEmailSetup(user)) throw notPending();
      const key = challengeKey(user.id);
      const record = await store.get(key);
      if (
        !record ||
        record.userId !== user.id ||
        record.expiresAt <= Math.floor(clock() / 1000)
      )
        throw invalidCode();
      if (
        !(await store.consume(
          key,
          record.id,
          codeHash(user.id, input.email, record.id, input.code),
        ))
      )
        throw invalidCode();
      const db = await databaseOperation(() => connect());
      const activated = await authorizationTransaction(db, async (tx) => {
        if (!(await repository.lockPendingOfficer(tx, user.id)))
          throw notPending();
        if (await repository.emailTaken(tx, input.email)) throw emailTaken();
        // Fail closed like a password change: revoke while holding the row lock.
        await sessions.revokeUser(user.id);
        await repository.activate(tx, user.id, input.email);
        return loadSessionUser(user.id, tx);
      });
      const tokens = await sessions.issue(activated.id);
      return { ...tokens, user: toSessionUserResponseDTO(activated) };
    },
  };
}
export const emailSetupService = createEmailSetupService();
export type EmailSetupService = ReturnType<typeof createEmailSetupService>;
