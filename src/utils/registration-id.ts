/** Human-readable reference; UUIDs remain the authoritative resource identifiers. */
export function formatRegistrationID(number: bigint): string {
  if (number <= 0n) throw new RangeError("Số hồ sơ phải là số nguyên dương");
  return `FP-REG-${number.toString().padStart(5, "0")}`;
}

/** Recognize a complete code; other search text must remain a name query. */
export function parseRegistrationID(value: string): bigint | undefined {
  if (!/^FP-REG-(?:[0-9]{5}|[1-9][0-9]{5,18})$/i.test(value)) return undefined;
  const number = BigInt(value.slice(7));
  return number > 0n && number <= 9_223_372_036_854_775_807n
    ? number
    : undefined;
}
