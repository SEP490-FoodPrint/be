import type { Request } from "express";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { ORG_TYPES, ROLES } from "../constants/roles";
import type { AuthPrincipal } from "../types/auth";
import { getPrisma } from "./database";
import { HttpError } from "./http-error";
export type AuthorizationClient = Prisma.TransactionClient;
export const identitySelect = {
  id: true,
  username: true,
  fullName: true,
  status: true,
  roleId: true,
  schoolId: true,
  supplierId: true,
  communeFoodSafetyUnitId: true,
  Role: {
    select: {
      code: true,
      type: true,
      rolePermissions: {
        select: { permission: { select: { code: true, isActive: true } } },
      },
    },
  },
  permissionDenials: {
    select: {
      schoolId: true,
      supplierId: true,
      communeFoodSafetyUnitId: true,
      permission: { select: { code: true } },
    },
  },
} as const satisfies Prisma.UserSelect;
type Identity = Prisma.UserGetPayload<{ select: typeof identitySelect }>;
const roleOrganizations: Record<string, string> = {
  [ROLES.SYSTEM_ADMIN]: ORG_TYPES.SYSTEM,
  [ROLES.SCHOOL_ADMINISTRATION]: ORG_TYPES.SCHOOL,
  [ROLES.SCHOOL_MANAGEMENT_BOARD]: ORG_TYPES.SCHOOL,
  [ROLES.SCHOOL_HEALTH_OFFICER]: ORG_TYPES.SCHOOL,
  [ROLES.SCHOOL_KITCHEN_STAFF]: ORG_TYPES.SCHOOL,
  [ROLES.HOMEROOM_TEACHER]: ORG_TYPES.SCHOOL,
  [ROLES.PARENTS_COMMITTEE]: ORG_TYPES.SCHOOL,
  [ROLES.INGREDIENT_MANAGEMENT]: ORG_TYPES.SCHOOL,
  [ROLES.INGREDIENT_SUPPLIER_ADMIN]: ORG_TYPES.SUPPLIER,
  [ROLES.INGREDIENT_SUPPLIER_STAFF]: ORG_TYPES.SUPPLIER,
  [ROLES.COMMUNE_FOOD_SAFETY_OFFICER]: ORG_TYPES.AUTHORITY,
};
export function principalFromIdentity(user: Identity | null): AuthPrincipal {
  if (!user) throw new HttpError(401, "Tài khoản không tồn tại");
  if (user.status !== "ACTIVE")
    throw new HttpError(403, "Tài khoản chưa hoạt động hoặc đã bị khóa");
  const orgType = user.Role.type;
  const memberships = [
    user.schoolId,
    user.supplierId,
    user.communeFoodSafetyUnitId,
  ].filter(Boolean).length;
  if (
    roleOrganizations[user.Role.code] !== orgType ||
    (orgType === "SYSTEM" ? memberships !== 0 : memberships !== 1) ||
    (orgType === "SCHOOL" && !user.schoolId) ||
    (orgType === "SUPPLIER" && !user.supplierId) ||
    (orgType === "AUTHORITY" && !user.communeFoodSafetyUnitId)
  )
    throw new HttpError(403, "Role và tổ chức của tài khoản không hợp lệ");
  const denied = new Set(
    user.permissionDenials
      .filter(
        (row) =>
          row.schoolId === user.schoolId &&
          row.supplierId === user.supplierId &&
          row.communeFoodSafetyUnitId === user.communeFoodSafetyUnitId,
      )
      .map((row) => row.permission.code),
  );
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    roleId: user.roleId,
    role: user.Role.code,
    orgType,
    schoolId: user.schoolId,
    supplierId: user.supplierId,
    communeFoodSafetyUnitId: user.communeFoodSafetyUnitId,
    permissions: [
      ...new Set(
        user.Role.rolePermissions
          .filter(
            (row) =>
              row.permission.isActive && !denied.has(row.permission.code),
          )
          .map((row) => row.permission.code),
      ),
    ].sort(),
  };
}
export async function databaseOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      503,
      "Không thể xử lý phân quyền. Vui lòng thử lại sau.",
    );
  }
}
export async function loadPrincipal(
  id: string,
  client?: AuthorizationClient,
): Promise<AuthPrincipal> {
  return databaseOperation(async () => {
    const db = client ?? (await getPrisma());
    return principalFromIdentity(
      await db.user.findUnique({ where: { id }, select: identitySelect }),
    );
  });
}
export function requirePrincipal(req: Request): AuthPrincipal {
  if (!req.auth) throw new HttpError(401, "Chưa xác thực người dùng");
  return req.auth;
}

/** Serialize school business writes and re-read live identity/permissions inside the transaction. */
export async function withSchoolTransaction<T>(
  db: PrismaClient,
  principal: AuthPrincipal,
  permission: string,
  operation: (
    tx: Prisma.TransactionClient,
    actor: AuthPrincipal,
    schoolId: string,
  ) => Promise<T>,
): Promise<T> {
  assertPermission(principal, permission);
  if (principal.orgType !== "SCHOOL" || !principal.schoolId)
    throw new HttpError(403, "Thao tác yêu cầu phạm vi trường đã xác thực");
  return authorizationTransaction(db, async (tx) => {
    const actor = await loadPrincipal(principal.id, tx);
    assertPermission(actor, permission);
    if (
      actor.orgType !== "SCHOOL" ||
      !actor.schoolId ||
      actor.schoolId !== principal.schoolId
    )
      throw new HttpError(403, "Phạm vi tài khoản đã thay đổi");
    await tx.$queryRaw`SELECT id FROM foodprint.schools WHERE id = ${actor.schoolId}::uuid FOR UPDATE`;
    const school = await tx.school.findUnique({
      where: { id: actor.schoolId },
      select: { status: true },
    });
    if (school?.status !== "ACTIVE")
      throw new HttpError(409, "Trường không còn hoạt động");
    return operation(tx, actor, actor.schoolId);
  });
}

export function assertPermission(
  principal: AuthPrincipal,
  ...codes: string[]
): void {
  if (
    !codes.length ||
    !codes.some((code) => principal.permissions.includes(code))
  )
    throw new HttpError(403, "Bạn không có quyền thực hiện thao tác này");
}
export function assertSystemManager(
  principal: AuthPrincipal,
  code: string,
): void {
  if (
    principal.role !== ROLES.SYSTEM_ADMIN ||
    principal.orgType !== ORG_TYPES.SYSTEM
  )
    throw new HttpError(403, "Chỉ System Admin được thực hiện thao tác này");
  assertPermission(principal, code);
}
export function assertOrganizationManager(principal: AuthPrincipal): void {
  if (
    principal.orgType === ORG_TYPES.SCHOOL &&
    principal.role === ROLES.SCHOOL_ADMINISTRATION
  )
    assertPermission(principal, "school_user.manage");
  else if (
    principal.orgType === ORG_TYPES.SUPPLIER &&
    principal.role === ROLES.INGREDIENT_SUPPLIER_ADMIN
  )
    assertPermission(principal, "supplier_staff.manage");
  else
    throw new HttpError(
      403,
      "Tài khoản không có chức năng quản trị quyền tổ chức",
    );
}
function transactionConflict(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  if (error.code === "P2034") return true;
  if (error.code !== "P2010" || !("meta" in error)) return false;
  const meta: unknown = error.meta;
  if (
    meta &&
    typeof meta === "object" &&
    "code" in meta &&
    (meta.code === "40001" || meta.code === "40P01")
  )
    return true;
  if (!meta || typeof meta !== "object" || !("driverAdapterError" in meta))
    return false;
  const adapter: unknown = meta.driverAdapterError;
  if (!adapter || typeof adapter !== "object" || !("cause" in adapter))
    return false;
  const cause: unknown = adapter.cause;
  // PostgreSQL raw row locks report serialization failures through the pg adapter as P2010.
  return Boolean(
    cause &&
    typeof cause === "object" &&
    "kind" in cause &&
    cause.kind === "TransactionWriteConflict" &&
    "originalCode" in cause &&
    (cause.originalCode === "40001" || cause.originalCode === "40P01"),
  );
}
export async function authorizationTransaction<T>(
  client: PrismaClient,
  operation: (tx: AuthorizationClient) => Promise<T>,
): Promise<T> {
  return databaseOperation(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await client.$transaction(operation, {
          isolationLevel: "Serializable",
          maxWait: 10000,
          timeout: 20000,
        });
      } catch (error) {
        if (attempt < 2 && transactionConflict(error)) continue;
        throw error;
      }
    }
  });
}
