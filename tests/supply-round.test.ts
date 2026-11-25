import assert from "node:assert/strict";
import { test } from "node:test";
import { ROLES } from "../src/constants/roles";
import { Prisma } from "../src/generated/prisma/client";
import { supplyRoundService } from "../src/modules/supply-round/supply-round.service";
import {
  roundApprovalSchema,
  roundQuerySchema,
  validateRoundInput,
} from "../src/modules/supply-round/supply-round.validation";
import type { AuthPrincipal } from "../src/types/auth";
import { HttpError } from "../src/utils/http-error";

const board: AuthPrincipal = {
  id: "00000000-0000-4000-8000-0000000000b1",
  username: "school_bgh",
  fullName: "BGH",
  roleId: "role",
  role: ROLES.SCHOOL_MANAGEMENT_BOARD,
  orgType: "SCHOOL",
  schoolId: "10000000-0000-4000-8000-000000000001",
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: ["cooking_plan.view", "cooking_plan.approve"],
};
const hasStatus = (status: number) => (error: unknown) =>
  error instanceof HttpError && error.statusCode === status;

void test("round batch becomes official only after the last required receipt and stock check", async () => {
  const date = new Date("2026-11-25T00:00:00.000Z");
  let round2Exists = false;
  let received = false;
  let available = new Prisma.Decimal(4);
  let marked = 0;
  const tx = {
    supplyRound: {
      findUnique: ({
        where,
      }: {
        where: { schoolId_deliveryDate_batchNo: { batchNo: number } };
      }) =>
        Promise.resolve(
          where.schoolId_deliveryDate_batchNo.batchNo === 1
            ? { id: "round1", status: "READY" }
            : round2Exists
              ? { id: "round2", status: "NOT_NEEDED" }
              : null,
        ),
    },
    supplyRequest: {
      findMany: () =>
        Promise.resolve([
          { deliveries: [{ status: received ? "RECEIVED" : "IN_TRANSIT" }] },
        ]),
    },
    cookingBatch: {
      findMany: () =>
        Promise.resolve([
          {
            id: "batch",
            menuDayId: "menu",
            mealType: "LUNCH",
            status: "ROUND1_APPROVED",
            plannedPortions: 10,
            cookingBatchLots: [{ ingredientLotId: "lot" }],
          },
        ]),
      updateMany: () => {
        marked += 1;
        return Promise.resolve({ count: 1 });
      },
    },
    cookingBatchRoundPart: { findMany: () => Promise.resolve([]) },
    menuDay: { findUniqueOrThrow: () => Promise.resolve({ menuDate: date }) },
    ingredientLot: {
      findMany: () =>
        Promise.resolve([
          {
            id: "lot",
            status: "AVAILABLE",
            unit: "kg",
            availableQuantity: available,
          },
        ]),
    },
    cookingBatchLot: {
      findMany: () =>
        Promise.resolve([
          {
            ingredientLotId: "lot",
            unit: "kg",
            quantityUsed: new Prisma.Decimal(4),
            sampleQuantity: new Prisma.Decimal(1),
          },
        ]),
    },
    cookingBatchRoundPartLot: { findMany: () => Promise.resolve([]) },
    menuMealSeasoningLot: { findMany: () => Promise.resolve([]) },
    $queryRawUnsafe: () => Promise.resolve([]),
  } as unknown as Prisma.TransactionClient;
  const finalize = () =>
    supplyRoundService.finalizeReceivedDay(tx, board.schoolId!, date, date);
  await finalize();
  round2Exists = true;
  await finalize();
  assert.equal(marked, 0);
  received = true;
  await assert.rejects(finalize(), hasStatus(409));
  assert.equal(marked, 0);
  available = new Prisma.Decimal(5);
  await finalize();
  assert.equal(marked, 1);
});

void test("supply round validates calendar dates, batch numbers and unknown query fields", () => {
  assert.deepEqual(
    validateRoundInput(roundQuerySchema, {
      date: "2026-11-25",
      batchNo: "1",
    }),
    { date: new Date("2026-11-25T00:00:00.000Z"), batchNo: 1 },
  );
  for (const query of [
    { date: "2026-02-30", batchNo: "1" },
    { date: "2026-11-25", batchNo: "3" },
    { date: "2026-11-25", batchNo: "1", schoolId: board.schoolId },
  ]) {
    assert.throws(
      () => validateRoundInput(roundQuerySchema, query),
      hasStatus(400),
    );
  }
});

void test("supply round approval requires a version and rejects unknown body fields", () => {
  const planVersion = "a".repeat(32);
  assert.deepEqual(validateRoundInput(roundApprovalSchema, { planVersion }), {
    planVersion,
  });
  for (const input of [
    {},
    { planVersion: "old" },
    { planVersion, schoolId: board.schoolId },
  ]) {
    assert.throws(
      () => validateRoundInput(roundApprovalSchema, input),
      hasStatus(400),
    );
  }
});

void test("supply round denials fail before accessing the database", async () => {
  const dish = { id: board.id, dishId: board.id };
  const query = { date: new Date("2026-11-25T00:00:00.000Z"), batchNo: 1 };
  await assert.rejects(
    supplyRoundService.get(query, { ...board, schoolId: null }),
    hasStatus(403),
  );
  await assert.rejects(
    supplyRoundService.get(query, { ...board, permissions: [] }),
    hasStatus(403),
  );
  await assert.rejects(supplyRoundService.retry(dish, board), hasStatus(403));
  await assert.rejects(
    supplyRoundService.approve(dish, { planVersion: "a".repeat(32) }, board),
    hasStatus(403),
  );
});
