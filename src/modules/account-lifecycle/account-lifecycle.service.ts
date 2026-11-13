import type { Prisma } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import { ROLES } from "../../constants/roles";
import {
  assertSystemManager,
  authorizationTransaction,
  databaseOperation,
  loadPrincipal,
} from "../../utils/authorization";
import { HttpError } from "../../utils/http-error";
import type {
  LifecycleParamsRequestDTO,
  IntakeStateRequestDTO,
} from "./account-lifecycle.request.dto";
import type {
  LifecycleResponseDTO,
  DeactivateResponseDTO,
} from "./account-lifecycle.response.dto";
import {
  createAccountLifecycleRepository,
  type AccountLifecycleRepository,
  type LifecycleTarget,
} from "./account-lifecycle.repository";
import type { OrderScope } from "./intake-access.repository";

type OrganizationScope =
  { kind: "SCHOOL"; id: string } | { kind: "SUPPLIER"; id: string };
type Scope =
  OrganizationScope | { kind: "OFFICER"; id: string; unitId: string };
type Dependencies = {
  transaction: <T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ) => Promise<T>;
  loadActor: (
    id: string,
    tx: Prisma.TransactionClient,
  ) => Promise<AuthPrincipal>;
};

function scopeOf(target: LifecycleTarget): Scope {
  if (
    target.roleCode === ROLES.SCHOOL_ADMINISTRATION &&
    target.Role.type === "SCHOOL" &&
    target.schoolId &&
    target.School &&
    !target.supplierId &&
    !target.communeFoodSafetyUnitId
  )
    return { kind: "SCHOOL", id: target.schoolId };
  if (
    target.roleCode === ROLES.INGREDIENT_SUPPLIER_ADMIN &&
    target.Role.type === "SUPPLIER" &&
    target.supplierId &&
    target.Supplier &&
    !target.schoolId &&
    !target.communeFoodSafetyUnitId
  )
    return { kind: "SUPPLIER", id: target.supplierId };
  if (
    target.roleCode === ROLES.COMMUNE_FOOD_SAFETY_OFFICER &&
    target.Role.type === "AUTHORITY" &&
    target.communeFoodSafetyUnitId &&
    !target.schoolId &&
    !target.supplierId
  )
    return {
      kind: "OFFICER",
      id: target.id,
      unitId: target.communeFoodSafetyUnitId,
    };
  throw new HttpError(409, "Vai trò hoặc tổ chức tài khoản không hợp lệ");
}

function orderScope(scope: OrganizationScope): OrderScope {
  return scope.kind === "SCHOOL"
    ? { schoolId: scope.id }
    : { supplierId: scope.id };
}

function mapLifecycle(
  target: LifecycleTarget,
  scope: Scope,
): LifecycleResponseDTO {
  const owner =
    scope.kind === "SCHOOL"
      ? target.School
      : scope.kind === "SUPPLIER"
        ? target.Supplier
        : target;
  if (!owner) throw new HttpError(409, "Không tìm thấy tổ chức của tài khoản");
  return {
    userId: target.id,
    roleCode: target.roleCode,
    accountStatus: target.status,
    targetType: scope.kind,
    intakeState: owner.intakeState,
    updatedAt: owner.updatedAt.toISOString(),
  };
}

export function createAccountLifecycleService(
  repository: AccountLifecycleRepository = createAccountLifecycleRepository(),
  dependencies?: Dependencies,
) {
  const transaction: Dependencies["transaction"] =
    dependencies?.transaction ??
    (async (operation) =>
      authorizationTransaction(
        await databaseOperation(() => repository.connect()),
        operation,
      ));
  const loadActor = dependencies?.loadActor ?? loadPrincipal;

  async function withTarget<T>(
    params: LifecycleParamsRequestDTO,
    principal: AuthPrincipal,
    operation: (
      tx: Prisma.TransactionClient,
      target: LifecycleTarget,
      scope: Scope,
    ) => Promise<T>,
  ): Promise<T> {
    assertSystemManager(principal, "user.manage");
    return transaction(async (tx) => {
      const initial = await repository.findTarget(tx, params.userId);
      if (!initial) throw new HttpError(404, "Không tìm thấy tài khoản");
      const initialScope = scopeOf(initial);
      await repository.lockParents(tx, {
        ...(initialScope.kind === "SCHOOL"
          ? { schoolId: initialScope.id }
          : initialScope.kind === "SUPPLIER"
            ? { supplierId: initialScope.id }
            : {}),
        userIds: [principal.id, initial.id],
        roleIds: [principal.roleId],
      });
      const currentActor = await loadActor(principal.id, tx);
      assertSystemManager(currentActor, "user.manage");
      const current = await repository.findTarget(tx, initial.id);
      if (!current) throw new HttpError(404, "Không tìm thấy tài khoản");
      const scope = scopeOf(current);
      if (
        scope.kind !== initialScope.kind ||
        scope.id !== initialScope.id ||
        (scope.kind === "OFFICER" &&
          initialScope.kind === "OFFICER" &&
          scope.unitId !== initialScope.unitId) ||
        current.roleCode !== initial.roleCode
      )
        throw new HttpError(409, "Tổ chức hoặc vai trò tài khoản đã thay đổi");
      return operation(tx, current, scope);
    });
  }

  return {
    async getLifecycle(
      params: LifecycleParamsRequestDTO,
      principal: AuthPrincipal,
    ): Promise<LifecycleResponseDTO> {
      return withTarget(params, principal, (_tx, target, scope) =>
        Promise.resolve(mapLifecycle(target, scope)),
      );
    },
    async deactivate(
      params: LifecycleParamsRequestDTO,
      principal: AuthPrincipal,
    ): Promise<DeactivateResponseDTO> {
      return withTarget(params, principal, async (tx, target, scope) => {
        if (scope.kind === "OFFICER") {
          if (target.status !== "DEACTIVATED") {
            if (await repository.hasOpenReports(tx, target.id, scope.unitId))
              throw new HttpError(
                409,
                "Không thể vô hiệu hóa vì cán bộ còn yêu cầu kiểm tra chưa CLOSED.",
              );
            await repository.deactivateOfficer(tx, target.id);
          }
          return {
            userId: target.id,
            targetType: "OFFICER",
            status: "DEACTIVATED",
            affectedAccountCount: 1,
          };
        }
        const trustedScope = orderScope(scope);
        const counts = await repository.countAccounts(tx, trustedScope);
        if (target.status === "DEACTIVATED") {
          if (counts.active !== 0)
            throw new HttpError(
              409,
              "Trạng thái tài khoản trong tổ chức không nhất quán",
            );
        } else {
          if (await repository.hasOngoingOrders(tx, trustedScope))
            throw new HttpError(
              409,
              "Không thể vô hiệu hóa vì tổ chức còn đơn hàng IN_PROGRESS.",
            );
          await repository.deactivateAccounts(tx, trustedScope);
        }
        return {
          userId: target.id,
          targetType: scope.kind,
          status: "DEACTIVATED",
          affectedAccountCount: counts.total,
        };
      });
    },
    async setIntakeState(
      params: LifecycleParamsRequestDTO,
      input: IntakeStateRequestDTO,
      principal: AuthPrincipal,
    ): Promise<LifecycleResponseDTO> {
      return withTarget(params, principal, async (tx, target, scope) => {
        if (
          ((scope.kind === "SCHOOL" || scope.kind === "OFFICER") &&
            input.state === "PAUSED_FOR_FOOD_SAFETY_INSPECTION") ||
          (scope.kind === "SUPPLIER" && input.state === "PAUSED")
        )
          throw new HttpError(
            400,
            "Trạng thái tạm dừng không hợp lệ với loại tổ chức",
          );
        if (mapLifecycle(target, scope).intakeState !== input.state) {
          await repository.setIntakeState(tx, target, input.state);
          const updated = await repository.findTarget(tx, target.id);
          if (!updated) throw new HttpError(404, "Không tìm thấy tài khoản");
          return mapLifecycle(updated, scope);
        }
        return mapLifecycle(target, scope);
      });
    },
  };
}
export const accountLifecycleService = createAccountLifecycleService();
export type AccountLifecycleService = ReturnType<
  typeof createAccountLifecycleService
>;
