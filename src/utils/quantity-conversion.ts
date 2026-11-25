import { Prisma } from "../generated/prisma/client";
import { HttpError } from "./http-error";

/** Khối lượng/thể tích được phép quy đổi cho tồn kho và kế hoạch mẻ; đơn vị đếm chỉ khớp khi trùng chuỗi. */
const units: Record<string, { dimension: string; factor: string }> = {
  kg: { dimension: "mass", factor: "1000" },
  kilogram: { dimension: "mass", factor: "1000" },
  kilogam: { dimension: "mass", factor: "1000" },
  g: { dimension: "mass", factor: "1" },
  gam: { dimension: "mass", factor: "1" },
  gram: { dimension: "mass", factor: "1" },
  mg: { dimension: "mass", factor: "0.001" },
  miligam: { dimension: "mass", factor: "0.001" },
  milligram: { dimension: "mass", factor: "0.001" },
  l: { dimension: "volume", factor: "1000" },
  lit: { dimension: "volume", factor: "1000" },
  lít: { dimension: "volume", factor: "1000" },
  liter: { dimension: "volume", factor: "1000" },
  litre: { dimension: "volume", factor: "1000" },
  ml: { dimension: "volume", factor: "1" },
  mililit: { dimension: "volume", factor: "1" },
  mililít: { dimension: "volume", factor: "1" },
  milliliter: { dimension: "volume", factor: "1" },
  millilitre: { dimension: "volume", factor: "1" },
};

export function convertQuantity(
  quantity: Prisma.Decimal,
  from: string,
  to: string,
): Prisma.Decimal {
  const source = from.trim().normalize("NFC").toLowerCase();
  const target = to.trim().normalize("NFC").toLowerCase();
  if (source && source === target) return quantity;
  const left = Object.hasOwn(units, source) ? units[source] : undefined;
  const right = Object.hasOwn(units, target) ? units[target] : undefined;
  if (!left || !right || left.dimension !== right.dimension)
    throw new HttpError(
      409,
      `Không đổi được “${from.trim()}” sang “${to.trim()}”. Kiểm tra đơn vị.`,
    );
  return quantity.mul(left.factor).div(right.factor);
}
