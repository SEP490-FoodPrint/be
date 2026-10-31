import { objectBody, text } from "../../utils/auth-validation";
import { HttpError } from "../../utils/http-error";
export function validateLogin(value: unknown) {
  const body = objectBody(value, ["identifier", "password"]);
  if (
    typeof body.password !== "string" ||
    !body.password ||
    Buffer.byteLength(body.password, "utf8") > 72
  )
    throw new HttpError(400, "Mật khẩu phải có từ 1 đến 72 byte UTF-8");
  return { identifier: text(body.identifier, 320), password: body.password };
}
