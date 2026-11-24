import { z } from "zod";
import { paginationSchema } from "../../utils/directory-validation";
import { passwordSchema } from "../../utils/password-policy";
import {
  parseRequest,
  requiredText,
  requestUuidSchema,
} from "../../utils/request-validation";

/** Tạo tài khoản cán bộ ATTP theo phường/xã (specs/authority-officer-accounts FR-002). */
export const authorityOfficerCreateSchema = z.strictObject({
  locationId: requestUuidSchema,
  // Đăng nhập lần đầu dùng định danh đã chuyển chữ thường, nên lưu tên đăng nhập chữ thường.
  username: requiredText(120)
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9_.-]{2,119}$/, {
      error:
        "Tên đăng nhập cần 3–120 ký tự, bắt đầu bằng chữ Latin hoặc số, chỉ gồm chữ Latin, số, dấu gạch dưới, dấu chấm hoặc gạch ngang",
    }),
  password: passwordSchema,
  fullName: requiredText(255),
  phone: requiredText(30).nullable().default(null),
});

/** Danh sách tài khoản ATTP (FR-003). */
export const authorityOfficerListQuerySchema = paginationSchema.safeExtend({
  search: z
    .string({ error: "Từ khóa phải là chuỗi" })
    .trim()
    .max(120, { error: "Từ khóa tối đa 120 ký tự" })
    .transform((value) => value || undefined)
    .optional(),
  status: z
    .enum(["UNVERIFIED", "ACTIVE", "INACTIVE", "LOCKED", "DEACTIVATED"], {
      error: "Trạng thái không hợp lệ",
    })
    .optional(),
  locationId: requestUuidSchema.optional(),
});

export const authorityOfficerParamsSchema = z.strictObject({
  userId: requestUuidSchema,
});

export const validateAuthorityOfficerCreate = (value: unknown) =>
  parseRequest(authorityOfficerCreateSchema, value);
export const validateAuthorityOfficerListQuery = (value: unknown) =>
  parseRequest(authorityOfficerListQuerySchema, value);
export const validateAuthorityOfficerParams = (value: unknown) =>
  parseRequest(authorityOfficerParamsSchema, value);
