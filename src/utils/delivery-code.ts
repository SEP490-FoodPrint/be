export const DELIVERY_CODE_PREFIX = "FP-DE-";
export const DELIVERY_CODE_MIN_DIGITS = 5;
export const DELIVERY_CODE_MAX_LENGTH = 80;
export const DELIVERY_CODE_MAX_DIGITS =
  DELIVERY_CODE_MAX_LENGTH - DELIVERY_CODE_PREFIX.length;

// Matches 5 digits (00001..99999) or >=6 digits without leading zero up to varchar(80) cap (74 digits).
export const DELIVERY_CODE_PATTERN = /^FP-DE-(?:[0-9]{5}|[1-9][0-9]{5,73})$/;

export function formatDeliveryCode(sequence: bigint): string {
  if (typeof sequence !== "bigint" || sequence <= 0n) {
    throw new RangeError("Số thứ tự mã đơn giao hàng phải là số nguyên dương.");
  }
  const digits = sequence.toString(10);
  if (digits.length > DELIVERY_CODE_MAX_DIGITS) {
    throw new RangeError(
      `Mã đơn giao hàng vượt quá giới hạn ${DELIVERY_CODE_MAX_LENGTH} ký tự.`,
    );
  }
  const padded = digits.padStart(DELIVERY_CODE_MIN_DIGITS, "0");
  return `${DELIVERY_CODE_PREFIX}${padded}`;
}

export function parseCanonicalDeliverySequence(code: string): bigint | null {
  if (
    code.length > DELIVERY_CODE_MAX_LENGTH ||
    !DELIVERY_CODE_PATTERN.test(code) ||
    code === `${DELIVERY_CODE_PREFIX}00000`
  ) {
    return null;
  }
  const numericPart = code.slice(DELIVERY_CODE_PREFIX.length);
  const parsed = BigInt(numericPart);
  return parsed > 0n ? parsed : null;
}
