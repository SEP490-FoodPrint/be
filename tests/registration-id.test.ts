import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatRegistrationID,
  parseRegistrationID,
} from "../src/utils/registration-id";

void test("registration codes pad to five digits without truncating or losing bigint precision", () => {
  for (const [number, expected] of [
    [1n, "FP-REG-00001"],
    [9n, "FP-REG-00009"],
    [10n, "FP-REG-00010"],
    [99999n, "FP-REG-99999"],
    [100000n, "FP-REG-100000"],
    [9007199254740993n, "FP-REG-9007199254740993"],
    [9223372036854775807n, "FP-REG-9223372036854775807"],
  ] as const) {
    assert.equal(formatRegistrationID(number), expected);
    if (number <= 99999n) assert.equal(expected.length, 12);
  }
});
void test("registration codes reject nonpositive numbers", () => {
  assert.throws(() => formatRegistrationID(0n), RangeError);
  assert.throws(() => formatRegistrationID(-1n), RangeError);
});

void test("registration search recognizes complete codes case-insensitively with exact bigint precision", () => {
  for (const number of [
    1n,
    99999n,
    100000n,
    9007199254740993n,
    9223372036854775807n,
  ]) {
    const code = formatRegistrationID(number);
    assert.equal(parseRegistrationID(code), number);
    assert.equal(parseRegistrationID(code.toLowerCase()), number);
  }
});

void test("registration search leaves names, incomplete codes and out-of-range values as text", () => {
  for (const value of [
    "Nguyễn Văn An",
    "",
    "00000000-0000-4000-8000-000000000001",
    "FP-REG-1",
    "FP-REG-00000",
    "FP-REG-000001",
    "FP-REG-0100000",
    "FP-REG--00001",
    "FP-REG-+00001",
    "FP-REG-00001.0",
    "FP-REG-1e5",
    "FP-REG-9223372036854775808",
    "FP-REG-" + "9".repeat(1000),
  ]) {
    assert.equal(parseRegistrationID(value), undefined);
  }
});
