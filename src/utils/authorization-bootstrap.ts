import type { PrismaClient } from "../generated/prisma/client";
import {
  INITIAL_PERMISSIONS,
  INITIAL_ROLES,
  INITIAL_ROLE_PERMISSIONS,
} from "../constants/permission-catalog";
import { authorizationTransaction } from "./authorization";

/** Operator-run bootstrap. Existing tenant role assignments and inactive flags are preserved. */
export async function bootstrapAuthorization(client: PrismaClient) {
  return authorizationTransaction(client, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412026)`;
    const existing = new Set(
      (await tx.role.findMany({ select: { code: true } })).map(
        (row) => row.code,
      ),
    );
    await tx.role.createMany({
      data: INITIAL_ROLES.map((role) => ({ ...role })),
      skipDuplicates: true,
    });
    await tx.permission.createMany({
      data: INITIAL_PERMISSIONS.map((permission) => ({ ...permission })),
      skipDuplicates: true,
    });
    const roles = new Map(
      (await tx.role.findMany({ select: { id: true, code: true } })).map(
        (row) => [row.code, row.id],
      ),
    );
    const permissions = new Map(
      (await tx.permission.findMany({ select: { id: true, code: true } })).map(
        (row) => [row.code, row.id],
      ),
    );
    const data = INITIAL_ROLE_PERMISSIONS.filter(
      ([code]) => !existing.has(code) || code === "SYSTEM_ADMIN",
    ).map(([roleCode, permissionCode]) => {
      const roleId = roles.get(roleCode);
      const permissionId = permissions.get(permissionCode);
      if (!roleId || !permissionId)
        throw new Error("Incomplete bootstrap catalog");
      return { roleId, permissionId };
    });
    const result = await tx.rolePermission.createMany({
      data,
      skipDuplicates: true,
    });
    return { assignmentsCreated: result.count };
  });
}
