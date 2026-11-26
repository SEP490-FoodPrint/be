import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import { ROLES } from "../../constants/roles";
import {
  assertPermission,
  databaseOperation,
  withSchoolTransaction,
} from "../../utils/authorization";
import {
  canonicalizeJson,
  computeCanonicalHash,
} from "../../utils/canonical-hash";
import { getPrisma } from "../../utils/database";
import {
  cloudinaryEvidenceStorage,
  signedEvidenceUrl,
  withStoredEvidence,
  type EvidenceStorage,
} from "../../utils/evidence-files";
import { HttpError } from "../../utils/http-error";
import { readListPage } from "../../utils/list-query";
import { RequestValidationError } from "../../utils/request-validation";
import { listScopes } from "../../utils/resource-access";
import {
  createFoodSafetyIncidentRepository,
  type FoodSafetyIncidentDetailRow,
  type FoodSafetyIncidentListRow,
  type FoodSafetyIncidentRepository,
  type FoodSafetyIncidentTarget,
  type IncidentActor,
  type IncidentAttachmentRow,
  type IncidentRecipient,
  type SnapshotEvidenceRow,
  type TraceSnapshotRow,
  type TraceSourceRow,
} from "./food-safety-incident.repository";
import type {
  AddFoodSafetyIncidentAllocationsRequestDTO,
  CancelFoodSafetyIncidentRequestDTO,
  DirectFoodSafetyIncidentRequestDTO,
  FoodSafetyIncidentListRequestDTO,
  ForwardFoodSafetyIncidentRequestDTO,
  ReportFoodSafetyIncidentRequestDTO,
} from "./food-safety-incident.request.dto";
import type {
  FoodSafetyIncidentActionDTO,
  FoodSafetyIncidentAllocationsResponseDTO,
  FoodSafetyIncidentAttachmentDTO,
  FoodSafetyIncidentDetailResponseDTO,
  FoodSafetyIncidentFullDetailDTO,
  FoodSafetyIncidentListItemDTO,
  FoodSafetyIncidentListResponseDTO,
  FoodSafetyIncidentReporterDetailDTO,
  FoodSafetyIncidentTraceSnapshotDTO,
  FoodSafetyIncidentTraceSnapshotSummaryDTO,
  TraceCompletenessDTO,
  TraceMissingReasonDTO,
  TracePayloadV1DTO,
  TracePayloadV2DTO,
} from "./food-safety-incident.response.dto";

type Tx = Prisma.TransactionClient;

const NOT_FOUND = "Không tìm thấy hồ sơ sự cố";
const ONLY_BOARD = "Chỉ Ban Giám hiệu được thực hiện thao tác này";
const ONLY_REPORTER =
  "Chỉ phụ huynh (Ban đại diện) hoặc GVCN được báo cáo sự cố";
const NOT_PENDING = "Hồ sơ không còn ở bước Ban Giám hiệu xác minh";
const FINISHED = "Hồ sơ đã đóng hoặc đã hủy";
const SERVED = new Set(["DISTRIBUTED", "FINALIZED"]);
const FINISHED_STATUSES = new Set(["CLOSED", "CANCELLED_BY_SCHOOL"]);

/** Q20: chỉ PH (Ban đại diện) và GVCN gửi báo cáo lên BGH. */
export function reporterSource(
  role: string,
): "PARENT_REPORT" | "TEACHER_REPORT" | null {
  if (role === ROLES.PARENTS_COMMITTEE) return "PARENT_REPORT";
  if (role === ROLES.HOMEROOM_TEACHER) return "TEACHER_REPORT";
  return null;
}

const isBoard = (p: AuthPrincipal) =>
  p.orgType === "SCHOOL" && p.role === ROLES.SCHOOL_MANAGEMENT_BOARD;

/** Người xem rút gọn: mọi vai trò trường ngoài BGH (phạm vi đã giới hạn ở hồ sơ mình báo). */
export function isReporterView(p: AuthPrincipal): boolean {
  return p.orgType === "SCHOOL" && !isBoard(p);
}

/** PR6a: cán bộ ATTP của đơn vị đang nhận hồ sơ. */
export function isRecipientOfficer(
  p: AuthPrincipal,
  recipientUnitId: string | null,
): boolean {
  return (
    p.orgType === "AUTHORITY" &&
    p.role === ROLES.COMMUNE_FOOD_SAFETY_OFFICER &&
    recipientUnitId !== null &&
    p.communeFoodSafetyUnitId === recipientUnitId
  );
}

export function allowedIncidentActions(
  principal: AuthPrincipal,
  status: string,
  recipientUnitId: string | null = null,
): FoodSafetyIncidentActionDTO[] {
  const has = (code: string) => principal.permissions.includes(code);
  if (isRecipientOfficer(principal, recipientUnitId)) {
    if (!has("food_safety_inspection.manage")) return [];
    if (status === "AUTHORITY_ACKNOWLEDGED" || status === "UNDER_INSPECTION")
      return ["PLAN_INSPECTION"];
    if (status === "INSPECTION_COMPLETED") return ["CLOSE"];
    return [];
  }
  if (!isBoard(principal)) return [];
  const actions: FoodSafetyIncidentActionDTO[] = [];
  if (status === "PENDING_SCHOOL_REVIEW") {
    if (has("food_safety_incident.forward")) actions.push("FORWARD");
    if (has("food_safety_incident.manage")) actions.push("CANCEL");
  }
  if (!FINISHED_STATUSES.has(status) && has("food_safety_incident.manage"))
    actions.push("ADD_ALLOCATIONS");
  return actions;
}

const iso = (value: Date | null) => value?.toISOString() ?? null;
const isoDate = (value: Date) => value.toISOString().slice(0, 10);

// ---- PR5b: snapshot truy xuất (specs/food-safety-incident-trace-snapshots) ----

/** v2 (PR-G): thêm `evidenceFiles`; snapshot v1 cũ giữ nguyên payload và hash. */
export const TRACE_PAYLOAD_VERSION = 2;

type DecimalLike = { toFixed(digits: number): string };
const fixed3 = (value: DecimalLike) => value.toFixed(3);
const optionalDay = (value: Date | null) => (value ? isoDate(value) : null);

/** So sánh theo mã ký tự (không phụ thuộc locale) để thứ tự payload cố định. */
function byKeys<T>(...keys: ((item: T) => string)[]) {
  return (left: T, right: T): number => {
    for (const key of keys) {
      const a = key(left);
      const b = key(right);
      if (a !== b) return a < b ? -1 : 1;
    }
    return 0;
  };
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const item of items) if (!seen.has(key(item))) seen.set(key(item), item);
  return [...seen.values()];
}

export type TraceSnapshotDraft = {
  completeness: TraceCompletenessDTO;
  missingReasons: TraceMissingReasonDTO[];
  payload: TracePayloadV2DTO;
};

/**
 * FR-004: dựng payload chuẩn hóa + lý do thiếu từ chuỗi truy xuất của các suất ăn đã gắn.
 * PR-G: kèm file REPORT/SCHOOL_REVIEW (sha256); file không ảnh hưởng mức đầy đủ.
 */
export function buildTraceSnapshot(
  incident: { id: string; code: string | null; schoolId: string },
  rows: readonly TraceSourceRow[],
  evidence: readonly SnapshotEvidenceRow[] = [],
): TraceSnapshotDraft {
  const allocations = uniqueBy(
    rows.map((row) => row.MealAllocation),
    (allocation) => allocation.id,
  );
  const links = allocations.flatMap((allocation) =>
    allocation.mealAllocationBatches.map((link) => ({
      ...link,
      mealAllocationId: allocation.id,
    })),
  );
  const dishKey = (link: { cookingBatchId: string; dishId: string }) =>
    `${link.cookingBatchId}:${link.dishId}`;
  const batchDishes = uniqueBy(links, dishKey);
  const usages = batchDishes.flatMap((link) =>
    link.CookingBatchDish.cookingBatchLots.map((usage) => ({
      ...usage,
      cookingBatchId: link.cookingBatchId,
      dishId: link.dishId,
    })),
  );
  const lots = uniqueBy(
    usages.map((usage) => usage.IngredientLot),
    (lot) => lot.id,
  );
  const samples = batchDishes.flatMap((link) =>
    link.CookingBatchDish.retainedFoodSamples.map((sample) => ({
      ...sample,
      cookingBatchId: link.cookingBatchId,
      dishId: link.dishId,
    })),
  );

  const missingReasons: TraceMissingReasonDTO[] = [];
  if (allocations.length === 0) missingReasons.push({ code: "NO_ALLOCATIONS" });
  for (const allocation of allocations)
    if (allocation.mealAllocationBatches.length === 0)
      missingReasons.push({
        code: "ALLOCATION_WITHOUT_COOKING_BATCH",
        mealAllocationId: allocation.id,
      });
  for (const link of batchDishes) {
    const ref = { cookingBatchId: link.cookingBatchId, dishId: link.dishId };
    if (link.CookingBatchDish.cookingBatchLots.length === 0)
      missingReasons.push({ code: "COOKING_BATCH_DISH_WITHOUT_LOTS", ...ref });
    if (link.CookingBatchDish.retainedFoodSamples.length === 0)
      missingReasons.push({
        code: "COOKING_BATCH_DISH_WITHOUT_RETAINED_SAMPLE",
        ...ref,
      });
  }
  missingReasons.sort(byKeys((reason) => canonicalizeJson(reason)));

  const byId = byKeys<{ id: string }>((item) => item.id);
  const payload: TracePayloadV2DTO = {
    incident: {
      id: incident.id,
      code: incident.code,
      schoolId: incident.schoolId,
    },
    allocations: allocations
      .map((allocation) => ({
        id: allocation.id,
        dailyMealPortionId: allocation.DailyMealPortion.id,
        classId: allocation.DailyMealPortion.Class.id,
        className: allocation.DailyMealPortion.Class.name,
        mealDate: isoDate(allocation.DailyMealPortion.mealDate),
        mealType: allocation.DailyMealPortion.mealType,
        totalPortions: allocation.DailyMealPortion.totalPortions,
        status: allocation.status,
        distributedAt: iso(allocation.distributedAt),
        finalizedAt: iso(allocation.finalizedAt),
      }))
      .sort(byId),
    cookingBatches: uniqueBy(
      links.map((link) => link.CookingBatch),
      (batch) => batch.id,
    )
      .map((batch) => ({
        id: batch.id,
        batchCode: batch.batchCode,
        menuDayId: batch.menuDayId,
        mealType: batch.mealType,
        status: batch.status,
        completedAt: iso(batch.completedAt),
      }))
      .sort(byId),
    allocationBatches: links
      .map((link) => ({
        mealAllocationId: link.mealAllocationId,
        cookingBatchId: link.cookingBatchId,
        dishId: link.dishId,
        dishName: link.CookingBatchDish.Dish.name,
        allocatedPortions: fixed3(link.allocatedPortions),
      }))
      .sort(
        byKeys(
          (item) => item.mealAllocationId,
          (item) => item.cookingBatchId,
          (item) => item.dishId,
        ),
      ),
    lotUsages: usages
      .map((usage) => ({
        cookingBatchId: usage.cookingBatchId,
        dishId: usage.dishId,
        ingredientLotId: usage.ingredientLotId,
        quantityUsed: fixed3(usage.quantityUsed),
        unit: usage.unit,
      }))
      .sort(
        byKeys(
          (item) => item.cookingBatchId,
          (item) => item.dishId,
          (item) => item.ingredientLotId,
        ),
      ),
    ingredientLots: lots
      .map((lot) => ({
        id: lot.id,
        lotCode: lot.lotCode,
        ingredientId: lot.DeliveryItem.ingredientId,
        ingredientName:
          lot.DeliveryItem.ingredientNameSnapshot ??
          lot.DeliveryItem.Ingredient.name,
        supplierId: lot.DeliveryItem.Delivery.Supplier.id,
        deliveryId: lot.DeliveryItem.Delivery.id,
        deliveryNo: lot.DeliveryItem.Delivery.deliveryNo,
        sourceFacilityId: lot.SourceFacility?.id ?? null,
        manufactureDate: optionalDay(lot.manufactureDate),
        expiryDate: optionalDay(lot.expiryDate),
        unit: lot.unit,
      }))
      .sort(byId),
    suppliers: uniqueBy(
      lots.map((lot) => lot.DeliveryItem.Delivery.Supplier),
      (supplier) => supplier.id,
    )
      .map((supplier) => ({ id: supplier.id, name: supplier.name }))
      .sort(byId),
    sourceFacilities: uniqueBy(
      lots.flatMap((lot) => (lot.SourceFacility ? [lot.SourceFacility] : [])),
      (facility) => facility.id,
    )
      .map((facility) => ({
        id: facility.id,
        supplierId: facility.supplierId,
        name: facility.name,
        facilityCode: facility.facilityCode,
      }))
      .sort(byId),
    retainedSamples: samples
      .map((sample) => ({
        id: sample.id,
        cookingBatchId: sample.cookingBatchId,
        dishId: sample.dishId,
        sampledAt: sample.sampledAt.toISOString(),
        status: sample.status,
        quantity: sample.quantity ? fixed3(sample.quantity) : null,
        unit: sample.unit,
        storageLocation: sample.storageLocation,
        photoHash: sample.photoHash,
      }))
      .sort(byId),
    potentialExposedPortionCount: allocations.reduce(
      (total, allocation) => total + allocation.DailyMealPortion.totalPortions,
      0,
    ),
    evidenceFiles: evidence
      .flatMap((file) =>
        file.stage === "INSPECTION_RESULT"
          ? []
          : [
              {
                id: file.id,
                stage: file.stage,
                mimeType: file.mimeType,
                sizeBytes: file.sizeBytes,
                sha256: file.sha256,
              },
            ],
      )
      .sort(byId),
  };
  const completeness: TraceCompletenessDTO =
    allocations.length === 0
      ? "MISSING"
      : missingReasons.length > 0
        ? "PARTIAL"
        : "COMPLETE";
  return { completeness, missingReasons, payload };
}

export function hashTracePayload(payload: unknown): string {
  return computeCanonicalHash(payload).toLowerCase();
}

function mapSnapshotSummary(
  row: Omit<TraceSnapshotRow, "incidentId" | "payload">,
): FoodSafetyIncidentTraceSnapshotSummaryDTO {
  return {
    id: row.id,
    version: row.version,
    completeness: row.completeness,
    missingReasons: row.missingReasons as TraceMissingReasonDTO[],
    payloadVersion: row.payloadVersion,
    hashAlgorithm: row.hashAlgorithm,
    payloadHash: row.payloadHash,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdByUser,
  };
}

function mapSnapshot(
  row: TraceSnapshotRow,
): FoodSafetyIncidentTraceSnapshotDTO {
  return {
    ...mapSnapshotSummary(row),
    incidentId: row.incidentId,
    payload: row.payload as unknown as TracePayloadV1DTO | TracePayloadV2DTO,
    hashMatches: hashTracePayload(row.payload) === row.payloadHash,
  };
}

function mapListItem(
  row: FoodSafetyIncidentListRow,
): FoodSafetyIncidentListItemDTO {
  return {
    id: row.id,
    code: row.code,
    schoolId: row.schoolId,
    reportedByUserId: row.reportedByUserId,
    title: row.title,
    description: row.description,
    status: row.status,
    source: row.source,
    reportedSymptomaticCount: row.reportedSymptomaticCount,
    recipientCommuneFoodSafetyUnitId: row.recipientCommuneFoodSafetyUnitId,
    occurredAt: iso(row.occurredAt),
    resolvedAt: iso(row.resolvedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapAttachment(
  row: IncidentAttachmentRow,
  storage: Pick<EvidenceStorage, "url">,
): FoodSafetyIncidentAttachmentDTO {
  return {
    id: row.id,
    stage: row.stage,
    fileName: row.originalFilename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
    url: signedEvidenceUrl(storage, row.storagePublicId),
  };
}

/** File cấp hồ sơ theo projection: người báo chỉ REPORT (chốt 2026-11-25), đầy đủ thêm SCHOOL_REVIEW. */
function mapIncidentAttachments(
  rows: readonly IncidentAttachmentRow[],
  stages: readonly IncidentAttachmentRow["stage"][],
  storage: Pick<EvidenceStorage, "url">,
): FoodSafetyIncidentAttachmentDTO[] {
  return rows
    .filter((row) => stages.includes(row.stage))
    .map((row) => mapAttachment(row, storage));
}

function mapInspectionCore(
  inspection: FoodSafetyIncidentDetailRow["inspections"][number],
  attachments: readonly IncidentAttachmentRow[],
  storage: Pick<EvidenceStorage, "url">,
) {
  return {
    id: inspection.id,
    status: inspection.status,
    scheduledAt: inspection.scheduledAt.toISOString(),
    completedAt: iso(inspection.completedAt),
    resultSummary: inspection.resultSummary,
    overallConclusion: inspection.overallConclusion,
    findings: inspection.findings.map((finding) => ({
      supplier: finding.Supplier,
      finding: finding.finding,
      evidenceNote: finding.evidenceNote,
    })),
    attachments: attachments
      .filter(
        (file) =>
          file.stage === "INSPECTION_RESULT" &&
          file.inspectionId === inspection.id,
      )
      .map((file) => mapAttachment(file, storage)),
  };
}

function mapReporterDetail(
  row: FoodSafetyIncidentDetailRow,
  storage: Pick<EvidenceStorage, "url">,
): FoodSafetyIncidentReporterDetailDTO {
  return {
    view: "REPORTER",
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description,
    status: row.status,
    source: row.source,
    reportedSymptomaticCount: row.reportedSymptomaticCount,
    symptomDescription: row.symptomDescription,
    occurredAt: iso(row.occurredAt),
    reportedClass: row.ReportedClass,
    cancellationReason: row.cancellationReason,
    cancellationNote: row.cancellationNote,
    histories: row.statusHistories.map((history) => ({
      fromStatus: history.fromStatus,
      toStatus: history.toStatus,
      createdAt: history.createdAt.toISOString(),
    })),
    inspections: row.inspections.map((inspection) => ({
      ...mapInspectionCore(inspection, row.attachments, storage),
      recordedBy: inspection.recordedByUser
        ? {
            fullName: inspection.recordedByUser.fullName,
            roleCode: inspection.recordedByUser.roleCode,
          }
        : null,
    })),
    attachments: mapIncidentAttachments(row.attachments, ["REPORT"], storage),
    allowedActions: [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapFullDetail(
  row: FoodSafetyIncidentDetailRow,
  principal: AuthPrincipal,
  storage: Pick<EvidenceStorage, "url">,
): FoodSafetyIncidentFullDetailDTO {
  const base = mapReporterDetail(row, storage);
  return {
    ...base,
    view: "FULL",
    attachments: mapIncidentAttachments(
      row.attachments,
      ["REPORT", "SCHOOL_REVIEW"],
      storage,
    ),
    school: row.School,
    reportedBy: row.User,
    reportedRoleCode: row.reportedRoleCode,
    preliminaryAssessment: row.schoolPreliminaryAssessment,
    preliminaryNote: row.schoolPreliminaryNote,
    reviewedBy: row.SchoolReviewedBy,
    reviewedAt: iso(row.schoolReviewedAt),
    recipientUnit: row.RecipientUnit,
    resolvedAt: iso(row.resolvedAt),
    forwardings: row.foodSafetyReportForwardings.map((forwarding) => ({
      id: forwarding.id,
      recipientCommuneFoodSafetyUnitId:
        forwarding.recipientCommuneFoodSafetyUnitId,
      recipientOrganization: forwarding.recipientOrganization,
      status: forwarding.status,
      forwardedAt: iso(forwarding.forwardedAt),
      receivedAt: iso(forwarding.receivedAt),
      createdAt: forwarding.createdAt.toISOString(),
      traceSnapshotVersion: forwarding.TraceSnapshot?.version ?? null,
    })),
    traceCompleteness: row.traceCompleteness,
    traceSnapshots: row.traceSnapshots.map(mapSnapshotSummary),
    allocations: row.foodSafetyIncidentAllocations.map((link) => ({
      mealAllocationId: link.mealAllocationId,
      status: link.MealAllocation.status,
      mealDate: isoDate(link.MealAllocation.DailyMealPortion.mealDate),
      mealType: link.MealAllocation.DailyMealPortion.mealType,
      classId: link.MealAllocation.DailyMealPortion.Class.id,
      className: link.MealAllocation.DailyMealPortion.Class.name,
    })),
    histories: row.statusHistories.map((history) => ({
      fromStatus: history.fromStatus,
      toStatus: history.toStatus,
      createdAt: history.createdAt.toISOString(),
      note: history.note,
      actor:
        history.actorUser && history.actorRoleCode
          ? { ...history.actorUser, roleCode: history.actorRoleCode }
          : null,
    })),
    inspections: row.inspections.map((inspection) => ({
      ...mapInspectionCore(inspection, row.attachments, storage),
      teamDescription: inspection.teamDescription,
      createdAt: inspection.createdAt.toISOString(),
      createdBy: inspection.createdByUser,
      recordedBy: inspection.recordedByUser,
    })),
    allowedActions: allowedIncidentActions(
      principal,
      row.status,
      row.recipientCommuneFoodSafetyUnitId,
    ),
  };
}

function mapDetail(
  row: FoodSafetyIncidentDetailRow,
  principal: AuthPrincipal,
  storage: Pick<EvidenceStorage, "url">,
): FoodSafetyIncidentDetailResponseDTO {
  return isReporterView(principal)
    ? mapReporterDetail(row, storage)
    : mapFullDetail(row, principal, storage);
}

const actorOf = (actor: AuthPrincipal): IncidentActor => ({
  id: actor.id,
  roleCode: actor.role,
});

export function createFoodSafetyIncidentService(
  repository: FoodSafetyIncidentRepository = createFoodSafetyIncidentRepository(),
  connect: () => Promise<PrismaClient> = getPrisma,
  now = () => new Date(),
  storage: EvidenceStorage = cloudinaryEvidenceStorage,
) {
  const database = () => databaseOperation(() => connect());
  /** PR-G: upload trước transaction (transaction có thể thử lại), lỗi sau upload ⇒ xóa file. */
  const withEvidence = <T>(
    files: Parameters<typeof withStoredEvidence>[1],
    principal: AuthPrincipal,
    run: Parameters<typeof withStoredEvidence<T>>[3],
  ) =>
    withStoredEvidence(
      storage,
      files,
      principal.id,
      run,
      "food-safety-incidents",
    );

  async function readDetail(
    tx: Tx,
    id: string,
  ): Promise<FoodSafetyIncidentDetailRow> {
    const row = await repository.findDetail(tx, id, {});
    if (!row)
      throw new HttpError(503, "Chưa tải được hồ sơ. Vui lòng thử lại.");
    return row;
  }

  function assertOccurredAt(occurredAt: Date | undefined, at: Date) {
    if (occurredAt && occurredAt.getTime() > at.getTime())
      throw new RequestValidationError([
        {
          field: "occurredAt",
          message: "Thời điểm xảy ra không được ở tương lai",
        },
      ]);
  }

  /** FR-004/FR-006: đơn vị ATTP nhận suy ra từ phường/xã của trường; thiếu → 409, không đổi gì. */
  async function resolveRecipient(
    tx: Tx,
    schoolId: string,
  ): Promise<IncidentRecipient> {
    const locationId = await repository.findSchoolLocationId(tx, schoolId);
    if (!locationId) throw new HttpError(409, "Trường chưa được gắn phường/xã");
    const unit = await repository.findRecipientUnit(tx, locationId);
    if (!unit)
      throw new HttpError(
        409,
        "Phường/xã của trường chưa có đơn vị ATTP đang hoạt động",
      );
    const officer = await repository.findUnitOfficer(tx, unit.id);
    if (!officer)
      throw new HttpError(409, "Đơn vị ATTP chưa có cán bộ đang hoạt động");
    return { unitId: unit.id, unitName: unit.name, officerId: officer.id };
  }

  /** Kiểm tra lớp gắn với hồ sơ: GVCN bắt buộc lớp mình chủ nhiệm, vai trò khác tùy chọn. */
  async function resolveClass(
    tx: Tx,
    actor: AuthPrincipal,
    schoolId: string,
    classId: string | undefined,
    at: Date,
  ): Promise<string | null> {
    if (!classId) {
      if (actor.role === ROLES.HOMEROOM_TEACHER)
        throw new RequestValidationError([
          { field: "classId", message: "GVCN cần chọn lớp chủ nhiệm" },
        ]);
      return null;
    }
    if (!(await repository.findActiveClass(tx, classId, schoolId)))
      throw new HttpError(404, "Không tìm thấy lớp trong trường");
    if (
      actor.role === ROLES.HOMEROOM_TEACHER &&
      !(await repository.isCurrentHomeroom(tx, classId, actor.id, at))
    )
      throw new HttpError(403, "GVCN chỉ báo cáo cho lớp mình chủ nhiệm");
    return classId;
  }

  /** Thao tác của BGH trên một hồ sơ: nạp lại actor, khóa dòng, kiểm tra phạm vi trường. */
  async function boardAction<T>(
    id: string,
    principal: AuthPrincipal,
    permission: string,
    run: (
      tx: Tx,
      actor: AuthPrincipal,
      target: FoodSafetyIncidentTarget,
      schoolId: string,
      at: Date,
    ) => Promise<T>,
  ): Promise<T> {
    if (!isBoard(principal)) throw new HttpError(403, ONLY_BOARD);
    return withSchoolTransaction(
      await database(),
      principal,
      permission,
      async (tx, actor, schoolId) => {
        if (!isBoard(actor)) throw new HttpError(403, ONLY_BOARD);
        await repository.lockIncident(tx, id);
        const target = await repository.findTarget(tx, id, schoolId);
        if (!target) throw new HttpError(404, NOT_FOUND);
        return run(tx, actor, target, schoolId, now());
      },
    );
  }

  /** FR-004: snapshot phiên bản kế tiếp trong transaction đang khóa dòng hồ sơ. */
  async function takeSnapshot(
    tx: Tx,
    incident: { id: string; code: string | null; schoolId: string },
    actorId: string,
    at: Date,
  ): Promise<string> {
    const draft = buildTraceSnapshot(
      incident,
      await repository.findTraceSource(tx, incident.id),
      await repository.findSnapshotEvidence(tx, incident.id),
    );
    const version = await repository.nextSnapshotVersion(tx, incident.id);
    return repository.createSnapshot(tx, version, {
      incidentId: incident.id,
      completeness: draft.completeness,
      missingReasons: draft.missingReasons,
      payload: draft.payload,
      payloadVersion: TRACE_PAYLOAD_VERSION,
      payloadHash: hashTracePayload(draft.payload),
      createdByUserId: actorId,
      at,
    });
  }

  /** FR-006: bản bổ sung gửi tới đơn vị đang nhận hồ sơ (không suy lại từ phường/xã). */
  async function supplementRecipient(
    tx: Tx,
    unitId: string,
  ): Promise<IncidentRecipient> {
    const unit = await repository.findActiveUnit(tx, unitId);
    if (!unit)
      throw new HttpError(409, "Đơn vị ATTP nhận hồ sơ không còn hoạt động");
    const officer = await repository.findUnitOfficer(tx, unit.id);
    if (!officer)
      throw new HttpError(409, "Đơn vị ATTP chưa có cán bộ đang hoạt động");
    return { unitId: unit.id, unitName: unit.name, officerId: officer.id };
  }

  return {
    async getAll(
      query: FoodSafetyIncidentListRequestDTO,
      principal: AuthPrincipal,
    ): Promise<FoodSafetyIncidentListResponseDTO> {
      const scope = listScopes["food-safety-incident"](principal);
      const where: Prisma.FoodSafetyIncidentWhereInput = query.status
        ? { AND: [scope, { status: query.status }] }
        : scope;
      const page = await readListPage(
        () => repository.list(query, where),
        query,
      );
      return {
        items: page.items.map(mapListItem),
        pagination: {
          page: page.pagination.page,
          limit: page.pagination.limit,
          hasNext: page.pagination.hasNext,
        },
      };
    },

    async getOne(
      id: string,
      principal: AuthPrincipal,
    ): Promise<FoodSafetyIncidentDetailResponseDTO> {
      const scope = listScopes["food-safety-incident"](principal);
      const row = await repository.findDetail(await database(), id, scope);
      if (!row) throw new HttpError(404, NOT_FOUND);
      return mapDetail(row, principal, storage);
    },

    /** FR-008: payload snapshot cho BGH/ATTP/SYSTEM; người báo không xem (Q23). */
    async getTraceSnapshot(
      id: string,
      version: number,
      principal: AuthPrincipal,
    ): Promise<FoodSafetyIncidentTraceSnapshotDTO> {
      const scope = listScopes["food-safety-incident"](principal);
      if (isReporterView(principal))
        throw new HttpError(403, "Người báo không xem được dữ liệu truy xuất.");
      const row = await repository.findSnapshot(
        await database(),
        id,
        version,
        scope,
      );
      if (!row) throw new HttpError(404, "Không tìm thấy dữ liệu truy xuất.");
      return mapSnapshot(row);
    },

    /** US1: PH/GVCN báo cáo → PENDING_SCHOOL_REVIEW. */
    async report(
      body: ReportFoodSafetyIncidentRequestDTO,
      principal: AuthPrincipal,
    ): Promise<FoodSafetyIncidentReporterDetailDTO> {
      if (!reporterSource(principal.role))
        throw new HttpError(403, ONLY_REPORTER);
      assertPermission(principal, "food_safety_incident.report");
      const db = await database();
      return withEvidence(body.files, principal, (files) =>
        withSchoolTransaction(
          db,
          principal,
          "food_safety_incident.report",
          async (tx, actor, schoolId) => {
            const source = reporterSource(actor.role);
            if (!source) throw new HttpError(403, ONLY_REPORTER);
            const at = now();
            assertOccurredAt(body.occurredAt, at);
            const classId = await resolveClass(
              tx,
              actor,
              schoolId,
              body.classId,
              at,
            );
            const code = await repository.allocateCode(tx);
            const id = await repository.create(tx, {
              code,
              schoolId,
              source,
              status: "PENDING_SCHOOL_REVIEW",
              reportedByUserId: actor.id,
              reportedRoleCode: actor.role,
              reportedClassId: classId,
              reportedSymptomaticCount: body.reportedSymptomaticCount,
              symptomDescription: body.symptomDescription ?? null,
              title: body.title,
              description: body.description,
              occurredAt: body.occurredAt ?? null,
              createdAt: at,
            });
            await repository.recordHistory(tx, {
              incidentId: id,
              fromStatus: null,
              toStatus: "PENDING_SCHOOL_REVIEW",
              actor: actorOf(actor),
              at,
            });
            await repository.addAttachments(tx, {
              incidentId: id,
              stage: "REPORT",
              uploaderUserId: actor.id,
              files,
              at,
            });
            return mapReporterDetail(await readDetail(tx, id), storage);
          },
        ),
      );
    },

    /** US3: BGH tự lập hồ sơ (SCHOOL_DIRECT) gửi thẳng ATTP. */
    async createDirect(
      body: DirectFoodSafetyIncidentRequestDTO,
      principal: AuthPrincipal,
    ): Promise<FoodSafetyIncidentFullDetailDTO> {
      if (!isBoard(principal)) throw new HttpError(403, ONLY_BOARD);
      assertPermission(principal, "food_safety_incident.forward");
      assertPermission(principal, "food_safety_incident.create");
      const db = await database();
      return withEvidence(body.files, principal, (files) =>
        withSchoolTransaction(
          db,
          principal,
          "food_safety_incident.create",
          async (tx, actor, schoolId) => {
            if (!isBoard(actor)) throw new HttpError(403, ONLY_BOARD);
            assertPermission(actor, "food_safety_incident.forward");
            const at = now();
            assertOccurredAt(body.occurredAt, at);
            const classId = await resolveClass(
              tx,
              actor,
              schoolId,
              body.classId,
              at,
            );
            const recipient = await resolveRecipient(tx, schoolId);
            const code = await repository.allocateCode(tx);
            const id = await repository.create(tx, {
              code,
              schoolId,
              source: "SCHOOL_DIRECT",
              status: "SUBMITTED_TO_AUTHORITY",
              reportedByUserId: actor.id,
              reportedRoleCode: actor.role,
              reportedClassId: classId,
              reportedSymptomaticCount: body.reportedSymptomaticCount,
              symptomDescription: body.symptomDescription ?? null,
              title: body.title,
              description: body.description,
              occurredAt: body.occurredAt ?? null,
              schoolPreliminaryAssessment: body.preliminaryAssessment,
              schoolPreliminaryNote: body.preliminaryNote ?? null,
              schoolReviewedByUserId: actor.id,
              schoolReviewedAt: at,
              recipientCommuneFoodSafetyUnitId: recipient.unitId,
              createdAt: at,
            });
            await repository.recordHistory(tx, {
              incidentId: id,
              fromStatus: null,
              toStatus: "SUBMITTED_TO_AUTHORITY",
              actor: actorOf(actor),
              at,
            });
            await repository.addAttachments(tx, {
              incidentId: id,
              stage: "REPORT",
              uploaderUserId: actor.id,
              files,
              at,
            });
            const traceSnapshotId = await takeSnapshot(
              tx,
              { id, code, schoolId },
              actor.id,
              at,
            );
            await repository.createForwarding(tx, {
              incidentId: id,
              recipient,
              forwardedByUserId: actor.id,
              traceSnapshotId,
              at,
            });
            return mapFullDetail(await readDetail(tx, id), actor, storage);
          },
        ),
      );
    },

    /** US2: BGH ghi nhận định sơ bộ và chuyển ATTP (OUTSIDE_MEAL vẫn phải chuyển, Q4). */
    async forward(
      id: string,
      body: ForwardFoodSafetyIncidentRequestDTO,
      principal: AuthPrincipal,
    ): Promise<FoodSafetyIncidentFullDetailDTO> {
      if (!isBoard(principal)) throw new HttpError(403, ONLY_BOARD);
      assertPermission(principal, "food_safety_incident.forward");
      return withEvidence(body.files, principal, (files) =>
        boardAction(
          id,
          principal,
          "food_safety_incident.forward",
          async (tx, actor, target, schoolId, at) => {
            if (target.status !== "PENDING_SCHOOL_REVIEW")
              throw new HttpError(409, NOT_PENDING);
            const recipient = await resolveRecipient(tx, schoolId);
            const changed = await repository.markForwarded(tx, id, {
              assessment: body.preliminaryAssessment,
              note: body.preliminaryNote ?? null,
              reviewerId: actor.id,
              unitId: recipient.unitId,
              at,
            });
            if (changed !== 1) throw new HttpError(409, NOT_PENDING);
            await repository.recordHistory(tx, {
              incidentId: id,
              fromStatus: "PENDING_SCHOOL_REVIEW",
              toStatus: "SUBMITTED_TO_AUTHORITY",
              actor: actorOf(actor),
              at,
            });
            await repository.addAttachments(tx, {
              incidentId: id,
              stage: "SCHOOL_REVIEW",
              uploaderUserId: actor.id,
              files,
              at,
            });
            const traceSnapshotId = await takeSnapshot(
              tx,
              target,
              actor.id,
              at,
            );
            await repository.createForwarding(tx, {
              incidentId: id,
              recipient,
              forwardedByUserId: actor.id,
              traceSnapshotId,
              at,
            });
            return mapFullDetail(await readDetail(tx, id), actor, storage);
          },
        ),
      );
    },

    /** US2: BGH hủy chỉ khi trùng/nhập sai (Q4). */
    async cancel(
      id: string,
      body: CancelFoodSafetyIncidentRequestDTO,
      principal: AuthPrincipal,
    ): Promise<FoodSafetyIncidentFullDetailDTO> {
      return boardAction(
        id,
        principal,
        "food_safety_incident.manage",
        async (tx, actor, target, _schoolId, at) => {
          if (target.status !== "PENDING_SCHOOL_REVIEW")
            throw new HttpError(409, NOT_PENDING);
          const changed = await repository.markCancelled(tx, id, body);
          if (changed !== 1) throw new HttpError(409, NOT_PENDING);
          await repository.recordHistory(tx, {
            incidentId: id,
            fromStatus: "PENDING_SCHOOL_REVIEW",
            toStatus: "CANCELLED_BY_SCHOOL",
            actor: actorOf(actor),
            note: body.note,
            at,
          });
          return mapFullDetail(await readDetail(tx, id), actor, storage);
        },
      );
    },

    /** US4: BGH gắn suất ăn đã phát của trường (chỉ thêm, không gỡ). */
    async addAllocations(
      id: string,
      body: AddFoodSafetyIncidentAllocationsRequestDTO,
      principal: AuthPrincipal,
    ): Promise<FoodSafetyIncidentAllocationsResponseDTO> {
      return boardAction(
        id,
        principal,
        "food_safety_incident.manage",
        async (tx, actor, target, schoolId, at) => {
          if (FINISHED_STATUSES.has(target.status))
            throw new HttpError(409, FINISHED);
          const allocations = await repository.findSchoolAllocations(
            tx,
            body.mealAllocationIds,
            schoolId,
          );
          if (allocations.length !== body.mealAllocationIds.length)
            throw new HttpError(404, "Không tìm thấy suất ăn trong trường");
          if (allocations.some((row) => !SERVED.has(row.status)))
            throw new HttpError(409, "Chỉ gắn được suất ăn đã phát cho lớp");
          const added = await repository.addAllocations(
            tx,
            id,
            body.mealAllocationIds,
          );
          // FR-006: sau khi đã gửi ATTP, mỗi lần bổ sung suất ăn mới → snapshot mới + bản chuyển bổ sung.
          if (added > 0 && target.status !== "PENDING_SCHOOL_REVIEW") {
            const recipient = target.recipientCommuneFoodSafetyUnitId
              ? await supplementRecipient(
                  tx,
                  target.recipientCommuneFoodSafetyUnitId,
                )
              : null;
            const traceSnapshotId = await takeSnapshot(
              tx,
              target,
              actor.id,
              at,
            );
            if (recipient)
              await repository.createForwarding(tx, {
                incidentId: id,
                recipient,
                forwardedByUserId: actor.id,
                traceSnapshotId,
                at,
              });
          }
          return {
            added,
            incident: mapFullDetail(await readDetail(tx, id), actor, storage),
          };
        },
      );
    },
  };
}

export const foodSafetyIncidentService = createFoodSafetyIncidentService();
export type FoodSafetyIncidentService = ReturnType<
  typeof createFoodSafetyIncidentService
>;
