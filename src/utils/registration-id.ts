/** Human-readable reference; UUIDs remain the authoritative resource identifiers. */
export function formatRegistrationID(number: bigint): string {
  if (number <= 0n) throw new RangeError("Số hồ sơ phải là số nguyên dương");
  return `FP-REG-${number.toString().padStart(5, "0")}`;
}
