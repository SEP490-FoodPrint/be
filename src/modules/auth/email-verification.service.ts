import { createHmac, randomBytes, randomInt } from "node:crypto";
import { ipKeyGenerator } from "express-rate-limit";
import { ROLES } from "../../constants/roles";
import { getPrisma } from "../../utils/database";
import { databaseOperation } from "../../utils/authorization";
import { HttpError } from "../../utils/http-error";
import { requireJwtSecret } from "../../utils/jwt";
import {
  verificationMailer,
  type VerificationMailer,
} from "../../utils/verification-email";
import {
  emailVerificationStore,
  EMAIL_CODE_TTL_SECONDS,
  type EmailVerificationStore,
} from "../../utils/email-verification-store";

export interface VerificationAccount {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  status: string;
  roleCode: string;
}
export interface EmailVerificationRepository {
  find(email: string): Promise<VerificationAccount | null>;
  markVerified(id: string, email: string): Promise<boolean>;
}
const applicantRoles = [
  ROLES.SCHOOL_ADMINISTRATION,
  ROLES.INGREDIENT_SUPPLIER_ADMIN,
];
const repository: EmailVerificationRepository = {
  async find(email) {
    return databaseOperation(async () =>
      (await getPrisma()).user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          emailVerifiedAt: true,
          status: true,
          roleCode: true,
        },
      }),
    );
  },
  async markVerified(id, email) {
    return databaseOperation(async () => {
      const result = await (
        await getPrisma()
      ).user.updateMany({
        where: {
          id,
          email,
          emailVerifiedAt: null,
          status: "UNVERIFIED",
          roleCode: { in: applicantRoles },
        },
        data: { emailVerifiedAt: new Date() },
      });
      return result.count === 1;
    });
  },
};
export class EmailVerificationRateLimitError extends HttpError {
  constructor(readonly retryAfterSeconds: number) {
    super(429, "Bạn đã yêu cầu quá nhiều mã xác minh. Vui lòng thử lại sau.");
  }
}
export function verificationFingerprint(value: string): string {
  return createHmac("sha256", requireJwtSecret())
    .update("foodprint:email-verification:key:" + value)
    .digest("hex");
}
function codeHash(
  userId: string,
  emailKey: string,
  id: string,
  code: string,
): string {
  return createHmac("sha256", requireJwtSecret())
    .update(
      JSON.stringify([
        "foodprint:email-verification:code",
        userId,
        emailKey,
        id,
        code,
      ]),
    )
    .digest("hex");
}
function eligible(
  user: VerificationAccount | null,
): user is VerificationAccount {
  return Boolean(
    user &&
    user.status === "UNVERIFIED" &&
    !user.emailVerifiedAt &&
    applicantRoles.some((role) => role === user.roleCode),
  );
}
const invalidCode = () =>
  new HttpError(
    400,
    "Mã xác minh không hợp lệ, đã hết hạn hoặc đã được sử dụng",
  );

export function createEmailVerificationService(
  store: EmailVerificationStore = emailVerificationStore,
  mailer: VerificationMailer = verificationMailer,
  db: EmailVerificationRepository = repository,
  clock: () => number = Date.now,
) {
  return {
    async request(email: string, ip = "unknown"): Promise<boolean> {
      mailer.assertConfigured();
      const emailKey = verificationFingerprint("email:" + email);
      const id = randomBytes(16).toString("hex");
      const wait = await store.reserve(
        emailKey,
        verificationFingerprint("ip:" + ipKeyGenerator(ip)),
        id,
      );
      if (wait > 0) throw new EmailVerificationRateLimitError(wait);
      const user = await db.find(email);
      // Always reserve limits, even for unknown, verified or ineligible accounts.
      if (!eligible(user)) return false;
      const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
      const record = {
        id,
        userId: user.id,
        codeHash: codeHash(user.id, emailKey, id, code),
        attempts: 0,
        expiresAt: Math.floor(clock() / 1000) + EMAIL_CODE_TTL_SECONDS,
      };
      if (!(await store.issue(emailKey, record)))
        throw new EmailVerificationRateLimitError(60);
      try {
        await mailer.send(user.email, code, id);
      } catch (error) {
        try {
          await store.discard(emailKey, id);
        } catch {
          console.error(
            "Could not discard failed email verification challenge",
          );
        }
        if (error instanceof HttpError) throw error;
        throw new HttpError(
          503,
          "Chưa thể gửi mã xác minh. Vui lòng thử gửi lại sau.",
        );
      }
      return true;
    },
    async verify(email: string, code: string): Promise<void> {
      const emailKey = verificationFingerprint("email:" + email);
      const record = await store.get(emailKey);
      if (!record || record.expiresAt <= Math.floor(clock() / 1000))
        throw invalidCode();
      if (
        !(await store.consume(
          emailKey,
          record.id,
          codeHash(record.userId, emailKey, record.id, code),
        ))
      )
        throw invalidCode();
      // Consume once before touching PostgreSQL; a DB failure requires a new email code.
      if (!(await db.markVerified(record.userId, email))) throw invalidCode();
    },
  };
}
export const emailVerificationService = createEmailVerificationService();
export type EmailVerificationService = ReturnType<
  typeof createEmailVerificationService
>;
