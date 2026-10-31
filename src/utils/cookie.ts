import type { Request } from "express";

/**
 * Trích xuất giá trị cookie an toàn kiểu (type-safe) từ Express Request.
 * Xử lý an toàn các trường hợp cookie-parser chưa chạy, cookie không tồn tại,
 * hoặc giá trị cookie bị làm sai lệch định dạng ở runtime.
 */
export function getCookie(req: Request, name: string): string | undefined {
  const rawCookies = req.cookies as unknown;
  if (!rawCookies || typeof rawCookies !== "object") {
    return undefined;
  }

  if (name in rawCookies) {
    const value = (rawCookies as Record<string, unknown>)[name];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}
