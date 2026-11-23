import { readEmailConfig } from "../config/email";
import { readEmailLogoUrl, renderLetterEmail } from "./branded-email";
import type { VerificationMailer } from "./verification-email";
import { HttpError } from "./http-error";
import { sendMail } from "./mailer";

export const passwordResetMailer: VerificationMailer = {
  assertConfigured() {
    readEmailConfig();
  },
  async send(email, code, challengeId) {
    readEmailConfig();
    try {
      await sendMail({
        to: email,
        subject: "Mã đặt lại mật khẩu FoodPrint",
        ...renderLetterEmail(
          {
            title: "Mã đặt lại mật khẩu FoodPrint",
            preheader: "Mã có hiệu lực 10 phút và chỉ dùng một lần.",
            greeting: "Kính gửi Quý khách,",
            intro: [
              "Nhập mã dưới đây để đặt lại mật khẩu tài khoản FoodPrint.",
            ],
            code: {
              label: "Mã đặt lại mật khẩu",
              value: code,
              note: "Có hiệu lực 10 phút · Chỉ dùng một lần",
            },
            note: "Không chia sẻ mã với người khác. Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này; mật khẩu hiện tại vẫn được giữ nguyên.",
          },
          { logoUrl: readEmailLogoUrl() },
        ),
        idempotencyKey: `password-reset/${challengeId}`,
      });
    } catch {
      throw new HttpError(
        503,
        "Chưa thể gửi mã đặt lại mật khẩu. Vui lòng thử lại sau.",
      );
    }
  },
};
