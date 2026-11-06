import { z } from "zod";
import { parseRequest, requiredText } from "../../utils/request-validation";
export const profileUpdateSchema = z
  .strictObject({
    fullName: requiredText(255).optional(),
    phone: z
      .union([
        z
          .string()
          .trim()
          .max(30, { error: "Điện thoại chỉ nhận tối đa 30 ký tự" }),
        z.null(),
      ])
      .transform((value) => (value === "" ? null : value))
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    error: "Cần cung cấp fullName hoặc phone để cập nhật",
  });
export function validateProfileUpdate(value: unknown) {
  return parseRequest(profileUpdateSchema, value);
}
