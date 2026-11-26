import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import { ROLES } from "../../constants/roles";
import {
  assertPermission,
  authorizationTransaction,
  databaseOperation,
  loadPrincipal,
} from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import {
  cloudinaryEvidenceStorage,
  signedEvidenceUrl,
  withStoredEvidence,
  type EvidenceStorage,
} from "../../utils/evidence-files";
import { HttpError } from "../../utils/http-error";
import { RequestValidationError } from "../../utils/request-validation";
import {
  createFoodSafetyInspectionRepository,
  type FoodSafetyInspectionRepository,
  type FoodSafetyInspectionRow,
  type InspectionIncidentTarget,
} from "./food-safety-inspection.repository";
import type {
  CloseFoodSafetyIncidentRequestDTO,
  PlanFoodSafetyInspectionRequestDTO,
  RecordFoodSafetyInspectionResultRequestDTO,
} from "./food-safety-inspection.request.dto";
import type {
  FoodSafetyIncidentCloseResponseDTO,
  FoodSafetyInspectionActionResponseDTO,
  FoodSafetyInspectionDTO,
  FoodSafetyInspectionSupplierOptionsResponseDTO,
} from "./food-safety-inspection.response.dto";

type Tx = Prisma.TransactionClient;

export const INSPECTION_PERMISSION = "food_safety_inspection.manage";
const NOT_FOUND = "Không tìm thấy hồ sơ sự cố";
const ONLY_OFFICER = "Chỉ cán bộ ATTP được thực hiện thao tác này";

function isOfficer(p: AuthPrincipal): p is AuthPrincipal & {
  communeFoodSafetyUnitId: string;
} {
  return (
    p.orgType === "AUTHORITY" &&
    p.role === ROLES.COMMUNE_FOOD_SAFETY_OFFICER &&
    Boolean(p.communeFoodSafetyUnitId)
  );
}

function assertOfficer(p: AuthPrincipal): string {
  if (!isOfficer(p)) throw new HttpError(403, ONLY_OFFICER);
  assertPermission(p, INSPECTION_PERMISSION);
  return p.communeFoodSafetyUnitId;
}

/** NCC trong payload snapshot (`payload.suppliers[].id`), bỏ qua dữ liệu không đúng dạng. */
export function snapshotSupplierIds(payloads: readonly unknown[]): string[] {
  const ids = new Set<string>();
  for (const payload of payloads) {
    if (!payload || typeof payload !== "object") continue;
    const suppliers = (payload as { suppliers?: unknown }).suppliers;
    if (!Array.isArray(suppliers)) continue;
    for (const supplier of suppliers) {
      const id = (supplier as { id?: unknown } | null)?.id;
      if (typeof id === "string") ids.add(id);
    }
  }
  return [...ids].sort();
}

function mapInspection(
  row: FoodSafetyInspectionRow,
  storage: Pick<EvidenceStorage, "url">,
): FoodSafetyInspectionDTO {
  return {
    id: row.id,
    incidentId: row.incidentId,
    status: row.status,
    teamDescription: row.teamDescription,
    scheduledAt: row.scheduledAt.toISOString(),
    resultSummary: row.resultSummary,
    overallConclusion: row.overallConclusion,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    findings: row.findings.map((item) => ({
      supplier: item.Supplier,
      finding: item.finding,
      evidenceNote: item.evidenceNote,
    })),
    attachments: row.attachments.flatMap((file) =>
      file.stage === "INSPECTION_RESULT"
        ? [
            {
              id: file.id,
              stage: file.stage,
              fileName: file.originalFilename,
              mimeType: file.mimeType,
              sizeBytes: file.sizeBytes,
              createdAt: file.createdAt.toISOString(),
              url: signedEvidenceUrl(storage, file.storagePublicId),
            },
          ]
        : [],
    ),
  };
}

export function createFoodSafetyInspectionService(
  repository: FoodSafetyInspectionRepository = createFoodSafetyInspectionRepository(),
  connect: () => Promise<PrismaClient> = getPrisma,
  now = () => new Date(),
  storage: EvidenceStorage = cloudinaryEvidenceStorage,
) {
  const database = () => databaseOperation(() => connect());

  /** FR-004: nạp lại cán bộ, khóa dòng hồ sơ, giới hạn theo đơn vị nhận. */
  async function officerAction<T>(
    id: string,
    principal: AuthPrincipal,
    run: (
      tx: Tx,
      actor: AuthPrincipal,
      target: InspectionIncidentTarget,
      at: Date,
    ) => Promise<T>,
  ): Promise<T> {
    assertOfficer(principal);
    return authorizationTransaction(await database(), async (tx) => {
      const actor = await loadPrincipal(principal.id, tx);
      const unitId = assertOfficer(actor);
      if (unitId !== principal.communeFoodSafetyUnitId)
        throw new HttpError(403, "Phạm vi tài khoản đã thay đổi");
      await repository.lockIncident(tx, id);
      const target = await repository.findOfficerTarget(tx, id, unitId);
      if (!target) throw new HttpError(404, NOT_FOUND);
      return run(tx, actor, target, now());
    });
  }

  async function supplierOptions(
    db: Parameters<FoodSafetyInspectionRepository["snapshotPayloads"]>[0],
    target: InspectionIncidentTarget,
  ): Promise<FoodSafetyInspectionSupplierOptionsResponseDTO> {
    const ids = snapshotSupplierIds(
      await repository.snapshotPayloads(db, target.id),
    );
    if (ids.length)
      return {
        source: "SNAPSHOT",
        items: await repository.suppliersByIds(db, ids),
      };
    return {
      source: "SCHOOL_RELATIONSHIP",
      items: await repository.schoolSuppliers(db, target.schoolId),
    };
  }

  async function readInspection(tx: Tx, id: string) {
    const row = await repository.readInspection(tx, id);
    if (!row)
      throw new HttpError(503, "Chưa tải được hồ sơ. Vui lòng thử lại.");
    return mapInspection(row, storage);
  }

  const actorOf = (actor: AuthPrincipal) => ({
    id: actor.id,
    roleCode: actor.role,
  });

  return {
    async getSupplierOptions(
      id: string,
      principal: AuthPrincipal,
    ): Promise<FoodSafetyInspectionSupplierOptionsResponseDTO> {
      const unitId = assertOfficer(principal);
      const db = await database();
      const target = await repository.findOfficerTarget(db, id, unitId);
      if (!target) throw new HttpError(404, NOT_FOUND);
      return supplierOptions(db, target);
    },

    /** US1: lập đợt; AUTHORITY_ACKNOWLEDGED → UNDER_INSPECTION. */
    async plan(
      id: string,
      body: PlanFoodSafetyInspectionRequestDTO,
      principal: AuthPrincipal,
    ): Promise<FoodSafetyInspectionActionResponseDTO> {
      return officerAction(id, principal, async (tx, actor, target, at) => {
        if (target.status === "SUBMITTED_TO_AUTHORITY")
          throw new HttpError(
            409,
            "Cần tiếp nhận hồ sơ trước khi lập đợt kiểm tra",
          );
        if (
          target.status !== "AUTHORITY_ACKNOWLEDGED" &&
          target.status !== "UNDER_INSPECTION"
        )
          throw new HttpError(409, "Hồ sơ không còn nhận đợt kiểm tra mới");
        const inspection = await repository.createInspection(tx, {
          incidentId: id,
          teamDescription: body.teamDescription,
          scheduledAt: body.scheduledAt,
          createdByUserId: actor.id,
          at,
        });
        if (target.status === "AUTHORITY_ACKNOWLEDGED") {
          const moved = await repository.moveIncident(
            tx,
            id,
            "AUTHORITY_ACKNOWLEDGED",
            "UNDER_INSPECTION",
          );
          if (moved !== 1)
            throw new HttpError(409, "Trạng thái hồ sơ đã thay đổi");
          await repository.recordHistory(tx, {
            incidentId: id,
            fromStatus: "AUTHORITY_ACKNOWLEDGED",
            toStatus: "UNDER_INSPECTION",
            actor: actorOf(actor),
            at,
          });
        }
        return {
          incidentStatus: "UNDER_INSPECTION",
          inspection: mapInspection(inspection, storage),
        };
      });
    },

    /** US2: ghi kết quả một lần; hết đợt PLANNED → INSPECTION_COMPLETED. */
    async recordResult(
      id: string,
      inspectionId: string,
      body: RecordFoodSafetyInspectionResultRequestDTO,
      principal: AuthPrincipal,
    ): Promise<FoodSafetyInspectionActionResponseDTO> {
      assertOfficer(principal);
      return withStoredEvidence(
        storage,
        body.files,
        principal.id,
        (files) =>
          officerAction(id, principal, async (tx, actor, target, at) => {
            if (target.status !== "UNDER_INSPECTION")
              throw new HttpError(409, "Hồ sơ không ở bước kiểm tra");
            const inspection = await repository.findInspection(
              tx,
              id,
              inspectionId,
            );
            if (!inspection)
              throw new HttpError(404, "Không tìm thấy đợt kiểm tra");
            if (inspection.status !== "PLANNED")
              throw new HttpError(409, "Đợt kiểm tra đã có kết quả");
            const allowed = new Set(
              (await supplierOptions(tx, target)).items.map((item) => item.id),
            );
            const invalid = body.findings.flatMap((item, index) =>
              allowed.has(item.supplierId)
                ? []
                : [
                    {
                      field: `findings.${index}.supplierId`,
                      message: "NCC không thuộc chuỗi truy xuất của hồ sơ",
                    },
                  ],
            );
            if (invalid.length) throw new RequestValidationError(invalid);
            const changed = await repository.recordResult(tx, inspectionId, {
              resultSummary: body.resultSummary,
              overallConclusion: body.overallConclusion,
              recordedByUserId: actor.id,
              at,
            });
            if (changed !== 1)
              throw new HttpError(409, "Đợt kiểm tra đã có kết quả");
            await repository.createFindings(
              tx,
              inspectionId,
              body.findings.map((item) => ({
                supplierId: item.supplierId,
                finding: item.finding,
                evidenceNote: item.evidenceNote ?? null,
              })),
            );
            await repository.addResultAttachments(tx, {
              incidentId: id,
              inspectionId,
              uploaderUserId: actor.id,
              files,
              at,
            });
            const counts = await repository.countInspections(tx, id);
            let incidentStatus: FoodSafetyInspectionActionResponseDTO["incidentStatus"] =
              "UNDER_INSPECTION";
            if (counts.planned === 0) {
              const moved = await repository.moveIncident(
                tx,
                id,
                "UNDER_INSPECTION",
                "INSPECTION_COMPLETED",
              );
              if (moved !== 1)
                throw new HttpError(409, "Trạng thái hồ sơ đã thay đổi");
              await repository.recordHistory(tx, {
                incidentId: id,
                fromStatus: "UNDER_INSPECTION",
                toStatus: "INSPECTION_COMPLETED",
                actor: actorOf(actor),
                at,
              });
              incidentStatus = "INSPECTION_COMPLETED";
            }
            return {
              incidentStatus,
              inspection: await readInspection(tx, inspectionId),
            };
          }),
        "food-safety-incidents",
      );
    },

    /** US3: đóng hồ sơ; không gỡ hạn chế NCC (Q5). */
    async close(
      id: string,
      body: CloseFoodSafetyIncidentRequestDTO,
      principal: AuthPrincipal,
    ): Promise<FoodSafetyIncidentCloseResponseDTO> {
      return officerAction(id, principal, async (tx, actor, target, at) => {
        if (target.status !== "INSPECTION_COMPLETED")
          throw new HttpError(409, "Chỉ đóng hồ sơ đã có kết quả kiểm tra");
        const counts = await repository.countInspections(tx, id);
        if (counts.planned > 0)
          throw new HttpError(409, "Còn đợt kiểm tra chưa có kết quả");
        if (counts.completed === 0 && target.source !== "LEGACY_IMPORT")
          throw new HttpError(409, "Hồ sơ chưa có kết quả kiểm tra");
        const moved = await repository.moveIncident(
          tx,
          id,
          "INSPECTION_COMPLETED",
          "CLOSED",
        );
        if (moved !== 1)
          throw new HttpError(409, "Trạng thái hồ sơ đã thay đổi");
        await repository.recordHistory(tx, {
          incidentId: id,
          fromStatus: "INSPECTION_COMPLETED",
          toStatus: "CLOSED",
          actor: actorOf(actor),
          note: body.note,
          at,
        });
        return { id, status: "CLOSED" };
      });
    },
  };
}

export const foodSafetyInspectionService = createFoodSafetyInspectionService();
export type FoodSafetyInspectionService = ReturnType<
  typeof createFoodSafetyInspectionService
>;
