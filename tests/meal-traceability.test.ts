import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getGradeMealTraceabilitySchema } from "../src/modules/meal-traceability/meal-traceability.validation";

void describe("getGradeMealTraceabilitySchema validation", () => {
  const base = {
    gradeId: "123e4567-e89b-12d3-a456-426614174000",
    date: "2026-11-16",
    mealType: "LUNCH",
  };

  void it("accepts a full grade/date/meal key with schoolCode and verify", () => {
    const result = getGradeMealTraceabilitySchema.safeParse({
      ...base,
      schoolCode: "TH-001",
      verify: "true",
    });
    assert.equal(result.success, true);
    assert.equal(result.success && result.data.verify, true);
  });

  void it("rejects a missing or invalid key part", () => {
    for (const invalid of [
      { date: base.date, mealType: base.mealType },
      { ...base, gradeId: "grade-1" },
      { ...base, date: "16/11/2026" },
      { ...base, date: "2026-02-30" },
      { ...base, mealType: "BREAKFAST" },
      { ...base, verify: "yes" },
      { ...base, classId: base.gradeId },
    ]) {
      assert.equal(
        getGradeMealTraceabilitySchema.safeParse(invalid).success,
        false,
      );
    }
  });
});
