import { withReadTransaction } from "../../utils/read-transaction";
import bcrypt from "bcryptjs";
import { ROLES } from "../../constants/roles";
import type {
  SupplierStaffPermissionParamsRequest,
  SupplierStaffStatusRequest,
  SupplierStaffCreateRequest,
  SupplierStaffQueryRequest,
  SupplierStaffParamsRequest,
} from "./supplier-staff.request.dto";
import type { Prisma } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import {
  supplierStaffManagementScope,
  type SupplierStaffManagementScope,
} from "../../utils/resource-access";
import {
  authorizationTransaction,
  databaseOperation,
} from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import type {
  StaffPermissions,
  StaffListItem,
  StaffDetail,
  StaffList,
} from "./supplier-staff.response.dto";
import {
  supplierStaffRepository,
  type SupplierStaffRepository,
  type StaffRow,
} from "./supplier-staff.repository";

function listDto(row: StaffRow): StaffListItem {
  return {
    id: row.id,
    username: row.username,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    roleCode: "INGREDIENT_SUPPLIER_STAFF",
    roleName: row.Role.name,
    status: row.status,
  };
}
function detailDto(row: StaffRow): StaffDetail {
  if (!row.supplierId)
    throw new HttpError(503, "Thông tin nhân viên không hợp lệ");
  return {
    ...listDto(row),
    supplierId: row.supplierId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
function found(row: StaffRow | null): StaffRow {
  if (!row) throw new HttpError(404, "Không tìm thấy tài khoản nhân viên");
  return row;
}

function permissionsDto(
  target: StaffRow,
  state: Awaited<ReturnType<SupplierStaffRepository["permissionState"]>>,
): StaffPermissions {
  const denied = new Set(state.denials.map((row) => row.permissionId));
  return {
    userId: target.id,
    roleId: target.roleId,
    permissions: state.grants
      .map(({ permission: p }) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        module: p.module,
        action: p.action,
        description: p.description,
        isActive: p.isActive,
        enabled: p.isActive && !denied.has(p.id),
      }))
      .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)),
  };
}
/** PR6b (cách 1): không tạo/mở khóa tài khoản khi NCC đang bị khóa do sự cố ATTP. */
const SUPPLIER_LOCKED =
  "NCC đang bị khóa tài khoản theo sự cố ATTP; không thể tạo hoặc mở khóa tài khoản";

function active(target: StaffRow) {
  if (target.status !== "ACTIVE")
    throw new HttpError(403, "Chỉ quản lý quyền của tài khoản đang hoạt động");
  return target;
}

export function createSupplierStaffService(
  repo: SupplierStaffRepository = supplierStaffRepository,
  connect = getPrisma,
  hashPassword: (password: string) => Promise<string> = (password) =>
    bcrypt.hash(password, 12),
) {
  async function write<T>(
    principal: AuthPrincipal,
    targetId: string | undefined,
    operation: (
      tx: Prisma.TransactionClient,
      scope: SupplierStaffManagementScope,
      actor: AuthPrincipal,
      target: StaffRow | null,
    ) => Promise<T>,
  ): Promise<T> {
    const original = supplierStaffManagementScope(principal);
    return databaseOperation(async () =>
      authorizationTransaction(await connect(), async (tx) => {
        // Metadata reads establish lock IDs only; authorization is checked again after locks.
        const beforeActor = await repo.actor(principal.id, tx);
        const beforeScope = supplierStaffManagementScope(beforeActor);
        if (
          beforeScope.supplierId !== original.supplierId ||
          beforeActor.roleId !== principal.roleId
        )
          throw new HttpError(
            403,
            "Phạm vi hoặc vai trò tài khoản đã thay đổi",
          );
        const beforeTarget = targetId
          ? found(await repo.find(original, targetId, tx))
          : null;
        const role = targetId ? null : await repo.staffRole(tx);
        await repo.lock(original, beforeActor, beforeTarget, role?.id, tx);
        const actor = await repo.actor(principal.id, tx);
        const scope = supplierStaffManagementScope(actor);
        if (
          scope.supplierId !== original.supplierId ||
          actor.roleId !== beforeActor.roleId
        )
          throw new HttpError(
            403,
            "Phạm vi hoặc vai trò tài khoản đã thay đổi",
          );
        const target = targetId
          ? found(await repo.find(scope, targetId, tx))
          : null;
        if (target && beforeTarget && target.roleId !== beforeTarget.roleId)
          throw new HttpError(403, "Vai trò nhân viên đã thay đổi");
        if (!targetId && (await repo.staffRole(tx))?.id !== role?.id)
          throw new HttpError(503, "Cấu hình vai trò nhân viên đã thay đổi");
        return operation(tx, scope, actor, target);
      }),
    );
  }
  return {
    async getPermissions(
      params: SupplierStaffParamsRequest,
      principal: AuthPrincipal,
    ): Promise<StaffPermissions> {
      const scope = supplierStaffManagementScope(principal);
      return withReadTransaction(async (tx) => {
        const target = active(found(await repo.find(scope, params.userId, tx)));
        return permissionsDto(
          target,
          await repo.permissionState(scope, target.id, target.roleId, tx),
        );
      }, connect);
    },
    async togglePermission(
      params: SupplierStaffPermissionParamsRequest,
      disabled: boolean,
      principal: AuthPrincipal,
    ): Promise<StaffPermissions> {
      return write(principal, params.userId, async (tx, scope, actor, row) => {
        const target = active(found(row));
        if (
          !(await repo.findActiveRoleGrant(
            scope,
            target.id,
            target.roleId,
            params.permissionId,
            tx,
          ))
        )
          throw new HttpError(
            400,
            "Quyền phải đang hoạt động và thuộc vai trò nhân viên",
          );
        if (disabled)
          await repo.disablePermission(
            scope,
            target.id,
            params.permissionId,
            actor.id,
            tx,
          );
        else
          await repo.enablePermission(
            scope,
            target.id,
            params.permissionId,
            tx,
          );
        return permissionsDto(
          target,
          await repo.permissionState(scope, target.id, target.roleId, tx),
        );
      });
    },
    async changeStatus(
      params: SupplierStaffParamsRequest,
      input: SupplierStaffStatusRequest,
      principal: AuthPrincipal,
    ): Promise<StaffDetail> {
      return write(principal, params.userId, async (tx, scope, _actor, row) => {
        const target = found(row);
        if (target.status !== "ACTIVE" && target.status !== "LOCKED")
          throw new HttpError(
            409,
            "Trạng thái tài khoản không hỗ trợ khóa hoặc mở khóa",
          );
        if (target.status === input.status) return detailDto(target);
        if (input.status === "ACTIVE" && (await repo.hasAccountLock(scope, tx)))
          throw new HttpError(409, SUPPLIER_LOCKED);
        return detailDto(
          found(
            await repo.setStatus(
              scope,
              target.id,
              target.status,
              input.status,
              tx,
            ),
          ),
        );
      });
    },
    async create(
      input: SupplierStaffCreateRequest,
      principal: AuthPrincipal,
    ): Promise<StaffDetail> {
      supplierStaffManagementScope(principal);
      const passwordHash = await databaseOperation(() =>
        hashPassword(input.password),
      );
      return write(principal, undefined, async (tx, scope) => {
        const role = await repo.staffRole(tx);
        if (
          !role ||
          role.code !== ROLES.INGREDIENT_SUPPLIER_STAFF ||
          role.type !== "SUPPLIER"
        )
          throw new HttpError(503, "Cấu hình vai trò nhân viên không hợp lệ");
        if (await repo.hasAccountLock(scope, tx))
          throw new HttpError(409, SUPPLIER_LOCKED);
        if (await repo.duplicateExists(scope, input.username, input.email, tx))
          throw new HttpError(409, "Tên đăng nhập hoặc email đã được sử dụng");
        return detailDto(
          await repo.createStaff(
            scope,
            {
              username: input.username,
              fullName: input.fullName,
              email: input.email,
              phone: input.phone,
              passwordHash,
              roleId: role.id,
            },
            tx,
          ),
        );
      });
    },
    async getDetail(
      params: SupplierStaffParamsRequest,
      principal: AuthPrincipal,
    ): Promise<StaffDetail> {
      const scope = supplierStaffManagementScope(principal);
      return databaseOperation(async () =>
        detailDto(found(await repo.find(scope, params.userId))),
      );
    },
    async getAll(
      query: SupplierStaffQueryRequest,
      principal: AuthPrincipal,
    ): Promise<StaffList> {
      const scope = supplierStaffManagementScope(principal);
      return databaseOperation(async () => {
        const rows = await repo.list(scope, query);
        return {
          items: rows.slice(0, query.limit).map(listDto),
          pagination: { ...query, hasNext: rows.length > query.limit },
        };
      });
    },
  };
}

export const supplierStaffService = createSupplierStaffService();
export type SupplierStaffService = ReturnType<
  typeof createSupplierStaffService
>;
