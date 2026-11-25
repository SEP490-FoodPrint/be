import assert from "node:assert/strict";
import test from "node:test";
import {
  BUSINESS_CODE_MAX_SEQUENCE,
  BUSINESS_CODE_TYPES,
  allocateBusinessCode,
  allocateBusinessCodes,
  businessCodeSuffix,
  formatBusinessCode,
  isStoredBusinessCode,
  normalizeSearchCode,
  parseBusinessCode,
  parseLegacyCode,
  type BusinessCodeDeps,
  type BusinessCodeType,
} from "../src/utils/business-code";
import { feistelDecrypt, feistelEncrypt } from "../src/utils/feistel";
import { HttpError } from "../src/utils/http-error";

const key = Buffer.from(
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
  "hex",
);
const tx = {} as never;

function counterDeps(start = 0): BusinessCodeDeps & { last: () => number } {
  let current = start;
  return {
    readKey: () => key,
    nextSequence: () => {
      current += 1;
      return Promise.resolve(current);
    },
    last: () => current,
  };
}

const none = () => Promise.resolve(new Set<string>());
const suffixOf = (code: string) => Number(code.slice(-5));

void test("danh mục chỉ gồm chữ viết tắt 2 chữ in hoa, không trùng mã cũ", () => {
  assert.deepEqual(Object.keys(BUSINESS_CODE_TYPES).sort(), [
    "AC",
    "CP",
    "DE",
    "IC",
    "MC",
    "RG",
  ]);
  for (const type of Object.keys(BUSINESS_CODE_TYPES)) {
    assert.match(type, /^[A-Z]{2}$/);
    assert(!["LO", "CB", "BG", "SU", "SF", "SC"].includes(type));
  }
  assert.equal(BUSINESS_CODE_MAX_SEQUENCE, 100_000);
});

void test("formatBusinessCode và parseBusinessCode theo cú pháp FP-XX-NNNNN", () => {
  assert.equal(formatBusinessCode("DE", 42), "FP-DE-00042");
  assert.equal(formatBusinessCode("RG", 99_999), "FP-RG-99999");
  for (const invalid of [0, -1, 100_000, 1.5]) {
    assert.throws(() => formatBusinessCode("DE", invalid), RangeError);
  }
  assert.throws(
    () => formatBusinessCode("XX" as BusinessCodeType, 1),
    RangeError,
  );
  assert.equal(parseBusinessCode("DE", "FP-DE-00042"), 42);
  assert.equal(parseBusinessCode("DE", "fp-de-00042"), 42);
  for (const invalid of [
    "FP-DE-00000",
    "FP-DE-0042",
    "FP-DE-000042",
    "FP-CP-00042",
    "FP-DE-1234a",
    "",
    null,
    42,
  ]) {
    assert.equal(parseBusinessCode("DE", invalid), null, String(invalid));
  }
});

void test("hậu tố của số thứ tự s đúng bằng Feistel(s − 1) và giải ngược về s", async () => {
  for (const sequence of [1, 2, 3, 99, 100_000]) {
    const suffix = businessCodeSuffix(sequence, key);
    assert.equal(suffix, feistelEncrypt(sequence - 1, key));
    assert.equal(feistelDecrypt(suffix, key) + 1, sequence);
  }
  const deps = counterDeps();
  const codes = await allocateBusinessCodes(tx, "DE", 3, none, deps);
  const decoded = codes.map((code) => feistelDecrypt(suffixOf(code), key) + 1);
  // Bỏ qua hậu tố 00000 có thể làm nhảy số thứ tự; còn lại phải tăng dần.
  for (let index = 1; index < decoded.length; index += 1) {
    assert(decoded[index] > decoded[index - 1]);
  }
  for (const code of codes) assert.match(code, /^FP-DE-[0-9]{5}$/);
});

void test("1.000 mã liên tiếp không trùng và không có cặp kế tiếp liên tiếp nhau", async () => {
  const codes = await allocateBusinessCodes(
    tx,
    "MC",
    1_000,
    none,
    counterDeps(),
  );
  assert.equal(new Set(codes).size, 1_000);
  for (let index = 1; index < codes.length; index += 1) {
    assert.notEqual(
      Math.abs(suffixOf(codes[index]) - suffixOf(codes[index - 1])),
      1,
      `${codes[index - 1]} → ${codes[index]}`,
    );
  }
});

void test("allocator bỏ qua hậu tố 00000 và mã đã tồn tại", async () => {
  // Tìm số thứ tự cho ra hậu tố 0 với khóa test.
  const zeroSequence = feistelDecrypt(0, key) + 1;
  const deps = counterDeps(zeroSequence - 1);
  const [code] = await allocateBusinessCodes(tx, "IC", 1, none, deps);
  assert.notEqual(code, "FP-IC-00000");
  assert.equal(deps.last(), zeroSequence + 1);

  const taken = formatBusinessCode("CP", businessCodeSuffix(1, key));
  const existsCalls: string[][] = [];
  const exists = (codes: readonly string[]) => {
    existsCalls.push([...codes]);
    return Promise.resolve(new Set(codes.filter((c) => c === taken)));
  };
  const result = await allocateBusinessCode(tx, "CP", exists, counterDeps());
  assert.notEqual(result, taken);
  assert.equal(result, formatBusinessCode("CP", businessCodeSuffix(2, key)));
  assert(existsCalls.length >= 2);
});

void test("allocator báo lỗi 503 khi hết dải hoặc thiếu khóa", async () => {
  await assert.rejects(
    allocateBusinessCodes(
      tx,
      "RG",
      1,
      none,
      counterDeps(BUSINESS_CODE_MAX_SEQUENCE),
    ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 503 &&
      error.message.includes("hồ sơ đăng ký"),
  );
  const missingKey: BusinessCodeDeps = {
    readKey: () => {
      throw new HttpError(503, "Không thể cấp mã nghiệp vụ.");
    },
    nextSequence: () => Promise.resolve(1),
  };
  await assert.rejects(
    allocateBusinessCodes(tx, "RG", 1, none, missingKey),
    (error: unknown) => error instanceof HttpError && error.statusCode === 503,
  );
  await assert.rejects(
    allocateBusinessCodes(tx, "ZZ" as BusinessCodeType, 1, none, counterDeps()),
    RangeError,
  );
  assert.deepEqual(
    await allocateBusinessCodes(tx, "RG", 0, none, counterDeps()),
    [],
  );
});

void test("parseLegacyCode, normalizeSearchCode và isStoredBusinessCode nhận mã cũ và mã mới", () => {
  assert.deepEqual(parseLegacyCode("FP-REG-00001"), {
    prefix: "REG",
    sequence: 1n,
  });
  assert.deepEqual(parseLegacyCode("fp-reg-123456"), {
    prefix: "REG",
    sequence: 123_456n,
  });
  assert.deepEqual(parseLegacyCode("FP-DE-100000"), {
    prefix: "DE",
    sequence: 100_000n,
  });
  assert.deepEqual(parseLegacyCode("FP-CP-00042"), {
    prefix: "CP",
    sequence: 42n,
  });
  for (const invalid of [
    "FP-REG-00000",
    "FP-REG-0001",
    "FP-DE-0123456",
    "FP-CP-9223372036854775808",
    "FP-RG-00001",
    "Nguyen Van A",
  ]) {
    assert.equal(parseLegacyCode(invalid), null, invalid);
  }

  assert.equal(normalizeSearchCode(" fp-rg-04213 "), "FP-RG-04213");
  assert.equal(normalizeSearchCode("fp-reg-00001"), "FP-REG-00001");
  assert.equal(normalizeSearchCode("FP-RG-00000"), null);
  assert.equal(normalizeSearchCode("Trường A"), null);

  assert(isStoredBusinessCode("CP", "FP-CP-00001"));
  assert(isStoredBusinessCode("CP", "FP-CP-1234567"));
  assert(isStoredBusinessCode("CP", "FP-CP-58213"));
  assert(!isStoredBusinessCode("CP", "FP-DE-58213"));
  assert(!isStoredBusinessCode("CP", "fp-cp-58213"));
  assert(isStoredBusinessCode("RG", "FP-REG-00007"));
  assert(isStoredBusinessCode("RG", "FP-RG-00007"));
  assert(!isStoredBusinessCode("MC", "FP-MC-00000"));
});
