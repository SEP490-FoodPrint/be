import "./env";
import { HttpError } from "../utils/http-error";

export function readEmailConfig(source: NodeJS.ProcessEnv = process.env) {
  const apiKey = source.RESEND_API_KEY?.trim();
  const from = source.RESEND_FROM?.trim();
  const address = from?.match(/^[^<>\r\n]*<([^<>\r\n]+)>$/)?.[1] ?? from;
  if (
    !apiKey?.startsWith("re_") ||
    apiKey.includes("replace-") ||
    !from ||
    from.includes("your-verified-domain") ||
    !address ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)
  )
    throw new HttpError(
      503,
      "Chưa cấu hình Resend và địa chỉ gửi email hợp lệ",
    );
  return { apiKey, from };
}
