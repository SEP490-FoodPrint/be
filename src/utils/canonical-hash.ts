import { keccak256, toUtf8Bytes } from "ethers";

/**
 * Recursively sort object keys alphabetically and serialize to deterministic JSON string.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([_, v]) => v !== undefined)
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB));

  const serializedProps = entries.map(
    ([k, v]) => `${JSON.stringify(k)}:${canonicalizeJson(v)}`,
  );

  return `{${serializedProps.join(",")}}`;
}

/**
 * Computes Keccak-256 hash of canonicalized JSON representation.
 */
export function computeCanonicalHash(payload: unknown): string {
  const canonicalString = canonicalizeJson(payload);
  const bytes = toUtf8Bytes(canonicalString);
  return keccak256(bytes);
}
