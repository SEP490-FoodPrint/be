import type { Prisma } from "../generated/prisma/client";

export type BusinessCodeCounterClient = Pick<
  Prisma.TransactionClient,
  "$queryRaw"
>;

/**
 * Cấp số thứ tự kế tiếp cho một loại mã nghiệp vụ. Phải gọi trong transaction tạo bản ghi:
 * khóa advisory theo loại mã (nguyên tắc VII) và khóa dòng bộ đếm đều giữ tới hết transaction, nên các lần
 * cấp đồng thời cùng loại được tuần tự hóa và rollback trả lại số thứ tự.
 *
 * Trả về `null` khi bộ đếm đã chạm giới hạn `maxSequence` (hết dải) mà không làm hỏng transaction.
 */
export async function nextBusinessCodeSequence(
  db: BusinessCodeCounterClient,
  codeType: string,
  maxSequence: number,
): Promise<number | null> {
  const lockKey = `foodprint:business-code:${codeType}`;
  // pg_advisory_xact_lock trả về void; chọn hằng số để Prisma không phải đọc cột kiểu void.
  await db.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext(${lockKey}))`;
  const rows = await db.$queryRaw<{ lastSequence: number }[]>`
    INSERT INTO foodprint.business_code_counters AS counters (code_type, last_sequence, updated_at)
    VALUES (${codeType}, 1, now())
    ON CONFLICT (code_type) DO UPDATE
      SET last_sequence = counters.last_sequence + 1,
          updated_at = now()
      WHERE counters.last_sequence < ${maxSequence}
    RETURNING last_sequence AS "lastSequence"
  `;
  const value = rows[0]?.lastSequence;
  if (value === undefined) return null;
  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error("Giá trị bộ đếm mã nghiệp vụ không hợp lệ.");
  }
  return sequence;
}
