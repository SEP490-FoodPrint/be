import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DELIVERY_CODE_MAX_DIGITS,
  DELIVERY_CODE_MAX_LENGTH,
  formatDeliveryCode,
  parseCanonicalDeliverySequence,
} from "../src/utils/delivery-code";

void describe("delivery-code", () => {
  void it("formats positive sequences with minimum 5 digits and handles 99999 -> 100000", () => {
    assert.equal(formatDeliveryCode(1n), "FP-DE-00001");
    assert.equal(formatDeliveryCode(42n), "FP-DE-00042");
    assert.equal(formatDeliveryCode(99999n), "FP-DE-99999");
    assert.equal(formatDeliveryCode(100000n), "FP-DE-100000");

    const maxValid = BigInt("9".repeat(DELIVERY_CODE_MAX_DIGITS));
    const maxCode = formatDeliveryCode(maxValid);
    assert.equal(maxCode.length, DELIVERY_CODE_MAX_LENGTH);
    assert.equal(parseCanonicalDeliverySequence(maxCode), maxValid);
  });

  void it("rejects zero, negative values, and values exceeding varchar(80)", () => {
    assert.throws(() => formatDeliveryCode(0n), RangeError);
    assert.throws(() => formatDeliveryCode(-1n), RangeError);
    assert.throws(
      () =>
        formatDeliveryCode(BigInt(`1${"0".repeat(DELIVERY_CODE_MAX_DIGITS)}`)),
      RangeError,
    );
  });

  void it("parses only canonical positive FP-DE codes and rejects zero, bad padding, and legacy codes", () => {
    assert.equal(parseCanonicalDeliverySequence("FP-DE-00001"), 1n);
    assert.equal(parseCanonicalDeliverySequence("FP-DE-99999"), 99999n);
    assert.equal(parseCanonicalDeliverySequence("FP-DE-100000"), 100000n);

    for (const invalid of [
      "FP-DE-00000",
      "FP-DE-0001",
      "FP-DE-000001",
      "FP-DE-010000",
      "FP-DE-1",
      "fp-de-00001",
      " FP-DE-00001",
      "FP-DE-00001 ",
      "FP-DE-00001\n",
      "DG-20261115-001",
      "DG-00001",
      "FP-DE-",
      `FP-DE-1${"0".repeat(DELIVERY_CODE_MAX_DIGITS)}`,
    ]) {
      assert.equal(parseCanonicalDeliverySequence(invalid), null, invalid);
    }
  });
});
