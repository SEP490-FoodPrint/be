import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import { ROLES } from "../../constants/roles";
import {
  assertPermission,
  assertSystemManager,
  authorizationTransaction,
  databaseOperation,
  loadPrincipal,
} from "../../utils/authorization";
import { authSessions } from "../../utils/auth-sessions";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import { RequestValidationError } from "../../utils/request-validation";
import { listScopes } from "../../utils/resource-access";
import { snapshotSupplierIds } from "../food-safety-inspection/food-safety-inspection.service";
import {
  supplierEnforcementRepository,
  type ActiveRestriction,
  type DecisionTarget,
  type IntakeStateValue,
  type RestrictionType,
  type SupplierEnforcementActionRow,
  type SupplierEnforcementRepository,
} from "./supplier-enforcement.repository";
import type {
  ApproveEnforcementRequestDTO,
  EnforcementListQueryRequestDTO,
  RejectEnforcementRequestDTO,
  RequestEnforcementRequestDTO,
} from "./supplier-enforcement.request.dto";
import type {
  EnforcementActorDTO,
  SupplierEnforcementActionDetailDTO,
  SupplierEnforcementActionDTO,
  SupplierEnforcementDecisionResponseDTO,
  SupplierEnforcementListResponseDTO,
  SupplierRestrictionDTO,
} from "./supplier-enforcement.response.dto";

type Tx = Prisma.TransactionClient;

export const REQUEST_PERMISSION = "supplier_enforcement.request";
export const DECIDE_PERMISSION = "supplier_enforcement.decide";
const PAUSED: IntakeStateValue = "PAUSED_FOR_FOOD_SAFETY_INSPECTION";
const NOT_FOUND = "Không tìm thấy yêu cầu chế tài";
/** Trạng thái hồ sơ nhận đề nghị PAUSE_INTAKE / LOCK_ACCOUNT. */
const OPEN_INCIDENT_STATUSES = new Set<string>([
  "AUTHORITY_ACKNOWLEDGED",
  "UNDER_INSPECTION",
  "INSPECTION_COMPLETED",
]);
const RESTRICTION_OF = {
  PAUSE_INTAKE: "PAUSE_INTAKE",
  LOCK_ACCOUNT: "ACCOUNT_LOCKED",
} as const satisfies Record<string, RestrictionType>;
const LOCK_REASON = "Khóa tài khoản theo yêu cầu chế tài NCC đã duyệt";
const UNLOCK_REASON = "Mở khóa tài khoản theo yêu cầu khôi phục NCC đã duyệt";

type Effect = {
  note: string;
  locked: number;
  unlocked: number;
  revokeUserIds: string[];
};

function assertOfficer(p: AuthPrincipal): string {
  if (
    p.orgType !== "AUTHORITY" ||
    p.role !== ROLES.COMMUNE_FOOD_SAFETY_OFFICER ||
    !p.communeFoodSafetyUnitId
  )
    throw new HttpError(403, "Chỉ cán bộ ATTP được đề nghị chế tài");
  assertPermission(p, REQUEST_PERMISSION);
  return p.communeFoodSafetyUnitId;
}

const actor = (
  row: { id: string; fullName: string; roleCode: string } | null,
): EnforcementActorDTO | null =>
  row ? { id: row.id, fullName: row.fullName, roleCode: row.roleCode } : null;

function mapAction(
  row: SupplierEnforcementActionRow,
): SupplierEnforcementActionDTO {
  const requestedBy = actor(row.requestedByUser);
  if (!requestedBy) throw new HttpError(503, "Dữ liệu yêu cầu không hợp lệ");
  return {
    id: row.id,
    incident: {
      id: row.Incident.id,
      code: row.Incident.code,
      title: row.Incident.title,
      status: row.Incident.status,
    },
    supplier: { id: row.Supplier.id, name: row.Supplier.name },
    actionType: row.actionType,
    requestReason: row.requestReason,
    evidenceInspection: row.EvidenceInspection
      ? {
          id: row.EvidenceInspection.id,
          status: row.EvidenceInspection.status,
          overallConclusion: row.EvidenceInspection.overallConclusion,
          completedAt:
            row.EvidenceInspection.completedAt?.toISOString() ?? null,
        }
      : null,
    requestedBy,
    decisionStatus: row.decisionStatus,
    decidedBy: actor(row.decidedByUser),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionNote: row.decisionNote,
    executionStatus: row.executionStatus,
    executedAt: row.executedAt?.toISOString() ?? null,
    executionNote: row.executionNote,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapRestriction(row: ActiveRestriction): SupplierRestrictionDTO {
  return {
    id: row.id,
    restrictionType: row.restrictionType,
    incidentId: row.incidentId,
    activatedAt: row.activatedAt.toISOString(),
    lockedAccountCount: row.lockedAccountCount,
  };
}

export function createSupplierEnforcementService(
  repository: SupplierEnforcementRepository = supplierEnforcementRepository,
  connect: () => Promise<PrismaClient> = getPrisma,
  now = () => new Date(),
  revokeUser: (userId: string) => Promise<void> = (userId) =>
    authSessions.revokeUser(userId),
) {
  const database = () => databaseOperation(() => connect());

  async function readAction(tx: Tx, id: string) {
    const row = await repository.readAction(tx, id);
    if (!row) throw new HttpError(503, "Không đọc lại được yêu cầu chế tài");
    return mapAction(row);
  }

  /** NCC đề nghị được: snapshot (fallback quan hệ cung cấp) ∪ NCC đã có kết luận. */
  async function allowedSuppliers(
    tx: Tx,
    incidentId: string,
    schoolId: string,
  ): Promise<Set<string>> {
    let ids = snapshotSupplierIds(
      await repository.snapshotPayloads(tx, incidentId),
    );
    if (!ids.length) ids = await repository.schoolSupplierIds(tx, schoolId);
    return new Set([
      ...ids,
      ...(await repository.findingSupplierIds(tx, incidentId)),
    ]);
  }

  async function assertLockEvidence(
    tx: Tx,
    incidentId: string,
    inspectionId: string | null,
    supplierId: string,
  ): Promise<void> {
    const evidence = inspectionId
      ? await repository.findEvidence(tx, incidentId, inspectionId, supplierId)
      : null;
    if (evidence?.status !== "COMPLETED" || evidence.finding !== "AT_FAULT")
      throw new HttpError(
        409,
        "Căn cứ khóa tài khoản phải là đợt kiểm tra đã có kết luận NCC AT_FAULT",
      );
  }

  async function pauseIntake(tx: Tx, supplierId: string): Promise<void> {
    if ((await repository.supplierIntake(tx, supplierId)) !== PAUSED)
      await repository.setSupplierIntake(tx, supplierId, PAUSED);
  }

  /** PAUSE_INTAKE / LOCK_ACCOUNT: tạo hạn chế, tạm dừng tiếp nhận, khóa tài khoản ACTIVE. */
  async function applyRestriction(
    tx: Tx,
    action: DecisionTarget,
    actorId: string,
    at: Date,
  ): Promise<Effect> {
    const type =
      RESTRICTION_OF[action.actionType as keyof typeof RESTRICTION_OF];
    if (action.actionType === "LOCK_ACCOUNT")
      await assertLockEvidence(
        tx,
        action.incidentId,
        action.evidenceInspectionId,
        action.supplierId,
      );
    const active = await repository.activeRestrictions(
      tx,
      action.supplierId,
      action.incidentId,
    );
    if (active.some((item) => item.restrictionType === type))
      throw new HttpError(409, "NCC đã có hạn chế này theo hồ sơ sự cố");
    const restrictionId = await repository.createRestriction(tx, {
      supplierId: action.supplierId,
      incidentId: action.incidentId,
      restrictionType: type,
      sourceActionId: action.id,
      at,
    });
    await pauseIntake(tx, action.supplierId);
    if (type === "PAUSE_INTAKE")
      return {
        note: "Đã tạm dừng tiếp nhận đơn của NCC.",
        locked: 0,
        unlocked: 0,
        revokeUserIds: [],
      };
    const userIds = await repository.activeSupplierUserIds(
      tx,
      action.supplierId,
    );
    if (
      (await repository.setUserStatus(tx, userIds, "ACTIVE", "LOCKED")) !==
      userIds.length
    )
      throw new HttpError(409, "Trạng thái tài khoản NCC đã thay đổi");
    await repository.createLocks(
      tx,
      restrictionId,
      userIds.map((userId) => ({ userId, lockedAt: at })),
    );
    await repository.recordStatusHistories(
      tx,
      userIds.map((userId) => ({
        userId,
        supplierId: action.supplierId,
        fromStatus: "ACTIVE",
        toStatus: "LOCKED",
        reason: LOCK_REASON,
        sourceActionId: action.id,
        actorUserId: actorId,
        at,
      })),
    );
    return {
      note: `Đã khóa ${userIds.length} tài khoản và tạm dừng tiếp nhận đơn của NCC.`,
      locked: userIds.length,
      unlocked: 0,
      revokeUserIds: userIds,
    };
  }

  /** RESTORE: gỡ hạn chế của hồ sơ, không vượt hạn chế còn hiệu lực khác (§5.2 mục 4). */
  async function restore(
    tx: Tx,
    action: DecisionTarget,
    actorId: string,
    at: Date,
  ): Promise<Effect> {
    const lifted = await repository.activeRestrictions(
      tx,
      action.supplierId,
      action.incidentId,
    );
    if (!lifted.length)
      throw new HttpError(
        409,
        "NCC không còn hạn chế đang hiệu lực theo hồ sơ này",
      );
    const liftedIds = lifted.map((item) => item.id);
    if (
      (await repository.liftRestrictions(tx, liftedIds, action.id, at)) !==
      liftedIds.length
    )
      throw new HttpError(409, "Hạn chế của NCC đã thay đổi");
    const remaining = await repository.activeRestrictions(
      tx,
      action.supplierId,
    );
    const notes = [`Đã gỡ ${liftedIds.length} hạn chế của hồ sơ.`];
    if (remaining.length)
      notes.push(
        `Còn ${remaining.length} hạn chế khác đang hiệu lực nên giữ tạm dừng tiếp nhận đơn.`,
      );
    else if (
      (await repository.supplierIntake(tx, action.supplierId)) === PAUSED
    ) {
      await repository.setSupplierIntake(tx, action.supplierId, "ACTIVE");
      notes.push("Đã mở lại tiếp nhận đơn.");
    }

    const lockIds = lifted
      .filter((item) => item.restrictionType === "ACCOUNT_LOCKED")
      .map((item) => item.id);
    const locks = await repository.openLocks(tx, lockIds);
    await repository.closeLocks(tx, lockIds, at);
    const stillLocked = [
      ...new Map(
        locks
          .filter((item) => item.userStatus === "LOCKED")
          .map((item) => [item.userId, item]),
      ).values(),
    ];
    const holder = remaining.find(
      (item) => item.restrictionType === "ACCOUNT_LOCKED",
    );
    let unlocked = 0;
    if (holder && stillLocked.length) {
      // Chuyển liên kết sang hạn chế ACCOUNT_LOCKED còn hiệu lực để lần gỡ sau mở đúng tài khoản.
      await repository.createLocks(
        tx,
        holder.id,
        stillLocked.map((item) => ({ userId: item.userId, lockedAt: at })),
      );
      notes.push(
        `Giữ khóa ${stillLocked.length} tài khoản do còn hạn chế ACCOUNT_LOCKED khác.`,
      );
    } else if (stillLocked.length) {
      const ids = stillLocked.map((item) => item.userId);
      unlocked = await repository.setUserStatus(tx, ids, "LOCKED", "ACTIVE");
      if (unlocked !== ids.length)
        throw new HttpError(409, "Trạng thái tài khoản NCC đã thay đổi");
      await repository.recordStatusHistories(
        tx,
        ids.map((userId) => ({
          userId,
          supplierId: action.supplierId,
          fromStatus: "LOCKED",
          toStatus: "ACTIVE",
          reason: UNLOCK_REASON,
          sourceActionId: action.id,
          actorUserId: actorId,
          at,
        })),
      );
      notes.push(`Đã mở khóa ${unlocked} tài khoản.`);
    }
    return { note: notes.join(" "), locked: 0, unlocked, revokeUserIds: [] };
  }

  /** Thu hồi phiên sau commit; trả về ghi chú lỗi nếu có. */
  async function revokeSessions(userIds: readonly string[]) {
    const failed: string[] = [];
    for (const userId of userIds) {
      try {
        await revokeUser(userId);
      } catch {
        failed.push(userId);
      }
    }
    return failed;
  }

  /** System Admin: nạp lại actor, khóa NCC rồi khóa yêu cầu (FR-005). */
  async function adminAction<T>(
    actionId: string,
    principal: AuthPrincipal,
    run: (
      tx: Tx,
      action: DecisionTarget,
      actorId: string,
      at: Date,
    ) => Promise<T>,
  ): Promise<T> {
    assertSystemManager(principal, DECIDE_PERMISSION);
    return authorizationTransaction(await database(), async (tx) => {
      const current = await loadPrincipal(principal.id, tx);
      assertSystemManager(current, DECIDE_PERMISSION);
      const initial = await repository.findDecisionTarget(tx, actionId);
      if (!initial) throw new HttpError(404, NOT_FOUND);
      await repository.lockSupplier(tx, initial.supplierId);
      await repository.lockAction(tx, actionId);
      const action = await repository.findDecisionTarget(tx, actionId);
      if (!action) throw new HttpError(404, NOT_FOUND);
      return run(tx, action, current.id, now());
    });
  }

  async function finish(
    actionId: string,
    effect: Effect,
    intake: IntakeStateValue,
    action: SupplierEnforcementActionDTO,
    from: "APPLIED" | "FAILED",
  ): Promise<SupplierEnforcementDecisionResponseDTO> {
    let result = action;
    if (effect.revokeUserIds.length) {
      const failed = await revokeSessions(effect.revokeUserIds);
      const note = failed.length
        ? `${effect.note} Thu hồi phiên đăng nhập thất bại cho ${failed.length}/${effect.revokeUserIds.length} tài khoản; System Admin cần chạy lại.`
        : `${effect.note} Đã thu hồi phiên đăng nhập của ${effect.revokeUserIds.length} tài khoản.`;
      const to = failed.length ? "FAILED" : "APPLIED";
      const db = await database();
      await databaseOperation(() =>
        repository.markExecution(db, actionId, from, to, note),
      );
      result = { ...action, executionStatus: to, executionNote: note };
    }
    return {
      action: result,
      lockedAccountCount: effect.locked,
      unlockedAccountCount: effect.unlocked,
      supplierIntakeState: intake,
    };
  }

  return {
    /** US1: cán bộ ATTP đơn vị nhận đề nghị chế tài. */
    async request(
      id: string,
      body: RequestEnforcementRequestDTO,
      principal: AuthPrincipal,
    ): Promise<SupplierEnforcementActionDTO> {
      assertOfficer(principal);
      return authorizationTransaction(await database(), async (tx) => {
        const current = await loadPrincipal(principal.id, tx);
        const unitId = assertOfficer(current);
        if (unitId !== principal.communeFoodSafetyUnitId)
          throw new HttpError(403, "Phạm vi tài khoản đã thay đổi");
        await repository.lockIncident(tx, id);
        const target = await repository.findOfficerTarget(tx, id, unitId);
        if (!target) throw new HttpError(404, "Không tìm thấy hồ sơ sự cố");
        if (
          body.evidenceInspectionId &&
          !(await repository.findEvidence(
            tx,
            id,
            body.evidenceInspectionId,
            body.supplierId,
          ))
        )
          throw new RequestValidationError([
            {
              field: "evidenceInspectionId",
              message: "Đợt kiểm tra không thuộc hồ sơ sự cố",
            },
          ]);
        const active = await repository.activeRestrictions(
          tx,
          body.supplierId,
          id,
        );
        if (body.actionType === "RESTORE") {
          if (!active.length)
            throw new HttpError(
              409,
              "NCC không có hạn chế đang hiệu lực theo hồ sơ này",
            );
        } else {
          if (!OPEN_INCIDENT_STATUSES.has(target.status))
            throw new HttpError(409, "Hồ sơ không ở bước nhận đề nghị chế tài");
          if (
            !(await allowedSuppliers(tx, id, target.schoolId)).has(
              body.supplierId,
            )
          )
            throw new RequestValidationError([
              {
                field: "supplierId",
                message: "NCC không thuộc chuỗi truy xuất của hồ sơ",
              },
            ]);
          if (body.actionType === "LOCK_ACCOUNT")
            await assertLockEvidence(
              tx,
              id,
              body.evidenceInspectionId ?? null,
              body.supplierId,
            );
          const type = RESTRICTION_OF[body.actionType];
          if (active.some((item) => item.restrictionType === type))
            throw new HttpError(409, "NCC đã có hạn chế này theo hồ sơ sự cố");
        }
        const duplicate = "Đã có yêu cầu cùng loại đang chờ duyệt";
        if (
          await repository.hasPending(tx, id, body.supplierId, body.actionType)
        )
          throw new HttpError(409, duplicate);
        const created = await repository.createAction(tx, {
          incidentId: id,
          supplierId: body.supplierId,
          actionType: body.actionType,
          requestedByUserId: current.id,
          requestReason: body.reason,
          evidenceInspectionId: body.evidenceInspectionId ?? null,
          at: now(),
        });
        if (!created) throw new HttpError(409, duplicate);
        return mapAction(created);
      });
    },

    async list(
      query: EnforcementListQueryRequestDTO,
      principal: AuthPrincipal,
    ): Promise<SupplierEnforcementListResponseDTO> {
      const scope = listScopes["supplier-enforcement"](principal);
      const db = await database();
      const rows = await databaseOperation(() =>
        repository.listActions(
          db,
          scope,
          {
            incidentId: query.incidentId,
            supplierId: query.supplierId,
            actionType: query.actionType,
            decisionStatus: query.decisionStatus,
            executionStatus: query.executionStatus,
          },
          { skip: (query.page - 1) * query.limit, take: query.limit + 1 },
        ),
      );
      return {
        items: rows.slice(0, query.limit).map(mapAction),
        pagination: {
          page: query.page,
          limit: query.limit,
          hasNext: rows.length > query.limit,
        },
      };
    },

    async getOne(
      actionId: string,
      principal: AuthPrincipal,
    ): Promise<SupplierEnforcementActionDetailDTO> {
      const scope = listScopes["supplier-enforcement"](principal);
      const db = await database();
      return databaseOperation(async () => {
        const row = await repository.findAction(db, scope, actionId);
        if (!row) throw new HttpError(404, NOT_FOUND);
        const isAdmin =
          principal.orgType === "SYSTEM" &&
          principal.role === ROLES.SYSTEM_ADMIN;
        return {
          ...mapAction(row),
          activeRestrictions: isAdmin
            ? (await repository.activeRestrictions(db, row.supplierId)).map(
                mapRestriction,
              )
            : null,
        };
      });
    },

    /** US2/US3: duyệt = thực thi trong cùng transaction; thu hồi phiên sau commit. */
    async approve(
      actionId: string,
      body: ApproveEnforcementRequestDTO,
      principal: AuthPrincipal,
    ): Promise<SupplierEnforcementDecisionResponseDTO> {
      const outcome = await adminAction(
        actionId,
        principal,
        async (tx, action, actorId, at) => {
          if (action.decisionStatus !== "PENDING")
            throw new HttpError(409, "Yêu cầu chế tài đã được xử lý");
          const effect =
            action.actionType === "RESTORE"
              ? await restore(tx, action, actorId, at)
              : await applyRestriction(tx, action, actorId, at);
          const changed = await repository.decide(tx, action.id, {
            decisionStatus: "APPROVED",
            decidedByUserId: actorId,
            decisionNote: body.note ?? null,
            executionStatus: "APPLIED",
            executionNote: effect.note,
            at,
          });
          if (changed !== 1)
            throw new HttpError(409, "Yêu cầu chế tài đã được xử lý");
          return {
            effect,
            intake: await repository.supplierIntake(tx, action.supplierId),
            action: await readAction(tx, action.id),
          };
        },
      );
      return finish(
        actionId,
        outcome.effect,
        outcome.intake,
        outcome.action,
        "APPLIED",
      );
    },

    async reject(
      actionId: string,
      body: RejectEnforcementRequestDTO,
      principal: AuthPrincipal,
    ): Promise<SupplierEnforcementActionDTO> {
      return adminAction(
        actionId,
        principal,
        async (tx, action, actorId, at) => {
          if (action.decisionStatus !== "PENDING")
            throw new HttpError(409, "Yêu cầu chế tài đã được xử lý");
          const changed = await repository.decide(tx, action.id, {
            decisionStatus: "REJECTED",
            decidedByUserId: actorId,
            decisionNote: body.note,
            executionStatus: "NOT_APPLIED",
            executionNote: null,
            at,
          });
          if (changed !== 1)
            throw new HttpError(409, "Yêu cầu chế tài đã được xử lý");
          return readAction(tx, action.id);
        },
      );
    },

    /** FR-006: chạy lại thu hồi phiên cho LOCK_ACCOUNT thực thi lỗi. */
    async retry(
      actionId: string,
      principal: AuthPrincipal,
    ): Promise<SupplierEnforcementDecisionResponseDTO> {
      const outcome = await adminAction(
        actionId,
        principal,
        async (tx, action) => {
          if (
            action.actionType !== "LOCK_ACCOUNT" ||
            action.executionStatus !== "FAILED"
          )
            throw new HttpError(
              409,
              "Chỉ chạy lại yêu cầu khóa tài khoản đang thực thi lỗi",
            );
          const userIds = await repository.lockedUserIdsOfAction(tx, action.id);
          return {
            userIds,
            intake: await repository.supplierIntake(tx, action.supplierId),
            action: await readAction(tx, action.id),
          };
        },
      );
      const effect: Effect = {
        note: "Chạy lại thu hồi phiên.",
        locked: 0,
        unlocked: 0,
        revokeUserIds: outcome.userIds,
      };
      if (!outcome.userIds.length) {
        const note = "Chạy lại: không còn tài khoản bị khóa cần thu hồi phiên.";
        const db = await database();
        await databaseOperation(() =>
          repository.markExecution(db, actionId, "FAILED", "APPLIED", note),
        );
        return {
          action: {
            ...outcome.action,
            executionStatus: "APPLIED",
            executionNote: note,
          },
          lockedAccountCount: 0,
          unlockedAccountCount: 0,
          supplierIntakeState: outcome.intake,
        };
      }
      const response = await finish(
        actionId,
        effect,
        outcome.intake,
        outcome.action,
        "FAILED",
      );
      return { ...response, lockedAccountCount: outcome.userIds.length };
    },
  };
}

export const supplierEnforcementService = createSupplierEnforcementService();
export type SupplierEnforcementService = ReturnType<
  typeof createSupplierEnforcementService
>;
