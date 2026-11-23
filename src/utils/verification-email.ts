import { readEmailConfig } from "../config/email";
import { readEmailLogoUrl, renderLetterEmail } from "./branded-email";
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
        ...renderLetterEmail(
          {
            title: "Mã xác minh email FoodPrint",
            preheader: "Mã có hiệu lực 10 phút và chỉ dùng một lần.",
            greeting: "Kính gửi Quý khách,",
            intro: [
              "Nhập mã dưới đây để xác minh địa chỉ email và tiếp tục đăng ký tài khoản FoodPrint.",
            ],
            code: {
              label: "Mã xác minh",
              value: code,
              note: "Có hiệu lực 10 phút · Chỉ dùng một lần",
            },
            note: "Không chia sẻ mã với người khác. Nếu bạn không đăng ký tài khoản FoodPrint, hãy bỏ qua email này.",
          },
          { logoUrl: readEmailLogoUrl() },
        ),
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
