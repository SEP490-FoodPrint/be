import assert from "node:assert/strict";
import test from "node:test";
import {
  INITIAL_PERMISSIONS,
  INITIAL_ROLE_PERMISSIONS,
} from "../src/constants/permission-catalog";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import { allowedIncidentActions } from "../src/modules/food-safety-incident/food-safety-incident.service";
import type { FoodSafetyInspectionRepository } from "../src/modules/food-safety-inspection/food-safety-inspection.repository";
import {
  createFoodSafetyInspectionService,
  snapshotSupplierIds,
} from "../src/modules/food-safety-inspection/food-safety-inspection.service";
import {
  validateCloseFoodSafetyIncident,
  validatePlanFoodSafetyInspection,
  validateRecordFoodSafetyInspectionResult,
} from "../src/modules/food-safety-inspection/food-safety-inspection.validation";
import type { AuthPrincipal } from "../src/types/auth";
import type { EvidenceStorage } from "../src/utils/evidence-files";
import { HttpError } from "../src/utils/http-error";
import { RequestValidationError } from "../src/utils/request-validation";

const NOW = new Date("2026-11-22T03:00:00.000Z");
const unitId = "50000000-0000-4000-8000-000000000001";
const incidentId = "50000000-0000-4000-8000-000000000002";
const inspectionId = "50000000-0000-4000-8000-000000000003";
const supplierA = "50000000-0000-4000-8000-000000000004";
const supplierB = "50000000-0000-4000-8000-000000000005";
const schoolId = "50000000-0000-4000-8000-000000000006";

const officer: AuthPrincipal = {
  id: "50000000-0000-4000-8000-000000000010",
  username: "officer",
  fullName: "Cán bộ ATTP",
  roleId: "50000000-0000-4000-8000-000000000011",
  role: "COMMUNE_FOOD_SAFETY_OFFICER",
  orgType: "AUTHORITY",
  schoolId: null,
  supplierId: null,
  communeFoodSafetyUnitId: unitId,
  permissions: ["food_safety_incident.view", "food_safety_inspection.manage"],
};
const board: AuthPrincipal = {
  ...officer,
  id: "50000000-0000-4000-8000-000000000020",
  role: "SCHOOL_MANAGEMENT_BOARD",
  orgType: "SCHOOL",
  schoolId,
  communeFoodSafetyUnitId: null,
  permissions: [
    "food_safety_incident.forward",
    "food_safety_incident.manage",
    "food_safety_inspection.manage",
  ],
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

function fakeClient(actor: AuthPrincipal) {
  return {
    $transaction<T>(
      op: (tx: Prisma.TransactionClient) => Promise<T>,
    ): Promise<T> {
      return op({
        $queryRaw: () => Promise.resolve([]),
        user: { findUnique: () => Promise.resolve(identityOf(actor)) },
      } as unknown as Prisma.TransactionClient);
    },
  } as unknown as PrismaClient;
}

const inspectionRow = (state: "PLANNED" | "COMPLETED") => ({
  id: inspectionId,
  incidentId,
  status: state,
  teamDescription: "Đoàn kiểm tra liên ngành phường",
  scheduledAt: NOW,
  resultSummary: state === "COMPLETED" ? "Phát hiện thịt quá hạn" : null,
  overallConclusion: state === "COMPLETED" ? "SUPPLIER_AT_FAULT" : null,
  completedAt: state === "COMPLETED" ? NOW : null,
  createdAt: NOW,
  findings: [],
  attachments: [] as {
    id: string;
    stage: "INSPECTION_RESULT";
    storagePublicId: string;
    mimeType: string;
    sizeBytes: number;
    originalFilename: string;
    createdAt: Date;
  }[],
});

function setup(
  actor: AuthPrincipal,
  options: {
    incident?: { status: string; source?: string } | null;
    inspection?: { status: string } | null;
    counts?: { planned: number; completed: number };
    payloads?: unknown[];
    changed?: number;
    storage?: EvidenceStorage;
  } = {},
) {
  const calls: string[] = [];
  const moves: string[] = [];
  const histories: Record<string, unknown>[] = [];
  const findings: unknown[] = [];
  const attachments: unknown[] = [];
  const incident =
    options.incident === undefined
      ? { status: "AUTHORITY_ACKNOWLEDGED" }
      : options.incident;
  const repository = {
    connect: () => Promise.resolve(fakeClient(actor)),
    lockIncident: () => {
      calls.push("lock");
      return Promise.resolve();
    },
    findOfficerTarget: (_db: unknown, _id: string, unit: string) =>
      Promise.resolve(
        incident && unit === unitId
          ? {
              id: incidentId,
              schoolId,
              status: incident.status,
              source: incident.source ?? "PARENT_REPORT",
            }
          : null,
      ),
    countInspections: () =>
      Promise.resolve(options.counts ?? { planned: 0, completed: 1 }),
    createInspection: () => {
      calls.push("create");
      return Promise.resolve(inspectionRow("PLANNED"));
    },
    findInspection: () =>
      Promise.resolve(
        options.inspection === undefined
          ? { id: inspectionId, status: "PLANNED" }
          : options.inspection,
      ),
    recordResult: () => {
      calls.push("result");
      return Promise.resolve(options.changed ?? 1);
    },
    createFindings: (_tx: unknown, _id: string, items: unknown[]) => {
      calls.push("findings");
      findings.push(...items);
      return Promise.resolve();
    },
    addResultAttachments: (_tx: unknown, data: { files: unknown[] }) => {
      if (!data.files.length) return Promise.resolve();
      calls.push("attachments");
      attachments.push(data);
      return Promise.resolve();
    },
    readInspection: () => Promise.resolve(inspectionRow("COMPLETED")),
    moveIncident: (_tx: unknown, _id: string, from: string, to: string) => {
      moves.push(`${from}->${to}`);
      return Promise.resolve(1);
    },
    recordHistory: (_tx: unknown, data: Record<string, unknown>) => {
      histories.push(data);
      return Promise.resolve();
    },
    snapshotPayloads: () =>
      Promise.resolve(
        options.payloads ?? [{ suppliers: [{ id: supplierA, name: "A" }] }],
      ),
    suppliersByIds: (_db: unknown, ids: string[]) =>
      Promise.resolve(ids.map((id) => ({ id, name: id }))),
    schoolSuppliers: () => Promise.resolve([{ id: supplierB, name: "B" }]),
  };
  const service = createFoodSafetyInspectionService(
    repository as unknown as FoodSafetyInspectionRepository,
    () => Promise.resolve(fakeClient(actor)),
    () => NOW,
    options.storage,
  );
  return { service, calls, moves, histories, findings, attachments };
}

const plan = {
  teamDescription: "Đoàn kiểm tra liên ngành phường",
  scheduledAt: NOW,
};
const result = {
  resultSummary: "Phát hiện thịt quá hạn sử dụng",
  overallConclusion: "SUPPLIER_AT_FAULT" as const,
  findings: [{ supplierId: supplierA, finding: "AT_FAULT" as const }],
};

void test("validation: plan, result consistency between conclusion and supplier findings, close", () => {
  assert.ok(
    validatePlanFoodSafetyInspection({
      teamDescription: " Đoàn ",
      scheduledAt: "2026-11-23T08:00:00+07:00",
    }).scheduledAt instanceof Date,
  );
  assert.throws(
    () =>
      validatePlanFoodSafetyInspection({
        teamDescription: "Đoàn",
        scheduledAt: "2026-11-23",
      }),
    invalid("scheduledAt"),
  );
  assert.throws(
    () =>
      validatePlanFoodSafetyInspection({
        teamDescription: "  ",
        scheduledAt: "2026-11-23T08:00:00Z",
      }),
    invalid("teamDescription"),
  );
  assert.deepEqual(validateRecordFoodSafetyInspectionResult(result), result);
  assert.throws(
    () => validateRecordFoodSafetyInspectionResult({ ...result, findings: [] }),
    invalid("findings"),
  );
  assert.throws(
    () =>
      validateRecordFoodSafetyInspectionResult({
        ...result,
        overallConclusion: "NOT_FOOD_RELATED",
      }),
    invalid("findings"),
  );
  assert.ok(
    validateRecordFoodSafetyInspectionResult({
      ...result,
      overallConclusion: "INCONCLUSIVE",
      findings: [{ supplierId: supplierA, finding: "CLEARED" }],
    }),
  );
  assert.throws(
    () =>
      validateRecordFoodSafetyInspectionResult({
        ...result,
        findings: [
          { supplierId: supplierA, finding: "AT_FAULT" },
          { supplierId: supplierA.toUpperCase(), finding: "CLEARED" },
        ],
      }),
    invalid("findings"),
  );
  assert.throws(
    () =>
      validateRecordFoodSafetyInspectionResult({
        ...result,
        resultSummary: "ngắn",
      }),
    invalid("resultSummary"),
  );
  assert.deepEqual(validateCloseFoodSafetyIncident(undefined), {});
  assert.throws(
    () => validateCloseFoodSafetyIncident({ reason: "x" }),
    invalid("reason"),
  );
});

void test("catalog and actions: officer of the recipient unit plans and closes", () => {
  assert.ok(
    INITIAL_PERMISSIONS.some(
      (item) => item.code === "food_safety_inspection.manage",
    ),
  );
  assert.deepEqual(
    INITIAL_ROLE_PERMISSIONS.filter(
      ([, code]) => code === "food_safety_inspection.manage",
    ).map(([role]) => role),
    ["COMMUNE_FOOD_SAFETY_OFFICER"],
  );
  assert.deepEqual(
    allowedIncidentActions(officer, "AUTHORITY_ACKNOWLEDGED", unitId),
    ["PLAN_INSPECTION"],
  );
  assert.deepEqual(
    allowedIncidentActions(officer, "UNDER_INSPECTION", unitId),
    ["PLAN_INSPECTION"],
  );
  assert.deepEqual(
    allowedIncidentActions(officer, "INSPECTION_COMPLETED", unitId),
    ["CLOSE"],
  );
  assert.deepEqual(
    allowedIncidentActions(officer, "SUBMITTED_TO_AUTHORITY", unitId),
    [],
  );
  assert.deepEqual(
    allowedIncidentActions(officer, "INSPECTION_COMPLETED", schoolId),
    [],
  );
  assert.deepEqual(
    allowedIncidentActions(
      { ...officer, permissions: ["food_safety_incident.view"] },
      "INSPECTION_COMPLETED",
      unitId,
    ),
    [],
  );
});

void test("snapshot suppliers: union of payload suppliers, malformed entries ignored", () => {
  assert.deepEqual(
    snapshotSupplierIds([
      { suppliers: [{ id: supplierB }, { id: supplierA }] },
      { suppliers: [{ id: supplierA }, { name: "x" }, null] },
      { suppliers: "bad" },
      null,
    ]),
    [supplierA, supplierB],
  );
});

void test("plan: acknowledged incident moves to UNDER_INSPECTION; other states and scopes rejected", async () => {
  const f = setup(officer);
  const created = await f.service.plan(incidentId, plan, officer);
  assert.equal(created.incidentStatus, "UNDER_INSPECTION");
  assert.deepEqual(f.calls, ["lock", "create"]);
  assert.deepEqual(f.moves, ["AUTHORITY_ACKNOWLEDGED->UNDER_INSPECTION"]);
  assert.equal(f.histories[0].toStatus, "UNDER_INSPECTION");

  const again = setup(officer, { incident: { status: "UNDER_INSPECTION" } });
  await again.service.plan(incidentId, plan, officer);
  assert.deepEqual(again.moves, []);

  for (const state of [
    "SUBMITTED_TO_AUTHORITY",
    "INSPECTION_COMPLETED",
    "CLOSED",
  ]) {
    const failing = setup(officer, { incident: { status: state } });
    await assert.rejects(
      failing.service.plan(incidentId, plan, officer),
      status(409),
    );
    assert.ok(!failing.calls.includes("create"));
  }
  await assert.rejects(
    setup(officer, { incident: null }).service.plan(incidentId, plan, officer),
    status(404),
  );
  await assert.rejects(
    setup(board).service.plan(incidentId, plan, board),
    status(403),
  );
  await assert.rejects(
    setup(officer).service.plan(incidentId, plan, {
      ...officer,
      permissions: ["food_safety_incident.view"],
    }),
    status(403),
  );
});

void test("result: written once, suppliers limited to the trace, last result completes the incident", async () => {
  const underInspection = { incident: { status: "UNDER_INSPECTION" } };
  const last = setup(officer, underInspection);
  const done = await last.service.recordResult(
    incidentId,
    inspectionId,
    result,
    officer,
  );
  assert.equal(done.incidentStatus, "INSPECTION_COMPLETED");
  assert.deepEqual(last.calls, ["lock", "result", "findings"]);
  assert.deepEqual(last.moves, ["UNDER_INSPECTION->INSPECTION_COMPLETED"]);
  assert.deepEqual(last.findings, [
    { supplierId: supplierA, finding: "AT_FAULT", evidenceNote: null },
  ]);

  const more = setup(officer, {
    ...underInspection,
    counts: { planned: 1, completed: 1 },
  });
  assert.equal(
    (await more.service.recordResult(incidentId, inspectionId, result, officer))
      .incidentStatus,
    "UNDER_INSPECTION",
  );
  assert.deepEqual(more.moves, []);

  const outside = setup(officer, underInspection);
  await assert.rejects(
    outside.service.recordResult(
      incidentId,
      inspectionId,
      {
        ...result,
        findings: [{ supplierId: supplierB, finding: "AT_FAULT" }],
      },
      officer,
    ),
    invalid("findings.0.supplierId"),
  );
  assert.deepEqual(outside.calls, ["lock"]);

  // Không có NCC trong snapshot → NCC có quan hệ với trường.
  const legacy = setup(officer, { ...underInspection, payloads: [] });
  await legacy.service.recordResult(
    incidentId,
    inspectionId,
    { ...result, findings: [{ supplierId: supplierB, finding: "AT_FAULT" }] },
    officer,
  );

  for (const [options, code] of [
    [{ incident: { status: "AUTHORITY_ACKNOWLEDGED" } }, 409],
    [{ ...underInspection, inspection: null }, 404],
    [{ ...underInspection, inspection: { status: "COMPLETED" } }, 409],
    [{ ...underInspection, changed: 0 }, 409],
  ] as const) {
    const failing = setup(officer, options);
    await assert.rejects(
      failing.service.recordResult(incidentId, inspectionId, result, officer),
      status(code),
    );
    assert.ok(!failing.calls.includes("findings"));
  }
});

void test("close: only INSPECTION_COMPLETED with every inspection completed; legacy exempt from having one", async () => {
  const completed = { incident: { status: "INSPECTION_COMPLETED" } };
  const f = setup(officer, completed);
  assert.deepEqual(
    await f.service.close(incidentId, { note: "Đã xử lý xong" }, officer),
    { id: incidentId, status: "CLOSED" },
  );
  assert.deepEqual(f.moves, ["INSPECTION_COMPLETED->CLOSED"]);
  assert.equal(f.histories[0].note, "Đã xử lý xong");

  await assert.rejects(
    setup(officer, {
      incident: { status: "UNDER_INSPECTION" },
    }).service.close(incidentId, {}, officer),
    status(409),
  );
  await assert.rejects(
    setup(officer, {
      ...completed,
      counts: { planned: 1, completed: 1 },
    }).service.close(incidentId, {}, officer),
    status(409),
  );
  await assert.rejects(
    setup(officer, {
      ...completed,
      counts: { planned: 0, completed: 0 },
    }).service.close(incidentId, {}, officer),
    status(409),
  );
  const legacy = setup(officer, {
    incident: { status: "INSPECTION_COMPLETED", source: "LEGACY_IMPORT" },
    counts: { planned: 0, completed: 0 },
  });
  await legacy.service.close(incidentId, {}, officer);
  assert.deepEqual(legacy.moves, ["INSPECTION_COMPLETED->CLOSED"]);
});

void test("supplier options: snapshot suppliers first, school relationships as fallback", async () => {
  assert.deepEqual(
    await setup(officer).service.getSupplierOptions(incidentId, officer),
    { source: "SNAPSHOT", items: [{ id: supplierA, name: supplierA }] },
  );
  assert.deepEqual(
    await setup(officer, { payloads: [] }).service.getSupplierOptions(
      incidentId,
      officer,
    ),
    { source: "SCHOOL_RELATIONSHIP", items: [{ id: supplierB, name: "B" }] },
  );
  await assert.rejects(
    setup(officer, { incident: null }).service.getSupplierOptions(
      incidentId,
      officer,
    ),
    status(404),
  );
});
