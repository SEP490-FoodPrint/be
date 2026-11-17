import type { z } from "zod";
import type {
  permissionCreateSchema,
  permissionQuerySchema,
  inactivePermissionQuerySchema,
  roleQuerySchema,
  roleParamsSchema,
  permissionParamsSchema,
  userParamsSchema,
  userPermissionParamsSchema,
  rolePermissionsSchema,
  permissionStateSchema,
  permissionUpdateSchema,
} from "./permission.validation";

export type CreatePermissionRequest = z.infer<typeof permissionCreateSchema>;
export type RoleQueryRequest = z.infer<typeof roleQuerySchema>;
export type PermissionQueryRequest = z.infer<typeof permissionQuerySchema>;
export type RoleParamsRequest = z.infer<typeof roleParamsSchema>;
export type PermissionParamsRequest = z.infer<typeof permissionParamsSchema>;
export type PermissionUserParamsRequest = z.infer<typeof userParamsSchema>;
export type UserPermissionParamsRequest = z.infer<
  typeof userPermissionParamsSchema
>;
export type RolePermissionsRequest = z.infer<typeof rolePermissionsSchema>;

export type PermissionStateRequest = z.infer<typeof permissionStateSchema>;

export type PermissionUpdateRequest = z.infer<typeof permissionUpdateSchema>;

export type InactivePermissionQueryRequest = z.infer<
  typeof inactivePermissionQuerySchema
>;
