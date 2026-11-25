import { readBusinessCodeKey } from "../config/env";
import {
  nextBusinessCodeSequence,
  type BusinessCodeCounterClient,
} from "./business-code.repository";
import { FEISTEL_DOMAIN, feistelEncrypt } from "./feistel";
import { HttpError } from "./http-error";

/**
 * Mã nghiệp vụ dùng chung cho các danh sách nghiệp vụ (hiến chương, nguyên tắc VII):
 * `FP-<XX>-<NNNNN>`, trong đó với số thứ tự thứ `s` của loại `XX`,
 * hậu tố `NNNNN = pad5(feistelEncrypt(s − 1, BUSINESS_CODE_KEY))` — không bao giờ là `s` thô.
 *
 * Mỗi chữ viết tắt chỉ đăng ký một lần ở đây và trong spec của tính năng.
 * Mã lô tuần tự (LO/CB/BG/SU) vẫn dùng `fp-code.ts`; cơ sở nguồn cung (SF) dùng `source-facility-code.ts`.
 */
export const BUSINESS_CODE_TYPES = {
  RG: "hồ sơ đăng ký",
  DE: "chuyến giao hàng",
  CP: "khiếu nại nguyên liệu",
  MC: "khiếu nại bữa ăn",
  AC: "khiếu nại leo thang lên ATTP",
  IC: "sự cố an toàn thực phẩm",
} as const;
export type BusinessCodeType = keyof typeof BUSINESS_CODE_TYPES;

/**
 * Chữ viết tắt đã dùng bởi cơ chế khác hoặc mã cũ; không được đăng ký lại.
 * `SC` từng cấp cho khiếu nại gửi hệ thống, đã gỡ (specs/remove-system-complaints).
 */
const RESERVED_ABBREVIATIONS = [
  "LO",
  "CB",
  "BG",
  "SU",
  "SF",
  "REG",
  "SC",
] as const;

for (const type of Object.keys(BUSINESS_CODE_TYPES)) {
  if (
    !/^[A-Z]{2}$/.test(type) ||
    (RESERVED_ABBREVIATIONS as readonly string[]).includes(type)
  ) {
    throw new Error(`Chữ viết tắt mã nghiệp vụ không hợp lệ: ${type}`);
  }
}

export const BUSINESS_CODE_SUFFIX_DIGITS = 5;
/** Số thứ tự tối đa của mỗi loại (miền Feistel 0–99999 ↔ s = 1…100000). */
export const BUSINESS_CODE_MAX_SEQUENCE = FEISTEL_DOMAIN;

const NEW_CODE_PATTERN = /^FP-([A-Z]{2})-([0-9]{5})$/;

/** Định dạng mã tuần tự cũ đã phát hành trước Feistel; chỉ dùng để đọc/tra cứu, không cấp mới. */
const LEGACY_PATTERNS = {
  REG: { pattern: /^FP-REG-([0-9]{5}|[1-9][0-9]{5,18})$/, type: "RG" },
  DE: { pattern: /^FP-DE-([0-9]{5}|[1-9][0-9]{5,73})$/, type: "DE" },
  CP: { pattern: /^FP-CP-([0-9]{5}|[1-9][0-9]{5,18})$/, type: "CP" },
} as const satisfies Record<
  string,
  { pattern: RegExp; type: BusinessCodeType }
>;
type LegacyPrefix = keyof typeof LEGACY_PATTERNS;
const BIGINT_MAX = 9_223_372_036_854_775_807n;

function isBusinessCodeType(value: string): value is BusinessCodeType {
  return Object.hasOwn(BUSINESS_CODE_TYPES, value);
}

function assertType(type: string): asserts type is BusinessCodeType {
  if (!isBusinessCodeType(type)) {
    throw new RangeError(`Loại mã nghiệp vụ không được đăng ký: ${type}`);
  }
}

export function formatBusinessCode(
  type: BusinessCodeType,
  suffix: number,
): string {
  assertType(type);
  if (!Number.isSafeInteger(suffix) || suffix < 1 || suffix >= FEISTEL_DOMAIN) {
    throw new RangeError("Hậu tố mã nghiệp vụ phải trong khoảng 00001–99999.");
  }
  return `FP-${type}-${String(suffix).padStart(BUSINESS_CODE_SUFFIX_DIGITS, "0")}`;
}

/** Hậu tố của số thứ tự `sequence` (1…100000) = Feistel(sequence − 1). */
export function businessCodeSuffix(sequence: number, key: Buffer): number {
  if (
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    sequence > BUSINESS_CODE_MAX_SEQUENCE
  ) {
    throw new RangeError("Số thứ tự mã nghiệp vụ nằm ngoài dải.");
  }
  return feistelEncrypt(sequence - 1, key);
}

/** Đọc mã mới `FP-XX-NNNNN` của đúng loại; trả hậu tố hoặc `null`. Không phân biệt hoa thường. */
export function parseBusinessCode(
  type: BusinessCodeType,
  text: unknown,
): number | null {
  if (typeof text !== "string") return null;
  const match = NEW_CODE_PATTERN.exec(text.trim().toUpperCase());
  if (!match || match[1] !== type) return null;
  const suffix = Number(match[2]);
  return suffix >= 1 ? suffix : null;
}

/** Đọc mã tuần tự cũ (`FP-REG-`, `FP-DE-`, `FP-CP-`); trả tiền tố và số thứ tự hoặc `null`. */
export function parseLegacyCode(
  text: unknown,
): { prefix: LegacyPrefix; sequence: bigint } | null {
  if (typeof text !== "string") return null;
  const normalized = text.trim().toUpperCase();
  for (const [prefix, { pattern }] of Object.entries(LEGACY_PATTERNS)) {
    const match = pattern.exec(normalized);
    if (!match) continue;
    const sequence = BigInt(match[1]);
    if (sequence < 1n || sequence > BIGINT_MAX) return null;
    return { prefix: prefix as LegacyPrefix, sequence };
  }
  return null;
}

/**
 * Chuẩn hóa chuỗi tìm kiếm thành mã in hoa nếu là mã mới của loại đã đăng ký hoặc mã cũ hợp lệ;
 * chuỗi khác trả `null` để giữ tìm kiếm theo tên.
 */
export function normalizeSearchCode(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const normalized = text.trim().toUpperCase();
  const match = NEW_CODE_PATTERN.exec(normalized);
  if (match && isBusinessCodeType(match[1]) && Number(match[2]) >= 1) {
    return normalized;
  }
  return parseLegacyCode(normalized) ? normalized : null;
}

/** Kiểm tra mã đã lưu (chữ in hoa) thuộc loại `type`: mã mới hoặc mã cũ tương ứng của loại đó. */
export function isStoredBusinessCode(
  type: BusinessCodeType,
  text: unknown,
): boolean {
  if (typeof text !== "string") return false;
  const match = NEW_CODE_PATTERN.exec(text);
  if (match) return match[1] === type && Number(match[2]) >= 1;
  for (const [prefix, legacy] of Object.entries(LEGACY_PATTERNS)) {
    if (legacy.type !== type || !legacy.pattern.test(text)) continue;
    return parseLegacyCode(text)?.prefix === prefix;
  }
  return false;
}

/** Trả về tập mã trong `codes` đã tồn tại; phải truy vấn bằng cùng transaction client. */
export type ExistingBusinessCodes = (
  codes: readonly string[],
) => Promise<ReadonlySet<string>>;

export interface BusinessCodeDeps {
  readKey: () => Buffer;
  nextSequence: (
    db: BusinessCodeCounterClient,
    type: BusinessCodeType,
  ) => Promise<number | null>;
}

const defaultDeps: BusinessCodeDeps = {
  readKey: () => readBusinessCodeKey(),
  nextSequence: (db, type) =>
    nextBusinessCodeSequence(db, type, BUSINESS_CODE_MAX_SEQUENCE),
};

function exhausted(type: BusinessCodeType): HttpError {
  return new HttpError(
    503,
    `Đã hết mã ${BUSINESS_CODE_TYPES[type]}. Liên hệ quản trị.`,
  );
}

/**
 * Cấp `count` mã mới cho một loại trong transaction tạo bản ghi. Với mỗi số thứ tự `s` lấy từ bộ đếm,
 * hậu tố = Feistel(s − 1); bỏ qua hậu tố `00000` và mã đã tồn tại (kể cả mã tuần tự cũ trùng hậu tố),
 * hết dải thì ném HttpError 503. Không bao giờ quay vòng hay nới định dạng.
 */
export async function allocateBusinessCodes(
  db: BusinessCodeCounterClient,
  type: BusinessCodeType,
  count: number,
  exists: ExistingBusinessCodes,
  deps: BusinessCodeDeps = defaultDeps,
): Promise<string[]> {
  assertType(type);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError("Số lượng mã cần cấp phải là số nguyên không âm.");
  }
  if (count === 0) return [];
  const key = deps.readKey();
  const allocated: string[] = [];
  while (allocated.length < count) {
    const candidates: string[] = [];
    while (candidates.length < count - allocated.length) {
      const sequence = await deps.nextSequence(db, type);
      if (sequence === null || sequence > BUSINESS_CODE_MAX_SEQUENCE) {
        throw exhausted(type);
      }
      const suffix = businessCodeSuffix(sequence, key);
      if (suffix === 0) continue;
      candidates.push(formatBusinessCode(type, suffix));
    }
    const taken = await exists(candidates);
    for (const code of candidates) {
      if (!taken.has(code)) allocated.push(code);
    }
  }
  return allocated;
}

export async function allocateBusinessCode(
  db: BusinessCodeCounterClient,
  type: BusinessCodeType,
  exists: ExistingBusinessCodes,
  deps: BusinessCodeDeps = defaultDeps,
): Promise<string> {
  const [code] = await allocateBusinessCodes(db, type, 1, exists, deps);
  return code;
}
