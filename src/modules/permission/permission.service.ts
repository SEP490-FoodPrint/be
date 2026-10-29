import type { PrismaClient } from "../../generated/prisma/client";
import { ROLES } from "../../constants/roles";
import type { AuthPrincipal } from "../../types/auth";
import { getPrisma } from "../../utils/database";
import {
  authorizationTransaction,
  databaseOperation,
  loadPrincipal,
  identitySelect,
  principalFromIdentity,
  type AuthorizationClient,
  assertSystemManager,
  assertOrganizationManager,
} from "../../utils/authorization";
import { HttpError } from "../../utils/http-error";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";
import type { validatePermission } from "./permission.validation";
const permissionSelect = {
  id: true,
  code: true,
  name: true,
  module: true,
  action: true,
  description: true,
  isActive: true,
} as const;
function sameOrganization(
  actor: AuthPrincipal,
  target: AuthPrincipal,
): boolean {
  return (
    actor.orgType === target.orgType &&
    actor.schoolId === target.schoolId &&
    actor.supplierId === target.supplierId &&
    actor.communeFoodSafetyUnitId === target.communeFoodSafetyUnitId
  );
}
export function createPermissionService(
  connect: () => Promise<PrismaClient> = getPrisma,
) {
  async function targetPrincipal(
    db: AuthorizationClient,
    userId: string,
    actor: AuthPrincipal,
  ) {
    const scope =
      actor.orgType === "SYSTEM"
        ? {}
        : {
            schoolId: actor.schoolId,
            supplierId: actor.supplierId,
            communeFoodSafetyUnitId: actor.communeFoodSafetyUnitId,
          };
    const row = await db.user.findFirst({
      where: { id: userId, ...scope },
      select: identitySelect,
    });
    if (!row) throw new HttpError(404, "Không tìm thấy tài khoản");
    return principalFromIdentity(row);
  }
  async function detail(
    db: AuthorizationClient,
    actor: AuthPrincipal,
    userId: string,
  ) {
    if (actor.orgType === "SYSTEM") assertSystemManager(actor, "user.manage");
    else assertOrganizationManager(actor);
    const target = await targetPrincipal(db, userId, actor);
    if (actor.orgType !== "SYSTEM" && !sameOrganization(actor, target))
      throw new HttpError(404, "Không tìm thấy tài khoản trong tổ chức");
    const grants = await db.rolePermission.findMany({
      where: { roleId: target.roleId },
      select: { permission: { select: permissionSelect } },
    });
    return {
      userId: target.id,
      roleId: target.roleId,
      permissions: grants.map(({ permission }) => ({
        ...permission,
        enabled: target.permissions.includes(permission.code),
      })),
    };
  }
  return {
    async list(principal: AuthPrincipal, query: ListQuery) {
      assertSystemManager(principal, "permission.view");
      const db = await connect();
      return databaseOperation(() =>
        readListPage(
          () =>
            db.permission.findMany({
              ...listWindow(query),
              orderBy: [{ code: "asc" }],
              select: permissionSelect,
            }),
          query,
        ),
      );
    },
    async create(actorId: string, data: ReturnType<typeof validatePermission>) {
      const db = await connect();
      return authorizationTransaction(db, async (tx) => {
        assertSystemManager(
          await loadPrincipal(actorId, tx),
          "permission.create",
        );
        try {
          return await tx.permission.create({ data, select: permissionSelect });
        } catch (error) {
          if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "P2002"
          )
            throw new HttpError(409, "Permission đã tồn tại");
          throw error;
        }
      });
    },
    async role(principal: AuthPrincipal, roleId: string) {
      assertSystemManager(principal, "role_permission.manage");
      const db = await connect();
      return databaseOperation(async () => {
        const role = await db.role.findUnique({
          where: { id: roleId },
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
            rolePermissions: {
              select: { permission: { select: permissionSelect } },
            },
          },
        });
        if (!role) throw new HttpError(404, "Không tìm thấy role");
        return {
          id: role.id,
          code: role.code,
          name: role.name,
          type: role.type,
          editable: role.code !== ROLES.SYSTEM_ADMIN,
          permissions: role.rolePermissions.map((row) => row.permission),
        };
      });
    },
    async replaceRole(
      actorId: string,
      roleId: string,
      permissionIds: string[],
    ) {
      const db = await connect();
      return authorizationTransaction(db, async (tx) => {
        assertSystemManager(
          await loadPrincipal(actorId, tx),
          "role_permission.manage",
        );
        await tx.$queryRaw`SELECT id FROM foodprint.roles WHERE id = ${roleId}::uuid FOR UPDATE`;
        const role = await tx.role.findUnique({
          where: { id: roleId },
          select: { code: true },
        });
        if (!role) throw new HttpError(404, "Không tìm thấy role");
        if (role.code === ROLES.SYSTEM_ADMIN)
          throw new HttpError(
            403,
            "Không được chỉnh sửa quyền role SYSTEM_ADMIN",
          );
        const count = await tx.permission.count({
          where: { id: { in: permissionIds }, isActive: true },
        });
        if (count !== permissionIds.length)
          throw new HttpError(
            400,
            "Permission không tồn tại hoặc đã ngừng hoạt động",
          );
        await tx.rolePermission.deleteMany({ where: { roleId } });
        if (permissionIds.length)
          await tx.rolePermission.createMany({
            data: permissionIds.map((permissionId) => ({
              roleId,
              permissionId,
            })),
          });
        return { roleId, permissionIds };
      });
    },
    async user(principal: AuthPrincipal, userId: string) {
      const db = await connect();
      return databaseOperation(() => detail(db, principal, userId));
    },
    async toggle(
      actorId: string,
      userId: string,
      permissionId: string,
      disabled: boolean,
    ) {
      const db = await connect();
      return authorizationTransaction(db, async (tx) => {
        const actor = await loadPrincipal(actorId, tx);
        assertOrganizationManager(actor);
        await tx.$queryRaw`SELECT id FROM foodprint.users WHERE id = ${userId}::uuid
          AND school_id IS NOT DISTINCT FROM ${actor.schoolId}::uuid
          AND supplier_id IS NOT DISTINCT FROM ${actor.supplierId}::uuid
          AND commune_food_safety_unit_id IS NOT DISTINCT FROM ${actor.communeFoodSafetyUnitId}::uuid
          FOR UPDATE`;
        const target = await targetPrincipal(tx, userId, actor);
        if (!sameOrganization(actor, target))
          throw new HttpError(404, "Không tìm thấy tài khoản trong tổ chức");
        const grant = await tx.rolePermission.findUnique({
          where: {
            roleId_permissionId: { roleId: target.roleId, permissionId },
          },
          select: { permission: { select: { isActive: true } } },
        });
        if (!grant?.permission.isActive)
          throw new HttpError(
            400,
            "Quyền phải đang hoạt động và thuộc role tài khoản",
          );
        const scope = {
          userId,
          permissionId,
          schoolId: actor.schoolId,
          supplierId: actor.supplierId,
          communeFoodSafetyUnitId: actor.communeFoodSafetyUnitId,
        };
        if (disabled)
          await tx.userPermissionDenial.createMany({
            data: [{ ...scope, disabledByUserId: actor.id }],
            skipDuplicates: true,
          });
        else await tx.userPermissionDenial.deleteMany({ where: scope });
        return detail(tx, actor, userId);
      });
    },
  };
}
export const permissionService = createPermissionService();
export type PermissionService = ReturnType<typeof createPermissionService>;
