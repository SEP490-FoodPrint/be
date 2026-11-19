import assert from "node:assert/strict";
import test from "node:test";
import {
  FEISTEL_DOMAIN,
  feistelDecrypt,
  feistelEncrypt,
} from "../src/utils/feistel";

const key = Buffer.from(
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
  "hex",
);
const otherKey = Buffer.from(
  "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100",
  "hex",
);

void test("feistelEncrypt là hoán vị trên toàn miền 0–99999 và giải ngược đúng", () => {
  assert.equal(FEISTEL_DOMAIN, 100_000);
  const seen = new Uint8Array(FEISTEL_DOMAIN);
  for (let value = 0; value < FEISTEL_DOMAIN; value += 1) {
    const encrypted = feistelEncrypt(value, key);
    assert(
      Number.isSafeInteger(encrypted) &&
        encrypted >= 0 &&
        encrypted < FEISTEL_DOMAIN,
      `kết quả ngoài miền: ${encrypted}`,
    );
    assert.equal(seen[encrypted], 0, `trùng kết quả ${encrypted}`);
    seen[encrypted] = 1;
    assert.equal(feistelDecrypt(encrypted, key), value);
  }
});

void test("feistelEncrypt cố định theo khóa và khác nhau giữa hai khóa", () => {
  const sample = [0, 1, 2, 3, 42, 99_999];
  for (const value of sample) {
    assert.equal(feistelEncrypt(value, key), feistelEncrypt(value, key));
  }
  let different = 0;
  for (let value = 0; value < 1_000; value += 1) {
    if (feistelEncrypt(value, key) !== feistelEncrypt(value, otherKey)) {
      different += 1;
    }
  }
  assert(different > 990, `chỉ ${different}/1000 giá trị khác nhau`);
});

void test("feistelEncrypt không giữ thứ tự của các giá trị liên tiếp", () => {
  let consecutive = 0;
  for (let value = 0; value < 1_000; value += 1) {
    if (
      Math.abs(feistelEncrypt(value + 1, key) - feistelEncrypt(value, key)) ===
      1
    ) {
      consecutive += 1;
    }
  }
  assert(consecutive < 5, `${consecutive} cặp liên tiếp`);
});

void test("feistel từ chối giá trị ngoài miền và khóa sai độ dài", () => {
  for (const invalid of [-1, FEISTEL_DOMAIN, 1.5, Number.NaN]) {
    assert.throws(() => feistelEncrypt(invalid, key), RangeError);
    assert.throws(() => feistelDecrypt(invalid, key), RangeError);
  }
  assert.throws(() => feistelEncrypt(1, Buffer.alloc(16)), RangeError);
  assert.throws(() => feistelDecrypt(1, Buffer.alloc(33)), RangeError);
});
