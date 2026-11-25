import { z } from "zod";

/** Chính sách mật khẩu tài khoản do quản trị viên tạo (giống `validateNewPassword`). */
export const passwordSchema = z
  .string({ error: "Mật khẩu phải là văn bản" })
  .refine((value) => [...value].length >= 8, {
    error: "Mật khẩu cần ít nhất 8 ký tự Unicode",
  })
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72, {
    error: "Mật khẩu chỉ nhận tối đa 72 byte UTF-8",
  })
  .refine((value) => /\p{Ll}/u.test(value), {
    error: "Mật khẩu cần có chữ thường",
  })
  .refine((value) => /\p{Lu}/u.test(value), {
    error: "Mật khẩu cần có chữ hoa",
  })
  .refine((value) => /[0-9]/.test(value), {
    error: "Mật khẩu cần có chữ số",
  })
  .refine((value) => /[\p{P}\p{S}]/u.test(value), {
    error: "Mật khẩu cần có dấu câu hoặc ký hiệu",
  });
