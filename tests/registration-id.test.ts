import assert from "node:assert/strict";
import { test } from "node:test";
import { formatRegistrationID } from "../src/utils/registration-id";

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
