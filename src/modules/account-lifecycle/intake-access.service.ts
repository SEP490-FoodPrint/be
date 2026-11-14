import type { AccountStatus, Prisma } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import { ORG_TYPES, ROLES } from "../../constants/roles";
import {
  assertOrganizationManager,
  assertPermission,
  assertSystemManager,
  loadPrincipal,
} from "../../utils/authorization";
import { HttpError } from "../../utils/http-error";
import {
  createIntakeAccessRepository,
  type IntakeAccessRepository,
} from "./intake-access.repository";

export type IntakeOperation =
  | { operation: "SCHOOL_CREATE_ORDER"; supplierId: string }
  | { operation: "SCHOOL_SEND_ORDER"; orderId: string }
  | { operation: "SUPPLIER_ACCEPT_ORDER"; orderId: string }
  | { operation: "OFFICER_RECEIVE_REQUEST"; forwardingId: string }
  | {
      operation: "START_ORDER_PROCESSING";
      orderId: string;
      requiredPermission?: string;
    }
  | {
      operation: "CONTINUE_ACCEPTED_WORK";
      orderId: string;
      requiredPermission?: string;
    };

type PrincipalLoader = (
  id: string,
  tx: Prisma.TransactionClient,
) => Promise<AuthPrincipal>;
type MembershipScope = { kind: "SCHOOL" | "SUPPLIER"; id: string };

function assertSupplierAcceptor(actor: AuthPrincipal) {
  if (
    actor.orgType !== ORG_TYPES.SUPPLIER ||
    !actor.supplierId ||
    (actor.role !== ROLES.INGREDIENT_SUPPLIER_ADMIN &&
      actor.role !== ROLES.INGREDIENT_SUPPLIER_STAFF)
  )
    throw new HttpError(
      403,
      "Chỉ quản trị viên hoặc nhân viên nhà cung cấp được tiếp nhận đơn",
    );
}

function assertMembershipActor(actor: AuthPrincipal, scope: MembershipScope) {
  if (actor.orgType === "SYSTEM") {
    assertSystemManager(actor, "user.manage");
    return;
  }
  assertOrganizationManager(actor);
  if (
    (scope.kind === "SCHOOL" &&
      (actor.orgType !== "SCHOOL" || actor.schoolId !== scope.id)) ||
    (scope.kind === "SUPPLIER" &&
      (actor.orgType !== "SUPPLIER" || actor.supplierId !== scope.id))
  )
    throw new HttpError(403, "Tổ chức không thuộc phạm vi tài khoản");
}

function checkSameIdentity(current: AuthPrincipal, initial: AuthPrincipal) {
  if (
    current.id !== initial.id ||
    current.role !== initial.role ||
    current.orgType !== initial.orgType ||
    current.schoolId !== initial.schoolId ||
    current.supplierId !== initial.supplierId ||
    current.communeFoodSafetyUnitId !== initial.communeFoodSafetyUnitId
  ) {
    throw new HttpError(403, "Phạm vi tài khoản đã thay đổi");
  }
}

/** All reads and locks use the caller's transaction; retry-only send is handled by its caller. */
export function createIntakeAccessService(
  repo: IntakeAccessRepository = createIntakeAccessRepository(),
  loadActor: PrincipalLoader = loadPrincipal,
) {
  return {
    /** Future reassignment writers must invoke this under their own transaction. */
    async assertOfficerReassignment(
      tx: Prisma.TransactionClient,
      initial: AuthPrincipal,
      officerId: string,
    ): Promise<AuthPrincipal> {
      const actor = await loadActor(initial.id, tx);
      checkSameIdentity(actor, initial);
      assertSystemManager(actor, "user.manage");
      const before = await repo.readOfficer(tx, officerId);
      if (
        !before ||
        before.roleCode !== ROLES.COMMUNE_FOOD_SAFETY_OFFICER ||
        before.Role.type !== "AUTHORITY" ||
        !before.communeFoodSafetyUnitId
      )
        throw new HttpError(404, "Không tìm thấy cán bộ ATTP");
      await repo.lockParents(tx, {
        roleIds: [actor.roleId],
        userIds: [actor.id, officerId],
      });
      const current = await loadActor(actor.id, tx);
      checkSameIdentity(current, actor);
      assertSystemManager(current, "user.manage");
      const officer = await repo.readOfficer(tx, officerId);
      if (
        !officer ||
        officer.roleCode !== before.roleCode ||
        officer.Role.type !== before.Role.type ||
        officer.communeFoodSafetyUnitId !== before.communeFoodSafetyUnitId
      )
        throw new HttpError(409, "Phạm vi cán bộ đã thay đổi");
      if (
        await repo.hasOpenReports(tx, officerId, before.communeFoodSafetyUnitId)
      )
        throw new HttpError(409, "Cán bộ còn yêu cầu kiểm tra chưa CLOSED");
      return current;
    },
    /** The caller must write the forwarding in the same transaction after this check. */
    async assertOfficerForwarding(
      tx: Prisma.TransactionClient,
      initial: AuthPrincipal,
      incidentId: string,
      officerId: string,
    ): Promise<{
      actor: AuthPrincipal;
      recipientUserId: string;
      recipientCommuneFoodSafetyUnitId: string;
    }> {
      const actor = await loadActor(initial.id, tx);
      checkSameIdentity(actor, initial);
      if (actor.orgType !== "SCHOOL" || !actor.schoolId)
        throw new HttpError(403, "Thao tác yêu cầu phạm vi trường");
      assertPermission(actor, "food_safety_incident.forward");
      const beforeIncident = await repo.readIncident(tx, incidentId);
      if (!beforeIncident || beforeIncident.schoolId !== actor.schoolId)
        throw new HttpError(404, "Không tìm thấy sự cố");
      const beforeOfficer = await repo.readOfficer(tx, officerId);
      if (
        !beforeOfficer ||
        beforeOfficer.roleCode !== ROLES.COMMUNE_FOOD_SAFETY_OFFICER ||
        beforeOfficer.Role.type !== "AUTHORITY" ||
        !beforeOfficer.communeFoodSafetyUnitId
      )
        throw new HttpError(404, "Không tìm thấy cán bộ ATTP");
      await repo.lockParents(tx, {
        schoolId: actor.schoolId,
        roleIds: [actor.roleId],
        userIds: [actor.id, officerId],
      });
      await repo.lockIncident(tx, incidentId);
      const current = await loadActor(actor.id, tx);
      checkSameIdentity(current, actor);
      assertPermission(current, "food_safety_incident.forward");
      const [incident, officer] = await Promise.all([
        repo.readIncident(tx, incidentId),
        repo.readOfficer(tx, officerId),
      ]);
      if (!incident || incident.schoolId !== current.schoolId)
        throw new HttpError(404, "Không tìm thấy sự cố");
      if (
        !officer ||
        officer.roleCode !== beforeOfficer.roleCode ||
        officer.Role.type !== beforeOfficer.Role.type ||
        officer.communeFoodSafetyUnitId !==
          beforeOfficer.communeFoodSafetyUnitId
      )
        throw new HttpError(409, "Phạm vi cán bộ đã thay đổi");
      if (officer.status !== "ACTIVE")
        throw new HttpError(409, "Tài khoản cán bộ không hoạt động");
      if (officer.intakeState !== "ACTIVE")
        throw new HttpError(409, "Cán bộ đang tạm dừng nhận yêu cầu");
      return {
        actor: current,
        recipientUserId: officer.id,
        recipientCommuneFoodSafetyUnitId: beforeOfficer.communeFoodSafetyUnitId,
      };
    },
    /** Caller must independently authorize its operation and supply a trusted scope. */
    async assertMembershipEligibility(
      tx: Prisma.TransactionClient,
      initial: AuthPrincipal,
      scope: MembershipScope,
      desiredStatus: AccountStatus,
      targetUserId?: string,
    ): Promise<AuthPrincipal> {
      const actor = await loadActor(initial.id, tx);
      checkSameIdentity(actor, initial);
      assertMembershipActor(actor, scope);
      const before = targetUserId
        ? await repo.readMember(tx, targetUserId)
        : null;
      if (targetUserId && !before)
        throw new HttpError(404, "Không tìm thấy tài khoản");
      if (before && actor.orgType !== "SYSTEM") {
        const belongsToActor =
          (actor.orgType === "SCHOOL" && before.schoolId === actor.schoolId) ||
          (actor.orgType === "SUPPLIER" &&
            before.supplierId === actor.supplierId);
        if (!belongsToActor)
          throw new HttpError(403, "Thành viên không thuộc phạm vi tài khoản");
      }
      if (
        before &&
        [
          ROLES.SCHOOL_ADMINISTRATION,
          ROLES.INGREDIENT_SUPPLIER_ADMIN,
          ROLES.COMMUNE_FOOD_SAFETY_OFFICER,
        ].some((role) => role === before.roleCode)
      ) {
        throw new HttpError(
          403,
          "Không hỗ trợ chuyển thành viên quản trị hoặc cán bộ",
        );
      }
      await repo.lockParents(tx, {
        schoolIds: [
          scope.kind === "SCHOOL" ? scope.id : null,
          before?.schoolId,
        ].filter((id): id is string => Boolean(id)),
        supplierIds: [
          scope.kind === "SUPPLIER" ? scope.id : null,
          before?.supplierId,
        ].filter((id): id is string => Boolean(id)),
        roleIds: [actor.roleId],
        userIds: [actor.id, ...(targetUserId ? [targetUserId] : [])],
      });
      const current = await loadActor(actor.id, tx);
      checkSameIdentity(current, actor);
      assertMembershipActor(current, scope);
      if (before) {
        const member = await repo.readMember(tx, before.id);
        if (
          !member ||
          member.roleCode !== before.roleCode ||
          member.schoolId !== before.schoolId ||
          member.supplierId !== before.supplierId ||
          member.communeFoodSafetyUnitId !== before.communeFoodSafetyUnitId
        )
          throw new HttpError(409, "Phạm vi thành viên đã thay đổi");
      }
      const [owner, admin] =
        scope.kind === "SCHOOL"
          ? await Promise.all([
              repo.readSchool(tx, scope.id),
              repo.readSchoolAdmin(tx, scope.id),
            ])
          : await Promise.all([
              repo.readSupplier(tx, scope.id),
              repo.readSupplierAdmin(tx, scope.id),
            ]);
      if (!owner) throw new HttpError(404, "Không tìm thấy tổ chức");
      if (desiredStatus === "ACTIVE" && admin?.status === "DEACTIVATED")
        throw new HttpError(
          409,
          "Tài khoản quản trị của tổ chức đã bị vô hiệu hóa",
        );
      return current;
    },
    async assertAccess(
      tx: Prisma.TransactionClient,
      initial: AuthPrincipal,
      command: IntakeOperation,
    ): Promise<AuthPrincipal> {
      if (
        ![
          "SCHOOL_CREATE_ORDER",
          "SCHOOL_SEND_ORDER",
          "SUPPLIER_ACCEPT_ORDER",
          "OFFICER_RECEIVE_REQUEST",
          "START_ORDER_PROCESSING",
          "CONTINUE_ACCEPTED_WORK",
        ].includes(command.operation)
      ) {
        throw new HttpError(403, "Thao tác chưa hỗ trợ");
      }
      const actor = await loadActor(initial.id, tx);
      checkSameIdentity(actor, initial);
      if (command.operation === "OFFICER_RECEIVE_REQUEST") {
        if (
          actor.orgType !== "AUTHORITY" ||
          actor.role !== ROLES.COMMUNE_FOOD_SAFETY_OFFICER ||
          !actor.communeFoodSafetyUnitId
        )
          throw new HttpError(403, "Chỉ cán bộ ATTP được nhận yêu cầu");
        assertPermission(actor, "food_safety_report.receive");
        const before = await repo.readForwarding(tx, command.forwardingId);
        if (!before || before.recipientUserId !== actor.id)
          throw new HttpError(404, "Không tìm thấy yêu cầu kiểm tra");
        await repo.lockParents(tx, {
          roleIds: [actor.roleId],
          userIds: [actor.id],
        });
        await repo.lockForwarding(tx, before.id);
        const current = await loadActor(actor.id, tx);
        checkSameIdentity(current, actor);
        assertPermission(current, "food_safety_report.receive");
        const [officer, report] = await Promise.all([
          repo.readOfficer(tx, current.id),
          repo.readForwarding(tx, before.id),
        ]);
        if (!report || report.recipientUserId !== current.id)
          throw new HttpError(404, "Không tìm thấy yêu cầu kiểm tra");
        if (
          !officer ||
          officer.roleCode !== ROLES.COMMUNE_FOOD_SAFETY_OFFICER ||
          officer.Role.type !== "AUTHORITY" ||
          officer.communeFoodSafetyUnitId !== current.communeFoodSafetyUnitId ||
          report.recipientCommuneFoodSafetyUnitId !==
            current.communeFoodSafetyUnitId
        )
          throw new HttpError(
            409,
            "Thông tin cán bộ nhận yêu cầu không hợp lệ",
          );
        if (report.receivedAt) return current;
        if (officer.intakeState !== "ACTIVE")
          throw new HttpError(409, "Cán bộ đang tạm dừng nhận yêu cầu");
        if (report.FoodSafetyIncident.status === "CLOSED")
          throw new HttpError(409, "Yêu cầu kiểm tra đã đóng");
        return current;
      }
      const isContinuation =
        command.operation === "START_ORDER_PROCESSING" ||
        command.operation === "CONTINUE_ACCEPTED_WORK";
      const isSupplier =
        command.operation === "SUPPLIER_ACCEPT_ORDER" ||
        (isContinuation && actor.orgType === "SUPPLIER");
      let requiredPermission: string;
      if (isContinuation) {
        if (!command.requiredPermission)
          throw new HttpError(
            403,
            "Thao tác chưa hỗ trợ khi thiếu quyền nghiệp vụ",
          );
        if (
          (actor.orgType !== "SCHOOL" || !actor.schoolId) &&
          (actor.orgType !== "SUPPLIER" || !actor.supplierId)
        )
          throw new HttpError(
            403,
            "Thao tác yêu cầu phạm vi trường hoặc nhà cung cấp",
          );
        requiredPermission = command.requiredPermission;
      } else if (isSupplier) {
        assertSupplierAcceptor(actor);
        requiredPermission = "supply_request.accept";
      } else {
        if (actor.orgType !== "SCHOOL" || !actor.schoolId)
          throw new HttpError(403, "Thao tác yêu cầu trường học");
        requiredPermission = "supply_request.create";
      }
      assertPermission(actor, requiredPermission);
      const before =
        command.operation === "SCHOOL_CREATE_ORDER"
          ? null
          : await repo.readOrder(tx, command.orderId);
      if (
        command.operation !== "SCHOOL_CREATE_ORDER" &&
        (!before ||
          (command.operation === "SUPPLIER_ACCEPT_ORDER" &&
            before.status === "DRAFT") ||
          (isSupplier
            ? before.supplierId !== actor.supplierId
            : before.schoolId !== actor.schoolId))
      )
        throw new HttpError(404, "Không tìm thấy đơn đặt hàng");
      const schoolId = before?.schoolId ?? actor.schoolId;
      const supplierId =
        before?.supplierId ??
        (command.operation === "SCHOOL_CREATE_ORDER"
          ? command.supplierId
          : null);
      if (!schoolId || !supplierId)
        throw new HttpError(403, "Phạm vi đơn hàng không hợp lệ");
      await repo.lockParents(tx, {
        schoolId,
        supplierId,
        roleIds: [actor.roleId],
        userIds: [actor.id],
      });
      if (before) await repo.lockOrder(tx, before.id);
      const current = await loadActor(actor.id, tx);
      checkSameIdentity(current, actor);
      if (command.operation === "SUPPLIER_ACCEPT_ORDER")
        assertSupplierAcceptor(current);
      assertPermission(current, requiredPermission);
      if (before) {
        const order = await repo.readOrder(tx, before.id);
        if (
          !order ||
          (command.operation === "SUPPLIER_ACCEPT_ORDER" &&
            order.status === "DRAFT") ||
          order.schoolId !== schoolId ||
          order.supplierId !== supplierId
        )
          throw new HttpError(404, "Không tìm thấy đơn đặt hàng");
        // Already accepted is a read-only retry; no intake state or timestamp changes.
        if (
          command.operation === "SUPPLIER_ACCEPT_ORDER" &&
          (order.status === "ACCEPTED" || order.status === "IN_PROGRESS")
        )
          return current;
        if (
          command.operation === "SUPPLIER_ACCEPT_ORDER" &&
          order.status !== "SENT"
        )
          throw new HttpError(409, "Đơn hàng không ở trạng thái chờ nhận");
        if (
          isContinuation &&
          order.status !== "ACCEPTED" &&
          order.status !== "IN_PROGRESS"
        )
          throw new HttpError(409, "Đơn hàng chưa được tiếp nhận để xử lý");
      }
      const [school, supplier, schoolAdmin, supplierAdmin] = await Promise.all([
        repo.readSchool(tx, schoolId),
        repo.readSupplier(tx, supplierId),
        repo.readSchoolAdmin(tx, schoolId),
        repo.readSupplierAdmin(tx, supplierId),
      ]);
      if (!school || !supplier)
        throw new HttpError(409, "Không tìm thấy đơn vị của đơn hàng");
      if (
        schoolAdmin?.status === "DEACTIVATED" ||
        supplierAdmin?.status === "DEACTIVATED"
      )
        throw new HttpError(
          409,
          "Tài khoản quản trị của đơn vị đã bị vô hiệu hóa",
        );
      if (!isContinuation && !isSupplier && school.intakeState !== "ACTIVE")
        throw new HttpError(409, "Trường đang tạm dừng tạo đơn");
      if (!isContinuation && isSupplier && supplier.intakeState !== "ACTIVE")
        throw new HttpError(409, "Nhà cung cấp đang tạm dừng nhận đơn");
      return current;
    },
  };
}
