import type { PrismaClient } from "../../generated/prisma/client";
import { ROLES } from "../../constants/roles";
import type { AuthPrincipal } from "../../types/auth";
import { getPrisma } from "../../utils/database";
import {
  authorizationTransaction,
  databaseOperation,
  type AuthorizationClient,
} from "../../utils/authorization";
import {
  permissionCatalogScope,
  permissionUserScope,
} from "../../utils/resource-access";
import { HttpError } from "../../utils/http-error";
import { readListPage } from "../../utils/list-query";
import type {
  CreatePermissionRequest,
  PermissionUpdateRequest,
  PermissionStateRequest,
  PermissionParamsRequest,
  PermissionQueryRequest,
  InactivePermissionQueryRequest,
  RoleQueryRequest,
  RoleParamsRequest,
  PermissionUserParamsRequest,
  UserPermissionParamsRequest,
  RolePermissionsRequest,
} from "./permission.request.dto";
import type {
  PermissionResponse,
  RoleSummaryResponse,
  PermissionPageResponse,
  RolePermissionsResponse,
  UserPermissionsResponse,
  ReplaceRolePermissionsResponse,
} from "./permission.response.dto";
import {
  createPermissionRepository,
  type PermissionRepository,
  type PermissionRow,
} from "./permission.repository";

function permissionDto(row: PermissionRow): PermissionResponse {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    module: row.module,
    action: row.action,
    description: row.description,
    isActive: row.isActive,
  };
}
function sameIdentity(a: AuthPrincipal, b: AuthPrincipal) {
  return (
    a.id === b.id &&
    a.roleId === b.roleId &&
    a.role === b.role &&
    a.orgType === b.orgType &&
    a.schoolId === b.schoolId &&
    a.supplierId === b.supplierId &&
    a.communeFoodSafetyUnitId === b.communeFoodSafetyUnitId
  );
}
function unchanged(a: AuthPrincipal, b: AuthPrincipal) {
  if (!sameIdentity(a, b))
    throw new HttpError(403, "Vai trò hoặc phạm vi tài khoản đã thay đổi");
}
export function createPermissionService(
  connect: () => Promise<PrismaClient> = getPrisma,
  repo: PermissionRepository = createPermissionRepository(connect),
) {
  async function systemWrite<T>(
    principal: AuthPrincipal,
    guard: "permission.create" | "role_permission.manage",
    options: Parameters<PermissionRepository["lockSystem"]>[3],
    operation: (tx: AuthorizationClient) => Promise<T>,
  ) {
    permissionCatalogScope(principal, guard);
    return databaseOperation(async () =>
      authorizationTransaction(await connect(), async (tx) => {
        const before = await repo.actor(tx, principal.id);
        unchanged(principal, before);
        permissionCatalogScope(before, guard);
        await repo.lockSystem(tx, before, guard, options);
        const actor = await repo.actor(tx, principal.id);
        unchanged(before, actor);
        permissionCatalogScope(actor, guard);
        return operation(tx);
      }),
    );
  }
  async function detail(
    tx: AuthorizationClient,
    principal: AuthPrincipal,
    userId: string,
  ): Promise<UserPermissionsResponse> {
    const scope = permissionUserScope(principal);
    const target = await repo.target(scope, userId, tx);
    const grants = await repo.grants(target.roleId, tx);
    return {
      userId: target.id,
      roleId: target.roleId,
      permissions: grants.map(({ permission }) => ({
        ...permissionDto(permission),
        enabled: target.permissions.includes(permission.code),
      })),
    };
  }
  return {
    async listInactive(
      principal: AuthPrincipal,
      query: InactivePermissionQueryRequest,
    ): Promise<PermissionPageResponse<PermissionResponse>> {
      const scope = permissionCatalogScope(principal, "permission.view");
      const page = await readListPage(
        () => repo.listInactive(scope, query),
        query,
      );
      return {
        items: page.items.map(permissionDto),
        pagination: page.pagination,
      };
    },
    async listRoles(
      principal: AuthPrincipal,
      query: RoleQueryRequest,
    ): Promise<PermissionPageResponse<RoleSummaryResponse>> {
      const scope = permissionCatalogScope(principal, "role.view");
      const page = await readListPage(
        () => repo.listRoles(scope, query),
        query,
      );
      return {
        items: page.items.map((row) => ({
          id: row.id,
          code: row.code,
          name: row.name,
          type: row.type,
          editable: row.code !== ROLES.SYSTEM_ADMIN,
        })),
        pagination: page.pagination,
      };
    },
    async list(
      principal: AuthPrincipal,
      query: PermissionQueryRequest,
    ): Promise<PermissionPageResponse<PermissionResponse>> {
      const scope = permissionCatalogScope(principal, "permission.view");
      const page = await readListPage(() => repo.list(scope, query), {
        page: query.page,
        limit: query.limit,
      });
      return {
        items: page.items.map(permissionDto),
        pagination: page.pagination,
      };
    },
    async updatePermission(
      principal: AuthPrincipal,
      permissionId: PermissionParamsRequest["permissionId"],
      data: PermissionUpdateRequest,
    ): Promise<PermissionResponse> {
      const scope = permissionCatalogScope(principal, "role_permission.manage");
      return systemWrite(
        principal,
        "role_permission.manage",
        { permissionId },
        async (tx) => {
          const [row] = await repo.permissions(scope, [permissionId], tx);
          if (!row) throw new HttpError(404, "Không tìm thấy quyền");
          return permissionDto(
            await repo.updateMetadata(scope, permissionId, data, tx),
          );
        },
      );
    },
    async setPermissionState(
      principal: AuthPrincipal,
      permissionId: PermissionParamsRequest["permissionId"],
      data: PermissionStateRequest,
    ): Promise<PermissionResponse> {
      const scope = permissionCatalogScope(principal, "role_permission.manage");
      return systemWrite(
        principal,
        "role_permission.manage",
        { permissionId },
        async (tx) => {
          const [row] = await repo.permissions(scope, [permissionId], tx);
          if (!row) throw new HttpError(404, "Không tìm thấy quyền");
          return permissionDto(
            row.isActive === data.isActive
              ? row
              : await repo.updateState(scope, permissionId, data.isActive, tx),
          );
        },
      );
    },
    async create(
      principal: AuthPrincipal,
      data: CreatePermissionRequest,
    ): Promise<PermissionResponse> {
      const scope = permissionCatalogScope(principal, "permission.create");
      return systemWrite(principal, "permission.create", {}, async (tx) =>
        permissionDto(await repo.create(scope, data, tx)),
      );
    },
    async role(
      principal: AuthPrincipal,
      roleId: RoleParamsRequest["roleId"],
    ): Promise<RolePermissionsResponse> {
      const scope = permissionCatalogScope(principal, "role_permission.manage");
      return databaseOperation(async () => {
        const role = await repo.role(scope, roleId);
        if (!role) throw new HttpError(404, "Không tìm thấy vai trò.");
        return {
          id: role.id,
          code: role.code,
          name: role.name,
          type: role.type,
          editable: role.code !== ROLES.SYSTEM_ADMIN,
          permissions: role.rolePermissions.map((row) =>
            permissionDto(row.permission),
          ),
        };
      });
    },
    async replaceRole(
      principal: AuthPrincipal,
      roleId: RoleParamsRequest["roleId"],
      permissionIds: RolePermissionsRequest,
    ): Promise<ReplaceRolePermissionsResponse> {
      const scope = permissionCatalogScope(principal, "role_permission.manage");
      return systemWrite(
        principal,
        "role_permission.manage",
        { roleId, permissionIds },
        async (tx) => {
          const role = await repo.role(scope, roleId, tx);
          if (!role) throw new HttpError(404, "Không tìm thấy vai trò.");
          if (role.code === ROLES.SYSTEM_ADMIN)
            throw new HttpError(403, "Không được sửa quyền Quản trị hệ thống.");
          const permissions = await repo.permissions(scope, permissionIds, tx);
          const current = role.rolePermissions.map((row) => row.permission.id);
          const existing = new Set(current);
          if (
            permissions.length !== permissionIds.length ||
            permissions.some((p) => !p.isActive && !existing.has(p.id))
          )
            throw new HttpError(400, "Quyền không còn dùng.");
          await repo.replaceGrants(scope, roleId, permissionIds, current, tx);
          return { roleId, permissionIds };
        },
      );
    },
    async user(
      principal: AuthPrincipal,
      userId: PermissionUserParamsRequest["userId"],
    ): Promise<UserPermissionsResponse> {
      permissionUserScope(principal);
      return databaseOperation(async () =>
        detail(await connect(), principal, userId),
      );
    },
    async toggle(
      principal: AuthPrincipal,
      userId: UserPermissionParamsRequest["userId"],
      permissionId: UserPermissionParamsRequest["permissionId"],
      disabled: boolean,
    ): Promise<UserPermissionsResponse> {
      const original = permissionUserScope(principal, true);
      return databaseOperation(async () =>
        authorizationTransaction(await connect(), async (tx) => {
          const before = await repo.actor(tx, principal.id);
          unchanged(principal, before);
          permissionUserScope(before, true);
          const beforeTarget = await repo.target(original, userId, tx);
          const guard =
            before.orgType === "SCHOOL"
              ? "school_user.manage"
              : "supplier_staff.manage";
          await repo.lockTenant(tx, before, beforeTarget, permissionId, guard);
          const actor = await repo.actor(tx, principal.id);
          unchanged(before, actor);
          const scope = permissionUserScope(actor, true);
          const target = await repo.target(scope, userId, tx);
          unchanged(beforeTarget, target);
          const grants = await repo.grants(target.roleId, tx);
          if (
            !grants.some(
              (row) =>
                row.permission.id === permissionId && row.permission.isActive,
            )
          )
            throw new HttpError(400, "Quyền không thuộc vai trò này.");
          await repo.toggle(
            scope,
            target.id,
            permissionId,
            actor.id,
            disabled,
            tx,
          );
          return detail(tx, actor, target.id);
        }),
      );
    },
  };
}
export const permissionService = createPermissionService();
export type PermissionService = ReturnType<typeof createPermissionService>;
