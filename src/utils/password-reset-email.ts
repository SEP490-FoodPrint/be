import { readEmailConfig } from "../config/email";
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
        text: `Mã đặt lại mật khẩu FoodPrint của bạn là: ${code}\n\nMã có hiệu lực 10 phút và chỉ dùng một lần. Không chia sẻ mã với người khác.\nNếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này. Mật khẩu hiện tại vẫn được giữ nguyên.`,
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
