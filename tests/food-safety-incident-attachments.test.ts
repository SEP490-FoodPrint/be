import assert from "node:assert/strict";
import { once } from "node:events";
import { test, type TestContext } from "node:test";
import express from "express";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import type {
  FoodSafetyIncidentDetailRow,
  FoodSafetyIncidentRepository,
  IncidentAttachmentRow,
} from "../src/modules/food-safety-incident/food-safety-incident.repository";
import {
  buildTraceSnapshot,
  createFoodSafetyIncidentService,
  hashTracePayload,
  TRACE_PAYLOAD_VERSION,
  type FoodSafetyIncidentService,
} from "../src/modules/food-safety-incident/food-safety-incident.service";
import {
  validateDirectFoodSafetyIncident,
  validateForwardFoodSafetyIncident,
  validateReportFoodSafetyIncident,
} from "../src/modules/food-safety-incident/food-safety-incident.validation";
import { createFoodSafetyIncidentRouter } from "../src/modules/food-safety-incident/food-safety-incident.routes";
import type { FoodSafetyInspectionRepository } from "../src/modules/food-safety-inspection/food-safety-inspection.repository";
import {
  createFoodSafetyInspectionService,
  type FoodSafetyInspectionService,
} from "../src/modules/food-safety-inspection/food-safety-inspection.service";
import { validateRecordFoodSafetyInspectionResult } from "../src/modules/food-safety-inspection/food-safety-inspection.validation";
import { createFoodSafetyInspectionRouter } from "../src/modules/food-safety-inspection/food-safety-inspection.routes";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import type { AuthPrincipal } from "../src/types/auth";
import {
  storeEvidenceFiles,
  type EvidenceFile,
  type EvidenceStorage,
} from "../src/utils/evidence-files";
import { HttpError } from "../src/utils/http-error";
import { RequestValidationError } from "../src/utils/request-validation";

const NOW = new Date("2026-11-26T03:00:00.000Z");
const schoolId = "50000000-0000-4000-8000-000000000001";
const unitId = "50000000-0000-4000-8000-000000000002";
const incidentId = "50000000-0000-4000-8000-000000000003";
const inspectionId = "50000000-0000-4000-8000-000000000004";
const otherInspectionId = "50000000-0000-4000-8000-000000000005";
const supplierId = "50000000-0000-4000-8000-000000000006";

const parent: AuthPrincipal = {
  id: "50000000-0000-4000-8000-000000000010",
  username: "parent",
  fullName: "Phụ huynh",
  roleId: "50000000-0000-4000-8000-000000000011",
  role: "PARENTS_COMMITTEE",
  orgType: "SCHOOL",
  schoolId,
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: ["food_safety_incident.report", "food_safety_incident.view"],
};
const board: AuthPrincipal = {
  ...parent,
  id: "50000000-0000-4000-8000-000000000030",
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
  id: "50000000-0000-4000-8000-000000000040",
  role: "COMMUNE_FOOD_SAFETY_OFFICER",
  orgType: "AUTHORITY",
  schoolId: null,
  communeFoodSafetyUnitId: unitId,
  permissions: ["food_safety_incident.view", "food_safety_inspection.manage"],
};

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
const PDF = Buffer.from("%PDF-1.4\n");
const file = (
  buffer: Buffer,
  mimeType: string,
  name: string,
): EvidenceFile => ({
  buffer,
  size: buffer.length,
  mimeType,
  originalName: name,
});
const png = file(PNG, "image/png", "hoc-sinh.png");
const pdf = file(PDF, "application/pdf", "bien-ban.pdf");

const status = (code: number) => (error: unknown) =>
  error instanceof HttpError && error.statusCode === code;
const invalid = (field: string) => (error: unknown) =>
  error instanceof RequestValidationError &&
  error.fields.some((item) => item.field === field);

function memoryStorage() {
  const uploaded: string[] = [];
  const removed: string[] = [];
  const storage: EvidenceStorage = {
    upload: (_file, publicId) => {
      uploaded.push(publicId);
      return Promise.resolve();
    },
    remove: (publicId) => {
      removed.push(publicId);
      return Promise.resolve();
    },
    url: (publicId) => `signed:${publicId}`,
  };
  return { storage, uploaded, removed };
}

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
        school: { findUnique: () => Promise.resolve({ status: "ACTIVE" }) },
        user: { findUnique: () => Promise.resolve(identityOf(actor)) },
      } as unknown as Prisma.TransactionClient);
    },
  } as unknown as PrismaClient;
}

const attachment = (
  id: string,
  stage: IncidentAttachmentRow["stage"],
  inspection: string | null = null,
): IncidentAttachmentRow => ({
  id,
  stage,
  inspectionId: inspection,
  storagePublicId: `foodprint/food-safety-incidents/u/${id}.png`,
  mimeType: "image/png",
  sizeBytes: 10,
  originalFilename: `${id}.png`,
  createdAt: NOW,
});

function detailRow(
  overrides: Partial<FoodSafetyIncidentDetailRow> = {},
): FoodSafetyIncidentDetailRow {
  const inspection = (id: string) => ({
    id,
    status: "COMPLETED" as const,
    teamDescription: "Đoàn kiểm tra",
    scheduledAt: NOW,
    resultSummary: "Phát hiện thịt quá hạn",
    overallConclusion: "SUPPLIER_AT_FAULT" as const,
    completedAt: NOW,
    createdAt: NOW,
    recordedByUser: {
      id: officer.id,
      fullName: officer.fullName,
      roleCode: officer.role,
    },
    createdByUser: { id: officer.id, fullName: officer.fullName },
    findings: [],
  });
  return {
    id: incidentId,
    code: "FP-IC-48213",
    schoolId,
    reportedByUserId: parent.id,
    title: "Đau bụng sau bữa trưa",
    description: "Nhiều học sinh đau bụng",
    status: "INSPECTION_COMPLETED",
    source: "PARENT_REPORT",
    reportedSymptomaticCount: 4,
    recipientCommuneFoodSafetyUnitId: unitId,
    occurredAt: null,
    resolvedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    reportedRoleCode: "PARENTS_COMMITTEE",
    symptomDescription: null,
    schoolPreliminaryAssessment: "SCHOOL_MEAL_SUSPECTED",
    schoolPreliminaryNote: null,
    schoolReviewedAt: NOW,
    cancellationReason: null,
    cancellationNote: null,
    traceCompleteness: "MISSING",
    traceSnapshots: [],
    inspections: [inspection(inspectionId), inspection(otherInspectionId)],
    attachments: [
      attachment("a1", "REPORT"),
      attachment("a2", "SCHOOL_REVIEW"),
      attachment("a3", "INSPECTION_RESULT", inspectionId),
    ],
    School: { id: schoolId, name: "Trường A" },
    User: { id: parent.id, fullName: parent.fullName },
    SchoolReviewedBy: { id: board.id, fullName: board.fullName },
    ReportedClass: null,
    RecipientUnit: { id: unitId, name: "ATTP phường A" },
    foodSafetyReportForwardings: [],
    foodSafetyIncidentAllocations: [],
    statusHistories: [],
    ...overrides,
  };
}

function incidentSetup(
  actor: AuthPrincipal,
  storage: EvidenceStorage,
  options: {
    targetStatus?: string;
    classExists?: boolean;
    detail?: FoodSafetyIncidentDetailRow;
  } = {},
) {
  const calls: string[] = [];
  const attachments: {
    stage: string;
    uploaderUserId: string;
    files: { publicId: string; sha256: string }[];
  }[] = [];
  const snapshots: { payload: { evidenceFiles: unknown[] } }[] = [];
  const evidence: {
    id: string;
    stage: "REPORT" | "SCHOOL_REVIEW";
    mimeType: string;
    sizeBytes: number;
    sha256: string;
  }[] = [
    {
      id: "z-report",
      stage: "REPORT",
      mimeType: "image/png",
      sizeBytes: 10,
      sha256: "b".repeat(64),
    },
  ];
  const repository = {
    findDetail: () => Promise.resolve(options.detail ?? detailRow()),
    lockIncident: () => Promise.resolve(),
    findTarget: () =>
      Promise.resolve({
        id: incidentId,
        code: "FP-IC-48213",
        schoolId,
        status: options.targetStatus ?? "PENDING_SCHOOL_REVIEW",
        source: "PARENT_REPORT",
        recipientCommuneFoodSafetyUnitId: null,
      }),
    findActiveClass: () =>
      Promise.resolve(options.classExists === false ? null : { id: "c" }),
    isCurrentHomeroom: () => Promise.resolve(true),
    findSchoolLocationId: () => Promise.resolve("ward"),
    findRecipientUnit: () =>
      Promise.resolve({ id: unitId, name: "ATTP phường A" }),
    findUnitOfficer: () => Promise.resolve({ id: officer.id }),
    allocateCode: () => Promise.resolve("FP-IC-48213"),
    create: () => {
      calls.push("create");
      return Promise.resolve(incidentId);
    },
    recordHistory: () => {
      calls.push("history");
      return Promise.resolve();
    },
    markForwarded: () => {
      calls.push("forward");
      return Promise.resolve(1);
    },
    createForwarding: () => {
      calls.push("forwarding");
      return Promise.resolve();
    },
    addAttachments: (_tx: unknown, data: (typeof attachments)[number]) => {
      if (!data.files.length) return Promise.resolve();
      calls.push(`attachments:${data.stage}`);
      attachments.push(data);
      for (const [index, item] of data.files.entries())
        evidence.push({
          id: `a-${data.stage}-${index}`,
          stage: data.stage as "REPORT" | "SCHOOL_REVIEW",
          mimeType: "image/png",
          sizeBytes: 10,
          sha256: item.sha256,
        });
      return Promise.resolve();
    },
    findSnapshotEvidence: () => {
      calls.push("evidence");
      return Promise.resolve([...evidence]);
    },
    findTraceSource: () => Promise.resolve([]),
    nextSnapshotVersion: () => Promise.resolve(1),
    createSnapshot: (
      _tx: unknown,
      _version: number,
      data: (typeof snapshots)[number],
    ) => {
      calls.push("snapshot");
      snapshots.push(data);
      return Promise.resolve("snapshot-1");
    },
  };
  const service = createFoodSafetyIncidentService(
    repository as unknown as FoodSafetyIncidentRepository,
    () => Promise.resolve(fakeClient(actor)),
    () => NOW,
    storage,
  );
  return { service, calls, attachments, snapshots };
}

const report = {
  title: "Đau bụng sau bữa trưa",
  description: "Nhiều học sinh đau bụng sau bữa trưa",
  reportedSymptomaticCount: 4,
};

void test("validation: multipart strings, optional files ≤ 5 on report/direct/forward/result", () => {
  // multipart gửi mọi trường dưới dạng chuỗi; trường trống coi như không gửi.
  const parsed = validateReportFoodSafetyIncident({
    ...report,
    reportedSymptomaticCount: "4",
    classId: "",
    occurredAt: "",
    symptomDescription: "",
    files: [png],
  });
  assert.equal(parsed.reportedSymptomaticCount, 4);
  assert.equal(parsed.classId, undefined);
  assert.equal(parsed.occurredAt, undefined);
  assert.equal(parsed.files?.length, 1);
  for (const count of ["4.5", "abc", "0"])
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
      validateReportFoodSafetyIncident({
        ...report,
        files: Array<EvidenceFile>(6).fill(png),
      }),
    invalid("files"),
  );
  assert.equal(
    validateDirectFoodSafetyIncident({
      ...report,
      preliminaryAssessment: "UNDETERMINED",
      files: [pdf],
    }).files?.length,
    1,
  );
  assert.deepEqual(
    validateForwardFoodSafetyIncident({
      preliminaryAssessment: "OUTSIDE_MEAL",
      preliminaryNote: "",
      files: [],
    }),
    {
      preliminaryAssessment: "OUTSIDE_MEAL",
      preliminaryNote: undefined,
      files: [],
    },
  );
  const result = {
    resultSummary: "Phát hiện thịt quá hạn sử dụng",
    overallConclusion: "SUPPLIER_AT_FAULT",
  };
  // findings dạng chuỗi JSON trong multipart.
  assert.deepEqual(
    validateRecordFoodSafetyInspectionResult({
      ...result,
      findings: JSON.stringify([{ supplierId, finding: "AT_FAULT" }]),
      files: [pdf],
    }).findings,
    [{ supplierId, finding: "AT_FAULT" }],
  );
  assert.throws(
    () =>
      validateRecordFoodSafetyInspectionResult({
        ...result,
        findings: "[không phải JSON",
      }),
    invalid("findings"),
  );
});

void test("storage path: incident evidence lives under foodprint/food-safety-incidents/<userId>", async () => {
  const memory = memoryStorage();
  const stored = await storeEvidenceFiles(
    memory.storage,
    [png],
    parent.id,
    () => "u1",
    "food-safety-incidents",
  );
  assert.equal(
    stored[0].publicId,
    `foodprint/food-safety-incidents/${parent.id}/u1.png`,
  );
});

void test("report: REPORT files written in the creating transaction; failure removes uploads", async () => {
  const memory = memoryStorage();
  const f = incidentSetup(parent, memory.storage);
  await f.service.report({ ...report, files: [png, pdf] }, parent);
  assert.deepEqual(f.calls, ["create", "history", "attachments:REPORT"]);
  assert.equal(f.attachments[0].uploaderUserId, parent.id);
  assert.deepEqual(
    f.attachments[0].files.map((item) => item.publicId),
    memory.uploaded,
  );
  assert.ok(
    memory.uploaded.every((id) =>
      id.startsWith(`foodprint/food-safety-incidents/${parent.id}/`),
    ),
  );
  assert.deepEqual(memory.removed, []);

  // Lớp không tồn tại → 404 sau khi đã upload ⇒ xóa file.
  const failing = memoryStorage();
  await assert.rejects(
    incidentSetup(parent, failing.storage, {
      classExists: false,
    }).service.report({ ...report, classId: schoolId, files: [png] }, parent),
    status(404),
  );
  assert.equal(failing.uploaded.length, 1);
  assert.deepEqual(failing.removed, failing.uploaded);

  // Không có quyền báo cáo ⇒ chặn trước khi upload.
  const denied = memoryStorage();
  await assert.rejects(
    incidentSetup(board, denied.storage).service.report(
      { ...report, files: [png] },
      board,
    ),
    status(403),
  );
  assert.deepEqual(denied.uploaded, []);
});

void test("forward/direct: SCHOOL_REVIEW/REPORT files saved before the snapshot, which carries their sha256", async () => {
  const memory = memoryStorage();
  const f = incidentSetup(board, memory.storage);
  await f.service.forward(
    incidentId,
    { preliminaryAssessment: "SCHOOL_MEAL_SUSPECTED", files: [pdf] },
    board,
  );
  assert.deepEqual(f.calls, [
    "forward",
    "history",
    "attachments:SCHOOL_REVIEW",
    "evidence",
    "snapshot",
    "forwarding",
  ]);
  const files = f.snapshots[0].payload.evidenceFiles as {
    stage: string;
    sha256: string;
  }[];
  assert.deepEqual(
    files.map((item) => item.stage),
    ["SCHOOL_REVIEW", "REPORT"],
  );
  assert.equal(files[0].sha256, f.attachments[0].files[0].sha256);

  const direct = incidentSetup(board, memoryStorage().storage);
  await direct.service.createDirect(
    { ...report, preliminaryAssessment: "UNDETERMINED", files: [png] },
    board,
  );
  assert.deepEqual(direct.calls.slice(0, 5), [
    "create",
    "history",
    "attachments:REPORT",
    "evidence",
    "snapshot",
  ]);

  // Chuyển ở trạng thái sai → 409, file vừa upload bị xóa.
  const late = memoryStorage();
  await assert.rejects(
    incidentSetup(board, late.storage, {
      targetStatus: "SUBMITTED_TO_AUTHORITY",
    }).service.forward(
      incidentId,
      { preliminaryAssessment: "OUTSIDE_MEAL", files: [png] },
      board,
    ),
    status(409),
  );
  assert.deepEqual(late.removed, late.uploaded);
  assert.equal(late.uploaded.length, 1);
});

void test("trace payload v2: evidence sorted by id, inspection files excluded, sha256 changes the hash", () => {
  assert.equal(TRACE_PAYLOAD_VERSION, 2);
  const incident = { id: incidentId, code: "FP-IC-48213", schoolId };
  const evidence = [
    {
      id: "b",
      stage: "SCHOOL_REVIEW" as const,
      mimeType: "application/pdf",
      sizeBytes: 9,
      sha256: "1".repeat(64),
    },
    {
      id: "a",
      stage: "REPORT" as const,
      mimeType: "image/png",
      sizeBytes: 10,
      sha256: "2".repeat(64),
    },
    {
      id: "c",
      stage: "INSPECTION_RESULT" as const,
      mimeType: "image/png",
      sizeBytes: 10,
      sha256: "3".repeat(64),
    },
  ];
  const draft = buildTraceSnapshot(incident, [], evidence);
  assert.deepEqual(
    draft.payload.evidenceFiles.map((item) => item.id),
    ["a", "b"],
  );
  assert.equal(draft.completeness, "MISSING");
  assert.deepEqual(buildTraceSnapshot(incident, []).payload.evidenceFiles, []);
  const tampered = buildTraceSnapshot(
    incident,
    [],
    [{ ...evidence[0], sha256: "f".repeat(64) }, evidence[1]],
  );
  assert.notEqual(
    hashTracePayload(tampered.payload),
    hashTracePayload(draft.payload),
  );
});

void test("projections: reporter sees REPORT + inspection results only; full view adds SCHOOL_REVIEW; url null when signing fails", async () => {
  const memory = memoryStorage();
  const reporterView = await incidentSetup(
    parent,
    memory.storage,
  ).service.getOne(incidentId, parent);
  assert.equal(reporterView.view, "REPORTER");
  assert.deepEqual(
    reporterView.attachments.map((item) => item.id),
    ["a1"],
  );
  assert.deepEqual(
    reporterView.inspections.map((item) => item.attachments.map((a) => a.id)),
    [["a3"], []],
  );
  assert.deepEqual(reporterView.attachments[0], {
    id: "a1",
    stage: "REPORT",
    fileName: "a1.png",
    mimeType: "image/png",
    sizeBytes: 10,
    createdAt: NOW.toISOString(),
    url: "signed:foodprint/food-safety-incidents/u/a1.png",
  });
  assert.ok(!("storagePublicId" in reporterView.attachments[0]));

  for (const actor of [board, officer]) {
    const full = await incidentSetup(actor, memory.storage).service.getOne(
      incidentId,
      actor,
    );
    assert.equal(full.view, "FULL");
    assert.deepEqual(
      full.attachments.map((item) => item.stage),
      ["REPORT", "SCHOOL_REVIEW"],
    );
    assert.deepEqual(
      full.inspections[0].attachments.map((a) => a.id),
      ["a3"],
    );
  }

  const unsigned = await incidentSetup(board, {
    ...memory.storage,
    url: () => {
      throw new Error("not configured");
    },
  }).service.getOne(incidentId, board);
  assert.equal(unsigned.attachments[0].url, null);
});

function inspectionSetup(
  storage: EvidenceStorage,
  inspectionStatus = "PLANNED",
) {
  const calls: string[] = [];
  const written: {
    inspectionId: string;
    incidentId: string;
    files: unknown[];
  }[] = [];
  const row = (state: "PLANNED" | "COMPLETED") => ({
    id: inspectionId,
    incidentId,
    status: state,
    teamDescription: "Đoàn kiểm tra",
    scheduledAt: NOW,
    resultSummary: null,
    overallConclusion: null,
    completedAt: null,
    createdAt: NOW,
    findings: [],
    attachments: [
      {
        id: "r1",
        stage: "INSPECTION_RESULT" as const,
        storagePublicId: "foodprint/food-safety-incidents/o/r1.pdf",
        mimeType: "application/pdf",
        sizeBytes: 9,
        originalFilename: "bien-ban.pdf",
        createdAt: NOW,
      },
    ],
  });
  const repository = {
    lockIncident: () => Promise.resolve(),
    findOfficerTarget: () =>
      Promise.resolve({
        id: incidentId,
        schoolId,
        status: "UNDER_INSPECTION",
        source: "PARENT_REPORT",
      }),
    findInspection: () =>
      Promise.resolve({ id: inspectionId, status: inspectionStatus }),
    snapshotPayloads: () =>
      Promise.resolve([{ suppliers: [{ id: supplierId }] }]),
    suppliersByIds: (_db: unknown, ids: string[]) =>
      Promise.resolve(ids.map((id) => ({ id, name: id }))),
    schoolSuppliers: () => Promise.resolve([]),
    recordResult: () => {
      calls.push("result");
      return Promise.resolve(1);
    },
    createFindings: () => {
      calls.push("findings");
      return Promise.resolve();
    },
    addResultAttachments: (_tx: unknown, data: (typeof written)[number]) => {
      if (!data.files.length) return Promise.resolve();
      calls.push("attachments");
      written.push(data);
      return Promise.resolve();
    },
    countInspections: () => Promise.resolve({ planned: 1, completed: 1 }),
    readInspection: () => Promise.resolve(row("COMPLETED")),
    moveIncident: () => Promise.resolve(1),
    recordHistory: () => Promise.resolve(),
  };
  const service = createFoodSafetyInspectionService(
    repository as unknown as FoodSafetyInspectionRepository,
    () => Promise.resolve(fakeClient(officer)),
    () => NOW,
    storage,
  );
  return { service, calls, written };
}

void test("inspection result: INSPECTION_RESULT files bound to the inspection; rejected result removes uploads", async () => {
  const body = {
    resultSummary: "Phát hiện thịt quá hạn sử dụng",
    overallConclusion: "SUPPLIER_AT_FAULT" as const,
    findings: [{ supplierId, finding: "AT_FAULT" as const }],
  };
  const memory = memoryStorage();
  const f = inspectionSetup(memory.storage);
  const response = await f.service.recordResult(
    incidentId,
    inspectionId,
    { ...body, files: [pdf] },
    officer,
  );
  assert.deepEqual(f.calls, ["result", "findings", "attachments"]);
  assert.equal(f.written[0].inspectionId, inspectionId);
  assert.equal(f.written[0].incidentId, incidentId);
  assert.ok(
    memory.uploaded[0].startsWith(
      `foodprint/food-safety-incidents/${officer.id}/`,
    ),
  );
  assert.deepEqual(response.inspection.attachments, [
    {
      id: "r1",
      stage: "INSPECTION_RESULT",
      fileName: "bien-ban.pdf",
      mimeType: "application/pdf",
      sizeBytes: 9,
      createdAt: NOW.toISOString(),
      url: "signed:foodprint/food-safety-incidents/o/r1.pdf",
    },
  ]);

  const done = memoryStorage();
  await assert.rejects(
    inspectionSetup(done.storage, "COMPLETED").service.recordResult(
      incidentId,
      inspectionId,
      { ...body, files: [png] },
      officer,
    ),
    status(409),
  );
  assert.equal(done.uploaded.length, 1);
  assert.deepEqual(done.removed, done.uploaded);

  // Không phải cán bộ ATTP ⇒ chặn trước khi upload.
  const denied = memoryStorage();
  await assert.rejects(
    inspectionSetup(denied.storage).service.recordResult(
      incidentId,
      inspectionId,
      { ...body, files: [png] },
      board,
    ),
    status(403),
  );
  assert.deepEqual(denied.uploaded, []);
});

async function startApi(
  context: TestContext,
  router: express.Router,
  actor: AuthPrincipal,
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = actor;
    next();
  });
  app.use("/api/food-safety-incidents", router);
  app.use(globalErrorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  const address = server.address();
  assert(address && typeof address !== "string");
  return (path: string, init?: RequestInit) =>
    fetch(
      `http://127.0.0.1:${address.port}/api/food-safety-incidents${path}`,
      init,
    );
}

const passAuth: express.RequestHandler = (_req, _res, next) => next();

void test("routes: multipart report and inspection result reach the service with files and parsed fields", async (context) => {
  const received: unknown[] = [];
  const incidentService = {
    report: (body: unknown) => {
      received.push(body);
      return Promise.resolve({});
    },
  } as unknown as FoodSafetyIncidentService;
  const reportRequest = await startApi(
    context,
    createFoodSafetyIncidentRouter(incidentService, passAuth),
    parent,
  );
  const form = new FormData();
  form.set("title", report.title);
  form.set("description", report.description);
  form.set("reportedSymptomaticCount", "4");
  form.set("classId", "");
  form.append("files", new Blob([PNG], { type: "image/png" }), "a.png");
  const created = await reportRequest("", { method: "POST", body: form });
  assert.equal(created.status, 201);
  const body = received[0] as {
    reportedSymptomaticCount: number;
    classId?: string;
    files: EvidenceFile[];
  };
  assert.equal(body.reportedSymptomaticCount, 4);
  assert.equal(body.classId, undefined);
  assert.equal(body.files[0].originalName, "a.png");
  assert.ok(body.files[0].buffer.equals(PNG));

  // JSON vẫn hoạt động như cũ.
  const json = await reportRequest("", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(report),
  });
  assert.equal(json.status, 201);
  assert.deepEqual((received[1] as { files: unknown[] }).files, []);

  const inspectionService = {
    recordResult: (_id: string, _inspection: string, input: unknown) => {
      received.push(input);
      return Promise.resolve({});
    },
  } as unknown as FoodSafetyInspectionService;
  const resultRequest = await startApi(
    context,
    createFoodSafetyInspectionRouter(inspectionService, passAuth),
    officer,
  );
  const result = new FormData();
  result.set("resultSummary", "Phát hiện thịt quá hạn sử dụng");
  result.set("overallConclusion", "SUPPLIER_AT_FAULT");
  result.set("findings", JSON.stringify([{ supplierId, finding: "AT_FAULT" }]));
  result.append(
    "files",
    new Blob([PDF], { type: "application/pdf" }),
    "bb.pdf",
  );
  const recorded = await resultRequest(
    `/${incidentId}/inspections/${inspectionId}/result`,
    { method: "POST", body: result },
  );
  assert.equal(recorded.status, 200);
  const input = received[2] as {
    findings: unknown[];
    files: EvidenceFile[];
  };
  assert.equal(input.findings.length, 1);
  assert.equal(input.files[0].mimeType, "application/pdf");
});
