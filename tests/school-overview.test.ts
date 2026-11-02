import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuthPrincipal } from "../src/types/auth";
import { getSchoolOverview } from "../src/modules/school-overview/school-overview.service";
import type { getPrisma } from "../src/utils/database";

const principal: AuthPrincipal = {
  id: "user",
  username: "board",
  fullName: "Board",
  roleId: "role",
  role: "SCHOOL_MANAGEMENT_BOARD",
  orgType: "SCHOOL",
  schoolId: "own-school",
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: [
    "dashboard.view",
    "menu.view",
    "meal_complaint.view",
    "supplier_relationship.manage",
    "food_safety_incident.view",
  ],
};

void test("overview rejects missing permission and non-school identities before DB access", async () => {
  const connect = (): ReturnType<typeof getPrisma> =>
    Promise.reject(new Error("Database must not be accessed"));
  await assert.rejects(
    getSchoolOverview({ ...principal, permissions: [] }, connect),
    { statusCode: 403 },
  );
  await assert.rejects(
    getSchoolOverview({ ...principal, schoolId: null }, connect),
    { statusCode: 403 },
  );
  await assert.rejects(
    getSchoolOverview({ ...principal, orgType: "SYSTEM" }, connect),
    { statusCode: 403 },
  );
});

function fixture() {
  const queries: Record<string, unknown>[] = [];
  const read =
    (table: string, value: unknown) => (query: Record<string, unknown>) => {
      queries.push({ table, ...query });
      return Promise.resolve(value);
    };
  const db = {
    school: {
      findUniqueOrThrow: read("school", { id: "own-school", name: "School" }),
    },
    weeklyMenu: {
      findMany: read("menus", [{ id: "menu", status: "PENDING_APPROVAL" }]),
    },
    mealComplaint: {
      groupBy: read("complaints", [
        { status: "SUBMITTED", complaintType: "OTHER", _count: { _all: 3 } },
      ]),
    },
    schoolSupplierRelationship: {
      groupBy: read("suppliers", [{ status: "ACTIVE", _count: { _all: 2 } }]),
    },
    foodSafetyIncident: { findMany: read("incidents", [{ id: "incident" }]) },
    $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
  } as unknown as Awaited<ReturnType<typeof getPrisma>>;
  return { queries, connect: () => Promise.resolve(db) };
}

void test("overview scopes every data source to the authenticated school and serializes counts", async () => {
  const { queries, connect } = fixture();
  const result = await getSchoolOverview(principal, connect);
  assert.equal(queries.length, 5);
  for (const query of queries) {
    if (query.table === "school")
      assert.deepEqual(query.where, { id: "own-school" });
    else if (query.table === "complaints")
      assert.deepEqual(query.where, {
        MealAllocation: {
          DailyMealPortion: { Class: { schoolId: "own-school" } },
        },
      });
    else assert.deepEqual(query.where, { schoolId: "own-school" });
  }
  assert.deepEqual(result.complaints, [
    { status: "SUBMITTED", type: "OTHER", count: 3 },
  ]);
  assert.deepEqual(result.suppliers, [{ status: "ACTIVE", count: 2 }]);
});

void test("dashboard permission alone cannot disclose another business module", async () => {
  const { queries, connect } = fixture();
  const result = await getSchoolOverview(
    { ...principal, permissions: ["dashboard.view"] },
    connect,
  );
  assert.equal(result.menus, null);
  assert.equal(result.complaints, null);
  assert.equal(result.suppliers, null);
  assert.equal(result.incidents, null);
  for (const query of queries.filter((query) => query.table !== "school")) {
    assert.deepEqual((query.where as { id: unknown }).id, { in: [] });
  }
});
