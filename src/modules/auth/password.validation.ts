import { objectBody, text } from "../../utils/auth-validation";
import { HttpError } from "../../utils/http-error";

export function validateNewPassword(value: unknown): string {
  if (
    typeof value !== "string" ||
    [...value].length < 8 ||
    Buffer.byteLength(value, "utf8") > 72 ||
    !/\p{Ll}/u.test(value) ||
    !/\p{Lu}/u.test(value) ||
    !/[0-9]/.test(value) ||
    !/[\p{P}\p{S}]/u.test(value)
  )
    throw new HttpError(
      400,
      "Mật khẩu mới cần ít nhất 8 ký tự, gồm chữ thường, chữ hoa, chữ số và ký tự đặc biệt; tối đa 72 byte UTF-8",
    );
  return value;
}
function emailAddress(value: unknown) {
  const email = text(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new HttpError(400, "Email không hợp lệ");
  return email;
}
export function validateForgotPassword(value: unknown) {
  const body = objectBody(value, ["email"]);
  return { email: emailAddress(body.email) };
}
export function validatePasswordCode(value: unknown) {
  const body = objectBody(value, ["email", "code"]);
  if (typeof body.code !== "string" || !/^[0-9]{6}$/.test(body.code))
    throw new HttpError(400, "Mã xác minh phải gồm 6 chữ số");
  return { email: emailAddress(body.email), code: body.code };
}
export function validateResetPassword(value: unknown) {
  const body = objectBody(value, ["resetToken", "newPassword"]);
  if (
    typeof body.resetToken !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(body.resetToken)
  )
    throw new HttpError(
      400,
      "Phiên đặt lại mật khẩu không hợp lệ hoặc đã hết hạn",
    );
  return {
    resetToken: body.resetToken,
    newPassword: validateNewPassword(body.newPassword),
  };
}
export function validateCurrentPassword(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    Buffer.byteLength(value, "utf8") > 72
  )
    throw new HttpError(
      400,
      "Mật khẩu hiện tại phải có từ 1 đến 72 byte UTF-8",
    );
  return value;
}
export function validateVerifyCurrentPassword(value: unknown) {
  const body = objectBody(value, ["currentPassword"]);
  return { currentPassword: validateCurrentPassword(body.currentPassword) };
}
export function validateChangePassword(value: unknown) {
  const body = objectBody(value, ["currentPassword", "newPassword"]);
  return {
    currentPassword: validateCurrentPassword(body.currentPassword),
    newPassword: validateNewPassword(body.newPassword),
  };
}
