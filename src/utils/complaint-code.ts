export const COMPLAINT_CODE_PREFIX = "FP-CP-";
export const COMPLAINT_CODE_MIN_DIGITS = 5;
export const COMPLAINT_CODE_MAX_LENGTH = 25;
export const COMPLAINT_CODE_MAX_SEQUENCE = 9_223_372_036_854_775_807n;
export const COMPLAINT_CODE_MAX_DIGITS =
  COMPLAINT_CODE_MAX_LENGTH - COMPLAINT_CODE_PREFIX.length;

// Matches 5 digits (00001..99999) or 6..19 digits without leading zero up to BIGINT max.
export const COMPLAINT_CODE_PATTERN = /^FP-CP-(?:[0-9]{5}|[1-9][0-9]{5,18})$/;

export function formatComplaintCode(sequence: bigint): string {
  if (
    typeof sequence !== "bigint" ||
    sequence <= 0n ||
    sequence > COMPLAINT_CODE_MAX_SEQUENCE
  ) {
    throw new RangeError(
      "Số thứ tự mã khiếu nại phải là số nguyên dương trong phạm vi BIGINT.",
    );
  }
  const digits = sequence.toString(10);
  if (digits.length > COMPLAINT_CODE_MAX_DIGITS) {
    throw new RangeError(
      `Mã khiếu nại vượt quá giới hạn ${COMPLAINT_CODE_MAX_LENGTH} ký tự.`,
    );
  }
  return `${COMPLAINT_CODE_PREFIX}${digits.padStart(COMPLAINT_CODE_MIN_DIGITS, "0")}`;
}

export function parseCanonicalComplaintCode(code: unknown): bigint | null {
  if (
    typeof code !== "string" ||
    code.length > COMPLAINT_CODE_MAX_LENGTH ||
    !COMPLAINT_CODE_PATTERN.test(code)
  ) {
    return null;
  }
  const numericPart = code.slice(COMPLAINT_CODE_PREFIX.length);
  const parsed = BigInt(numericPart);
  return parsed >= 1n && parsed <= COMPLAINT_CODE_MAX_SEQUENCE ? parsed : null;
}
