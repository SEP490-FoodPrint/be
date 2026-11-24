import { z } from "zod";
import { paginationSchema } from "../../utils/directory-validation";
import { passwordSchema } from "../../utils/password-policy";
import {
  parseRequest,
  requiredText,
  requestUuidSchema,
} from "../../utils/request-validation";

export const supplierStaffQuerySchema = paginationSchema;

export const supplierStaffParamsSchema = z.strictObject({
  userId: requestUuidSchema,
});

export const supplierStaffPermissionParamsSchema = z.strictObject({
  userId: requestUuidSchema,
  permissionId: requestUuidSchema,
});

export const supplierStaffCreateSchema = z.strictObject({
  username: requiredText(120).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,119}$/, {
    error:
      "Tên đăng nhập cần 3–120 ký tự, bắt đầu bằng chữ Latin hoặc số, chỉ gồm chữ Latin, số, dấu gạch dưới, dấu chấm hoặc gạch ngang",
  }),
  fullName: requiredText(255),
  email: requiredText(254)
    .toLowerCase()
    .email({ error: "Email không đúng định dạng" }),
  password: passwordSchema,
  phone: requiredText(30).nullable().default(null),
});

export const supplierStaffStatusSchema = z.strictObject({
  status: z.enum(["ACTIVE", "LOCKED"], {
    error: "Trạng thái tài khoản chỉ nhận ACTIVE hoặc LOCKED",
  }),
});

export const supplierStaffEmptySchema = z.strictObject({});

export const validateSupplierStaffQuery = (value: unknown) =>
  parseRequest(supplierStaffQuerySchema, value);
export const validateSupplierStaffParams = (value: unknown) =>
  parseRequest(supplierStaffParamsSchema, value);
export const validateSupplierStaffPermissionParams = (value: unknown) =>
  parseRequest(supplierStaffPermissionParamsSchema, value);
export const validateSupplierStaffCreate = (value: unknown) =>
  parseRequest(supplierStaffCreateSchema, value);
export const validateSupplierStaffStatus = (value: unknown) =>
  parseRequest(supplierStaffStatusSchema, value);
export const validateSupplierStaffEmpty = (value: unknown) =>
  parseRequest(supplierStaffEmptySchema, value === undefined ? {} : value);
