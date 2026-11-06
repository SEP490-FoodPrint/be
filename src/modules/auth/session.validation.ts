import { z } from "zod";
import { parseRequest, requiredText } from "../../utils/request-validation";
export const loginSchema = z.strictObject({
  identifier: requiredText(320),
  password: z
    .string({ error: "Mật khẩu phải có từ 1 đến 72 byte UTF-8" })
    .refine(
      (value) => value.length > 0 && Buffer.byteLength(value, "utf8") <= 72,
      { error: "Mật khẩu phải có từ 1 đến 72 byte UTF-8" },
    ),
});
export function validateLogin(value: unknown) {
  return parseRequest(loginSchema, value);
}
