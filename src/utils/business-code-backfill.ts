import type { Prisma, PrismaClient } from "../generated/prisma/client";
import {
  allocateBusinessCodes,
  type ExistingBusinessCodes,
} from "./business-code";

/** Các loại mã có bản ghi cũ chưa mang mã cần backfill. */
export const BACKFILL_TYPES = ["MC", "IC"] as const;
export type BackfillType = (typeof BACKFILL_TYPES)[number];

export const BACKFILL_BATCH_SIZE = 100;

type Tx = Prisma.TransactionClient;

export interface BusinessCodeBackfillRepository {
  transaction<T>(operation: (tx: Tx) => Promise<T>): Promise<T>;
  /** Khóa và trả `id` của tối đa `take` dòng `code IS NULL`, theo thời điểm tạo rồi `id`. */
  lockUncoded(tx: Tx, type: BackfillType, take: number): Promise<string[]>;
  existingCodes(
    tx: Tx,
    type: BackfillType,
    codes: readonly string[],
  ): Promise<ReadonlySet<string>>;
  /** Gán mã cho dòng còn `code IS NULL`; trả số dòng được cập nhật (0 hoặc 1). */
  assignCode(
    tx: Tx,
    type: BackfillType,
    id: string,
    code: string,
  ): Promise<number>;
}

export type BackfillAllocator = (
  tx: Tx,
  type: BackfillType,
  count: number,
  exists: ExistingBusinessCodes,
) => Promise<string[]>;

export function createBusinessCodeBackfillRepository(
  db: PrismaClient,
): BusinessCodeBackfillRepository {
  return {
    transaction: (operation) =>
      db.$transaction(operation, { maxWait: 20_000, timeout: 120_000 }),
    async lockUncoded(tx, type, take) {
      const rows =
        type === "MC"
          ? await tx.$queryRaw<{ id: string }[]>`
              SELECT id::text AS id FROM foodprint.meal_complaints
              WHERE code IS NULL
              ORDER BY submitted_at, id
              LIMIT ${take}
              FOR UPDATE`
          : await tx.$queryRaw<{ id: string }[]>`
              SELECT id::text AS id FROM foodprint.food_safety_incidents
              WHERE code IS NULL
              ORDER BY created_at, id
              LIMIT ${take}
              FOR UPDATE`;
      return rows.map((row) => row.id);
    },
    async existingCodes(tx, type, codes) {
      const where = { code: { in: [...codes] } };
      const rows =
        type === "MC"
          ? await tx.mealComplaint.findMany({ where, select: { code: true } })
          : await tx.foodSafetyIncident.findMany({
              where,
              select: { code: true },
            });
      return new Set(
        rows.flatMap((row) => (row.code === null ? [] : [row.code])),
      );
    },
    async assignCode(tx, type, id, code) {
      // Chỉ gán mã kỹ thuật cho bản ghi cũ: cố ý không đổi updated_at nghiệp vụ.
      return type === "MC"
        ? tx.$executeRaw`UPDATE foodprint.meal_complaints SET code = ${code} WHERE id = ${id}::uuid AND code IS NULL`
        : tx.$executeRaw`UPDATE foodprint.food_safety_incidents SET code = ${code} WHERE id = ${id}::uuid AND code IS NULL`;
    },
  };
}

/**
 * Gán mã `FP-MC-…`/`FP-IC-…` cho bản ghi cũ `code IS NULL`, theo lô, mỗi lô một transaction
 * (khóa dòng → cấp mã bằng bộ đếm chung + Feistel → cập nhật). Chạy lại sau khi xong sẽ gán 0 dòng.
 */
export async function backfillBusinessCodes(
  repository: BusinessCodeBackfillRepository,
  options: { batchSize?: number; allocate?: BackfillAllocator } = {},
): Promise<Record<BackfillType, number>> {
  const batchSize = options.batchSize ?? BACKFILL_BATCH_SIZE;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new RangeError("Kích thước lô backfill phải là số nguyên dương.");
  }
  const allocate: BackfillAllocator =
    options.allocate ??
    ((tx, type, count, exists) =>
      allocateBusinessCodes(tx, type, count, exists));
  const assigned: Record<BackfillType, number> = { MC: 0, IC: 0 };
  for (const type of BACKFILL_TYPES) {
    for (;;) {
      const batch = await repository.transaction(async (tx) => {
        const ids = await repository.lockUncoded(tx, type, batchSize);
        if (ids.length === 0) return { selected: 0, updated: 0 };
        const codes = await allocate(tx, type, ids.length, (candidates) =>
          repository.existingCodes(tx, type, candidates),
        );
        let updated = 0;
        for (const [index, id] of ids.entries()) {
          updated += await repository.assignCode(tx, type, id, codes[index]);
        }
        return { selected: ids.length, updated };
      });
      assigned[type] += batch.updated;
      if (batch.selected < batchSize) break;
    }
  }
  return assigned;
}
