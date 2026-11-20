import { Prisma } from "../generated/prisma/client";

/**
 * Chỉ dùng cho mã lô đánh số tuần tự LO/CB/BG/SU (ngoài phạm vi nguyên tắc VII).
 * Mã nghiệp vụ của các danh sách (hồ sơ, chuyến giao, khiếu nại, sự cố...) dùng `business-code.ts`
 * với hậu tố mã hóa Feistel; không thêm loại mã danh sách mới vào đây.
 *
 * Mã định danh thống nhất của hệ thống: FP-<2 chữ viết tắt tính năng>-<số thứ tự 5 chữ số>.
 * Đánh số toàn hệ thống, tăng dần theo từng loại mã. Mã chuyến giao (FP-DE), phản hồi chất lượng
 * (FP-CP) và cơ sở nguồn cung (FP-SF) có bộ sinh riêng từ trước.
 */
export const FP_CODE_TARGETS = {
  /** Lô nguyên liệu */
  LO: { table: "ingredient_lots", column: "lot_code" },
  /** Lô nấu */
  CB: { table: "cooking_batches", column: "batch_code" },
  /** Nhóm lô nấu của một bữa */
  BG: { table: "cooking_batch_groups", column: "batch_code" },
  /** Tủ lưu mẫu */
  SU: { table: "sample_storage_units", column: "code" },
} as const;
export type FpCodeType = keyof typeof FP_CODE_TARGETS;

const MIN_DIGITS = 5;

export function formatFpCode(type: FpCodeType, sequence: bigint): string {
  if (sequence <= 0n)
    throw new RangeError("Số thứ tự mã phải là số nguyên dương.");
  return `FP-${type}-${sequence.toString(10).padStart(MIN_DIGITS, "0")}`;
}

type RawQueryClient = Pick<Prisma.TransactionClient, "$queryRaw">;

/**
 * Cấp `count` mã liên tiếp cho một loại mã. Phải gọi trong transaction: khóa advisory theo loại mã
 * giữ đến hết transaction nên hai lần cấp đồng thời không trùng số. Chỉ đọc các mã đã đúng dạng
 * FP-XX-<số>; mã cũ (PLAN-01, CB-<uuid>, TU-LM-01...) không ảnh hưởng số thứ tự.
 */
export async function reserveFpCodes(
  db: RawQueryClient,
  type: FpCodeType,
  count: number,
): Promise<string[]> {
  if (count <= 0) return [];
  const { table, column } = FP_CODE_TARGETS[type];
  const lockKey = `foodprint:fp-code:${type}`;
  await db.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext(${lockKey}))`;
  const pattern = `^FP-${type}-[0-9]{5,}$`;
  // Lọc bằng regex trước khi ép kiểu numeric để mã cũ không làm lỗi truy vấn.
  const rows = await db.$queryRaw<{ maxSeq: string | null }[]>(
    Prisma.sql`SELECT MAX(substring(${Prisma.raw(column)} FROM 7)::numeric)::text AS "maxSeq"
      FROM foodprint.${Prisma.raw(table)}
      WHERE ${Prisma.raw(column)} ~ ${pattern}`,
  );
  const rawMax = Array.isArray(rows) ? rows[0]?.maxSeq : null;
  const start = (rawMax ? BigInt(rawMax) : 0n) + 1n;
  return Array.from({ length: count }, (_, index) =>
    formatFpCode(type, start + BigInt(index)),
  );
}
