import assert from "node:assert/strict";
import test from "node:test";
import {
  validateUnitCreate,
  validateUnitQuery,
  validateUnitUpdate,
} from "../src/modules/measurement-unit/measurement-unit.validation";
import { createMeasurementUnitService } from "../src/modules/measurement-unit/measurement-unit.service";
import { testAdmin } from "./helpers/authorization";

void test("unit catalogue validates precision, normalization and immutable fields", () => {
  const input = {
    code: "KG",
    name: "Kilôgam",
    symbol: " kg ",
    group: "MASS",
    recommendedStep: "0.1",
    aliases: [" Kilogram "],
  };
  assert.deepEqual(validateUnitCreate(input), {
    ...input,
    code: "kg",
    symbol: "kg",
    aliases: ["kilogram"],
  });
  for (const step of ["0", "-1", "0.0001", "1e2", "100000000000"])
    assert.throws(
      () => validateUnitCreate({ ...input, recommendedStep: step }),
      { statusCode: 400 },
    );
  for (const field of ["code", "symbol", "group"])
    assert.throws(() => validateUnitUpdate({ [field]: "kg" }), {
      statusCode: 400,
    });
  assert.throws(() => validateUnitUpdate({}), { statusCode: 400 });
  assert.equal(validateUnitQuery({}).status, "ACTIVE");
  assert.throws(() => validateUnitQuery({ limit: 101 }), { statusCode: 400 });
});
void test("unit mutations reject non-system roles and missing permission before connecting", async () => {
  let connected = false;
  const service = createMeasurementUnitService(() => {
    connected = true;
    throw new Error("unexpected connect");
  });
  const input = validateUnitCreate({
    code: "box",
    name: "Hộp",
    symbol: "hộp",
    group: "COUNT",
    recommendedStep: "1",
  });
  await assert.rejects(
    service.create(input, {
      ...testAdmin,
      role: "INGREDIENT_SUPPLIER_ADMIN",
      orgType: "SUPPLIER",
      permissions: ["measurement_unit.manage"],
    }),
    { statusCode: 403 },
  );
  await assert.rejects(
    service.create(input, { ...testAdmin, permissions: [] }),
    { statusCode: 403 },
  );
  assert.equal(connected, false);
});
