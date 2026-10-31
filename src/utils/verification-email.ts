import { Resend } from "resend";
import { readEmailConfig } from "../config/email";
import { HttpError } from "./http-error";

export interface VerificationMailer {
  assertConfigured(): void;
  send(email: string, code: string, challengeId: string): Promise<void>;
}
export const verificationMailer: VerificationMailer = {
  assertConfigured() {
    readEmailConfig();
  },
  async send(email, code, challengeId) {
    const config = readEmailConfig();
    try {
      const { data, error } = await new Resend(config.apiKey).emails.send(
        {
          from: config.from,
          to: [email],
          subject: "Mã xác minh email FoodPrint",
          text: `Mã xác minh email FoodPrint của bạn là: ${code}\n\nMã có hiệu lực 10 phút và chỉ dùng một lần. Không chia sẻ mã với người khác.\nNếu bạn không đăng ký tài khoản FoodPrint, hãy bỏ qua email này.`,
        },
        {
          idempotencyKey: `email-verification/${challengeId}`,
          signal: AbortSignal.timeout(10000),
        },
      );
      if (error || !data?.id) throw new Error("Email was not accepted");
    } catch {
      throw new HttpError(
        503,
        "Chưa thể gửi mã xác minh. Vui lòng thử gửi lại sau.",
      );
    }
  },
};
