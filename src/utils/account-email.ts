import { HttpError } from "./http-error";

/**
 * Email người nhận thư hệ thống. `users.email` chỉ rỗng với cán bộ ATTP chưa cập nhật email
 * (specs/authority-officer-accounts FR-001), là tài khoản không bao giờ nhận các thư này.
 */
export function requireAccountEmail(email: string | null): string {
  if (!email) throw new HttpError(409, "Tài khoản chưa có email");
  return email;
}
