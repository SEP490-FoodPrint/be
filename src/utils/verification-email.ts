import { readEmailConfig } from "../config/email";
import { HttpError } from "./http-error";
import { sendMail } from "./mailer";

export interface VerificationMailer {
  assertConfigured(): void;
  send(email: string, code: string, challengeId: string): Promise<void>;
}
export const verificationMailer: VerificationMailer = {
  assertConfigured() {
    readEmailConfig();
  },
  async send(email, code, challengeId) {
    readEmailConfig();
    try {
      await sendMail({
        to: email,
        subject: "Mã xác minh email FoodPrint",
        text: `Mã xác minh email FoodPrint của bạn là: ${code}\n\nMã có hiệu lực 10 phút và chỉ dùng một lần. Không chia sẻ mã với người khác.\nNếu bạn không đăng ký tài khoản FoodPrint, hãy bỏ qua email này.`,
        idempotencyKey: `email-verification/${challengeId}`,
      });
    } catch {
      throw new HttpError(
        503,
        "Chưa thể gửi mã xác minh. Vui lòng thử gửi lại sau.",
      );
    }
  },
};
