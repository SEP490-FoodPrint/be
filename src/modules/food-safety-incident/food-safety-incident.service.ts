import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import { ROLES } from "../../constants/roles";
import {
  assertPermission,
  databaseOperation,
  withSchoolTransaction,
} from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import { readListPage } from "../../utils/list-query";
import { RequestValidationError } from "../../utils/request-validation";
import { listScopes } from "../../utils/resource-access";
import {
  createFoodSafetyIncidentRepository,
  type FoodSafetyIncidentDetailRow,
  type FoodSafetyIncidentListRow,
  type FoodSafetyIncidentRepository,
  type IncidentActor,
  type IncidentRecipient,
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
  FoodSafetyIncidentDetailResponseDTO,
  FoodSafetyIncidentFullDetailDTO,
  FoodSafetyIncidentListItemDTO,
  FoodSafetyIncidentListResponseDTO,
  FoodSafetyIncidentReporterDetailDTO,
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

export function allowedIncidentActions(
  principal: AuthPrincipal,
  status: string,
): FoodSafetyIncidentActionDTO[] {
  if (!isBoard(principal)) return [];
  const has = (code: string) => principal.permissions.includes(code);
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

function mapReporterDetail(
  row: FoodSafetyIncidentDetailRow,
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
    allowedActions: [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapFullDetail(
  row: FoodSafetyIncidentDetailRow,
  principal: AuthPrincipal,
): FoodSafetyIncidentFullDetailDTO {
  const base = mapReporterDetail(row);
  return {
    ...base,
    view: "FULL",
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
    })),
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
    allowedActions: allowedIncidentActions(principal, row.status),
  };
}

function mapDetail(
  row: FoodSafetyIncidentDetailRow,
  principal: AuthPrincipal,
): FoodSafetyIncidentDetailResponseDTO {
  return isReporterView(principal)
    ? mapReporterDetail(row)
    : mapFullDetail(row, principal);
}

const actorOf = (actor: AuthPrincipal): IncidentActor => ({
  id: actor.id,
  roleCode: actor.role,
});

export function createFoodSafetyIncidentService(
  repository: FoodSafetyIncidentRepository = createFoodSafetyIncidentRepository(),
  connect: () => Promise<PrismaClient> = getPrisma,
  now = () => new Date(),
) {
  const database = () => databaseOperation(() => connect());

  async function readDetail(
    tx: Tx,
    id: string,
  ): Promise<FoodSafetyIncidentDetailRow> {
    const row = await repository.findDetail(tx, id, {});
    if (!row) throw new HttpError(503, "Không đọc lại được hồ sơ sự cố");
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
      target: { id: string; status: string },
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
      return mapDetail(row, principal);
    },

    /** US1: PH/GVCN báo cáo → PENDING_SCHOOL_REVIEW. */
    async report(
      body: ReportFoodSafetyIncidentRequestDTO,
      principal: AuthPrincipal,
    ): Promise<FoodSafetyIncidentReporterDetailDTO> {
      if (!reporterSource(principal.role))
        throw new HttpError(403, ONLY_REPORTER);
      return withSchoolTransaction(
        await database(),
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
          return mapReporterDetail(await readDetail(tx, id));
        },
      );
    },

    /** US3: BGH tự lập hồ sơ (SCHOOL_DIRECT) gửi thẳng ATTP. */
    async createDirect(
      body: DirectFoodSafetyIncidentRequestDTO,
      principal: AuthPrincipal,
    ): Promise<FoodSafetyIncidentFullDetailDTO> {
      if (!isBoard(principal)) throw new HttpError(403, ONLY_BOARD);
      assertPermission(principal, "food_safety_incident.forward");
      return withSchoolTransaction(
        await database(),
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
          await repository.createForwarding(tx, {
            incidentId: id,
            recipient,
            forwardedByUserId: actor.id,
            at,
          });
          return mapFullDetail(await readDetail(tx, id), actor);
        },
      );
    },

    /** US2: BGH ghi nhận định sơ bộ và chuyển ATTP (OUTSIDE_MEAL vẫn phải chuyển, Q4). */
    async forward(
      id: string,
      body: ForwardFoodSafetyIncidentRequestDTO,
      principal: AuthPrincipal,
    ): Promise<FoodSafetyIncidentFullDetailDTO> {
      return boardAction(
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
          await repository.createForwarding(tx, {
            incidentId: id,
            recipient,
            forwardedByUserId: actor.id,
            at,
          });
          return mapFullDetail(await readDetail(tx, id), actor);
        },
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
          return mapFullDetail(await readDetail(tx, id), actor);
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
        async (tx, actor, target, schoolId) => {
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
          return {
            added,
            incident: mapFullDetail(await readDetail(tx, id), actor),
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
