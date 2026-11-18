import type { PrismaClient } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import { recordPhotoUrl, type RecordPhoto } from "../../utils/record-photo";
import {
  assertPermission,
  withSchoolTransaction,
} from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import {
  blockchainProofService,
  type ProofRef,
} from "../blockchain-proof/blockchain-proof.service";
import { HttpError } from "../../utils/http-error";
import { listScopes } from "../../utils/resource-access";
import type {
  FoodSampleInput,
  SampleDisposalInput,
  RetainedSampleListQuery,
} from "./retained-sample.request.dto";
import type {
  RetainedSampleResponseDTO,
  RetainedSampleListResponseDTO,
} from "./retained-sample.response.dto";
import {
  createRetainedSampleRepository,
  type ListReader,
  type SampleRow,
} from "./retained-sample.repository";

function mapSample(row: SampleRow): RetainedSampleResponseDTO {
  return {
    id: row.id,
    cookingBatchId: row.cookingBatchId,
    dishId: row.dishId,
    recordedByUserId: row.recordedByUserId,
    sampledAt: row.sampledAt.toISOString(),
    expiresAt: new Date(row.sampledAt.getTime() + 24 * 3600000).toISOString(),
    quantity: row.quantity?.toString() ?? null,
    unit: row.unit,
    storageLocation: row.storageLocation,
    storageUnitId: row.storageUnitId,
    storageUnitName: row.storageUnit?.name ?? null,
    photoUrl: recordPhotoUrl(row.photoPublicId),
    status: row.status,
    disposedAt: row.disposedAt?.toISOString() ?? null,
    disposalNote: row.disposalNote,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    CookingBatch: {
      batchCode: row.CookingBatch.batchCode,
      mealType: row.CookingBatch.mealType,
      plannedPortions: row.CookingBatchDish.plannedPortions,
      BatchGroup: {
        id: row.CookingBatch.BatchGroup.id,
        batchCode: row.CookingBatch.BatchGroup.batchCode,
      },
      Dish: { name: row.CookingBatchDish.Dish.name },
    },
  };
}

export function createRetainedSampleService(
  read?: ListReader,
  connect: () => Promise<PrismaClient> = getPrisma,
  proofs: Pick<
    typeof blockchainProofService,
    "prepareSampleStored" | "prepareSampleDisposed" | "scheduleAnchor"
  > = blockchainProofService,
) {
  const repository = createRetainedSampleRepository(read);
  return {
    async forBatch(
      cookingBatchId: string,
      principal: AuthPrincipal,
    ): Promise<RetainedSampleResponseDTO[]> {
      assertPermission(principal, "retained_sample.view");
      if (principal.orgType !== "SCHOOL" || !principal.schoolId)
        throw new HttpError(403, "Cần phạm vi trường");
      const db = await connect();
      if (!(await repository.findBatch(db, cookingBatchId, principal.schoolId)))
        throw new HttpError(404, "Không tìm thấy mẻ trong trường");
      const samples = await repository.listForBatch(db, cookingBatchId);
      return samples.map(mapSample);
    },
    async create(
      cookingBatchId: string,
      input: FoodSampleInput,
      principal: AuthPrincipal,
      photo: RecordPhoto | null = null,
    ): Promise<RetainedSampleResponseDTO & { created: boolean }> {
      let proof: ProofRef | null = null;
      const result = await withSchoolTransaction(
        await connect(),
        principal,
        "retained_sample.create",
        async (tx, actor, schoolId) => {
          const batch = await repository.findBatch(
            tx,
            cookingBatchId,
            schoolId,
          );
          if (!batch)
            throw new HttpError(404, "Không tìm thấy mẻ trong trường");
          if (batch.status !== "COMPLETED" || !batch.completedAt)
            throw new HttpError(409, "Chỉ lưu mẫu cho mẻ đã hoàn thành");
          const dishId =
            input.dishId ??
            (batch.dishes.length === 1 ? batch.dishes[0].dishId : undefined);
          if (!dishId || !batch.dishes.some((d) => d.dishId === dishId))
            throw new HttpError(400, "Cần chọn đúng món trong mẻ để lưu mẫu");
          const unit = await repository.lockStorageUnit(
            tx,
            input.storageUnitId,
            schoolId,
          );
          if (!unit)
            throw new HttpError(404, "Không tìm thấy tủ lưu mẫu của trường");
          const storageLocation = input.storageLocation
            ? `${unit.name} – ${input.storageLocation}`
            : unit.name;
          const existing = await repository.findForBatch(
            tx,
            cookingBatchId,
            dishId,
          );
          if (existing) {
            if (
              existing.quantity?.toString() !==
                String(Number(input.quantity)) ||
              existing.unit !== input.unit ||
              existing.storageUnitId !== unit.id ||
              existing.storageLocation !== storageLocation ||
              +existing.sampledAt !== +input.sampledAt ||
              (existing.photoHash ?? null) !== (photo?.photoHash ?? null)
            ) {
              throw new HttpError(
                409,
                "Mẻ đã có mẫu lưu; không ghi đè thông tin mẫu",
              );
            }
            return { ...mapSample(existing), created: false };
          }
          if (
            +input.sampledAt < +batch.completedAt ||
            +input.sampledAt > Date.now()
          )
            throw new HttpError(
              422,
              "Thời điểm lấy mẫu phải từ lúc hoàn thành mẻ đến hiện tại",
            );
          if (unit.status !== "ACTIVE")
            throw new HttpError(
              409,
              unit.status === "MAINTENANCE"
                ? `Tủ ${unit.name} đang bảo trì, hãy chọn tủ khác`
                : `Tủ ${unit.name} đã ngưng sử dụng, hãy chọn tủ khác`,
            );
          // Cùng công thức với màn tủ lưu mẫu: max(số đã khai báo, số mẫu đang lưu).
          const stored = Math.max(
            unit.currentUsage,
            await repository.countStoredInUnit(tx, unit.id),
          );
          if (stored >= unit.capacity)
            throw new HttpError(
              409,
              `Tủ ${unit.name} đã đầy (${stored}/${unit.capacity} mẫu), hãy chọn tủ khác`,
            );
          const sample = await repository.create(tx, cookingBatchId, actor.id, {
            ...input,
            ...photo,
            storageLocation,
            dishId,
          });
          proof = await proofs.prepareSampleStored(tx, sample.id, actor.id);
          return { ...mapSample(sample), created: true };
        },
      );
      proofs.scheduleAnchor(proof);
      return result;
    },
    async dispose(
      id: string,
      input: SampleDisposalInput,
      principal: AuthPrincipal,
    ): Promise<RetainedSampleResponseDTO> {
      let proof: ProofRef | null = null;
      const result = await withSchoolTransaction(
        await connect(),
        principal,
        "retained_sample.dispose",
        async (tx, actor, schoolId) => {
          const sample = await repository.findInSchool(tx, id, schoolId);
          if (!sample)
            throw new HttpError(404, "Không tìm thấy mẫu lưu của trường");
          if (sample.status === "DISPOSED") {
            if (
              Number(sample.disposedAt) !== +input.disposedAt ||
              sample.disposalNote !== input.disposalNote
            )
              throw new HttpError(409, "Mẫu đã tiêu hủy; không ghi đè lịch sử");
            return mapSample(sample);
          }
          const expires = +sample.sampledAt + 24 * 3600000,
            now = Date.now();
          if (
            now < expires ||
            +input.disposedAt < expires ||
            +input.disposedAt > now
          )
            throw new HttpError(
              422,
              "Chỉ tiêu hủy mẫu sau ít nhất 24 giờ lưu thực tế",
            );
          const hold = await repository.findActiveIncident(
            tx,
            id,
            sample.cookingBatchId,
            schoolId,
          );
          if (hold)
            throw new HttpError(
              409,
              "Mẫu liên quan sự cố ATTP chưa kết thúc; cần tiếp tục bảo quản",
            );
          const disposed = await repository.dispose(tx, id, input);
          proof = await proofs.prepareSampleDisposed(tx, id, actor.id);
          return mapSample(disposed);
        },
      );
      proofs.scheduleAnchor(proof);
      return result;
    },
    async getAll(
      query: RetainedSampleListQuery,
      principal: AuthPrincipal,
    ): Promise<RetainedSampleListResponseDTO> {
      const scope = listScopes["retained-sample"](principal);
      try {
        const db = await connect();
        return await db.$transaction(
          async (tx) => {
            const [rows, totalItems] = await Promise.all([
              repository.list(tx, query, scope),
              repository.count(tx, query, scope),
            ]);
            return {
              items: rows.map(mapSample),
              pagination: {
                page: query.page,
                limit: query.limit,
                totalItems,
                hasNext: query.page * query.limit < totalItems,
              },
            };
          },
          { isolationLevel: "RepeatableRead" },
        );
      } catch {
        throw new HttpError(
          503,
          "Không thể tải danh sách. Vui lòng thử lại sau.",
        );
      }
    },
  };
}
export const retainedSampleService = createRetainedSampleService();
export type RetainedSampleService = ReturnType<
  typeof createRetainedSampleService
>;
