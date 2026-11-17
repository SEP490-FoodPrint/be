import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { inspect } from "node:util";
import {
  COMPLAINT_CODE_MAX_LENGTH,
  COMPLAINT_CODE_MAX_SEQUENCE,
  COMPLAINT_CODE_MIN_DIGITS,
  COMPLAINT_CODE_PREFIX,
  formatComplaintCode,
  parseCanonicalComplaintCode,
} from "../src/utils/complaint-code";

void describe("complaint-code", () => {
  void it("formats positive BigInt sequences with minimum 5 digits, handles >99999 without truncation, and supports MAX_BIGINT without Number conversion", () => {
    assert.equal(COMPLAINT_CODE_PREFIX, "FP-CP-");
    assert.equal(COMPLAINT_CODE_MIN_DIGITS, 5);
    assert.equal(COMPLAINT_CODE_MAX_LENGTH, 25);
    assert.equal(COMPLAINT_CODE_MAX_SEQUENCE, 9_223_372_036_854_775_807n);

    assert.equal(formatComplaintCode(1n), "FP-CP-00001");
    assert.equal(formatComplaintCode(42n), "FP-CP-00042");
    assert.equal(formatComplaintCode(99999n), "FP-CP-99999");
    assert.equal(formatComplaintCode(100000n), "FP-CP-100000");
    assert.equal(formatComplaintCode(1234567n), "FP-CP-1234567");

    // Precision beyond Number.MAX_SAFE_INTEGER (9007199254740991) must stay exact.
    const beyondSafeInt = 9_007_199_254_740_993n;
    const beyondCode = formatComplaintCode(beyondSafeInt);
    assert.equal(beyondCode, "FP-CP-9007199254740993");
    assert.equal(parseCanonicalComplaintCode(beyondCode), beyondSafeInt);

    const maxCode = formatComplaintCode(COMPLAINT_CODE_MAX_SEQUENCE);
    assert.equal(maxCode, "FP-CP-9223372036854775807");
    assert.equal(maxCode.length, COMPLAINT_CODE_MAX_LENGTH);
    assert.equal(
      parseCanonicalComplaintCode(maxCode),
      COMPLAINT_CODE_MAX_SEQUENCE,
    );
  });

  void it("rejects zero, negative, out-of-range, and non-bigint inputs", () => {
    assert.throws(() => formatComplaintCode(0n), RangeError);
    assert.throws(() => formatComplaintCode(-1n), RangeError);
    assert.throws(
      () => formatComplaintCode(-9_223_372_036_854_775_807n),
      RangeError,
    );
    assert.throws(
      () => formatComplaintCode(COMPLAINT_CODE_MAX_SEQUENCE + 1n),
      RangeError,
    );
    assert.throws(
      () => formatComplaintCode(10_000_000_000_000_000_000n),
      RangeError,
    );

    for (const invalid of [
      1,
      0,
      1.5,
      Number.NaN,
      "1",
      "FP-CP-00001",
      null,
      undefined,
      {},
      [],
      true,
    ]) {
      assert.throws(
        () => Reflect.apply(formatComplaintCode, undefined, [invalid]),
        Error,
      );
    }
  });

  void it("parses canonical uppercase codes and rejects noncanonical, zero, out-of-range, and non-string values", () => {
    assert.equal(parseCanonicalComplaintCode("FP-CP-00001"), 1n);
    assert.equal(parseCanonicalComplaintCode("FP-CP-00099"), 99n);
    assert.equal(parseCanonicalComplaintCode("FP-CP-99999"), 99999n);
    assert.equal(parseCanonicalComplaintCode("FP-CP-100000"), 100000n);
    assert.equal(
      parseCanonicalComplaintCode("FP-CP-9223372036854775807"),
      9_223_372_036_854_775_807n,
    );

    for (const invalid of [
      "",
      "FP-CP-",
      "FP-CP-00000",
      "FP-CP-0000",
      "FP-CP-0001",
      "FP-CP-1",
      "FP-CP-000001",
      "FP-CP-010000",
      "FP-CP-0000099999",
      "fp-cp-00001",
      "FP-cp-00001",
      " FP-CP-00001",
      "FP-CP-00001 ",
      "FP-CP-00001\n",
      "FP-CP--0001",
      "FP-CP-+0001",
      "FP-CP-abcde",
      "FP-CP-9223372036854775808",
      "FP-CP-9999999999999999999",
      "FP-CP-10000000000000000000",
      "FP-DE-00001",
      "FP-REG-00001",
      "66666666-6666-4666-8666-666666666661",
      null,
      undefined,
      123,
      1n,
      {},
      ["FP-CP-00001"],
    ]) {
      assert.equal(
        parseCanonicalComplaintCode(invalid),
        null,
        `Expected rejection for ${inspect(invalid)}`,
      );
    }
  });

  void it("stays pure with no database, Redis, or UUID derivation side effects", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../src/utils/complaint-code.ts"),
      "utf8",
    );
    assert(!/\b(getPrisma|prisma|Pool|Client|redis|randomUUID)\b/.test(source));
    assert(!/\bNumber\(/.test(source));
  });
});
