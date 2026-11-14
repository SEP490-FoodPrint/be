import { HttpError } from "./http-error";

const prefix = "FP-SF-";
const maximumCodeLength = 80;
const canonicalCode = /^FP-SF-(?:[0-9]{5}|[1-9][0-9]{5,73})$/;

export function formatSourceFacilityCode(number: bigint): string {
  const code = prefix + number.toString().padStart(5, "0");
  if (number <= 0n || code.length > maximumCodeLength) {
    throw new HttpError(
      503,
      "Không thể cấp mã cơ sở cung cấp. Vui lòng thử lại sau.",
    );
  }
  return code;
}

export function parseCanonicalSourceFacilityCode(
  value: string | null,
): bigint | undefined {
  if (value === null || canonicalCode.exec(value)?.[0] !== value)
    return undefined;
  const number = BigInt(value.slice(prefix.length));
  return number > 0n ? number : undefined;
}
