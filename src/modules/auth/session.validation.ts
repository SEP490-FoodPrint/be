import { z } from "zod";
import { parseRequest, requiredText } from "../../utils/request-validation";
export const loginSchema = z.strictObject({
  identifier: requiredText(320).toLowerCase(),
  password: z
    .string({ error: "Nhập mật khẩu hợp lệ." })
    .refine(
      (value) => value.length > 0 && Buffer.byteLength(value, "utf8") <= 72,
      { error: "Nhập mật khẩu hợp lệ." },
    ),
});
export function validateLogin(value: unknown) {
  return parseRequest(loginSchema, value);
}
