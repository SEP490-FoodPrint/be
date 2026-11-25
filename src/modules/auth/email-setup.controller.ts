import { asyncHandler } from "../../utils/async-handler";
import { setAuthCookies } from "../../utils/auth-cookies";
import {
  EMAIL_CODE_TTL_SECONDS,
  EMAIL_RESEND_SECONDS,
} from "../../utils/email-verification-store";
import { sendSuccess } from "../../utils/response";
import { requireSessionUser } from "../../utils/session-identity";
import { EmailVerificationRateLimitError } from "./email-verification.service";
import {
  emailSetupService,
  type EmailSetupService,
} from "./email-setup.service";
import {
  validateEmailSetupRequest,
  validateEmailSetupVerify,
} from "./email-setup.validation";

export function createEmailSetupController(
  service: EmailSetupService = emailSetupService,
) {
  return {
    request: asyncHandler(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const body = validateEmailSetupRequest(req.body as unknown);
      try {
        await service.request(requireSessionUser(req), body, req.ip);
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
        "Đã gửi mã xác minh tới email. Vui lòng kiểm tra hộp thư và thư rác.",
      );
    }),
    verify: asyncHandler(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const body = validateEmailSetupVerify(req.body as unknown);
      const result = await service.verify(requireSessionUser(req), body);
      setAuthCookies(res, result);
      sendSuccess(
        res,
        { user: result.user, expiresIn: result.accessTtlSeconds },
        "Cập nhật email thành công; từ nay đăng nhập bằng email",
      );
    }),
  };
}
