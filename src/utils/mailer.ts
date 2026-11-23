import { Resend, type CreateEmailOptions } from "resend";
import { readEmailConfig } from "../config/email";
import {
  EMAIL_LOGO_CID,
  EMAIL_LOGO_FILENAME,
  EMAIL_LOGO_PNG_BASE64,
} from "./email-logo";
import { HttpError } from "./http-error";

export type MailOptions = {
  to: string | readonly string[];
  subject: string;
  idempotencyKey?: string;
} & ({ text: string; html?: string } | { text?: undefined; html: string });

export const MAIL_TIMEOUT_MS = 10_000;
let cached: { apiKey: string; client: Resend } | undefined;

/** Send immediately; code generation, rate limits and templates belong to callers. */
export async function sendMail(options: MailOptions): Promise<{ id: string }> {
  const to = (
    typeof options.to === "string" ? [options.to] : [...options.to]
  ).map((email) => email.trim());
  if (
    !to.length ||
    to.some((email) => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) ||
    !options.subject.trim() ||
    /[\r\n]/.test(options.subject) ||
    (!options.text?.trim() && !options.html?.trim()) ||
    (options.idempotencyKey !== undefined &&
      (!options.idempotencyKey.trim() || /[\r\n]/.test(options.idempotencyKey)))
  )
    throw new HttpError(
      400,
      "Người nhận, tiêu đề hoặc nội dung email không hợp lệ",
    );

  const config = readEmailConfig();
  try {
    if (!cached || cached.apiKey !== config.apiKey)
      cached = { apiKey: config.apiKey, client: new Resend(config.apiKey) };
    // HTML thương hiệu tham chiếu logo bằng `cid:`; đính kèm inline đúng ảnh đó (không cần host ảnh).
    const attachments = options.html?.includes(`cid:${EMAIL_LOGO_CID}`)
      ? [
          {
            filename: EMAIL_LOGO_FILENAME,
            // Chuỗi base64 (Buffer sẽ bị JSON hóa thành {type, data}).
            content: EMAIL_LOGO_PNG_BASE64,
            contentType: "image/png",
            contentId: EMAIL_LOGO_CID,
          },
        ]
      : undefined;
    const base = {
      from: config.from,
      to,
      subject: options.subject,
      ...(attachments ? { attachments } : {}),
    };
    const message: CreateEmailOptions =
      options.text === undefined
        ? { ...base, html: options.html }
        : { ...base, text: options.text, html: options.html };
    const { data, error } = await cached.client.emails.send(message, {
      signal: AbortSignal.timeout(MAIL_TIMEOUT_MS),
      ...(options.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: options.idempotencyKey }),
    });
    if (error || typeof data?.id !== "string" || !data.id.trim())
      throw new Error("Email was not accepted");
    return { id: data.id };
  } catch {
    // Provider errors can contain addresses, payloads or credentials.
    throw new HttpError(503, "Chưa thể gửi email. Vui lòng thử lại sau.");
  }
}
