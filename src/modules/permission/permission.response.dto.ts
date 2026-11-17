export interface PermissionResponse {
  id: string;
  code: string;
  name: string;
  module: string;
  action: string;
  description: string | null;
  isActive: boolean;
}
export interface RoleSummaryResponse {
  id: string;
  code: string;
  name: string;
  type: string;
  editable: boolean;
}
export interface RolePermissionsResponse extends RoleSummaryResponse {
  permissions: PermissionResponse[];
}
export interface ReplaceRolePermissionsResponse {
  roleId: string;
  permissionIds: string[];
}
export interface PermissionPageResponse<T> {
  items: T[];
  pagination: { page: number; limit: number; hasNext: boolean };
}
export interface UserPermissionsResponse {
  userId: string;
  roleId: string;
  permissions: (PermissionResponse & { enabled: boolean })[];
}
