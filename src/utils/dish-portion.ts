import { Prisma } from "../generated/prisma/client";

const Decimal = Prisma.Decimal;
type DecimalInput = Prisma.Decimal | string | number;

/** Đơn vị được phép cho mốc chuẩn của món. */
export const DISH_STANDARD_UNITS = ["g", "ml"] as const;
export type DishStandardUnit = (typeof DISH_STANDARD_UNITS)[number];

/**
 * Đơn vị khối lượng/thể tích: dòng công thức dùng các đơn vị này được nhân theo tỉ lệ khẩu phần.
 * Đơn vị đếm (quả, hộp, cái, phần, miếng, suất, chai…) giữ nguyên số lượng đã khai báo cho mọi khối.
 */
const SCALED_UNITS = new Set(["g", "mg", "kg", "ml", "l", "lít", "lit"]);

const normalizeUnit = (unit: string) =>
  unit.normalize("NFC").trim().toLowerCase();

/** Dòng công thức có được nhân theo tỉ lệ khẩu phần hay không (FR-003). */
export function isScaledUnit(unit: string) {
  return SCALED_UNITS.has(normalizeUnit(unit));
}

/**
 * Kiểm tra mốc chuẩn so với công thức (FR-004). Không quy đổi đơn vị.
 * S = tổng `requiredQuantity` của mọi dòng (nguyên liệu chính và gia vị) có đơn vị trùng mốc chuẩn.
 * - Mọi dòng cùng đơn vị: mốc chuẩn ≥ S.
 * - Có dòng cùng đơn vị và có dòng khác đơn vị: mốc chuẩn > S.
 * - Không dòng nào cùng đơn vị: mốc chuẩn > 0.
 * Trả về thông báo lỗi, hoặc null nếu hợp lệ.
 */
export function standardQuantityIssue(
  lines: readonly { requiredQuantity: DecimalInput; unit: string }[],
  standardQuantity: DecimalInput,
  standardUnit: string,
): string | null {
  const standard = new Decimal(standardQuantity);
  if (!standard.isFinite() || !standard.gt(0))
    return "Mốc chuẩn phải lớn hơn 0";
  const unit = normalizeUnit(standardUnit);
  const same = lines.filter((line) => normalizeUnit(line.unit) === unit);
  if (!same.length) return null;
  const total = same.reduce(
    (sum, line) => sum.add(new Decimal(line.requiredQuantity)),
    new Decimal(0),
  );
  const strict = same.length !== lines.length;
  if (strict ? standard.gt(total) : standard.gte(total)) return null;
  return strict
    ? `Mốc chuẩn phải lớn hơn ${total.toString()} ${unit} (tổng nguyên liệu và gia vị cùng đơn vị, món còn nguyên liệu dùng đơn vị khác)`
    : `Mốc chuẩn phải lớn hơn hoặc bằng ${total.toString()} ${unit} (tổng nguyên liệu và gia vị cùng đơn vị)`;
}

/**
 * Định lượng 1 suất = required × portion / standard, làm tròn 3 chữ số thập phân ROUND_HALF_UP (FR-003).
 */
export function scaleDishQuantity(
  requiredQuantity: DecimalInput,
  portionQuantity: DecimalInput,
  standardQuantity: DecimalInput,
): Prisma.Decimal {
  const standard = new Decimal(standardQuantity);
  if (!standard.gt(0)) throw new RangeError("Mốc chuẩn phải lớn hơn 0");
  return new Decimal(requiredQuantity)
    .mul(new Decimal(portionQuantity))
    .div(standard)
    .toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
}

/**
 * Tính định lượng 1 suất cho từng dòng công thức mốc chuẩn.
 * Dòng khối lượng/thể tích nhân theo tỉ lệ; dòng đơn vị đếm giữ nguyên.
 * `portionQuantity` null/undefined nghĩa là dùng đúng mốc chuẩn (tỉ lệ 1, thực đơn toàn trường).
 */
export function scaleDishLines<
  L extends { requiredQuantity: DecimalInput; unit: string },
>(
  standardQuantity: DecimalInput,
  portionQuantity: DecimalInput | null | undefined,
  lines: readonly L[],
): (Omit<L, "requiredQuantity"> & { requiredQuantity: Prisma.Decimal })[] {
  const portion = portionQuantity ?? standardQuantity;
  return lines.map((line) => ({
    ...line,
    requiredQuantity: isScaledUnit(line.unit)
      ? scaleDishQuantity(line.requiredQuantity, portion, standardQuantity)
      : new Decimal(line.requiredQuantity),
  }));
}

/**
 * Định lượng 1 suất của món cho một khối: tìm khẩu phần của khối rồi tính theo `scaleDishLines`.
 * Trả về null nếu món chưa khai báo khẩu phần cho khối này.
 */
export function gradeDishLines<
  L extends { requiredQuantity: DecimalInput; unit: string },
>(
  dish: {
    standardQuantity: DecimalInput;
    gradeRecipes: readonly { gradeId: string; portionQuantity: DecimalInput }[];
  },
  gradeId: string,
  lines: readonly L[],
) {
  const portion = dish.gradeRecipes.find(
    (recipe) => recipe.gradeId === gradeId,
  )?.portionQuantity;
  if (portion === undefined) return null;
  return scaleDishLines(dish.standardQuantity, portion, lines);
}
