import { createHmac } from "node:crypto";

/**
 * Hoán vị Feistel có khóa trên miền 0–99999, dùng chung cho hậu tố mã nghiệp vụ FP-XX-NNNNN.
 *
 * Feistel nhị phân cân bằng 18 bit (2 nửa × 9 bit, miền 262.144), 8 vòng; hàm vòng là 9 bit thấp của
 * HMAC-SHA256(key, [vòng, nửa phải]). Kết quả ≥ 100.000 được mã hóa tiếp (cycle-walking) cho tới khi
 * rơi vào miền, nên hàm vẫn là song ánh trên 0–99999 và giải ngược được khi có khóa.
 */
export const FEISTEL_DOMAIN = 100_000;

const KEY_BYTES = 32;
const HALF_BITS = 9;
const HALF_SIZE = 1 << HALF_BITS;
const HALF_MASK = HALF_SIZE - 1;
const ROUNDS = 8;

type RoundTable = Uint16Array;

// Bảng hàm vòng tính sẵn theo khóa: 8 × 512 giá trị, tránh gọi HMAC cho mỗi lần mã hóa.
const roundTables = new Map<string, RoundTable>();

function assertKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new RangeError(`Khóa Feistel phải dài đúng ${KEY_BYTES} byte.`);
  }
}

function assertValue(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value >= FEISTEL_DOMAIN) {
    throw new RangeError(
      `Giá trị Feistel phải là số nguyên trong khoảng 0–${FEISTEL_DOMAIN - 1}.`,
    );
  }
}

function roundTable(key: Buffer): RoundTable {
  const cacheKey = key.toString("hex");
  const cached = roundTables.get(cacheKey);
  if (cached) return cached;
  const table = new Uint16Array(ROUNDS * HALF_SIZE);
  for (let round = 0; round < ROUNDS; round += 1) {
    for (let half = 0; half < HALF_SIZE; half += 1) {
      const digest = createHmac("sha256", key)
        .update(Buffer.from([round, half >> 8, half & 0xff]))
        .digest();
      table[round * HALF_SIZE + half] =
        ((digest[0] << 8) | digest[1]) & HALF_MASK;
    }
  }
  roundTables.set(cacheKey, table);
  return table;
}

function encryptBlock(block: number, table: RoundTable): number {
  let left = block >> HALF_BITS;
  let right = block & HALF_MASK;
  for (let round = 0; round < ROUNDS; round += 1) {
    const next = left ^ table[round * HALF_SIZE + right];
    left = right;
    right = next;
  }
  return (left << HALF_BITS) | right;
}

function decryptBlock(block: number, table: RoundTable): number {
  let left = block >> HALF_BITS;
  let right = block & HALF_MASK;
  for (let round = ROUNDS - 1; round >= 0; round -= 1) {
    const previous = right ^ table[round * HALF_SIZE + left];
    right = left;
    left = previous;
  }
  return (left << HALF_BITS) | right;
}

export function feistelEncrypt(value: number, key: Buffer): number {
  assertValue(value);
  assertKey(key);
  const table = roundTable(key);
  let result = encryptBlock(value, table);
  while (result >= FEISTEL_DOMAIN) result = encryptBlock(result, table);
  return result;
}

export function feistelDecrypt(value: number, key: Buffer): number {
  assertValue(value);
  assertKey(key);
  const table = roundTable(key);
  let result = decryptBlock(value, table);
  while (result >= FEISTEL_DOMAIN) result = decryptBlock(result, table);
  return result;
}
