import assert from "node:assert/strict";
import test from "node:test";
import {
  INITIAL_PERMISSIONS,
  INITIAL_ROLE_PERMISSIONS,
} from "../src/constants/permission-catalog";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import type {
  FoodSafetyIncidentDetailRow,
  FoodSafetyIncidentRepository,
  SnapshotEvidenceRow,
  TraceSnapshotRow,
  TraceSourceRow,
} from "../src/modules/food-safety-incident/food-safety-incident.repository";
import {
  allowedIncidentActions,
  buildTraceSnapshot,
  createFoodSafetyIncidentService,
  hashTracePayload,
  isReporterView,
  reporterSource,
} from "../src/modules/food-safety-incident/food-safety-incident.service";
import {
  validateAddFoodSafetyIncidentAllocations,
  validateCancelFoodSafetyIncident,
  validateDirectFoodSafetyIncident,
  validateFoodSafetyIncidentListQuery,
  validateForwardFoodSafetyIncident,
  validateFoodSafetyIncidentSnapshotParams,
  validateReportFoodSafetyIncident,
} from "../src/modules/food-safety-incident/food-safety-incident.validation";
import type { AuthPrincipal } from "../src/types/auth";
import type { EvidenceStorage } from "../src/utils/evidence-files";
import { HttpError } from "../src/utils/http-error";
import { RequestValidationError } from "../src/utils/request-validation";
import { listScopes } from "../src/utils/resource-access";

const NOW = new Date("2026-11-22T03:00:00.000Z");
const schoolId = "40000000-0000-4000-8000-000000000001";
const unitId = "40000000-0000-4000-8000-000000000002";
const incidentId = "40000000-0000-4000-8000-000000000003";
const classId = "40000000-0000-4000-8000-000000000004";
const allocationId = "40000000-0000-4000-8000-000000000005";

const parent: AuthPrincipal = {
  id: "40000000-0000-4000-8000-000000000010",
  username: "parent",
  fullName: "Phụ huynh",
  roleId: "40000000-0000-4000-8000-000000000011",
  role: "PARENTS_COMMITTEE",
  orgType: "SCHOOL",
  schoolId,
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: ["food_safety_incident.report", "food_safety_incident.view"],
};
const teacher: AuthPrincipal = {
  ...parent,
  id: "40000000-0000-4000-8000-000000000020",
  role: "HOMEROOM_TEACHER",
};
const board: AuthPrincipal = {
  ...parent,
  id: "40000000-0000-4000-8000-000000000030",
  role: "SCHOOL_MANAGEMENT_BOARD",
  permissions: [
    "food_safety_incident.view",
    "food_safety_incident.create",
    "food_safety_incident.manage",
    "food_safety_incident.forward",
  ],
};
const officer: AuthPrincipal = {
  ...parent,
  id: "40000000-0000-4000-8000-000000000040",
  role: "COMMUNE_FOOD_SAFETY_OFFICER",
  orgType: "AUTHORITY",
  schoolId: null,
  communeFoodSafetyUnitId: unitId,
  permissions: ["food_safety_incident.view", "food_safety_report.receive"],
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

/** Prisma client giả cho withSchoolTransaction: nạp lại actor, trường ACTIVE. */
function fakeClient(actor: AuthPrincipal) {
  return {
    $transaction<T>(
      op: (tx: Prisma.TransactionClient) => Promise<T>,
    ): Promise<T> {
      return op({
        $queryRaw: () => Promise.resolve([]),
        school: { findUnique: () => Promise.resolve({ status: "ACTIVE" }) },
        user: { findUnique: () => Promise.resolve(identityOf(actor)) },
      } as unknown as Prisma.TransactionClient);
    },
  } as unknown as PrismaClient;
}

function detailRow(
  overrides: Partial<FoodSafetyIncidentDetailRow> = {},
): FoodSafetyIncidentDetailRow {
  return {
    id: incidentId,
    code: "FP-IC-48213",
    schoolId,
    reportedByUserId: parent.id,
    title: "Đau bụng sau bữa trưa",
    description: "Nhiều học sinh đau bụng",
    status: "PENDING_SCHOOL_REVIEW",
    source: "PARENT_REPORT",
    reportedSymptomaticCount: 4,
    recipientCommuneFoodSafetyUnitId: null,
    occurredAt: null,
    resolvedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    reportedRoleCode: "PARENTS_COMMITTEE",
    symptomDescription: null,
    schoolPreliminaryAssessment: null,
    schoolPreliminaryNote: null,
    schoolReviewedAt: null,
    cancellationReason: null,
    cancellationNote: null,
    traceCompleteness: null,
    traceSnapshots: [],
    inspections: [],
    attachments: [],
    School: { id: schoolId, name: "Trường A" },
    User: { id: parent.id, fullName: parent.fullName },
    SchoolReviewedBy: null,
    ReportedClass: null,
    RecipientUnit: null,
    foodSafetyReportForwardings: [],
    foodSafetyIncidentAllocations: [],
    statusHistories: [
      {
        fromStatus: null,
        toStatus: "PENDING_SCHOOL_REVIEW",
        note: null,
        createdAt: NOW,
        actorRoleCode: "PARENTS_COMMITTEE",
        actorUser: { id: parent.id, fullName: parent.fullName },
      },
    ],
    ...overrides,
  };
}

/** Repository giả ghi lại thứ tự gọi. */
function setup(
  actor: AuthPrincipal,
  options: {
    target?: {
      status: string;
      recipientCommuneFoodSafetyUnitId?: string | null;
    } | null;
    added?: number;
    activeUnit?: boolean;
    snapshot?: TraceSnapshotRow | null;
    locationId?: string | null;
    unit?: boolean;
    officer?: boolean;
    homeroom?: boolean;
    classExists?: boolean;
    changed?: number;
    allocations?: { id: string; status: string }[];
    evidence?: SnapshotEvidenceRow[];
    detail?: FoodSafetyIncidentDetailRow;
    storage?: EvidenceStorage;
  } = {},
) {
  const calls: string[] = [];
  const created: Record<string, unknown>[] = [];
  const histories: Record<string, unknown>[] = [];
  const snapshots: Record<string, unknown>[] = [];
  const attachments: Record<string, unknown>[] = [];
  const target =
    options.target === undefined
      ? { status: "PENDING_SCHOOL_REVIEW" }
      : options.target;
  const repository = {
    connect: () => Promise.resolve(fakeClient(actor)),
    list: () => Promise.resolve([]),
    findDetail: () => Promise.resolve(options.detail ?? detailRow()),
    lockIncident: () => {
      calls.push("lock");
      return Promise.resolve();
    },
    findTarget: () =>
      Promise.resolve(
        target
          ? {
              id: incidentId,
              code: "FP-IC-48213",
              schoolId,
              status: target.status,
              source: "PARENT_REPORT",
              recipientCommuneFoodSafetyUnitId:
                target.recipientCommuneFoodSafetyUnitId === undefined
                  ? unitId
                  : target.recipientCommuneFoodSafetyUnitId,
            }
          : null,
      ),
    findActiveClass: () =>
      Promise.resolve(options.classExists === false ? null : { id: classId }),
    isCurrentHomeroom: () => Promise.resolve(options.homeroom ?? true),
    findSchoolLocationId: () => {
      calls.push("location");
      return Promise.resolve(
        options.locationId === undefined ? "ward" : options.locationId,
      );
    },
    findRecipientUnit: () =>
      Promise.resolve(
        options.unit === false ? null : { id: unitId, name: "ATTP phường A" },
      ),
    findUnitOfficer: () =>
      Promise.resolve(options.officer === false ? null : { id: officer.id }),
    allocateCode: () => {
      calls.push("code");
      return Promise.resolve("FP-IC-48213");
    },
    create: (_tx: unknown, data: Record<string, unknown>) => {
      calls.push("create");
      created.push(data);
      return Promise.resolve(incidentId);
    },
    recordHistory: (_tx: unknown, data: Record<string, unknown>) => {
      calls.push("history");
      histories.push(data);
      return Promise.resolve();
    },
    markForwarded: () => {
      calls.push("forward");
      return Promise.resolve(options.changed ?? 1);
    },
    createForwarding: () => {
      calls.push("forwarding");
      return Promise.resolve();
    },
    markCancelled: () => {
      calls.push("cancel");
      return Promise.resolve(options.changed ?? 1);
    },
    findSchoolAllocations: () =>
      Promise.resolve(
        options.allocations ?? [{ id: allocationId, status: "DISTRIBUTED" }],
      ),
    addAllocations: () => {
      calls.push("allocations");
      return Promise.resolve(options.added ?? 1);
    },
    findActiveUnit: () =>
      Promise.resolve(
        options.activeUnit === false
          ? null
          : { id: unitId, name: "ATTP phường A" },
      ),
    addAttachments: (_tx: unknown, data: { files: unknown[] }) => {
      // Như repository thật: không có file thì không ghi.
      if (!data.files.length) return Promise.resolve();
      calls.push("attachments");
      attachments.push(data);
      return Promise.resolve();
    },
    findSnapshotEvidence: () => Promise.resolve(options.evidence ?? []),
    findTraceSource: () => Promise.resolve([]),
    nextSnapshotVersion: () => Promise.resolve(snapshots.length + 1),
    createSnapshot: (
      _tx: unknown,
      version: number,
      data: Record<string, unknown>,
    ) => {
      calls.push("snapshot");
      snapshots.push({ version, ...data });
      return Promise.resolve(`snapshot-${version}`);
    },
    findSnapshot: () => Promise.resolve(options.snapshot ?? null),
  };
  const service = createFoodSafetyIncidentService(
    repository as unknown as FoodSafetyIncidentRepository,
    () => Promise.resolve(fakeClient(actor)),
    () => NOW,
    options.storage,
  );
  return { service, calls, created, histories, snapshots, attachments };
}

const report = {
  title: "Đau bụng sau bữa trưa",
  description: "Nhiều học sinh đau bụng sau bữa trưa",
  reportedSymptomaticCount: 4,
};

void test("validation: strict bodies, limits, enums and duplicate allocations", () => {
  assert.deepEqual(validateReportFoodSafetyIncident(report), report);
  assert.throws(
    () => validateReportFoodSafetyIncident({ ...report, source: "X" }),
    invalid("source"),
  );
  assert.throws(
    () => validateReportFoodSafetyIncident({ ...report, description: "ngắn" }),
    invalid("description"),
  );
  for (const count of [0, 1.5, 100_001])
    assert.throws(
      () =>
        validateReportFoodSafetyIncident({
          ...report,
          reportedSymptomaticCount: count,
        }),
      invalid("reportedSymptomaticCount"),
    );
  assert.throws(
    () =>
      validateReportFoodSafetyIncident({ ...report, occurredAt: "2026-11-22" }),
    invalid("occurredAt"),
  );
  assert.ok(
    validateReportFoodSafetyIncident({
      ...report,
      occurredAt: "2026-11-22T01:00:00+07:00",
    }).occurredAt instanceof Date,
  );
  assert.throws(
    () =>
      validateReportFoodSafetyIncident({
        ...report,
        preliminaryAssessment: "OUTSIDE_MEAL",
      }),
    invalid("preliminaryAssessment"),
  );
  assert.throws(
    () => validateDirectFoodSafetyIncident(report),
    invalid("preliminaryAssessment"),
  );
  assert.equal(
    validateForwardFoodSafetyIncident({ preliminaryAssessment: "OUTSIDE_MEAL" })
      .preliminaryAssessment,
    "OUTSIDE_MEAL",
  );
  assert.throws(
    () =>
      validateCancelFoodSafetyIncident({ reason: "OUTSIDE_MEAL", note: "x" }),
    invalid("reason"),
  );
  assert.throws(
    () => validateCancelFoodSafetyIncident({ reason: "DUPLICATE_REPORT" }),
    invalid("note"),
  );
  assert.throws(
    () =>
      validateAddFoodSafetyIncidentAllocations({
        mealAllocationIds: [allocationId, allocationId.toUpperCase()],
      }),
    invalid("mealAllocationIds"),
  );
  assert.throws(
    () => validateFoodSafetyIncidentListQuery({ status: "OPEN" }),
    invalid("status"),
  );
});

void test("scope: BGH sees the school, reporters only their own reports, school administration none", () => {
  assert.deepEqual(listScopes["food-safety-incident"](board), { schoolId });
  assert.deepEqual(listScopes["food-safety-incident"](parent), {
    schoolId,
    reportedByUserId: parent.id,
    source: { in: ["PARENT_REPORT", "TEACHER_REPORT"] },
  });
  assert.throws(
    () =>
      listScopes["food-safety-incident"]({
        ...board,
        role: "SCHOOL_ADMINISTRATION",
      }),
    status(403),
  );
  assert.throws(
    () => listScopes["food-safety-incident"]({ ...parent, permissions: [] }),
    status(403),
  );
  assert.deepEqual(listScopes["food-safety-incident"](officer), {
    foodSafetyReportForwardings: {
      some: {
        recipientCommuneFoodSafetyUnitId: unitId,
        OR: [{ recipientUserId: officer.id }, { recipientUserId: null }],
      },
    },
  });
  assert.equal(isReporterView(parent), true);
  assert.equal(isReporterView(board), false);
  assert.equal(isReporterView(officer), false);
});

void test("actions and catalog: only BGH acts; reporter grants for parents and homeroom teachers", () => {
  assert.equal(reporterSource("PARENTS_COMMITTEE"), "PARENT_REPORT");
  assert.equal(reporterSource("HOMEROOM_TEACHER"), "TEACHER_REPORT");
  assert.equal(reporterSource("SCHOOL_MANAGEMENT_BOARD"), null);
  assert.deepEqual(allowedIncidentActions(board, "PENDING_SCHOOL_REVIEW"), [
    "FORWARD",
    "CANCEL",
    "ADD_ALLOCATIONS",
  ]);
  assert.deepEqual(allowedIncidentActions(board, "SUBMITTED_TO_AUTHORITY"), [
    "ADD_ALLOCATIONS",
  ]);
  assert.deepEqual(allowedIncidentActions(board, "CANCELLED_BY_SCHOOL"), []);
  assert.deepEqual(allowedIncidentActions(parent, "PENDING_SCHOOL_REVIEW"), []);
  assert.deepEqual(
    allowedIncidentActions(officer, "SUBMITTED_TO_AUTHORITY"),
    [],
  );
  assert.ok(
    INITIAL_PERMISSIONS.some(
      (permission) => permission.code === "food_safety_incident.report",
    ),
  );
  const holders = (code: string) =>
    INITIAL_ROLE_PERMISSIONS.filter(([, permission]) => permission === code)
      .map(([role]) => role)
      .sort();
  assert.deepEqual(holders("food_safety_incident.report"), [
    "HOMEROOM_TEACHER",
    "PARENTS_COMMITTEE",
  ]);
  assert.ok(holders("food_safety_incident.view").includes("HOMEROOM_TEACHER"));
  assert.ok(
    !INITIAL_ROLE_PERMISSIONS.some(
      ([role, permission]) =>
        role === "SCHOOL_ADMINISTRATION" &&
        permission.startsWith("food_safety_incident."),
    ),
  );
});

void test("report: parent creates PENDING_SCHOOL_REVIEW with code and history; reporter projection", async () => {
  const f = setup(parent);
  const result = await f.service.report(report, parent);
  assert.deepEqual(f.calls, ["code", "create", "history"]);
  assert.equal(f.created[0].status, "PENDING_SCHOOL_REVIEW");
  assert.equal(f.created[0].source, "PARENT_REPORT");
  assert.equal(f.created[0].reportedRoleCode, "PARENTS_COMMITTEE");
  assert.equal(f.created[0].reportedClassId, null);
  assert.equal(f.histories[0].fromStatus, null);
  assert.equal(result.view, "REPORTER");
  assert.equal("preliminaryAssessment" in result, false);
});

void test("report: homeroom teacher must name their own class; others are rejected", async () => {
  await assert.rejects(
    setup(teacher).service.report(report, teacher),
    invalid("classId"),
  );
  await assert.rejects(
    setup(teacher, { homeroom: false }).service.report(
      { ...report, classId },
      teacher,
    ),
    status(403),
  );
  await assert.rejects(
    setup(parent, { classExists: false }).service.report(
      { ...report, classId },
      parent,
    ),
    status(404),
  );
  const f = setup(teacher);
  await f.service.report({ ...report, classId }, teacher);
  assert.equal(f.created[0].source, "TEACHER_REPORT");
  assert.equal(f.created[0].reportedClassId, classId);
  await assert.rejects(
    setup(board).service.report(report, {
      ...board,
      permissions: [...board.permissions, "food_safety_incident.report"],
    }),
    status(403),
  );
  const future = setup(parent);
  await assert.rejects(
    future.service.report(
      { ...report, occurredAt: new Date(NOW.getTime() + 60_000) },
      parent,
    ),
    invalid("occurredAt"),
  );
  assert.deepEqual(future.calls, []);
});

void test("forward: only from PENDING_SCHOOL_REVIEW, recipient derived from the ward, forwarding created", async () => {
  const f = setup(board);
  const result = await f.service.forward(
    incidentId,
    { preliminaryAssessment: "OUTSIDE_MEAL" },
    board,
  );
  assert.deepEqual(f.calls, [
    "lock",
    "location",
    "forward",
    "history",
    "snapshot",
    "forwarding",
  ]);
  assert.equal(result.view, "FULL");
  for (const [options, code] of [
    [{ target: { status: "SUBMITTED_TO_AUTHORITY" } }, 409],
    [{ target: null }, 404],
    [{ locationId: null }, 409],
    [{ unit: false }, 409],
    [{ officer: false }, 409],
    [{ changed: 0 }, 409],
  ] as const) {
    const failing = setup(board, options);
    await assert.rejects(
      failing.service.forward(
        incidentId,
        { preliminaryAssessment: "UNDETERMINED" },
        board,
      ),
      status(code),
    );
    assert.ok(!failing.calls.includes("forwarding"));
  }
  await assert.rejects(
    setup(parent).service.forward(
      incidentId,
      { preliminaryAssessment: "UNDETERMINED" },
      { ...parent, permissions: ["food_safety_incident.forward"] },
    ),
    status(403),
  );
});

void test("direct: BGH needs create and forward; record starts SUBMITTED_TO_AUTHORITY with forwarding", async () => {
  const f = setup(board);
  await f.service.createDirect(
    { ...report, preliminaryAssessment: "SCHOOL_MEAL_SUSPECTED" },
    board,
  );
  assert.deepEqual(f.calls, [
    "location",
    "code",
    "create",
    "history",
    "snapshot",
    "forwarding",
  ]);
  assert.equal(f.created[0].source, "SCHOOL_DIRECT");
  assert.equal(f.created[0].status, "SUBMITTED_TO_AUTHORITY");
  assert.equal(f.created[0].recipientCommuneFoodSafetyUnitId, unitId);
  assert.equal(f.created[0].schoolReviewedByUserId, board.id);
  const noForward = {
    ...board,
    permissions: board.permissions.filter(
      (code) => code !== "food_safety_incident.forward",
    ),
  };
  await assert.rejects(
    setup(noForward).service.createDirect(
      { ...report, preliminaryAssessment: "UNDETERMINED" },
      noForward,
    ),
    status(403),
  );
  const missing = setup(board, { locationId: null });
  await assert.rejects(
    missing.service.createDirect(
      { ...report, preliminaryAssessment: "UNDETERMINED" },
      board,
    ),
    status(409),
  );
  assert.ok(!missing.calls.includes("create"));
});

void test("cancel and allocations: state and school checks", async () => {
  const f = setup(board);
  await f.service.cancel(
    incidentId,
    { reason: "DUPLICATE_REPORT", note: "Trùng hồ sơ FP-IC-00001" },
    board,
  );
  assert.deepEqual(f.calls, ["lock", "cancel", "history"]);
  assert.equal(f.histories[0].toStatus, "CANCELLED_BY_SCHOOL");
  await assert.rejects(
    setup(board, {
      target: { status: "SUBMITTED_TO_AUTHORITY" },
    }).service.cancel(
      incidentId,
      { reason: "DUPLICATE_REPORT", note: "x" },
      board,
    ),
    status(409),
  );
  const body = { mealAllocationIds: [allocationId] };
  assert.equal(
    (await setup(board).service.addAllocations(incidentId, body, board)).added,
    1,
  );
  await assert.rejects(
    setup(board, { allocations: [] }).service.addAllocations(
      incidentId,
      body,
      board,
    ),
    status(404),
  );
  await assert.rejects(
    setup(board, {
      allocations: [{ id: allocationId, status: "ALLOCATED" }],
    }).service.addAllocations(incidentId, body, board),
    status(409),
  );
  await assert.rejects(
    setup(board, { target: { status: "CLOSED" } }).service.addAllocations(
      incidentId,
      body,
      board,
    ),
    status(409),
  );
});

// ---- PR5b: snapshot truy xuất ----

const batchId = "40000000-0000-4000-8000-000000000101";
const dishId = "40000000-0000-4000-8000-000000000102";
const lotId = "40000000-0000-4000-8000-000000000103";
const supplierId = "40000000-0000-4000-8000-000000000104";
const facilityId = "40000000-0000-4000-8000-000000000105";
const sampleId = "40000000-0000-4000-8000-000000000106";
const decimal = (value: string) => ({
  toFixed: (n: number) => Number(value).toFixed(n),
});

function traceRow(
  id: string,
  options: {
    lots?: boolean;
    sample?: boolean;
    batches?: boolean;
    portions?: number;
  } = {},
): TraceSourceRow {
  const lot = {
    ingredientLotId: lotId,
    quantityUsed: decimal("2.5"),
    unit: "kg",
    IngredientLot: {
      id: lotId,
      lotCode: "LOT-1",
      manufactureDate: new Date("2026-11-18T00:00:00.000Z"),
      expiryDate: null,
      unit: "kg",
      SourceFacility: {
        id: facilityId,
        supplierId,
        name: "Trại A",
        facilityCode: null,
      },
      DeliveryItem: {
        ingredientId: "40000000-0000-4000-8000-000000000107",
        ingredientNameSnapshot: null,
        Ingredient: { name: "Thịt heo" },
        Delivery: {
          id: "40000000-0000-4000-8000-000000000108",
          deliveryNo: "DE-1",
          Supplier: { id: supplierId, name: "NCC A" },
        },
      },
    },
  };
  const sample = {
    id: sampleId,
    sampledAt: NOW,
    status: "STORED",
    quantity: decimal("0.1"),
    unit: "kg",
    storageLocation: "Tủ 1",
    photoHash: null,
  };
  return {
    mealAllocationId: id,
    MealAllocation: {
      id,
      status: "DISTRIBUTED",
      distributedAt: NOW,
      finalizedAt: null,
      DailyMealPortion: {
        id: `${id.slice(0, -3)}900`,
        mealDate: new Date("2026-11-21T00:00:00.000Z"),
        mealType: "LUNCH",
        totalPortions: options.portions ?? 30,
        Class: { id: classId, name: "1A" },
      },
      mealAllocationBatches:
        options.batches === false
          ? []
          : [
              {
                cookingBatchId: batchId,
                dishId,
                allocatedPortions: decimal("30"),
                CookingBatch: {
                  id: batchId,
                  batchCode: "CB-1",
                  menuDayId: "40000000-0000-4000-8000-000000000109",
                  mealType: "LUNCH",
                  status: "COMPLETED",
                  completedAt: NOW,
                },
                CookingBatchDish: {
                  Dish: { name: "Thịt kho" },
                  cookingBatchLots: options.lots === false ? [] : [lot],
                  retainedFoodSamples: options.sample === false ? [] : [sample],
                },
              },
            ],
    },
  } as unknown as TraceSourceRow;
}

const incident = { id: incidentId, code: "FP-IC-48213", schoolId };
const otherAllocation = "40000000-0000-4000-8000-000000000006";

void test("trace payload: MISSING without allocations, COMPLETE with full chain, PARTIAL lists gaps", () => {
  const empty = buildTraceSnapshot(incident, []);
  assert.equal(empty.completeness, "MISSING");
  assert.deepEqual(empty.missingReasons, [{ code: "NO_ALLOCATIONS" }]);
  assert.equal(empty.payload.potentialExposedPortionCount, 0);

  const full = buildTraceSnapshot(incident, [
    traceRow(otherAllocation, { portions: 25 }),
    traceRow(allocationId),
  ]);
  assert.equal(full.completeness, "COMPLETE");
  assert.deepEqual(full.missingReasons, []);
  assert.deepEqual(
    full.payload.allocations.map((item) => item.id),
    [allocationId, otherAllocation],
  );
  // Hai suất ăn dùng chung mẻ/món: lô, mẫu lưu, NCC chỉ xuất hiện một lần.
  assert.equal(full.payload.cookingBatches.length, 1);
  assert.equal(full.payload.allocationBatches.length, 2);
  assert.equal(full.payload.lotUsages.length, 1);
  assert.equal(full.payload.lotUsages[0].quantityUsed, "2.500");
  assert.equal(full.payload.ingredientLots[0].manufactureDate, "2026-11-18");
  assert.equal(full.payload.ingredientLots[0].ingredientName, "Thịt heo");
  assert.deepEqual(full.payload.suppliers, [{ id: supplierId, name: "NCC A" }]);
  assert.equal(full.payload.sourceFacilities.length, 1);
  assert.equal(full.payload.retainedSamples[0].quantity, "0.100");
  assert.equal(full.payload.potentialExposedPortionCount, 55);
  // Thứ tự đầu vào không đổi hash.
  const reversed = buildTraceSnapshot(incident, [
    traceRow(allocationId),
    traceRow(otherAllocation, { portions: 25 }),
  ]);
  assert.equal(
    hashTracePayload(reversed.payload),
    hashTracePayload(full.payload),
  );
  assert.match(hashTracePayload(full.payload), /^0x[0-9a-f]{64}$/);

  const partial = buildTraceSnapshot(incident, [
    traceRow(allocationId, { lots: false, sample: false }),
    traceRow(otherAllocation, { batches: false }),
  ]);
  assert.equal(partial.completeness, "PARTIAL");
  assert.deepEqual(partial.missingReasons.map((reason) => reason.code).sort(), [
    "ALLOCATION_WITHOUT_COOKING_BATCH",
    "COOKING_BATCH_DISH_WITHOUT_LOTS",
    "COOKING_BATCH_DISH_WITHOUT_RETAINED_SAMPLE",
  ]);
});

void test("allocations after submission: new snapshot + supplement forwarding; none when pending or duplicate", async () => {
  const body = { mealAllocationIds: [allocationId] };
  const submitted = { status: "AUTHORITY_ACKNOWLEDGED" };
  const f = setup(board, { target: submitted });
  await f.service.addAllocations(incidentId, body, board);
  assert.deepEqual(f.calls, ["lock", "allocations", "snapshot", "forwarding"]);
  assert.equal(f.snapshots[0].completeness, "MISSING");
  assert.equal(f.snapshots[0].payloadVersion, 2);
  assert.equal(
    f.snapshots[0].payloadHash,
    hashTracePayload(f.snapshots[0].payload),
  );

  const pending = setup(board);
  await pending.service.addAllocations(incidentId, body, board);
  assert.deepEqual(pending.calls, ["lock", "allocations"]);

  const duplicate = setup(board, { target: submitted, added: 0 });
  await duplicate.service.addAllocations(incidentId, body, board);
  assert.deepEqual(duplicate.calls, ["lock", "allocations"]);

  const legacy = setup(board, {
    target: {
      status: "UNDER_INSPECTION",
      recipientCommuneFoodSafetyUnitId: null,
    },
  });
  await legacy.service.addAllocations(incidentId, body, board);
  assert.deepEqual(legacy.calls, ["lock", "allocations", "snapshot"]);

  for (const options of [{ activeUnit: false }, { officer: false }]) {
    const failing = setup(board, { target: submitted, ...options });
    await assert.rejects(
      failing.service.addAllocations(incidentId, body, board),
      status(409),
    );
    assert.ok(!failing.calls.includes("forwarding"));
  }
});

void test("trace snapshot read: reporters 403, missing 404, hash recomputed", async () => {
  assert.deepEqual(
    validateFoodSafetyIncidentSnapshotParams({ id: incidentId, version: "2" }),
    { id: incidentId, version: 2 },
  );
  assert.throws(
    () =>
      validateFoodSafetyIncidentSnapshotParams({
        id: incidentId,
        version: "0",
      }),
    invalid("version"),
  );
  await assert.rejects(
    setup(parent).service.getTraceSnapshot(incidentId, 1, parent),
    status(403),
  );
  await assert.rejects(
    setup(officer).service.getTraceSnapshot(incidentId, 1, officer),
    status(404),
  );
  const draft = buildTraceSnapshot(incident, [traceRow(allocationId)]);
  const row = {
    id: "snapshot-1",
    incidentId,
    version: 1,
    completeness: draft.completeness,
    missingReasons: draft.missingReasons,
    payload: JSON.parse(JSON.stringify(draft.payload)) as unknown,
    payloadVersion: 1,
    hashAlgorithm: "KECCAK-256",
    payloadHash: hashTracePayload(draft.payload),
    createdAt: NOW,
    createdByUser: { id: board.id, fullName: board.fullName },
  } as unknown as TraceSnapshotRow;
  const ok = await setup(officer, { snapshot: row }).service.getTraceSnapshot(
    incidentId,
    1,
    officer,
  );
  assert.equal(ok.hashMatches, true);
  assert.equal(ok.completeness, "COMPLETE");
  const tampered = await setup(officer, {
    snapshot: { ...row, payloadHash: `0x${"0".repeat(64)}` },
  }).service.getTraceSnapshot(incidentId, 1, officer);
  assert.equal(tampered.hashMatches, false);
});
