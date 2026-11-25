import { Prisma } from "../generated/prisma/client";

const Decimal = Prisma.Decimal;
type DecimalInput = Prisma.Decimal | string | number;

/** Tỷ lệ hao hụt hợp lệ: 0 <= r < 1. Giá trị thiếu hoặc null được coi là 0. */
function rate(value: DecimalInput | null | undefined): Prisma.Decimal {
  const r = new Decimal(value ?? 0);
  if (!r.isFinite() || r.lt(0) || r.gte(1))
    throw new RangeError("Tỷ lệ hao hụt từ 0% đến dưới 100%.");
  return r;
}

/** Lượng sống cần dùng để ra `net` thành phẩm: net / (1 - r). */
export function grossFromNet(
  net: DecimalInput,
  wasteRate: DecimalInput | null | undefined,
): Prisma.Decimal {
  const r = rate(wasteRate);
  const value = new Decimal(net);
  return r.isZero() ? value : value.div(new Decimal(1).sub(r));
}

/** Lượng thành phẩm thu được từ `gross` nguyên liệu sống: gross × (1 - r). */
export function netFromGross(
  gross: DecimalInput,
  wasteRate: DecimalInput | null | undefined,
): Prisma.Decimal {
  const r = rate(wasteRate);
  const value = new Decimal(gross);
  return r.isZero() ? value : value.mul(new Decimal(1).sub(r));
}
