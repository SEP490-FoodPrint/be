import { Prisma } from "../generated/prisma/client";

/**
 * Số suất của mẻ là numeric(20,2) từ TASK-10 v8 (mẻ chia theo nguyên liệu, có thể lẻ).
 * Các phép cộng/so sánh dùng số thực nhưng luôn làm tròn 0,01 để tránh sai số dấu phẩy động.
 */
type PortionInput = Prisma.Decimal | number | string | null | undefined;

export function portionsOrNull(value: PortionInput): number | null {
  if (value === null || value === undefined) return null;
  return roundPortions(Number(value));
}

export function portionNumber(value: PortionInput): number {
  return portionsOrNull(value) ?? 0;
}

export function roundPortions(value: number): number {
  return Math.round(value * 100) / 100;
}

export function addPortion(total: number, value: PortionInput): number {
  return roundPortions(total + portionNumber(value));
}
