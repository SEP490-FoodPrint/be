import { z } from "zod";
import { paginationSchema, parse } from "../../utils/directory-validation";

export const userListQuerySchema = paginationSchema;

export const userSchoolParamsSchema = z.strictObject({
  schoolId: z.string().uuid({ error: "ID trường học không hợp lệ" }),
});

export const userSchoolUserParamsSchema = z.strictObject({
  schoolId: z.string().uuid({ error: "ID trường học không hợp lệ" }),
  userId: z.string().uuid({ error: "ID người dùng không hợp lệ" }),
});

export const createSchoolAccountBodySchema = z.strictObject({
  fullName: z
    .string({ error: "Họ và tên là bắt buộc" })
    .trim()
    .min(2, "Họ và tên tối thiểu 2 ký tự")
    .max(255, "Họ và tên tối đa 255 ký tự"),
  email: z
    .string({ error: "Email là bắt buộc" })
    .trim()
    .email("Email không hợp lệ"),
  phone: z
    .string()
    .trim()
    .max(30, "Số điện thoại tối đa 30 ký tự")
    .optional()
    .nullable(),
  roleCode: z
    .string({ error: "Vai trò là bắt buộc" })
    .trim()
    .min(1, "Vui lòng chọn vai trò"),
  username: z
    .string()
    .trim()
    .min(3, "Tên đăng nhập tối thiểu 3 ký tự")
    .max(120, "Tên đăng nhập tối đa 120 ký tự")
    .optional(),
  password: z
    .string()
    .min(6, "Mật khẩu tối thiểu 6 ký tự")
    .max(72, "Mật khẩu tối đa 72 ký tự")
    .optional(),
});

export const updateSchoolAccountBodySchema = z.strictObject({
  fullName: z
    .string()
    .trim()
    .min(2, "Họ và tên tối thiểu 2 ký tự")
    .max(255, "Họ và tên tối đa 255 ký tự")
    .optional(),
  phone: z
    .string()
    .trim()
    .max(30, "Số điện thoại tối đa 30 ký tự")
    .optional()
    .nullable(),
  roleCode: z.string().trim().min(1, "Vui lòng chọn vai trò").optional(),
});

export const updateAccountStatusBodySchema = z.strictObject({
  status: z.enum(["ACTIVE", "LOCKED", "INACTIVE"], {
    error: "Trạng thái tài khoản không hợp lệ",
  }),
});

export function validateUserListQuery(value: unknown) {
  return parse(userListQuerySchema, value);
}

export function validateUserSchoolParams(value: unknown) {
  return parse(userSchoolParamsSchema, value);
}

export function validateUserSchoolUserParams(value: unknown) {
  return parse(userSchoolUserParamsSchema, value);
}

export function validateCreateSchoolAccountBody(value: unknown) {
  return parse(createSchoolAccountBodySchema, value);
}

export function validateUpdateSchoolAccountBody(value: unknown) {
  return parse(updateSchoolAccountBodySchema, value);
}

export function validateUpdateAccountStatusBody(value: unknown) {
  return parse(updateAccountStatusBodySchema, value);
}
