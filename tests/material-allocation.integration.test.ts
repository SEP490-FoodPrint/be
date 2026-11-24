import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import { Prisma } from "../src/generated/prisma/client";
import { getPrisma } from "../src/utils/database";
import { bootstrapAuthorization } from "../src/utils/authorization-bootstrap";
import { loadPrincipal } from "../src/utils/authorization";
import {
  loadAllocationFixture,
  allocationFixtureClock,
  allocationFixtureDate,
} from "./helpers/meal-allocation-fixture";
import { createMaterialAllocationService } from "../src/modules/meal-allocation/material-allocation.service";
import { createMealAllocationService } from "../src/modules/meal-allocation/meal-allocation.service";
import { createMealAllocationRouter } from "../src/modules/meal-allocation/meal-allocation.routes";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import { createBlockchainProofService } from "../src/modules/blockchain-proof/blockchain-proof.service";
import {
  allocationHash,
  buildMaterialPlan,
  readValidatedMaterialData,
} from "../src/modules/meal-allocation/material-allocation.service";
import {
  processNextAllocationDraft,
  queueAllocationDraft,
} from "../src/modules/meal-allocation/material-allocation-runtime";
import type { MaterialPlanResponseDTO } from "../src/modules/meal-allocation/material-allocation.response.dto";
import {
  readMaterialAllocationData,
  writeMaterialAllocation,
} from "../src/modules/meal-allocation/meal-allocation.repository";

void test("material allocation migration and lifecycle in an explicitly owned disposable database", async (context) => {
  const target = new URL(
    process.env.DATABASE_URL ?? "postgresql://invalid/invalid",
  );
  const name = target.pathname.slice(1);
  assert.match(name, /^foodprint_material_test_[a-f0-9]{32}$/);
  assert.equal(
    name,
    process.env.FOODPRINT_OWNED_MATERIAL_DATABASE,
    "Integration writes require the newly created owned test database",
  );
  const db = await getPrisma();
  context.after(() => db.$disconnect());
  const current = await db.$queryRaw<
    { name: string }[]
  >`SELECT current_database() AS name`;
  assert.equal(current[0].name, name);
  await bootstrapAuthorization(db);
  const school = await db.school.create({
    data: { name: "Material integration school", status: "ACTIVE" },
  });
  const supplier = await db.supplier.create({
    data: { name: "Material integration supplier" },
  });
  const createUser = async (
    code: string,
    scope: { schoolId?: string; supplierId?: string },
  ) => {
    const role = await db.role.findUniqueOrThrow({ where: { code } });
    const id = randomUUID();
    return db.user.create({
      data: {
        id,
        roleId: role.id,
        roleCode: role.code,
        username: "test_" + id,
        email: id + "@example.test",
        passwordHash: "integration-only",
        fullName: code,
        status: "ACTIVE",
        ...scope,
      },
    });
  };
  const kitchen = await createUser("SCHOOL_KITCHEN_STAFF", {
    schoolId: school.id,
  });
  const teacher = await createUser("HOMEROOM_TEACHER", { schoolId: school.id });
  const supplierUser = await createUser("INGREDIENT_SUPPLIER_ADMIN", {
    supplierId: supplier.id,
  });
  const permissions = await db.permission.findMany({
    where: {
      code: {
        in: [
          "meal_allocation.view",
          "meal_allocation.update",
          "meal_allocation.create",
        ],
      },
    },
    select: { id: true },
  });
  await db.rolePermission.createMany({
    data: permissions.map((permission) => ({
      roleId: kitchen.roleId,
      permissionId: permission.id,
    })),
    skipDuplicates: true,
  });
  const fixture = await loadAllocationFixture(
    db,
    school.id,
    kitchen.id,
    teacher.id,
    "ready",
  );
  const demands = await db.dailyMealPortion.findMany({
    where: { id: { in: fixture.demandIds } },
    orderBy: { totalPortions: "desc" },
  });
  const grades = await Promise.all(
    ["4–5", "1–3"].map((name) =>
      db.schoolGrade.create({ data: { schoolId: school.id, name } }),
    ),
  );
  for (const [index, demand] of demands.entries())
    await db.class.update({
      where: { id: demand.classId },
      data: { gradeId: grades[index === 0 ? 0 : 1].id },
    });
  const first = await db.cookingBatch.findUniqueOrThrow({
    where: { id: fixture.batchIds[0] },
    include: { dishes: true },
  });
  const dishId = first.dishes[0].dishId;
  const ingredient = await db.ingredient.create({
    data: {
      supplierId: supplier.id,
      name: "Integration beef",
      defaultUnit: "kg",
    },
  });
  const entry = await db.ingredientEntry.create({
    data: {
      schoolId: school.id,
      ingredientId: ingredient.id,
      handlingType: "DIRECT_USE",
    },
  });
  const request = await db.supplyRequest.create({
    data: {
      schoolId: school.id,
      supplierId: supplier.id,
      requestNo: randomUUID(),
      createdByUserId: kitchen.id,
      status: "IN_PROGRESS",
      acceptedByUserId: supplierUser.id,
      acceptedAt: new Date(),
      sentAt: new Date(),
    },
  });
  const item = await db.supplyRequestItem.create({
    data: {
      supplyRequestId: request.id,
      ingredientEntryId: entry.id,
      requestedQuantity: "7.200",
      unit: "kg",
    },
  });
  const delivery = await db.delivery.create({
    data: {
      supplyRequestId: request.id,
      schoolId: school.id,
      supplierId: supplier.id,
      creationMode: null,
      deliveryNo: randomUUID(),
      status: "ARRIVED",
      arrivedAt: new Date(),
      createdByUserId: supplierUser.id,
    },
  });
  const received = await db.deliveryItem.create({
    data: {
      deliveryId: delivery.id,
      supplyRequestItemId: item.id,
      ingredientId: ingredient.id,
      ingredientEntryId: entry.id,
      actualQuantity: "7.200",
      unit: "kg",
    },
  });
  const snapshot = {
    version: 1,
    profiles: grades.map((grade, index) => ({
      gradeId: grade.id,
      lines: [
        {
          ingredientId: ingredient.id,
          quantityPerPortion: index === 0 ? "60" : "80",
          unit: "g",
        },
      ],
    })),
    fallback: [
      { ingredientId: ingredient.id, quantityPerPortion: "72", unit: "g" },
    ],
  };
  await db.menuDayDishIngredient.create({
    data: {
      menuDayId: first.menuDayId,
      dishId,
      mealType: "LUNCH",
      ingredientId: ingredient.id,
      quantityPerPortion: "72",
      unit: "g",
    },
  });
  for (const [index, batchId] of fixture.batchIds.entries()) {
    const quantity = index === 0 ? "3.000" : "4.200";
    const lot = await db.ingredientLot.create({
      data: {
        deliveryItemId: received.id,
        lotCode: randomUUID(),
        receivedQuantity: quantity,
        availableQuantity: "0",
        unit: "kg",
        status: "AVAILABLE",
      },
    });
    await db.cookingBatchLot.create({
      data: {
        cookingBatchId: batchId,
        dishId,
        ingredientLotId: lot.id,
        quantityUsed: quantity,
        unit: "kg",
      },
    });
    await db.cookingBatchDish.update({
      where: { cookingBatchId_dishId: { cookingBatchId: batchId, dishId } },
      data: { allocationRecipeSnapshot: snapshot },
    });
  }
  const actor = await loadPrincipal(kitchen.id, db);
  const materials = createMaterialAllocationService(
    () => Promise.resolve(db),
    allocationFixtureClock,
  );
  const proofs = createBlockchainProofService({
    connect: () => Promise.resolve(db),
    enabled: () => true,
  });
  const manual = createMealAllocationService(
    () => Promise.resolve(db),
    allocationFixtureClock,
    {
      prepareMealDistributed: (tx, schoolId, date, actorId) =>
        proofs.prepareMealDistributed(tx, schoolId, date, actorId),
      scheduleAnchor: () => {},
    },
  );
  const app = express();
  app.use(express.json());
  app.use(
    "/api/meal-allocations",
    createMealAllocationRouter(
      manual,
      (req, _res, next) => {
        req.auth = actor;
        next();
      },
      materials,
    ),
  );
  app.use(globalErrorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  context.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/meal-allocations`;
  const post = async (path: string, body: unknown, method = "POST") => {
    const response = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      body: (await response.json()) as {
        data: Record<string, unknown>;
        message?: string;
      },
    };
  };
  type Plan = MaterialPlanResponseDTO;
  let plan: Plan;
  const planDate = "2026-11-12";
  const compute = async () =>
    buildMaterialPlan(
      await db.$transaction((tx) =>
        readValidatedMaterialData(
          tx,
          school.id,
          allocationFixtureDate,
          "LUNCH",
        ),
      ),
      planDate,
      { mealType: "LUNCH", priorityClassIds: [] },
    );
  const prepareDraft = async () => {
    await db.$transaction((tx) =>
      queueAllocationDraft(tx, school.id, allocationFixtureDate, "LUNCH"),
    );
    while (await processNextAllocationDraft(db));
    const draft = await db.mealAllocationDraft.findFirstOrThrow({
      where: { schoolId: school.id, mealType: "LUNCH" },
    });
    assert.equal(draft.state, "DRAFT");
    return {
      plan: draft.plan as unknown as Plan,
      token: allocationHash({
        draft: draft.revision,
        source: draft.sourceRevision,
      }),
    };
  };
  await context.test(
    "numeric(20,2) and material foreign keys deployed",
    async () => {
      const columns = await db.$queryRaw<
        { numeric_precision: number; numeric_scale: number }[]
      >`SELECT numeric_precision,numeric_scale FROM information_schema.columns WHERE table_schema='foodprint' AND table_name='meal_allocation_batches' AND column_name='allocated_portions'`;
      assert.equal(columns[0].numeric_precision, 20);
      assert.equal(columns[0].numeric_scale, 2);
    },
  );
  await context.test(
    "16.67 and 33.33 persist with exact 1000g and 2000g, then rollback atomically",
    async () => {
      await assert.rejects(
        () =>
          db.$transaction(
            async (tx) => {
              for (const [index, demand] of demands.entries())
                await tx.dailyMealPortion.update({
                  where: { id: demand.id },
                  data: { totalPortions: index === 0 ? 50 : 0 },
                });
              for (const [index, batchId] of fixture.batchIds.entries())
                await tx.cookingBatchLot.updateMany({
                  where: { cookingBatchId: batchId },
                  data: { quantityUsed: index === 0 ? "1.000" : "2.000" },
                });
              const data = await readMaterialAllocationData(
                tx,
                school.id,
                allocationFixtureDate,
                "LUNCH",
              );
              const decimal = buildMaterialPlan(data, "2026-11-12", {
                mealType: "LUNCH",
                priorityClassIds: [],
              });
              assert.deepEqual(
                decimal.entries.map((row) => row.allocatedPortions).sort(),
                ["16.67", "33.33"],
              );
              await writeMaterialAllocation(
                tx,
                school.id,
                allocationFixtureDate,
                kitchen.id,
                decimal.entries,
                data.allocations,
              );
              const stored = await tx.mealAllocationBatch.findMany({
                orderBy: { allocatedPortions: "asc" },
                include: { materials: true },
              });
              assert.deepEqual(
                stored.map((row) => row.allocatedPortions.toFixed(2)),
                ["16.67", "33.33"],
              );
              assert.deepEqual(
                stored.map((row) => row.materials[0].quantity.toFixed(9)),
                ["1000.000000000", "2000.000000000"],
              );
              throw new Error("rollback decimal fixture");
            },
            { timeout: 60000 },
          ),
        /rollback decimal fixture/,
      );
      assert.equal(await db.mealAllocationBatch.count(), 0);
    },
  );
  await context.test(
    "legacy batches without snapshots auto-plan from grade recipes through GET",
    async () => {
      // Mốc chuẩn 75 g gồm 60 g nguyên liệu; khối 1 dùng 75 g (60 g), khối 2 dùng 100 g (80 g).
      await db.dish.update({
        where: { id: dishId },
        data: { standardQuantity: "75", standardUnit: "g" },
      });
      await db.dishIngredientEntry.deleteMany({ where: { dishId } });
      await db.dishIngredientEntry.create({
        data: {
          dishId,
          ingredientEntryId: entry.id,
          ingredientRole: "MAIN",
          requiredQuantity: "60",
          unit: "g",
        },
      });
      for (const [index, grade] of grades.entries()) {
        await db.dishGradeRecipe.create({
          data: {
            dishId,
            gradeId: grade.id,
            schoolId: school.id,
            portionQuantity: index === 0 ? "75" : "100",
          },
        });
      }
      await db.cookingBatchDish.updateMany({
        data: { allocationRecipeSnapshot: Prisma.DbNull },
      });
      assert.equal((await fetch(base + "?mealType=LUNCH")).status, 200);
      assert.equal(
        await db.mealAllocationDraft.count(),
        0,
        "GET queues nothing",
      );
      await prepareDraft();
      const response = await fetch(base + "?mealType=LUNCH");
      const body = (await response.json()) as {
        data: { materialPlan: Plan };
      };
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.equal(
        body.data.materialPlan?.status,
        "READY",
        JSON.stringify(body),
      );
      assert.equal(
        body.data.materialPlan?.groups.find(
          (group: { gradeId: string }) => group.gradeId === grades[0].id,
        )?.allocatedPortions,
        "40.00",
      );
      assert.equal(await db.mealAllocationBatch.count(), 0);
      assert.equal(
        (await fetch(base + "/material-plan", { method: "POST" })).status,
        404,
      );
    },
  );
  await context.test(
    "HTTP preview partitions source material and grade demand",
    async () => {
      const response = await fetch(base + "?mealType=LUNCH");
      const result = {
        status: response.status,
        body: (await response.json()) as {
          data: { materialPlan: Plan };
        },
      };
      assert.equal(result.body.data.materialPlan.status, "READY");
      assert.equal(
        await db.mealAllocationBatch.count(),
        0,
        "GET must not persist allocations",
      );
      assert.equal(result.status, 200, JSON.stringify(result.body));
      plan = (await prepareDraft()).plan;
      assert.equal(
        plan.groups.find((g) => g.gradeId === grades[0].id)?.allocatedMassKg,
        "2.400000000",
      );
      assert.equal(
        plan.groups.find((g) => g.gradeId === grades[1].id)?.allocatedMassKg,
        "4.800000000",
      );
      assert.equal(
        plan.totals
          .reduce(
            (sum, row) => sum.add(row.allocatedPortions),
            new Prisma.Decimal(0),
          )
          .toFixed(2),
        "100.00",
      );
    },
  );
  await context.test(
    "GLPK suggestion overwrites an edited draft and restores the proposal",
    async () => {
      const { plan: proposed } = await prepareDraft();
      await db.mealAllocationDraft.updateMany({
        where: { schoolId: school.id, mealType: "LUNCH" },
        data: {
          plan: {
            ...proposed,
            entries: [],
          } as unknown as Prisma.InputJsonValue,
        },
      });
      const response = await post("/draft/suggest", { mealType: "LUNCH" });
      assert.equal(response.status, 200);
      const draft = await db.mealAllocationDraft.findFirstOrThrow({
        where: { schoolId: school.id, mealType: "LUNCH" },
      });
      assert.equal(draft.state, "DRAFT");
      assert.deepEqual(
        (draft.plan as unknown as Plan).entries.map((e) => e.allocatedPortions),
        proposed.entries.map((e) => e.allocatedPortions),
      );
      assert.equal(await db.mealAllocationBatch.count(), 0, "draft only");
    },
  );
  await context.test(
    "concurrent apply writes once and stale retries cannot duplicate material",
    async () => {
      const { token } = await prepareDraft();
      const body = { mealType: "LUNCH", revision: token };
      const results = await Promise.all([
        post("", body, "PUT"),
        post("", body, "PUT"),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      const rows = await db.mealAllocationBatch.findMany({
        include: { materials: true },
      });
      assert.equal(
        rows
          .reduce(
            (sum, row) => sum.add(row.allocatedPortions),
            new Prisma.Decimal(0),
          )
          .toFixed(2),
        "100.00",
      );
      assert.equal(
        rows
          .flatMap((row) => row.materials)
          .reduce((sum, row) => sum.add(row.quantity), new Prisma.Decimal(0))
          .toFixed(9),
        "7200.000000000",
      );
    },
  );
  await context.test(
    "public API returns decimal strings and scoped grade quantities",
    async () => {
      const response = await fetch(base + "?mealType=LUNCH");
      const body = (await response.json()) as {
        data: {
          status: string;
          materialPlan?: unknown;
          grades: { dishes: { batches: { plannedPortions: string }[] }[] }[];
        };
      };
      assert.equal(response.status, 200);
      assert.equal(body.data.status, "READY");
      assert.equal(
        body.data.materialPlan,
        undefined,
        "saved allocations must not be recalculated",
      );
      assert(
        body.data.grades
          .flatMap((g) => g.dishes)
          .flatMap((d) => d.batches)
          .every((batch) => typeof batch.plannedPortions === "string"),
      );
    },
  );
  await context.test(
    "whole-day confirmation persists a version-2 material proof",
    async () => {
      const view = await manual.getToday(actor);
      const confirmed = await manual.confirmDistribution(
        { revision: view.revision },
        actor,
      );
      assert.equal(confirmed.distribution.status, "DISTRIBUTED");
      const proof = await db.blockchainProof.findFirstOrThrow({
        where: { eventType: "DISTRIBUTED" },
      });
      assert.equal(proof.payloadVersion, 2);
      const snapshot = proof.snapshot as {
        v: number;
        batches: { portions: string; materials: unknown[] }[];
      };
      assert.equal(snapshot.v, 2);
      assert(
        snapshot.batches.every(
          (row) => typeof row.portions === "string" && row.materials.length > 0,
        ),
      );
    },
  );
  await context.test(
    "locked sources cannot be allocated a second time",
    async () => {
      await assert.rejects(() => compute(), /Không còn nhu cầu/);
      for (const [path, method] of [
        ["/draft", "PUT"],
        ["", "PUT"],
      ] as const)
        assert.equal(
          (
            await post(
              path,
              { mealType: "LUNCH", revision: "a".repeat(64), rows: [] },
              method,
            )
          ).status,
          409,
          "a distributed meal rejects drafts and apply",
        );
      assert.equal(
        await db.mealAllocation.count({
          where: {
            status: "DISTRIBUTED",
            DailyMealPortion: { mealDate: allocationFixtureDate },
          },
        }),
        3,
      );
    },
  );
});
