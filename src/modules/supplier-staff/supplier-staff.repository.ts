import { permissionConcurrencyRepository } from "../permission/permission.repository";
import { HttpError } from "../../utils/http-error";
import type { Prisma, AccountStatus } from "../../generated/prisma/client";
import type { SupplierStaffManagementScope } from "../../utils/resource-access";
import { getPrisma } from "../../utils/database";
import {
  identitySelect,
  principalFromIdentity,
} from "../../utils/authorization";
import { ROLES } from "../../constants/roles";
import { createIntakeAccessRepository } from "../account-lifecycle/intake-access.repository";

import { listWindow, type ListQuery } from "../../utils/list-query";

type Tx = Prisma.TransactionClient;
const parentLocks = createIntakeAccessRepository();

export const staffDetailSelect = {
  id: true,
  username: true,
  fullName: true,
  email: true,
  phone: true,
  roleCode: true,
  roleId: true,
  supplierId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  Role: { select: { code: true, name: true, type: true } },
} as const satisfies Prisma.UserSelect;

export type StaffRow = Prisma.UserGetPayload<{
  select: typeof staffDetailSelect;
}>;

function staffWhere(
  scope: SupplierStaffManagementScope,
): Prisma.UserWhereInput {
  return {
    supplierId: scope.supplierId,
    schoolId: null,
    communeFoodSafetyUnitId: null,
    roleCode: ROLES.INGREDIENT_SUPPLIER_STAFF,
    Role: { code: ROLES.INGREDIENT_SUPPLIER_STAFF, type: "SUPPLIER" },
  };
}

export interface StaffCreateInput {
  username: string;
  fullName: string;
  email: string;
  phone: string | null;
  passwordHash: string;
  roleId: string;
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}
function identityConstraint(value: unknown): boolean {
  if (Array.isArray(value))
    return (
      (value.length === 1 && value[0] === "email") ||
      (value.length === 2 &&
        value.includes("username") &&
        (value.includes("supplier_id") || value.includes("supplierId")))
    );
  return value === "uq_users_supplier_username" || value === "users_email_key";
}
export function supplierStaffWriteError(error: unknown): never {
  const outer = record(error),
    meta = record(outer?.meta),
    cause = record(record(meta?.driverAdapterError)?.cause),
    constraint = record(cause?.constraint);
  const unique =
    outer?.code === "P2002" ||
    outer?.code === "23505" ||
    cause?.code === "23505" ||
    cause?.originalCode === "23505";
  if (
    unique &&
    [
      meta?.target,
      outer?.constraint,
      cause?.constraint,
      constraint?.name,
      constraint?.index,
      constraint?.fields,
    ].some(identityConstraint)
  )
    throw new HttpError(409, "Tên đăng nhập hoặc email đã được sử dụng");
  throw error;
}

export function createSupplierStaffRepository(connect = getPrisma) {
  return {
    async list(scope: SupplierStaffManagementScope, query: ListQuery) {
      return (await connect()).user.findMany({
        where: staffWhere(scope),
        select: staffDetailSelect,
        ...listWindow(query),
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      });
    },
    async permissionState(
      scope: SupplierStaffManagementScope,
      userId: string,
      roleId: string,
      tx: Tx,
    ) {
      const grants = await tx.rolePermission.findMany({
        where: { roleId },
        select: {
          permission: {
            select: {
              id: true,
              code: true,
              name: true,
              module: true,
              action: true,
              description: true,
              isActive: true,
            },
          },
        },
        orderBy: { permission: { code: "asc" } },
      });
      const denials = await tx.userPermissionDenial.findMany({
        where: {
          userId,
          supplierId: scope.supplierId,
          schoolId: null,
          communeFoodSafetyUnitId: null,
          user: staffWhere(scope),
        },
        select: { permissionId: true },
      });
      return { grants, denials };
    },
    async findActiveRoleGrant(
      scope: SupplierStaffManagementScope,
      userId: string,
      roleId: string,
      permissionId: string,
      tx: Tx,
    ) {
      const target = await tx.user.findFirst({
        where: { ...staffWhere(scope), id: userId, roleId },
        select: { id: true },
      });
      if (!target) return null;
      return tx.rolePermission.findFirst({
        where: { roleId, permissionId, permission: { isActive: true } },
        select: { permissionId: true },
      });
    },
    async disablePermission(
      scope: SupplierStaffManagementScope,
      userId: string,
      permissionId: string,
      actorId: string,
      tx: Tx,
    ) {
      if (!(await this.find(scope, userId, tx))) return { count: 0 };
      const result = await tx.userPermissionDenial.createMany({
        data: [
          {
            userId,
            permissionId,
            supplierId: scope.supplierId,
            schoolId: null,
            communeFoodSafetyUnitId: null,
            disabledByUserId: actorId,
          },
        ],
        skipDuplicates: true,
      });
      if (result.count > 0)
        await permissionConcurrencyRepository.touchUser(tx, userId);
      return result;
    },
    async enablePermission(
      scope: SupplierStaffManagementScope,
      userId: string,
      permissionId: string,
      tx: Tx,
    ) {
      const result = await tx.userPermissionDenial.deleteMany({
        where: {
          userId,
          permissionId,
          supplierId: scope.supplierId,
          schoolId: null,
          communeFoodSafetyUnitId: null,
          user: staffWhere(scope),
        },
      });
      if (result.count > 0)
        await permissionConcurrencyRepository.touchUser(tx, userId);
      return result;
    },
    async setStatus(
      scope: SupplierStaffManagementScope,
      id: string,
      previousStatus: AccountStatus,
      status: "ACTIVE" | "LOCKED",
      tx: Tx,
    ) {
      const result = await tx.user.updateMany({
        where: { ...staffWhere(scope), id, status: previousStatus },
        data: { status },
      });
      return result.count ? this.find(scope, id, tx) : null;
    },
    async duplicateExists(
      scope: SupplierStaffManagementScope,
      username: string,
      email: string,
      tx: Tx,
    ) {
      return Boolean(
        await tx.user.findFirst({
          where: {
            OR: [{ email }, { supplierId: scope.supplierId, username }],
          },
          select: { id: true },
        }),
      );
    },
    async createStaff(
      scope: SupplierStaffManagementScope,
      input: StaffCreateInput,
      tx: Tx,
    ) {
      try {
        return await tx.user.create({
          data: {
            username: input.username,
            fullName: input.fullName,
            email: input.email,
            phone: input.phone,
            passwordHash: input.passwordHash,
            roleId: input.roleId,
            roleCode: ROLES.INGREDIENT_SUPPLIER_STAFF,
            supplierId: scope.supplierId,
            schoolId: null,
            communeFoodSafetyUnitId: null,
            status: "ACTIVE",
            emailVerifiedAt: null,
          },
          select: staffDetailSelect,
        });
      } catch (error) {
        return supplierStaffWriteError(error);
      }
    },
    async actor(id: string, tx: Tx) {
      // Keep query errors intact until authorizationTransaction can retry them.
      // loadPrincipal sanitizes failures eagerly, hiding serialization conflicts.
      return principalFromIdentity(
        await tx.user.findUnique({ where: { id }, select: identitySelect }),
      );
    },
    async staffRole(tx: Tx) {
      return tx.role.findUnique({
        where: { code: ROLES.INGREDIENT_SUPPLIER_STAFF },
        select: { id: true, code: true, type: true },
      });
    },
    async find(scope: SupplierStaffManagementScope, id: string, tx?: Tx) {
      return (tx ?? (await connect())).user.findFirst({
        where: { ...staffWhere(scope), id },
        select: staffDetailSelect,
      });
    },
    async lock(
      scope: SupplierStaffManagementScope,
      actor: { id: string; roleId: string },
      target: { id: string; roleId: string } | null,
      staffRoleId: string | undefined,
      tx: Tx,
    ) {
      await parentLocks.lockParents(tx, { supplierId: scope.supplierId });
      for (const id of [
        ...new Set([actor.id, ...(target ? [target.id] : [])]),
      ].sort()) {
        if (target && id === target.id) {
          await tx.$queryRaw`SELECT u.id FROM foodprint.users u
            JOIN foodprint.roles r ON r.id = u.role_id
            WHERE u.id = ${id}::uuid AND u.supplier_id = ${scope.supplierId}::uuid
              AND u.role_code = 'INGREDIENT_SUPPLIER_STAFF' AND r.code = 'INGREDIENT_SUPPLIER_STAFF'
              AND r.type = 'SUPPLIER' AND u.school_id IS NULL AND u.commune_food_safety_unit_id IS NULL
            FOR UPDATE OF u`;
        } else {
          await parentLocks.lockParents(tx, { userIds: [id] });
        }
      }
      await parentLocks.lockParents(tx, {
        roleIds: [
          actor.roleId,
          ...(target ? [target.roleId] : []),
          ...(staffRoleId ? [staffRoleId] : []),
        ],
      });
    },
  };
}

export type SupplierStaffRepository = ReturnType<
  typeof createSupplierStaffRepository
>;
export const supplierStaffRepository = createSupplierStaffRepository();
