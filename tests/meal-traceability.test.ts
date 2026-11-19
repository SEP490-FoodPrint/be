import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getMealTraceabilitySchema } from "../src/modules/meal-traceability/meal-traceability.validation";

void describe("getMealTraceabilitySchema validation", () => {
  void it("accepts valid query with classId, date, and mealType", () => {
    const valid = {
      classId: "123e4567-e89b-12d3-a456-426614174000",
      date: "2026-11-16",
      mealType: "LUNCH",
    };
    const result = getMealTraceabilitySchema.safeParse(valid);
    assert.equal(result.success, true);
  });

  void it("accepts valid query with mealAllocationId", () => {
    const valid = {
      mealAllocationId: "123e4567-e89b-12d3-a456-426614174000",
    };
    const result = getMealTraceabilitySchema.safeParse(valid);
    assert.equal(result.success, true);
  });

  void it("rejects invalid date format", () => {
    const invalid = {
      date: "16-11-2026",
    };
    const result = getMealTraceabilitySchema.safeParse(invalid);
    assert.equal(result.success, false);
  });

  void it("rejects invalid mealType", () => {
    const invalid = {
      mealType: "BREAKFAST",
    };
    const result = getMealTraceabilitySchema.safeParse(invalid);
    assert.equal(result.success, false);
  });

  void it("rejects non-uuid classId", () => {
    const invalid = {
      classId: "cls-001",
    };
    const result = getMealTraceabilitySchema.safeParse(invalid);
    assert.equal(result.success, false);
  });

  void it("rejects extra unknown query parameters", () => {
    const invalid = {
      date: "2026-11-16",
      extraField: "attack",
    };
    const result = getMealTraceabilitySchema.safeParse(invalid);
    assert.equal(result.success, false);
  });
  void it("rejects a query without a full class/date/meal key", () => {
    for (const partial of [
      {},
      { classId: "123e4567-e89b-12d3-a456-426614174000" },
      { classId: "123e4567-e89b-12d3-a456-426614174000", date: "2026-11-16" },
    ]) {
      const result = getMealTraceabilitySchema.safeParse(partial);
      assert.equal(result.success, false);
    }
  });

  void it("accepts an optional schoolCode and verify flag", () => {
    const result = getMealTraceabilitySchema.safeParse({
      classId: "123e4567-e89b-12d3-a456-426614174000",
      date: "2026-11-16",
      mealType: "AFTERNOON",
      schoolCode: "TH-001",
      verify: "true",
    });
    assert.equal(result.success, true);
    assert.equal(result.success && result.data.verify, true);
  });
});
