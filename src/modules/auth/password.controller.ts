import { asyncHandler } from "../../utils/async-handler";
import { clearAuthCookies } from "../../utils/auth-cookies";
import { sendSuccess } from "../../utils/response";
import { requireSessionUser } from "../../utils/session-identity";
import {
  EMAIL_CODE_TTL_SECONDS,
  EMAIL_RESEND_SECONDS,
} from "../../utils/email-verification-store";
import {
  passwordService,
  PasswordRateLimitError,
  type PasswordService,
} from "./password.service";
import {
  validateChangePassword,
  validateVerifyCurrentPassword,
  validateForgotPassword,
  validatePasswordCode,
  validateResetPassword,
} from "./password.validation";

export function createPasswordController(
  service: PasswordService = passwordService,
) {
  const handler = (run: Parameters<typeof asyncHandler>[0]) =>
    asyncHandler(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      try {
        await run(req, res);
      } catch (error) {
        if (error instanceof PasswordRateLimitError)
          res.setHeader("Retry-After", error.retryAfterSeconds);
        throw error;
      }
    });
  return {
    request: handler(async (req, res) => {
      const { email } = validateForgotPassword(req.body as unknown);
      await service.request(email, req.ip);
      sendSuccess(
        res,
        {
          expiresIn: EMAIL_CODE_TTL_SECONDS,
          resendAfter: EMAIL_RESEND_SECONDS,
        },
        "Nếu email thuộc tài khoản có thể khôi phục, mã đặt lại mật khẩu đã được gửi. Vui lòng kiểm tra hộp thư và thư rác.",
      );
    }),
    verify: handler(async (req, res) => {
      const { email, code } = validatePasswordCode(req.body as unknown);
      sendSuccess(
        res,
        await service.verify(email, code),
        "Mã hợp lệ; vui lòng nhập mật khẩu mới",
      );
    }),
    reset: handler(async (req, res) => {
      const { resetToken, newPassword } = validateResetPassword(
        req.body as unknown,
      );
      await service.reset(resetToken, newPassword);
      clearAuthCookies(res);
      sendSuccess(
        res,
        null,
        "Đặt lại mật khẩu thành công; vui lòng đăng nhập lại",
      );
    }),
    verifyCurrent: handler(async (req, res) => {
      const { currentPassword } = validateVerifyCurrentPassword(
        req.body as unknown,
      );
      await service.verifyCurrent(requireSessionUser(req), currentPassword);
      sendSuccess(res, { verified: true }, "Mật khẩu hiện tại chính xác");
    }),
    change: handler(async (req, res) => {
      const { currentPassword, newPassword } = validateChangePassword(
        req.body as unknown,
      );
      await service.change(
        requireSessionUser(req),
        currentPassword,
        newPassword,
      );
      clearAuthCookies(res);
      sendSuccess(res, null, "Đổi mật khẩu thành công; vui lòng đăng nhập lại");
    }),
  };
}
