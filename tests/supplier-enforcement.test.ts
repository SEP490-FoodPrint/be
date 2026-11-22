import assert from "node:assert/strict";
import test from "node:test";
import {
  INITIAL_PERMISSIONS,
  INITIAL_ROLE_PERMISSIONS,
} from "../src/constants/permission-catalog";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import type {
  ActiveRestriction,
  SupplierEnforcementActionRow,
  SupplierEnforcementRepository,
} from "../src/modules/supplier-enforcement/supplier-enforcement.repository";
import { createSupplierEnforcementService } from "../src/modules/supplier-enforcement/supplier-enforcement.service";
import {
  validateApproveEnforcement,
  validateEnforcementListQuery,
  validateRejectEnforcement,
  validateRequestEnforcement,
} from "../src/modules/supplier-enforcement/supplier-enforcement.validation";
import type { AuthPrincipal } from "../src/types/auth";
import { HttpError } from "../src/utils/http-error";
import { RequestValidationError } from "../src/utils/request-validation";
import { listScopes } from "../src/utils/resource-access";

const NOW = new Date("2026-11-22T05:00:00.000Z");
const unitId = "60000000-0000-4000-8000-000000000001";
const incidentA = "60000000-0000-4000-8000-000000000002";
const incidentB = "60000000-0000-4000-8000-000000000003";
const inspectionA = "60000000-0000-4000-8000-000000000004";
const inspectionB = "60000000-0000-4000-8000-000000000005";
const supplierId = "60000000-0000-4000-8000-000000000006";
const otherSupplier = "60000000-0000-4000-8000-000000000007";
const schoolId = "60000000-0000-4000-8000-000000000008";
const adminUser = "60000000-0000-4000-8000-000000000031";
const staffActive = "60000000-0000-4000-8000-000000000032";
const staffManual = "60000000-0000-4000-8000-000000000033";

const officer: AuthPrincipal = {
  id: "60000000-0000-4000-8000-000000000010",
  username: "officer",
  fullName: "Cán bộ ATTP",
  roleId: "60000000-0000-4000-8000-000000000011",
  role: "COMMUNE_FOOD_SAFETY_OFFICER",
  orgType: "AUTHORITY",
  schoolId: null,
  supplierId: null,
  communeFoodSafetyUnitId: unitId,
  permissions: ["supplier_enforcement.request"],
};
const sysadmin: AuthPrincipal = {
  ...officer,
  id: "60000000-0000-4000-8000-000000000020",
  username: "admin",
  fullName: "System Admin",
  roleId: "60000000-0000-4000-8000-000000000021",
  role: "SYSTEM_ADMIN",
  orgType: "SYSTEM",
  communeFoodSafetyUnitId: null,
  permissions: ["supplier_enforcement.decide"],
};

const status = (code: number) => (error: unknown) =>
  error instanceof HttpError && error.statusCode === code;
const invalid = (field: string) => (error: unknown) =>
  error instanceof RequestValidationError &&
  error.fields.some((item) => item.field === field);

function identityOf(principal: AuthPrincipal) {
  return {
    id: principal.id,
    username: principal.username,
    fullName: principal.fullName,
    status: "ACTIVE",
    roleId: principal.roleId,
    schoolId: principal.schoolId,
    supplierId: principal.supplierId,
    communeFoodSafetyUnitId: principal.communeFoodSafetyUnitId,
    Role: {
      code: principal.role,
      type: principal.orgType,
      rolePermissions: principal.permissions.map((code) => ({
        permission: { code, isActive: true },
      })),
    },
    permissionDenials: [],
  };
}

type Action = {
  id: string;
  incidentId: string;
  supplierId: string;
  actionType: "PAUSE_INTAKE" | "LOCK_ACCOUNT" | "RESTORE";
  evidenceInspectionId: string | null;
  requestReason: string;
  decisionStatus: "PENDING" | "APPROVED" | "REJECTED";
  executionStatus: "NOT_APPLIED" | "APPLIED" | "FAILED";
  decisionNote: string | null;
  executionNote: string | null;
  decidedBy: string | null;
};
type Restriction = {
  id: string;
  supplierId: string;
  incidentId: string | null;
  restrictionType: "PAUSE_INTAKE" | "ACCOUNT_LOCKED";
  sourceActionId: string | null;
  isActive: boolean;
  activatedAt: Date;
  liftedByActionId: string | null;
};
type Lock = {
  restrictionId: string;
  userId: string;
  lockedAt: Date;
  unlockedAt: Date | null;
};

/** Repository giả có trạng thái để kiểm tra logic đa sự cố. */
function setup() {
  let sequence = 0;
  const id = () =>
    `70000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
  const state = {
    intake: "ACTIVE" as string,
    incidents: new Map([
      [incidentA, { status: "INSPECTION_COMPLETED" }],
      [incidentB, { status: "UNDER_INSPECTION" }],
    ]),
    inspections: new Map([
      [
        inspectionA,
        { incidentId: incidentA, status: "COMPLETED", finding: "AT_FAULT" },
      ],
      [
        inspectionB,
        { incidentId: incidentB, status: "COMPLETED", finding: "AT_FAULT" },
      ],
    ]),
    users: new Map<string, string>([
      [adminUser, "ACTIVE"],
      [staffActive, "ACTIVE"],
      [staffManual, "LOCKED"],
    ]),
    actions: [] as Action[],
    restrictions: [] as Restriction[],
    locks: [] as Lock[],
    histories: [] as {
      userId: string;
      fromStatus: string;
      toStatus: string;
    }[],
  };
  let actor = officer;
  const client = {
    $transaction<T>(
      op: (tx: Prisma.TransactionClient) => Promise<T>,
    ): Promise<T> {
      return op({
        user: { findUnique: () => Promise.resolve(identityOf(actor)) },
      } as unknown as Prisma.TransactionClient);
    },
  } as unknown as PrismaClient;
  const row = (action: Action): SupplierEnforcementActionRow => ({
    id: action.id,
    actionType: action.actionType,
    requestReason: action.requestReason,
    decisionStatus: action.decisionStatus,
    decidedAt: action.decidedBy ? NOW : null,
    decisionNote: action.decisionNote,
    executionStatus: action.executionStatus,
    executedAt: action.executionStatus === "NOT_APPLIED" ? null : NOW,
    executionNote: action.executionNote,
    createdAt: NOW,
    updatedAt: NOW,
    Incident: {
      id: action.incidentId,
      code: "FP-IC-12345",
      title: "Sự cố",
      status: "UNDER_INSPECTION",
    },
    Supplier: { id: action.supplierId, name: "NCC A" },
    EvidenceInspection: action.evidenceInspectionId
      ? {
          id: action.evidenceInspectionId,
          status: "COMPLETED",
          overallConclusion: "SUPPLIER_AT_FAULT",
          completedAt: NOW,
        }
      : null,
    requestedByUser: {
      id: officer.id,
      fullName: officer.fullName,
      roleCode: officer.role,
    },
    decidedByUser: action.decidedBy
      ? {
          id: action.decidedBy,
          fullName: "System Admin",
          roleCode: "SYSTEM_ADMIN",
        }
      : null,
  });
  const active = (supplier: string, incident?: string): ActiveRestriction[] =>
    state.restrictions
      .filter(
        (item) =>
          item.supplierId === supplier &&
          item.isActive &&
          (!incident || item.incidentId === incident),
      )
      .map((item) => ({
        id: item.id,
        incidentId: item.incidentId,
        restrictionType: item.restrictionType,
        activatedAt: item.activatedAt,
        lockedAccountCount: state.locks.filter(
          (lock) => lock.restrictionId === item.id && !lock.unlockedAt,
        ).length,
      }));
  const repository = {
    connect: () => Promise.resolve(client),
    lockIncident: () => Promise.resolve(),
    lockSupplier: () => Promise.resolve(),
    lockAction: () => Promise.resolve(),
    findOfficerTarget: (_db: unknown, incident: string, unit: string) => {
      const found = state.incidents.get(incident);
      return Promise.resolve(
        found && unit === unitId
          ? { id: incident, schoolId, status: found.status }
          : null,
      );
    },
    snapshotPayloads: () =>
      Promise.resolve([{ suppliers: [{ id: supplierId }] }]),
    schoolSupplierIds: () => Promise.resolve([]),
    findingSupplierIds: () => Promise.resolve([]),
    findEvidence: (
      _db: unknown,
      incident: string,
      inspection: string,
      supplier: string,
    ) => {
      const found = state.inspections.get(inspection);
      if (!found || found.incidentId !== incident) return Promise.resolve(null);
      return Promise.resolve({
        status: found.status,
        finding: supplier === supplierId ? found.finding : null,
      });
    },
    activeRestrictions: (_db: unknown, supplier: string, incident?: string) =>
      Promise.resolve(active(supplier, incident)),
    hasPending: (
      _db: unknown,
      incident: string,
      supplier: string,
      type: string,
    ) =>
      Promise.resolve(
        state.actions.some(
          (item) =>
            item.incidentId === incident &&
            item.supplierId === supplier &&
            item.actionType === type &&
            item.decisionStatus === "PENDING",
        ),
      ),
    createAction: (
      _tx: unknown,
      data: {
        incidentId: string;
        supplierId: string;
        actionType: Action["actionType"];
        requestReason: string;
        evidenceInspectionId: string | null;
      },
    ) => {
      const action: Action = {
        id: id(),
        ...data,
        decisionStatus: "PENDING",
        executionStatus: "NOT_APPLIED",
        decisionNote: null,
        executionNote: null,
        decidedBy: null,
      };
      state.actions.push(action);
      return Promise.resolve(row(action));
    },
    listActions: () => Promise.resolve(state.actions.map(row)),
    findAction: (_db: unknown, _scope: unknown, actionId: string) => {
      const found = state.actions.find((item) => item.id === actionId);
      return Promise.resolve(
        found ? { ...row(found), supplierId: found.supplierId } : null,
      );
    },
    findDecisionTarget: (_tx: unknown, actionId: string) => {
      const found = state.actions.find((item) => item.id === actionId);
      return Promise.resolve(
        found
          ? {
              id: found.id,
              incidentId: found.incidentId,
              supplierId: found.supplierId,
              actionType: found.actionType,
              evidenceInspectionId: found.evidenceInspectionId,
              decisionStatus: found.decisionStatus,
              executionStatus: found.executionStatus,
            }
          : null,
      );
    },
    decide: (
      _tx: unknown,
      actionId: string,
      data: {
        decisionStatus: "APPROVED" | "REJECTED";
        decidedByUserId: string;
        decisionNote: string | null;
        executionStatus: "NOT_APPLIED" | "APPLIED";
        executionNote: string | null;
      },
    ) => {
      const found = state.actions.find(
        (item) => item.id === actionId && item.decisionStatus === "PENDING",
      );
      if (!found) return Promise.resolve(0);
      Object.assign(found, {
        decisionStatus: data.decisionStatus,
        decidedBy: data.decidedByUserId,
        decisionNote: data.decisionNote,
        executionStatus: data.executionStatus,
        executionNote: data.executionNote,
      });
      return Promise.resolve(1);
    },
    markExecution: (
      _db: unknown,
      actionId: string,
      from: string,
      to: Action["executionStatus"],
      note: string,
    ) => {
      const found = state.actions.find(
        (item) => item.id === actionId && item.executionStatus === from,
      );
      if (!found) return Promise.resolve(0);
      found.executionStatus = to;
      found.executionNote = note;
      return Promise.resolve(1);
    },
    readAction: (_tx: unknown, actionId: string) => {
      const found = state.actions.find((item) => item.id === actionId);
      return Promise.resolve(found ? row(found) : null);
    },
    createRestriction: (
      _tx: unknown,
      data: {
        supplierId: string;
        incidentId: string;
        restrictionType: Restriction["restrictionType"];
        sourceActionId: string;
        at: Date;
      },
    ) => {
      const restriction: Restriction = {
        id: id(),
        supplierId: data.supplierId,
        incidentId: data.incidentId,
        restrictionType: data.restrictionType,
        sourceActionId: data.sourceActionId,
        isActive: true,
        activatedAt: new Date(data.at.getTime() + sequence),
        liftedByActionId: null,
      };
      state.restrictions.push(restriction);
      return Promise.resolve(restriction.id);
    },
    liftRestrictions: (
      _tx: unknown,
      ids: readonly string[],
      actionId: string,
    ) => {
      let count = 0;
      for (const item of state.restrictions)
        if (ids.includes(item.id) && item.isActive) {
          item.isActive = false;
          item.liftedByActionId = actionId;
          count++;
        }
      return Promise.resolve(count);
    },
    supplierIntake: () => Promise.resolve(state.intake),
    setSupplierIntake: (_tx: unknown, _supplier: string, value: string) => {
      state.intake = value;
      return Promise.resolve();
    },
    activeSupplierUserIds: () =>
      Promise.resolve(
        [...state.users]
          .filter(([, value]) => value === "ACTIVE")
          .map(([key]) => key)
          .sort(),
      ),
    setUserStatus: (
      _tx: unknown,
      ids: readonly string[],
      from: string,
      to: string,
    ) => {
      let count = 0;
      for (const userId of ids)
        if (state.users.get(userId) === from) {
          state.users.set(userId, to);
          count++;
        }
      return Promise.resolve(count);
    },
    createLocks: (
      _tx: unknown,
      restrictionId: string,
      rows: readonly { userId: string; lockedAt: Date }[],
    ) => {
      for (const item of rows)
        if (
          !state.locks.some(
            (lock) =>
              lock.restrictionId === restrictionId &&
              lock.userId === item.userId,
          )
        )
          state.locks.push({ restrictionId, ...item, unlockedAt: null });
      return Promise.resolve();
    },
    openLocks: (_tx: unknown, ids: readonly string[]) =>
      Promise.resolve(
        state.locks
          .filter(
            (lock) => ids.includes(lock.restrictionId) && !lock.unlockedAt,
          )
          .map((lock) => ({
            restrictionId: lock.restrictionId,
            userId: lock.userId,
            lockedAt: lock.lockedAt,
            userStatus: state.users.get(lock.userId) ?? "ACTIVE",
          })),
      ),
    closeLocks: (_tx: unknown, ids: readonly string[], at: Date) => {
      for (const lock of state.locks)
        if (ids.includes(lock.restrictionId) && !lock.unlockedAt)
          lock.unlockedAt = at;
      return Promise.resolve();
    },
    lockedUserIdsOfAction: (_tx: unknown, actionId: string) =>
      Promise.resolve(
        state.locks
          .filter((lock) => {
            const restriction = state.restrictions.find(
              (item) => item.id === lock.restrictionId,
            );
            return (
              !lock.unlockedAt &&
              restriction?.sourceActionId === actionId &&
              restriction.isActive &&
              state.users.get(lock.userId) === "LOCKED"
            );
          })
          .map((lock) => lock.userId),
      ),
    recordStatusHistories: (
      _tx: unknown,
      rows: readonly { userId: string; fromStatus: string; toStatus: string }[],
    ) => {
      state.histories.push(
        ...rows.map(({ userId, fromStatus, toStatus }) => ({
          userId,
          fromStatus,
          toStatus,
        })),
      );
      return Promise.resolve();
    },
  } as unknown as SupplierEnforcementRepository;
  const revoked: string[] = [];
  let revokeFails = false;
  const service = createSupplierEnforcementService(
    repository,
    () => Promise.resolve(client),
    () => NOW,
    (userId) => {
      if (revokeFails) return Promise.reject(new Error("redis down"));
      revoked.push(userId);
      return Promise.resolve();
    },
  );
  return {
    state,
    service,
    revoked,
    as(principal: AuthPrincipal) {
      actor = principal;
    },
    failRevoke(value: boolean) {
      revokeFails = value;
    },
    async request(
      incidentId: string,
      actionType: Action["actionType"],
      evidenceInspectionId?: string,
    ) {
      actor = officer;
      return service.request(
        incidentId,
        validateRequestEnforcement({
          supplierId,
          actionType,
          reason: "Phát hiện nguyên liệu quá hạn",
          ...(evidenceInspectionId ? { evidenceInspectionId } : {}),
        }),
        officer,
      );
    },
    async approve(actionId: string) {
      actor = sysadmin;
      return service.approve(
        actionId,
        validateApproveEnforcement({}),
        sysadmin,
      );
    },
  };
}

void test("PR6b catalog: request for officer, decide for System Admin", () => {
  const codes = INITIAL_PERMISSIONS.map((item) => item.code);
  assert(codes.includes("supplier_enforcement.request"));
  assert(codes.includes("supplier_enforcement.decide"));
  const grants = INITIAL_ROLE_PERMISSIONS.filter(([, code]) =>
    code.startsWith("supplier_enforcement."),
  );
  assert.deepEqual(grants.map(([role, code]) => `${role}:${code}`).sort(), [
    "COMMUNE_FOOD_SAFETY_OFFICER:supplier_enforcement.request",
    "SYSTEM_ADMIN:supplier_enforcement.decide",
  ]);
});

void test("PR6b validation: LOCK needs evidence, reject needs note, strict fields", () => {
  assert.throws(
    () =>
      validateRequestEnforcement({
        supplierId,
        actionType: "LOCK_ACCOUNT",
        reason: "Phát hiện nguyên liệu quá hạn",
      }),
    invalid("evidenceInspectionId"),
  );
  assert.throws(
    () =>
      validateRequestEnforcement({
        supplierId,
        actionType: "PAUSE_INTAKE",
        reason: "ngắn",
      }),
    invalid("reason"),
  );
  assert.throws(
    () =>
      validateRequestEnforcement({
        supplierId,
        actionType: "PAUSE_INTAKE",
        reason: "Phát hiện nguyên liệu quá hạn",
        extra: true,
      }),
    RequestValidationError,
  );
  assert.throws(
    () => validateRejectEnforcement({ note: "  " }),
    invalid("note"),
  );
  assert.deepEqual(validateApproveEnforcement(undefined), {});
  assert.deepEqual(validateEnforcementListQuery({}), { page: 1, limit: 20 });
});

void test("PR6b scope: admin sees all, officer limited to recipient unit, others 403", () => {
  assert.deepEqual(listScopes["supplier-enforcement"](sysadmin), {});
  assert.deepEqual(listScopes["supplier-enforcement"](officer), {
    Incident: { recipientCommuneFoodSafetyUnitId: unitId },
  });
  assert.throws(
    () =>
      listScopes["supplier-enforcement"]({
        ...sysadmin,
        permissions: ["supplier_enforcement.request"],
      }),
    status(403),
  );
  assert.throws(
    () =>
      listScopes["supplier-enforcement"]({
        ...officer,
        role: "SCHOOL_MANAGEMENT_BOARD",
        orgType: "SCHOOL",
        schoolId,
        communeFoodSafetyUnitId: null,
      }),
    status(403),
  );
});

void test("PR6b request rules: supplier, evidence, duplicates, restore precondition", async () => {
  const f = setup();
  await assert.rejects(f.request(incidentA, "RESTORE"), status(409));
  await assert.rejects(
    f.service.request(
      incidentA,
      validateRequestEnforcement({
        supplierId: otherSupplier,
        actionType: "PAUSE_INTAKE",
        reason: "Phát hiện nguyên liệu quá hạn",
      }),
      officer,
    ),
    invalid("supplierId"),
  );
  await assert.rejects(
    f.request(incidentA, "LOCK_ACCOUNT", inspectionB),
    invalid("evidenceInspectionId"),
  );
  f.state.inspections.get(inspectionA)!.finding = "CLEARED";
  await assert.rejects(
    f.request(incidentA, "LOCK_ACCOUNT", inspectionA),
    status(409),
  );
  f.state.inspections.get(inspectionA)!.finding = "AT_FAULT";
  const pause = await f.request(incidentA, "PAUSE_INTAKE");
  assert.equal(pause.decisionStatus, "PENDING");
  assert.equal(pause.executionStatus, "NOT_APPLIED");
  await assert.rejects(f.request(incidentA, "PAUSE_INTAKE"), status(409));
  f.state.incidents.set(incidentB, { status: "SUBMITTED_TO_AUTHORITY" });
  await assert.rejects(f.request(incidentB, "PAUSE_INTAKE"), status(409));
  await assert.rejects(
    f.service.request(
      "60000000-0000-4000-8000-000000000099",
      validateRequestEnforcement({
        supplierId,
        actionType: "PAUSE_INTAKE",
        reason: "Phát hiện nguyên liệu quá hạn",
      }),
      officer,
    ),
    status(404),
  );
  await assert.rejects(
    f.service.request(
      incidentA,
      validateRequestEnforcement({
        supplierId,
        actionType: "PAUSE_INTAKE",
        reason: "Phát hiện nguyên liệu quá hạn",
      }),
      sysadmin,
    ),
    status(403),
  );
});

void test("PR6b approve PAUSE then reject twice-decided and duplicate restriction", async () => {
  const f = setup();
  const pause = await f.request(incidentA, "PAUSE_INTAKE");
  const result = await f.approve(pause.id);
  assert.equal(result.action.decisionStatus, "APPROVED");
  assert.equal(result.action.executionStatus, "APPLIED");
  assert.equal(result.supplierIntakeState, "PAUSED_FOR_FOOD_SAFETY_INSPECTION");
  assert.equal(f.state.restrictions.length, 1);
  await assert.rejects(f.approve(pause.id), status(409));
  await assert.rejects(f.request(incidentA, "PAUSE_INTAKE"), status(409));
  await assert.rejects(f.service.approve(pause.id, {}, officer), status(403));
});

void test("PR6b reject records the note and leaves NOT_APPLIED", async () => {
  const f = setup();
  const pause = await f.request(incidentA, "PAUSE_INTAKE");
  f.as(sysadmin);
  const rejected = await f.service.reject(
    pause.id,
    validateRejectEnforcement({ note: "Chưa đủ căn cứ" }),
    sysadmin,
  );
  assert.equal(rejected.decisionStatus, "REJECTED");
  assert.equal(rejected.executionStatus, "NOT_APPLIED");
  assert.equal(rejected.decisionNote, "Chưa đủ căn cứ");
  assert.equal(f.state.restrictions.length, 0);
  assert.equal(f.state.intake, "ACTIVE");
});

void test("PR6b LOCK locks only ACTIVE accounts, revokes sessions, FAILED then retry", async () => {
  const f = setup();
  const lock = await f.request(incidentA, "LOCK_ACCOUNT", inspectionA);
  f.failRevoke(true);
  const failed = await f.approve(lock.id);
  assert.equal(failed.lockedAccountCount, 2);
  assert.equal(failed.action.executionStatus, "FAILED");
  assert.match(failed.action.executionNote ?? "", /chạy lại/);
  assert.equal(f.state.users.get(adminUser), "LOCKED");
  assert.equal(f.state.users.get(staffActive), "LOCKED");
  assert.equal(f.state.users.get(staffManual), "LOCKED");
  assert.deepEqual(
    f.state.locks.map((item) => item.userId).sort(),
    [adminUser, staffActive].sort(),
  );
  assert.equal(f.state.histories.length, 2);
  f.failRevoke(false);
  f.as(sysadmin);
  const retried = await f.service.retry(lock.id, sysadmin);
  assert.equal(retried.action.executionStatus, "APPLIED");
  assert.deepEqual(f.revoked.sort(), [adminUser, staffActive].sort());
  await assert.rejects(f.service.retry(lock.id, sysadmin), status(409));
});

void test("PR6b RESTORE does not override another incident's restriction", async () => {
  const f = setup();
  await f.approve((await f.request(incidentA, "LOCK_ACCOUNT", inspectionA)).id);
  await f.approve((await f.request(incidentB, "LOCK_ACCOUNT", inspectionB)).id);
  // B khóa sau A: tài khoản đã LOCKED nên không ghi liên kết mới cho B.
  assert.equal(f.state.locks.length, 2);

  const restoreA = await f.approve((await f.request(incidentA, "RESTORE")).id);
  assert.equal(restoreA.unlockedAccountCount, 0);
  assert.equal(
    restoreA.supplierIntakeState,
    "PAUSED_FOR_FOOD_SAFETY_INSPECTION",
  );
  assert.match(restoreA.action.executionNote ?? "", /Giữ khóa 2 tài khoản/);
  assert.equal(f.state.users.get(adminUser), "LOCKED");

  const restoreB = await f.approve((await f.request(incidentB, "RESTORE")).id);
  assert.equal(restoreB.unlockedAccountCount, 2);
  assert.equal(restoreB.supplierIntakeState, "ACTIVE");
  assert.equal(f.state.users.get(adminUser), "ACTIVE");
  assert.equal(f.state.users.get(staffActive), "ACTIVE");
  // Tài khoản bị khóa thủ công trước sự cố giữ nguyên.
  assert.equal(f.state.users.get(staffManual), "LOCKED");
  assert(f.state.restrictions.every((item) => !item.isActive));
  assert(f.state.locks.every((item) => item.unlockedAt));
  assert.equal(
    f.state.histories.filter((item) => item.toStatus === "ACTIVE").length,
    2,
  );
});

void test("PR6b RESTORE keeps intake paused while a PAUSE from another incident remains", async () => {
  const f = setup();
  await f.approve((await f.request(incidentA, "PAUSE_INTAKE")).id);
  await f.approve((await f.request(incidentB, "PAUSE_INTAKE")).id);
  const restoreA = await f.approve((await f.request(incidentA, "RESTORE")).id);
  assert.equal(
    restoreA.supplierIntakeState,
    "PAUSED_FOR_FOOD_SAFETY_INSPECTION",
  );
  assert.match(restoreA.action.executionNote ?? "", /Còn 1 hạn chế khác/);
  // RESTORE thứ hai của A: không còn hạn chế → 409 lúc đề nghị.
  await assert.rejects(f.request(incidentA, "RESTORE"), status(409));
  const restoreB = await f.approve((await f.request(incidentB, "RESTORE")).id);
  assert.equal(restoreB.supplierIntakeState, "ACTIVE");
});
