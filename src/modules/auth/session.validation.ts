import { objectBody, text } from "../../utils/auth-validation";
import { HttpError } from "../../utils/http-error";

export function validateLogin(value: unknown) {
  const body = objectBody(value, ["identifier", "username", "password"]);
  if (
    typeof body.password !== "string" ||
    !body.password ||
    Buffer.byteLength(body.password, "utf8") > 72
  )
    throw new HttpError(400, "Mật khẩu phải có từ 1 đến 72 byte UTF-8");

  const idValue = body.identifier ?? body.username;
  return { identifier: text(idValue, 320), password: body.password };
}

export function validateRefreshToken(value: unknown): { refreshToken: string } {
  const body = objectBody(value, ["refreshToken"]);
  return { refreshToken: text(body.refreshToken, 1000) };
}
