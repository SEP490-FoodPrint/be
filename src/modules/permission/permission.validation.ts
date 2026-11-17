import { z } from "zod";
import { paginationSchema } from "../../utils/directory-validation";
import {
  parseRequest,
  requestUuidSchema,
  requiredText,
} from "../../utils/request-validation";

const part = /^[a-z][a-z0-9_]*$/;
export const permissionCreateSchema = z.strictObject({
  code: requiredText(100).regex(/^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$/, {
    error: "Mã quyền không hợp lệ",
  }),
  name: requiredText(150),
  module: requiredText(80).regex(part, {
    error: "Nhóm chức năng không hợp lệ",
  }),
  action: requiredText(50).regex(part, { error: "Hành động không hợp lệ" }),
  description: requiredText(2000).nullable().default(null),
});
export const rolePermissionsSchema = z
  .strictObject({
    permissionIds: z
      .array(requestUuidSchema, { error: "permissionIds phải là mảng UUID" })
      .max(1000, { error: "Chỉ nhận tối đa 1000 quyền" }),
  })
  .superRefine(({ permissionIds }, context) => {
    const seen = new Set<string>();
    permissionIds.forEach((id, index) => {
      if (seen.has(id))
        context.addIssue({
          code: "custom",
          path: ["permissionIds", index],
          message: "Quyền không được trùng",
        });
      seen.add(id);
    });
  })
  .transform(({ permissionIds }) => permissionIds);
export const roleQuerySchema = paginationSchema;
export const permissionQuerySchema = paginationSchema.safeExtend({
  search: z
    .string({ error: "Từ khóa tìm kiếm phải là văn bản" })
    .trim()
    .max(150, { error: "Từ khóa tìm kiếm tối đa 150 ký tự" })
    .transform((value) => value || undefined)
    .optional(),
});
export const roleParamsSchema = z.strictObject({ roleId: requestUuidSchema });
export const permissionParamsSchema = z.strictObject({
  permissionId: requestUuidSchema,
});
export const userParamsSchema = z.strictObject({ userId: requestUuidSchema });
export const userPermissionParamsSchema = z.strictObject({
  userId: requestUuidSchema,
  permissionId: requestUuidSchema,
});
export const permissionEmptySchema = z.strictObject({});

export const validatePermission = (value: unknown) =>
  parseRequest(permissionCreateSchema, value);
export const validateRolePermissions = (value: unknown) =>
  parseRequest(rolePermissionsSchema, value);
export const validateRoleQuery = (value: unknown) =>
  parseRequest(roleQuerySchema, value);
export const validatePermissionQuery = (value: unknown) =>
  parseRequest(permissionQuerySchema, value);
export const validateRoleParams = (value: unknown) =>
  parseRequest(roleParamsSchema, value);
export const validatePermissionParams = (value: unknown) =>
  parseRequest(permissionParamsSchema, value);
export const validatePermissionUserParams = (value: unknown) =>
  parseRequest(userParamsSchema, value);
export const validateUserPermissionParams = (value: unknown) =>
  parseRequest(userPermissionParamsSchema, value);
export const validatePermissionEmpty = (value: unknown) =>
  parseRequest(permissionEmptySchema, value === undefined ? {} : value);

export const permissionStateSchema = z.strictObject({
  isActive: z.boolean({ error: "Trạng thái quyền phải là boolean" }),
});
export const validatePermissionState = (value: unknown) =>
  parseRequest(permissionStateSchema, value);

export const permissionUpdateSchema = z
  .strictObject({
    name: requiredText(150).optional(),
    description: requiredText(2000).nullable().optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.description !== undefined,
    { error: "Cần có ít nhất một trường để chỉnh sửa" },
  );
export const validatePermissionUpdate = (value: unknown) =>
  parseRequest(permissionUpdateSchema, value);

export const inactivePermissionQuerySchema = z
  .strictObject({
    page: z.string({ error: "page phải là số nguyên dương" }).optional(),
  })
  .transform((query): z.input<typeof paginationSchema> => ({
    ...query,
    limit: "5",
  }))
  .pipe(paginationSchema)
  .transform(({ page }) => ({ page, limit: 5 as const }));
export const validateInactivePermissionQuery = (value: unknown) =>
  parseRequest(inactivePermissionQuerySchema, value);
