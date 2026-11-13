import assert from "node:assert/strict";
import { test } from "node:test";
import { createAllergyCatalogService } from "../src/modules/allergy/allergy.service";
import type { readAllergyCatalog } from "../src/modules/allergy/allergy.repository";
import { testStaff } from "./helpers/authorization";

const principal = { ...testStaff, permissions: ["class_allergy.view"] };
const row = {
  classId: "class-a",
  ingredientEntryId: "entry-a",
  affectedCount: 2,
  updatedAt: new Date("2026-11-13T00:00:00Z"),
  Class: { name: "Class A", academicYear: "2026-2027" },
  IngredientEntry: {
    ingredientId: "ingredient-a",
    Ingredient: {
      name: "Peanut",
      ingredientCategory: { categoryName: "Nuts" },
    },
  },
};

void test("allergy catalogue sends trusted school scope and bounded pagination and exposes real names", async () => {
  const service = createAllergyCatalogService((schoolId, window) => {
    assert.equal(schoolId, principal.schoolId);
    assert.deepEqual(window, { skip: 0, take: 2 });
    return Promise.resolve([row, { ...row, classId: "class-b" }]);
  });
  const result = await service.getAll({ page: 1, limit: 1 }, principal);
  assert.equal(result.pagination.hasNext, true);
  assert.deepEqual(result.items[0], {
    classId: "class-a",
    className: "Class A",
    academicYear: "2026-2027",
    ingredientEntryId: "entry-a",
    ingredientId: "ingredient-a",
    ingredientName: "Peanut",
    category: "Nuts",
    affectedCount: 2,
    updatedAt: "2026-11-13T00:00:00.000Z",
  });
  assert.equal("updatedByUserId" in result.items[0], false);
});

void test("allergy catalogue denies absent permission, unscoped and non-school callers before querying", async () => {
  let reads = 0;
  const read: typeof readAllergyCatalog = () => {
    reads++;
    return Promise.resolve([]);
  };
  const service = createAllergyCatalogService(read);
  await assert.rejects(
    () =>
      service.getAll({ page: 1, limit: 10 }, { ...principal, permissions: [] }),
    { statusCode: 403 },
  );
  await assert.rejects(
    () =>
      service.getAll({ page: 1, limit: 10 }, { ...principal, schoolId: null }),
    { statusCode: 403 },
  );
  await assert.rejects(
    () =>
      service.getAll(
        { page: 1, limit: 10 },
        { ...principal, orgType: "SYSTEM" },
      ),
    { statusCode: 403 },
  );
  assert.equal(reads, 0);
});

void test("allergy catalogue sanitizes query failures instead of reporting no allergies", async () => {
  const service = createAllergyCatalogService(() =>
    Promise.reject(new Error("database secret must not escape")),
  );
  await assert.rejects(
    () => service.getAll({ page: 1, limit: 10 }, principal),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal("statusCode" in error && error.statusCode, 503);
      assert.doesNotMatch(error.message, /secret/);
      return true;
    },
  );
});
