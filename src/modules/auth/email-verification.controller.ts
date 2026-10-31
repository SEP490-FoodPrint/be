import { asyncHandler } from "../../utils/async-handler";
import { objectBody, text } from "../../utils/auth-validation";
import { HttpError } from "../../utils/http-error";
import { sendSuccess } from "../../utils/response";
import {
  EMAIL_CODE_TTL_SECONDS,
  EMAIL_RESEND_SECONDS,
} from "../../utils/email-verification-store";
import {
  emailVerificationService,
  EmailVerificationRateLimitError,
  type EmailVerificationService,
} from "./email-verification.service";

function emailAddress(value: unknown): string {
  const email = text(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new HttpError(400, "Email không hợp lệ");
  return email;
}
export function createEmailVerificationController(
  service: EmailVerificationService = emailVerificationService,
) {
  return {
    request: asyncHandler(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const body = objectBody(req.body as unknown, ["email"]);
      try {
        await service.request(emailAddress(body.email), req.ip);
      } catch (error) {
        if (error instanceof EmailVerificationRateLimitError)
          res.setHeader("Retry-After", error.retryAfterSeconds);
        throw error;
      }
      sendSuccess(
        res,
        {
          expiresIn: EMAIL_CODE_TTL_SECONDS,
          resendAfter: EMAIL_RESEND_SECONDS,
        },
        "Nếu email thuộc tài khoản cần xác minh, mã đã được gửi. Vui lòng kiểm tra hộp thư và thư rác.",
      );
    }),
    verify: asyncHandler(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const body = objectBody(req.body as unknown, ["email", "code"]);
      if (typeof body.code !== "string" || !/^[0-9]{6}$/.test(body.code))
        throw new HttpError(400, "Mã xác minh phải gồm 6 chữ số");
      await service.verify(emailAddress(body.email), body.code);
      sendSuccess(
        res,
        { emailVerified: true, accountStatus: "UNVERIFIED" },
        "Xác minh email thành công; đăng nhập để hoàn thiện hồ sơ",
      );
    }),
  };
}
