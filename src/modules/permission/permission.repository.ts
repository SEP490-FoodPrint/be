import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import { getPrisma } from "../../utils/database";
import {
  identitySelect,
  principalFromIdentity,
  type AuthorizationClient,
} from "../../utils/authorization";
import type {
  PermissionCatalogScope,
  PermissionUserScope,
} from "../../utils/resource-access";
import { listWindow, type ListQuery } from "../../utils/list-query";
import { HttpError } from "../../utils/http-error";
import { createIntakeAccessRepository } from "../account-lifecycle/intake-access.repository";

export const permissionSelect = {
  id: true,
  code: true,
  name: true,
  module: true,
  action: true,
  description: true,
  isActive: true,
} as const satisfies Prisma.PermissionSelect;
export type PermissionRow = Prisma.PermissionGetPayload<{
  select: typeof permissionSelect;
}>;
const roleSelect = {
  id: true,
  code: true,
  name: true,
  type: true,
  rolePermissions: {
    select: { permission: { select: permissionSelect } },
    orderBy: { permission: { code: "asc" } },
  },
} as const satisfies Prisma.RoleSelect;
export type PermissionRoleRow = Prisma.RoleGetPayload<{
  select: typeof roleSelect;
}>;
interface PermissionListInput extends ListQuery {
  search?: string;
}

type CreateInput = Pick<
  PermissionRow,
  "code" | "name" | "module" | "action" | "description"
>;
function errorRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}
function duplicatePermissionCode(error: unknown): boolean {
  const outer = errorRecord(error),
    meta = errorRecord(outer?.meta);
  const cause =
    errorRecord(errorRecord(meta?.driverAdapterError)?.cause) ??
    errorRecord(outer?.cause);
  const constraint = errorRecord(cause?.constraint);
  const unique =
    outer?.code === "P2002" ||
    outer?.code === "23505" ||
    cause?.code === "23505" ||
    cause?.originalCode === "23505";
  return (
    unique &&
    [
      meta?.target,
      outer?.constraint,
      cause?.constraint,
      constraint?.name,
      constraint?.index,
      constraint?.fields,
    ].some(
      (value) =>
        value === "permissions_code_key" ||
        (Array.isArray(value) && value.length === 1 && value[0] === "code"),
    )
  );
}

function catalogWhere(scope: PermissionCatalogScope) {
  if (scope.kind !== "SYSTEM")
    throw new HttpError(403, "Không có phạm vi quản trị hệ thống");
  return {};
}
function userWhere(scope: PermissionUserScope): Prisma.UserWhereInput {
  return scope.kind === "SYSTEM"
    ? {}
    : {
        schoolId: scope.schoolId,
        supplierId: scope.supplierId,
        communeFoodSafetyUnitId: scope.communeFoodSafetyUnitId,
      };
}
const parents = createIntakeAccessRepository();
export const permissionConcurrencyRepository = {
  async touchUser(tx: AuthorizationClient, userId: string) {
    await tx.user.update({
      where: { id: userId },
      data: { updatedAt: new Date() },
      select: { id: true },
    });
  },
  async touchRole(tx: AuthorizationClient, roleId: string) {
    await tx.$executeRaw`UPDATE foodprint.roles SET name = name WHERE id = ${roleId}::uuid`;
  },
};
export function createPermissionRepository(
  connect: () => Promise<PrismaClient> = getPrisma,
) {
  async function lockPermissions(
    tx: AuthorizationClient,
    guard: string,
    ids: readonly string[],
    updateId?: string,
  ) {
    const guards = await tx.permission.findMany({
      where: { code: guard },
      select: { id: true },
    });
    for (const id of [
      ...new Set([...ids, ...guards.map((row) => row.id)]),
    ].sort()) {
      if (id === updateId)
        await tx.$queryRaw`SELECT id FROM foodprint.permissions WHERE id = ${id}::uuid FOR UPDATE`;
      else
        await tx.$queryRaw`SELECT id FROM foodprint.permissions WHERE id = ${id}::uuid FOR SHARE`;
    }
  }
  return {
    async actor(tx: AuthorizationClient, id: string) {
      return principalFromIdentity(
        await tx.user.findUnique({ where: { id }, select: identitySelect }),
      );
    },
    async list(scope: PermissionCatalogScope, query: PermissionListInput) {
      return (await connect()).permission.findMany({
        where: {
          ...catalogWhere(scope),
          ...(query.search
            ? {
                name: {
                  contains: query.search.replace(/[\\%_]/g, "\\$&"),
                  mode: "insensitive" as const,
                },
              }
            : {}),
        },
        ...listWindow(query),
        orderBy: [{ code: "asc" }, { id: "asc" }],
        select: permissionSelect,
      });
    },
    async listInactive(scope: PermissionCatalogScope, query: ListQuery) {
      return (await connect()).permission.findMany({
        where: { ...catalogWhere(scope), isActive: false },
        ...listWindow(query),
        orderBy: [{ code: "asc" }, { id: "asc" }],
        select: permissionSelect,
      });
    },
    async listRoles(scope: PermissionCatalogScope, query: ListQuery) {
      return (await connect()).role.findMany({
        where: catalogWhere(scope),
        ...listWindow(query),
        orderBy: [{ code: "asc" }, { id: "asc" }],
        select: { id: true, code: true, name: true, type: true },
      });
    },
    async role(
      scope: PermissionCatalogScope,
      id: string,
      tx?: AuthorizationClient,
    ) {
      return (tx ?? (await connect())).role.findFirst({
        where: { ...catalogWhere(scope), id },
        select: roleSelect,
      });
    },
    async permissions(
      scope: PermissionCatalogScope,
      ids: readonly string[],
      tx: AuthorizationClient,
    ) {
      return tx.permission.findMany({
        where: { ...catalogWhere(scope), id: { in: [...ids] } },
        select: permissionSelect,
      });
    },
    async create(
      scope: PermissionCatalogScope,
      input: CreateInput,
      tx: AuthorizationClient,
    ) {
      catalogWhere(scope);
      try {
        return await tx.permission.create({
          data: input,
          select: permissionSelect,
        });
      } catch (error) {
        if (duplicatePermissionCode(error))
          throw new HttpError(409, "Permission đã tồn tại");
        throw error;
      }
    },
    async updateMetadata(
      scope: PermissionCatalogScope,
      id: string,
      input: { name?: string; description?: string | null },
      tx: AuthorizationClient,
    ) {
      return tx.permission.update({
        where: { ...catalogWhere(scope), id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
        },
        select: permissionSelect,
      });
    },
    async updateState(
      scope: PermissionCatalogScope,
      id: string,
      isActive: boolean,
      tx: AuthorizationClient,
    ) {
      return tx.permission.update({
        where: { ...catalogWhere(scope), id },
        data: { isActive },
        select: permissionSelect,
      });
    },
    async replaceGrants(
      scope: PermissionCatalogScope,
      roleId: string,
      ids: readonly string[],
      current: readonly string[],
      tx: AuthorizationClient,
    ) {
      catalogWhere(scope);
      const wanted = new Set(ids),
        existing = new Set(current);
      const removed = current.filter((id) => !wanted.has(id));
      const added = ids.filter((id) => !existing.has(id));
      if (removed.length)
        await tx.rolePermission.deleteMany({
          where: { roleId, permissionId: { in: removed } },
        });
      if (added.length)
        await tx.rolePermission.createMany({
          data: added.map((permissionId) => ({ roleId, permissionId })),
        });
      if (removed.length || added.length)
        await permissionConcurrencyRepository.touchRole(tx, roleId);
    },
    async lockSystem(
      tx: AuthorizationClient,
      actor: AuthPrincipal,
      guard: string,
      options: {
        roleId?: string;
        permissionId?: string;
        permissionIds?: readonly string[];
      } = {},
    ) {
      await tx.$queryRaw`SELECT id FROM foodprint.users WHERE id = ${actor.id}::uuid FOR UPDATE`;
      for (const id of [
        ...new Set([actor.roleId, ...(options.roleId ? [options.roleId] : [])]),
      ].sort()) {
        if (id === options.roleId)
          await tx.$queryRaw`SELECT id FROM foodprint.roles WHERE id = ${id}::uuid FOR UPDATE`;
        else
          await tx.$queryRaw`SELECT id FROM foodprint.roles WHERE id = ${id}::uuid FOR SHARE`;
      }
      const current = options.roleId
        ? await tx.rolePermission.findMany({
            where: { roleId: options.roleId },
            select: { permissionId: true },
          })
        : [];
      await lockPermissions(
        tx,
        guard,
        [
          ...(options.permissionIds ?? []),
          ...current.map((row) => row.permissionId),
          ...(options.permissionId ? [options.permissionId] : []),
        ],
        options.permissionId,
      );
    },
    async target(
      scope: PermissionUserScope,
      id: string,
      tx: AuthorizationClient,
    ) {
      const row = await tx.user.findFirst({
        where: { ...userWhere(scope), id },
        select: identitySelect,
      });
      if (!row)
        throw new HttpError(
          404,
          "Không tìm thấy tài khoản trong phạm vi được phép",
        );
      return principalFromIdentity(row);
    },
    async grants(roleId: string, tx: AuthorizationClient) {
      return tx.rolePermission.findMany({
        where: { roleId },
        select: { permission: { select: permissionSelect } },
        orderBy: { permission: { code: "asc" } },
      });
    },
    async lockTenant(
      tx: AuthorizationClient,
      actor: AuthPrincipal,
      target: AuthPrincipal,
      permissionId: string,
      guard: string,
    ) {
      await parents.lockParents(tx, {
        ...(actor.schoolId ? { schoolId: actor.schoolId } : {}),
        ...(actor.supplierId ? { supplierId: actor.supplierId } : {}),
        userIds: [actor.id, target.id],
        roleIds: [actor.roleId, target.roleId],
      });
      await lockPermissions(tx, guard, [permissionId]);
    },
    async toggle(
      scope: PermissionUserScope,
      targetId: string,
      permissionId: string,
      actorId: string,
      disabled: boolean,
      tx: AuthorizationClient,
    ) {
      if (scope.kind !== "ORGANIZATION")
        throw new HttpError(403, "Không có phạm vi quản trị tổ chức");
      const where = {
        userId: targetId,
        permissionId,
        schoolId: scope.schoolId,
        supplierId: scope.supplierId,
        communeFoodSafetyUnitId: scope.communeFoodSafetyUnitId,
      };
      const result = disabled
        ? await tx.userPermissionDenial.createMany({
            data: [{ ...where, disabledByUserId: actorId }],
            skipDuplicates: true,
          })
        : await tx.userPermissionDenial.deleteMany({ where });
      if (result.count)
        await permissionConcurrencyRepository.touchUser(tx, targetId);
    },
  };
}
export type PermissionRepository = ReturnType<
  typeof createPermissionRepository
>;
