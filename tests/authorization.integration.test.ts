import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { setTimeout } from "node:timers/promises";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { MemoryStore } from "express-rate-limit";
import { createApp } from "../src/app";
import { createApiRateLimiter } from "../src/middlewares/rate-limit.middleware";
import { bootstrapAuthorization } from "../src/utils/authorization-bootstrap";
import { loadPrincipal } from "../src/utils/authorization";
import { getPrisma } from "../src/utils/database";
import { assertLocalMigrationTarget } from "../src/utils/migration-target";
import { signToken, verifyToken } from "../src/utils/jwt";
import { startHttp } from "./helpers/http";
import { parse as parseCookie } from "cookie";
import { connectRedis, disconnectRedis, redis } from "../src/config/redis";
import { authSessions } from "../src/utils/auth-sessions";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "../src/utils/auth-cookies";
import { createOnboardingService } from "../src/modules/auth/onboarding.service";
import { sessionService } from "../src/modules/auth/session.service";
import { createSignupService } from "../src/modules/auth/signup.service";
import {
  createEmailVerificationService,
  verificationFingerprint,
} from "../src/modules/auth/email-verification.service";
import { createRedisEmailVerificationStore } from "../src/utils/email-verification-store";
import type {
  DocumentStorage,
  OnboardingDocument,
} from "../src/utils/onboarding-documents";
import { HttpError } from "../src/utils/http-error";
import { loadSessionUser } from "../src/utils/session-identity";
import { createProfileService } from "../src/modules/auth/profile.service";
import {
  createPasswordService,
  createPasswordRepository,
} from "../src/modules/auth/password.service";
import { createRedisPasswordResetStore } from "../src/utils/password-reset-store";
import { createMenuService } from "../src/modules/menu/menu.service";
import {
  validateMenuWrite,
  validateMenuReview,
  validateMenuPortionGroups,
} from "../src/modules/menu/menu.validation";
import { createKitchenService } from "../src/modules/kitchen/kitchen.service";
import {
  validateKitchenComplete,
  validateKitchenFilters,
  validateKitchenUpdate,
} from "../src/modules/kitchen/kitchen.validation";
import { createRetainedSampleService } from "../src/modules/retained-sample/retained-sample.service";
import { createMealAttendanceService } from "../src/modules/meal-attendance/meal-attendance.service";
import { validateDailyPortionGroups } from "../src/modules/meal-attendance/meal-attendance.validation";
import { createMealAllocationService } from "../src/modules/meal-allocation/meal-allocation.service";
import {
  validateFoodSample,
  validateSampleDisposal,
} from "../src/modules/retained-sample/retained-sample.validation";

const run = promisify(execFile);
const root = path.resolve(__dirname, "..");
function record(value: unknown): Record<string, unknown> {
  assert(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function rows(value: unknown): Record<string, unknown>[] {
  const data = record(record(value).data);
  assert(Array.isArray(data.items));
  return data.items.map((item: unknown) => record(item));
}

function schoolWeek<T extends { menuDate: string }>(monday: T): T[] {
  const start = new Date(`${monday.menuDate}T00:00:00.000Z`);
  assert.equal(
    start.getUTCDay(),
    1,
    "School-week fixture must start on Monday",
  );
  return Array.from({ length: 5 }, (_, offset) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + offset);
    return { ...monday, menuDate: date.toISOString().slice(0, 10) };
  });
}

void test("authorization with real PostgreSQL, scoped HTTP APIs and concurrent admin writes", async (context) => {
  const base = process.env.MIGRATION_TEST_DATABASE_URL;
  assert(
    base,
    "Set MIGRATION_TEST_DATABASE_URL to a disposable local PostgreSQL instance",
  );
  const target = assertLocalMigrationTarget(base);
  assert.match(target.pathname, /^\/foodprint_migration_test(?:_[a-z0-9_]+)?$/);
  const owner = new Client({ connectionString: base });
  await owner.connect();
  const name =
    "foodprint_authorization_test_" + randomUUID().replaceAll("-", "");
  await owner.query('CREATE DATABASE "' + name + '"');
  await owner.end();
  const fresh = new URL(base);
  fresh.pathname = "/" + name;
  process.env.DATABASE_URL = fresh.toString();
  process.env.JWT_SECRET = "foodprint-authorization-integration-test-only";
  process.env.NODE_ENV = "test";
  await run(
    process.execPath,
    [
      path.join(root, "node_modules/prisma/build/index.js"),
      "migrate",
      "deploy",
    ],
    { cwd: root, env: { ...process.env, DATABASE_URL: fresh.toString() } },
  );
  const db = await getPrisma();
  context.after(() => db.$disconnect());
  await bootstrapAuthorization(db);
  const role = async (code: string) =>
    db.role.findUniqueOrThrow({ where: { code } });
  const permission = async (code: string) =>
    db.permission.findUniqueOrThrow({ where: { code } });
  const password = "auth-test-password";
  const passwordHash = await bcrypt.hash(password, 10);
  const schoolA = await db.school.create({ data: { name: "School A" } });
  const schoolB = await db.school.create({ data: { name: "School B" } });
  const supplierA = await db.supplier.create({ data: { name: "Supplier A" } });
  const supplierB = await db.supplier.create({ data: { name: "Supplier B" } });
  const unitA = await db.communeFoodSafetyUnit.create({
    data: { code: "UNIT_A", name: "Unit A" },
  });
  const unitB = await db.communeFoodSafetyUnit.create({
    data: { code: "UNIT_B", name: "Unit B" },
  });
  async function user(
    code: string,
    scope: {
      schoolId?: string;
      supplierId?: string;
      communeFoodSafetyUnitId?: string;
    } = {},
  ) {
    const r = await role(code);
    const username = "user_" + randomUUID().replaceAll("-", "");
    return db.user.create({
      data: {
        roleId: r.id,
        roleCode: r.code,
        username,
        email: username + "@example.test",
        passwordHash,
        fullName: code,
        status: "ACTIVE",
        ...scope,
      },
    });
  }
  const system = await user("SYSTEM_ADMIN");
  const adminA = await user("SCHOOL_ADMINISTRATION", { schoolId: schoolA.id });
  const adminB = await user("SCHOOL_ADMINISTRATION", { schoolId: schoolB.id });
  const staffA = await user("SCHOOL_HEALTH_OFFICER", { schoolId: schoolA.id });
  const staffB = await user("SCHOOL_HEALTH_OFFICER", { schoolId: schoolB.id });
  const supplierAdmin = await user("INGREDIENT_SUPPLIER_ADMIN", {
    supplierId: supplierA.id,
  });
  const supplierStaffA = await user("INGREDIENT_SUPPLIER_STAFF", {
    supplierId: supplierA.id,
  });
  const supplierStaffB = await user("INGREDIENT_SUPPLIER_STAFF", {
    supplierId: supplierB.id,
  });
  const officerA = await user("COMMUNE_FOOD_SAFETY_OFFICER", {
    communeFoodSafetyUnitId: unitA.id,
  });
  const officerB = await user("COMMUNE_FOOD_SAFETY_OFFICER", {
    communeFoodSafetyUnitId: unitB.id,
  });
  const menuA = await db.weeklyMenu.create({
    data: {
      schoolId: schoolA.id,
      createdByUserId: staffA.id,
      weekStartDate: new Date("2026-10-26"),
      title: "Menu A",
    },
  });
  const menuB = await db.weeklyMenu.create({
    data: {
      schoolId: schoolB.id,
      createdByUserId: staffB.id,
      weekStartDate: new Date("2026-10-26"),
      title: "Menu B",
    },
  });
  const ingredientA = await db.ingredient.create({
    data: { supplierId: supplierA.id, name: "Ingredient A", defaultUnit: "kg" },
  });
  await db.ingredient.create({
    data: { supplierId: supplierB.id, name: "Ingredient B", defaultUnit: "kg" },
  });
  const incidentA = await db.foodSafetyIncident.create({
    data: {
      schoolId: schoolA.id,
      title: "Incident A",
      description: "Incident A test",
    },
  });
  const incidentB = await db.foodSafetyIncident.create({
    data: {
      schoolId: schoolB.id,
      title: "Incident B",
      description: "Incident B test",
    },
  });
  const reportA = await db.foodSafetyReportForwarding.create({
    data: {
      incidentId: incidentA.id,
      recipientCommuneFoodSafetyUnitId: unitA.id,
      recipientName: "Unit A",
      recipientOrganization: "Unit A",
    },
  });
  await db.foodSafetyReportForwarding.create({
    data: {
      incidentId: incidentB.id,
      recipientCommuneFoodSafetyUnitId: unitB.id,
      recipientName: "Unit B",
      recipientOrganization: "Unit B",
    },
  });
  const store = new MemoryStore();
  await connectRedis();
  const issued = new Map<
    string,
    Awaited<ReturnType<typeof authSessions.issue>>
  >();
  const refreshTokens: string[] = [];
  const verificationKeys = new Set<string>();
  context.after(async () => {
    try {
      for (const token of refreshTokens) await authSessions.logout(token);
      if (verificationKeys.size) await redis.del([...verificationKeys]);
    } finally {
      await disconnectRedis();
    }
  });
  for (const account of [
    system,
    adminA,
    adminB,
    staffA,
    staffB,
    supplierAdmin,
    supplierStaffA,
    supplierStaffB,
    officerA,
    officerB,
  ]) {
    const session = await authSessions.issue(account.id);
    issued.set(account.id, session);
    refreshTokens.push(session.refreshToken);
  }
  function sessionFor(id: string) {
    const session = issued.get(id);
    assert(session);
    return session;
  }
  const emailPrefix = `foodprint:email-verification:test-${randomUUID()}:`;
  const emailStore = createRedisEmailVerificationStore(
    {
      get isReady() {
        return redis.isReady;
      },
      sendCommand(args) {
        if (args[0] === "EVAL")
          args
            .slice(3, 3 + Number(args[2]))
            .forEach((key) => verificationKeys.add(key));
        else if (args[0] === "GET") verificationKeys.add(args[1]);
        return redis.sendCommand(args);
      },
    },
    emailPrefix,
  );
  const sentCodes = new Map<string, string>();
  const resetCodes = new Map<string, string>();
  const resets = createRedisPasswordResetStore(
    {
      get isReady() {
        return redis.isReady;
      },
      sendCommand(args) {
        if (args[0] === "EVAL")
          args
            .slice(3, 3 + Number(args[2]))
            .forEach((key) => verificationKeys.add(key));
        else verificationKeys.add(args[1]);
        return redis.sendCommand(args);
      },
    },
    `foodprint:password-reset:test-${randomUUID()}:`,
  );
  const passwords = createPasswordService(resets.codes, resets.grants, {
    assertConfigured() {},
    send(email, code) {
      resetCodes.set(email, code);
      return Promise.resolve();
    },
  });
  let emailProviderDown = false;
  const verification = createEmailVerificationService(emailStore, {
    assertConfigured() {},
    send(email, code) {
      if (emailProviderDown)
        return Promise.reject(
          new HttpError(503, "Test email provider unavailable"),
        );
      sentCodes.set(email, code);
      return Promise.resolve();
    },
  });
  // External file/email providers are replaced; PostgreSQL, Redis, sessions and HTTP are real.
  const uploadedFiles = new Map<string, OnboardingDocument>();
  let failedUploadField: string | undefined;
  const testDocumentStorage: DocumentStorage = {
    upload: (userId, file) => {
      if (file.fieldname === failedUploadField)
        return Promise.reject(
          new HttpError(503, "Test file provider unavailable"),
        );
      const id = randomUUID();
      const document: OnboardingDocument = {
        id,
        field: file.fieldname,
        publicId: `foodprint/onboarding/${userId}/${id}.pdf`,
        format: "pdf",
        fileName: file.originalname,
        bytes: file.size,
      };
      uploadedFiles.set(id, document);
      return Promise.resolve(document);
    },
    remove: (document) => {
      uploadedFiles.delete(document.id);
      return Promise.resolve();
    },
    download: (document) => `https://documents.example.test/${document.id}`,
  };
  const http = await startHttp(
    createApp(
      createApiRateLimiter(store, { windowMs: 60_000, limit: 5000 }),
      undefined,
      {
        session: sessionService,
        signup: createSignupService(undefined, verification),
        emailVerification: verification,
        password: passwords,
        onboarding: createOnboardingService(getPrisma, testDocumentStorage),
      },
    ),
  );
  context.after(async () => {
    await http.close();
    store.shutdown();
  });
  context.mock.method(console, "error", () => undefined);
  await context.test(
    "menu cooking API reserves stock, completes once under concurrency and retains samples",
    async () => {
      const school = await db.school.create({
        data: {
          name: "Cooking API school",
          cookingMode: "COMBINE_LOTS",
          lunchTime: new Date("1970-01-01T11:30:00Z"),
          afternoonMealTime: new Date("1970-01-01T15:00:00Z"),
        },
      });
      const healthAccount = await user("SCHOOL_HEALTH_OFFICER", {
        schoolId: school.id,
      });
      const chefAccount = await user("SCHOOL_KITCHEN_STAFF", {
        schoolId: school.id,
      });
      const reviewerAccount = await user("SCHOOL_MANAGEMENT_BOARD", {
        schoolId: school.id,
      });
      const teacher = await user("HOMEROOM_TEACHER", { schoolId: school.id });
      const health = await loadPrincipal(healthAccount.id, db);
      const chef = await loadPrincipal(chefAccount.id, db);
      const reviewer = await loadPrincipal(reviewerAccount.id, db);
      const menus = createMenuService(undefined, () => Promise.resolve(db));
      const batches = createKitchenService(undefined, () =>
        Promise.resolve(db),
      );
      const samples = createRetainedSampleService(undefined, () =>
        Promise.resolve(db),
      );
      const supplier = await db.supplier.create({
        data: { name: "Cooking API supplier" },
      });
      const supplierUser = await user("INGREDIENT_SUPPLIER_ADMIN", {
        supplierId: supplier.id,
      });
      await db.schoolSupplierRelationship.create({
        data: {
          schoolId: school.id,
          supplierId: supplier.id,
          linkedByUserId: health.id,
        },
      });
      const request = await db.supplyRequest.create({
        data: {
          schoolId: school.id,
          supplierId: supplier.id,
          requestNo: randomUUID(),
          createdByUserId: health.id,
          status: "IN_PROGRESS",
          acceptedByUserId: supplierUser.id,
          acceptedAt: new Date(),
          sentAt: new Date(),
        },
      });
      const delivery = await db.delivery.create({
        data: {
          supplyRequestId: request.id,
          supplierId: supplier.id,
          deliveryNo: randomUUID(),
          status: "RECEIVED",
          receivedByUserId: chef.id,
          receivedAt: new Date(),
          createdByUserId: supplierUser.id,
        },
      });
      async function stock(name: string, quantities: number[]) {
        const ingredient = await db.ingredient.create({
          data: { supplierId: supplier.id, name, defaultUnit: "kg" },
        });
        const entry = await db.ingredientEntry.create({
          data: {
            schoolId: school.id,
            ingredientId: ingredient.id,
            handlingType: "DRY_STOCK",
            createdByUserId: health.id,
          },
        });
        const total = quantities.reduce((a, b) => a + b, 0).toFixed(3);
        const line = await db.supplyRequestItem.create({
          data: {
            supplyRequestId: request.id,
            ingredientEntryId: entry.id,
            requestedQuantity: total,
            unit: "kg",
          },
        });
        const received = await db.deliveryItem.create({
          data: {
            deliveryId: delivery.id,
            supplyRequestItemId: line.id,
            actualQuantity: total,
            unit: "kg",
          },
        });
        const lots = [];
        for (const [i, quantity] of quantities.entries())
          lots.push(
            await db.ingredientLot.create({
              data: {
                deliveryItemId: received.id,
                lotCode: name + i,
                receivedQuantity: quantity,
                availableQuantity: quantity,
                unit: "kg",
                status: "AVAILABLE",
                createdAt: new Date(Date.now() - 10000 + i * 1000),
              },
            }),
          );
        return { ingredient, entry, lots };
      }
      const rice = await stock("API rice", [6, 3.6, 1.2]);
      const seasoning = await stock("API seasoning", [1]);
      const dish = (name: string, quantityPerPortion: number) => ({
        name,
        ingredients: [
          { ingredientId: rice.ingredient.id, quantityPerPortion, unit: "g" },
        ],
      });
      const meal = {
        mealType: "LUNCH",
        dishes: [dish("API main", 80), dish("API side", 10)],
        seasonings: [
          {
            ingredientEntryId: seasoning.entry.id,
            quantityPerPortion: 1,
            unit: "g",
          },
        ],
      };
      const firstDay = {
        menuDate: "2030-01-07",
        meals: [
          meal,
          { ...meal, mealType: "AFTERNOON", dishes: [meal.dishes[0]] },
        ],
      };
      const menu = await menus.create(
        validateMenuWrite({
          weekStartDate: firstDay.menuDate,
          days: [firstDay],
        }),
        health,
      );
      await assert.rejects(
        () => menus.submit(menu.id, health),
        (error: unknown) =>
          error instanceof HttpError &&
          error.statusCode === 422 &&
          error.message.includes("Thứ Ba (08/01)") &&
          error.message.includes("Thứ Sáu (11/01)"),
      );
      const rejectedWeek = await menus.getOne(menu.id, health);
      assert.equal(rejectedWeek.status, "DRAFT");
      assert.equal(rejectedWeek.submittedAt, null);
      assert.equal(rejectedWeek.menuDays[0].approvalStatus, "DRAFT");
      const completeWeek = await menus.create(
        validateMenuWrite({
          weekStartDate: firstDay.menuDate,
          days: schoolWeek(firstDay),
        }),
        health,
      );
      assert.equal(completeWeek.id, menu.id);
      assert.deepEqual(
        completeWeek.menuDays.map((entry) =>
          entry.menuDate.toISOString().slice(0, 10),
        ),
        ["2030-01-07", "2030-01-08", "2030-01-09", "2030-01-10", "2030-01-11"],
      );
      const day = completeWeek.menuDays[0];
      const classroom = await db.class.create({
        data: {
          schoolId: school.id,
          name: "API class",
          registeredMealPortions: 120,
        },
      });
      for (const mealType of ["LUNCH", "AFTERNOON"] as const)
        await db.dailyMealPortion.create({
          data: {
            classId: classroom.id,
            confirmedByUserId: teacher.id,
            mealDate: day.menuDate,
            mealType,
            totalPortions: 120,
            status: "FINALIZED",
            finalizedAt: new Date(),
          },
        });
      const submittedWeek = await menus.submit(menu.id, health);
      assert.equal(submittedWeek.status, "PENDING_APPROVAL");
      assert.equal(submittedWeek.menuDays.length, 5);
      assert(
        submittedWeek.menuDays.every(
          (entry) => entry.approvalStatus === "PENDING_APPROVAL",
        ),
      );
      await menus.review(
        menu.id,
        validateMenuReview({ decision: "APPROVED" }),
        reviewer,
      );
      const mainDish = day.menuDayDishes.find(
        (d) => d.Dish.name === "API main",
      )!;
      const sideDish = day.menuDayDishes.find(
        (d) => d.Dish.name === "API side",
      )!;
      const key = {
        menuDayId: day.id,
        dishId: mainDish.dishId,
        mealType: "LUNCH" as const,
      };
      // Real PostgreSQL verifies the serializable retry and row-lock behavior.
      const plans = await Promise.all([
        batches.plan(key, chef),
        batches.plan(key, chef),
      ]);
      assert.equal(plans.filter((p) => p.created).length, 1);
      assert.equal(await db.cookingBatch.count({ where: key }), 1);
      const batch = plans[0].batches[0];
      assert.equal(batch.plannedPortions, 120);
      const allocated = new Map(
        batch.cookingBatchLots.map((l) => [l.ingredientLotId, l.quantityUsed]),
      );
      assert.equal(allocated.get(rice.lots[0].id), "6");
      assert.equal(allocated.get(rice.lots[1].id), "3.6");
      await assert.rejects(
        () => batches.plan({ ...key, mealType: "AFTERNOON" }, chef),
        (e: unknown) => e instanceof HttpError && e.statusCode === 409,
      );
      const side = (
        await batches.plan({ ...key, dishId: sideDish.dishId }, chef)
      ).batches[0];
      assert.equal(
        await db.menuMealSeasoningLot.count({
          where: { menuDayId: day.id, mealType: "LUNCH" },
        }),
        1,
      );
      assert(
        (
          await menus.getRequirements(
            { menuDayId: day.id, mealType: "LUNCH" },
            health,
          )
        ).items.every((i) => i.shortageQuantity === "0"),
      );
      await batches.confirm(batch.id, chef);
      await batches.confirm(side.id, chef);
      await assert.rejects(
        () => batches.complete(batch.id, chef),
        (e: unknown) => e instanceof HttpError && e.statusCode === 422,
      );
      const inspection = validateKitchenComplete({
        inspectionData: {
          step2_Cooking: {
            startTime: "08:00",
            endTime: "10:00",
            method: "Boiled",
            cookStaff: "Chef",
          },
          step3_Serving: {
            servingTime: "10:30",
            servingTemperature: 72,
            tempPass: true,
            sensoryEvaluation: "Passed",
            sensoryPass: true,
            hygieneStaff: true,
            hygieneUtensils: true,
            inspectedBy: "Chef",
            inspectedAt: new Date().toISOString(),
            notes: "",
          },
        },
      })!;
      const completed = await Promise.all([
        batches.complete(batch.id, chef, inspection),
        batches.complete(batch.id, chef, inspection),
      ]);
      assert(
        completed.every(
          (c) => c.inventoryDeducted && !c.mealSeasoningsConsumed,
        ),
      );
      assert.equal(
        await db.inventoryTransaction.count({
          where: { referenceType: "COOKING_BATCH", referenceId: batch.id },
        }),
        2,
      );
      assert.equal(
        (
          await db.ingredientLot.findUniqueOrThrow({
            where: { id: rice.lots[0].id },
          })
        ).availableQuantity.toString(),
        "0",
      );
      assert.equal(
        (
          await batches.complete(side.id, chef, {
            ...inspection,
            step3_Serving: {
              ...inspection.step3_Serving,
              inspectedAt: new Date().toISOString(),
            },
          })
        ).mealSeasoningsConsumed,
        true,
      );
      const shared = await db.menuMealSeasoningLot.findMany({
        where: { menuDayId: day.id, mealType: "LUNCH" },
      });
      assert.equal(
        await db.inventoryTransaction.count({
          where: {
            referenceType: "MENU_MEAL_SEASONING",
            referenceId: { in: shared.map((s) => s.id) },
          },
        }),
        1,
      );
      const sampleInput = validateFoodSample({
        quantity: 150,
        unit: "g",
        storageLocation: "Fridge 1",
        sampledAt: new Date().toISOString(),
      });
      const saved = await samples.create(batch.id, sampleInput, chef);
      assert.equal(
        (await samples.create(batch.id, sampleInput, chef)).created,
        false,
      );
      assert.equal(+saved.expiresAt - +saved.sampledAt, 86400000);
      const disposal = validateSampleDisposal({
        disposedAt: new Date(Date.now() + 86400000).toISOString(),
        disposalNote: "Future date must not bypass retention",
      });
      await assert.rejects(
        () => samples.dispose(saved.id, disposal, chef),
        (e: unknown) => e instanceof HttpError && e.statusCode === 422,
      );
      assert.deepEqual(
        (await batches.inspectionSheet(batch.id, chef)).inspectionData,
        inspection,
      );
      assert.equal(
        (
          await batches.stats(
            validateKitchenFilters({ menuDayId: day.id }),
            chef,
          )
        ).pendingSamples,
        1,
      );

      const attendance = createMealAttendanceService(undefined, () =>
        Promise.resolve(db),
      );
      const allocationService = createMealAllocationService(undefined, () =>
        Promise.resolve(db),
      );
      const teacherPrincipal = await loadPrincipal(teacher.id, db);
      const grRice = await stock("Group rice", [6, 3.6]),
        grMilk = await stock("Group milk", [2]),
        grPeanut = await stock("Group peanut", [1]),
        grBeef = await stock("Group beef", [1]),
        grSpice = await stock("Group spice", [1]);
      const grMenu = await menus.create(
        validateMenuWrite({
          weekStartDate: "2032-01-05",
          days: schoolWeek({
            menuDate: "2032-01-05",
            meals: [
              {
                mealType: "LUNCH",
                dishes: [
                  {
                    name: "Group common",
                    ingredients: [
                      {
                        ingredientId: grRice.ingredient.id,
                        quantityPerPortion: 80,
                        unit: "g",
                      },
                    ],
                  },
                  {
                    name: "Group regular",
                    ingredients: [
                      {
                        ingredientId: grMilk.ingredient.id,
                        quantityPerPortion: 10,
                        unit: "g",
                      },
                      {
                        ingredientId: grPeanut.ingredient.id,
                        quantityPerPortion: 5,
                        unit: "g",
                      },
                    ],
                  },
                  {
                    name: "Group manual alternative",
                    ingredients: [
                      {
                        ingredientId: grBeef.ingredient.id,
                        quantityPerPortion: 20,
                        unit: "g",
                      },
                    ],
                  },
                ],
                seasonings: [
                  {
                    ingredientEntryId: grSpice.entry.id,
                    quantityPerPortion: 1,
                    unit: "g",
                  },
                ],
              },
            ],
          }),
        }),
        health,
      );
      const grDay = grMenu.menuDays[0],
        grCommon = grDay.menuDayDishes.find(
          (d) => d.Dish.name === "Group common",
        )!.dishId,
        grRegular = grDay.menuDayDishes.find(
          (d) => d.Dish.name === "Group regular",
        )!.dishId,
        grAlt = grDay.menuDayDishes.find(
          (d) => d.Dish.name === "Group manual alternative",
        )!.dishId;
      assert.deepEqual(
        grMenu.menuDays.map((entry) =>
          entry.menuDate.toISOString().slice(0, 10),
        ),
        ["2032-01-05", "2032-01-06", "2032-01-07", "2032-01-08", "2032-01-09"],
      );
      const grKey = { menuDayId: grDay.id, mealType: "LUNCH" as const };
      const grDefinition = validateMenuPortionGroups({
        groups: [
          {
            name: "Regular",
            isDefault: true,
            dishIds: [grCommon, grRegular],
            avoidedIngredientEntryIds: [],
          },
          {
            name: "Milk",
            isDefault: false,
            dishIds: [grCommon, grAlt],
            avoidedIngredientEntryIds: [grMilk.entry.id],
          },
          {
            name: "Peanut",
            isDefault: false,
            dishIds: [grCommon, grAlt],
            avoidedIngredientEntryIds: [grPeanut.entry.id],
          },
          {
            name: "Both",
            isDefault: false,
            dishIds: [grCommon, grAlt],
            avoidedIngredientEntryIds: [grMilk.entry.id, grPeanut.entry.id],
          },
        ],
      });
      const grGroups = (
        await menus.savePortionGroups(grKey, grDefinition, health)
      ).groups;
      const grUnsafe = structuredClone(grDefinition);
      grUnsafe.groups[1].dishIds = [grRegular];
      await assert.rejects(
        () => menus.savePortionGroups(grKey, grUnsafe, health),
        (e: unknown) => e instanceof HttpError && e.statusCode === 422,
      );
      await menus.submit(grMenu.id, health);
      await menus.review(
        grMenu.id,
        validateMenuReview({ decision: "APPROVED" }),
        reviewer,
      );
      const grClass = await db.class.create({
        data: {
          schoolId: school.id,
          name: "Group class",
          registeredMealPortions: 120,
        },
      });
      await db.classAllergy.createMany({
        data: [
          {
            classId: grClass.id,
            ingredientEntryId: grMilk.entry.id,
            affectedCount: 10,
            updatedByUserId: health.id,
          },
          {
            classId: grClass.id,
            ingredientEntryId: grPeanut.entry.id,
            affectedCount: 5,
            updatedByUserId: health.id,
          },
        ],
      });
      const grDaily = await db.dailyMealPortion.create({
        data: {
          classId: grClass.id,
          confirmedByUserId: teacher.id,
          mealDate: grDay.menuDate,
          mealType: "LUNCH",
          totalPortions: 120,
          status: "FINALIZED",
          finalizedAt: new Date(),
        },
      });
      await db.dailyAllergyPortion.createMany({
        data: [
          {
            dailyMealPortionId: grDaily.id,
            classId: grClass.id,
            ingredientEntryId: grMilk.entry.id,
            portionCount: 10,
          },
          {
            dailyMealPortionId: grDaily.id,
            classId: grClass.id,
            ingredientEntryId: grPeanut.entry.id,
            portionCount: 5,
          },
        ],
      });
      await assert.rejects(
        () => batches.plan({ ...grKey, dishId: grCommon }, chef),
        (e: unknown) => e instanceof HttpError && e.statusCode === 409,
      );
      const grCounts: Record<string, number> = {
        Regular: 107,
        Milk: 8,
        Peanut: 3,
        Both: 2,
      };
      const grInput = validateDailyPortionGroups({
        menuDayId: grDay.id,
        groups: grGroups.map((g) => ({
          portionGroupId: g.id,
          portionCount: grCounts[g.name],
        })),
      });
      await attendance.savePortionGroups(grDaily.id, grInput, teacherPrincipal);
      assert.equal(
        (
          await attendance.savePortionGroups(
            grDaily.id,
            grInput,
            teacherPrincipal,
          )
        ).unchanged,
        true,
      );
      const grRequired = new Map(
        (await menus.getRequirements(grKey, health)).items.map((i) => [
          i.ingredientId,
          i.requiredQuantity,
        ]),
      );
      assert.equal(grRequired.get(grRice.ingredient.id), "9.6");
      assert.equal(grRequired.get(grMilk.ingredient.id), "1.07");
      assert.equal(grRequired.get(grPeanut.ingredient.id), "0.535");
      assert.equal(grRequired.get(grBeef.ingredient.id), "0.26");
      await db.school.update({
        where: { id: school.id },
        data: { cookingMode: "SEPARATE_BY_LOT" },
      });
      let grPlan = await batches.plan({ ...grKey, dishId: grCommon }, chef);
      assert.deepEqual(
        grPlan.batches.map((b) => b.plannedPortions).sort((a, b) => a! - b!),
        [45, 75],
      );
      const grDeleted = grPlan.batches.find((b) => b.plannedPortions === 75)!;
      assert.equal(
        (
          await batches.update(
            grDeleted.id,
            validateKitchenUpdate({ note: "Before confirmation" }),
            chef,
          )
        ).note,
        "Before confirmation",
      );
      assert.equal(
        (await batches.remove(grDeleted.id, chef))
          .mealSeasoningReservationsReleased,
        false,
      );
      grPlan = await batches.plan({ ...grKey, dishId: grCommon }, chef);
      assert.equal(
        grPlan.batches.reduce((n, b) => n + b.plannedPortions!, 0),
        120,
      );
      await batches.confirm(grPlan.batches[0].id, chef);
      await assert.rejects(
        () => batches.update(grPlan.batches[0].id, { note: "Too late" }, chef),
        (e: unknown) => e instanceof HttpError && e.statusCode === 409,
      );
      await assert.rejects(
        () => batches.remove(grPlan.batches[0].id, chef),
        (e: unknown) => e instanceof HttpError && e.statusCode === 409,
      );
      const grNormal = (
          await batches.plan({ ...grKey, dishId: grRegular }, chef)
        ).batches,
        grAlternative = (await batches.plan({ ...grKey, dishId: grAlt }, chef))
          .batches;
      assert.equal(grNormal[0].plannedPortions, 107);
      assert.equal(grAlternative[0].plannedPortions, 13);
      const grAll = [...grPlan.batches, ...grNormal, ...grAlternative];
      for (const grBatch of grAll) await batches.confirm(grBatch.id, chef);
      await assert.rejects(
        () =>
          allocationService.create(
            { dailyMealPortionId: grDaily.id, menuDayId: grDay.id },
            chef,
          ),
        (e: unknown) => e instanceof HttpError && e.statusCode === 409,
      );
      for (const [index, grBatch] of grAll.entries()) {
        const grComplete = await batches.complete(grBatch.id, chef, {
          ...inspection,
          step3_Serving: {
            ...inspection.step3_Serving,
            inspectedAt: new Date().toISOString(),
          },
        });
        assert.equal(
          grComplete.mealSeasoningsConsumed,
          index === grAll.length - 1,
        );
      }
      assert.equal(
        await db.menuMealSeasoningLot.count({
          where: { ...grKey, usedAt: { not: null } },
        }),
        1,
      );
      const grAllocation = await allocationService.create(
        { dailyMealPortionId: grDaily.id, menuDayId: grDay.id },
        chef,
      );
      const grDistributed = new Map<string, number>();
      for (const row of grAllocation.mealAllocationBatches)
        grDistributed.set(
          row.CookingBatch.dishId,
          (grDistributed.get(row.CookingBatch.dishId) ?? 0) +
            row.allocatedPortions,
        );
      assert.equal(grDistributed.get(grCommon), 120);
      assert.equal(grDistributed.get(grRegular), 107);
      assert.equal(grDistributed.get(grAlt), 13);
      assert.equal(
        (
          await allocationService.create(
            { dailyMealPortionId: grDaily.id, menuDayId: grDay.id },
            chef,
          )
        ).created,
        false,
      );
      assert.equal(
        (await allocationService.distribute(grAllocation.id, chef)).status,
        "DISTRIBUTED",
      );
    },
  );
  const postPassword = (path: string, body: unknown, cookie?: string) =>
    http.request("/api/auth/" + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Protection": "1",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  async function passwordLogin(
    account: { id: string; username: string },
    value = password,
  ) {
    const response = await postPassword("login", {
      identifier: account.username,
      password: value,
    });
    assert.equal(response.status, 200);
    const cookie = response.headers
      .getSetCookie()
      .map((part) => part.split(";")[0])
      .join("; ");
    const refresh = parseCookie(cookie)[REFRESH_COOKIE];
    assert(refresh);
    refreshTokens.push(refresh);
    verificationKeys.add("foodprint:auth:session:user:" + account.id);
    return cookie;
  }
  await context.test(
    "password change requires the old password, rechecks the account, and revokes every existing session",
    async () => {
      const account = await user("SCHOOL_HEALTH_OFFICER", {
        schoolId: schoolA.id,
      });
      const first = await passwordLogin(account);
      const second = await passwordLogin(account);
      const next = "Change123!";
      assert.equal(
        (
          await postPassword(
            "change-password",
            { currentPassword: "wrong password", newPassword: next },
            first,
          )
        ).status,
        400,
      );
      assert.equal(
        (await http.request("/api/auth/me", { headers: { Cookie: first } }))
          .status,
        200,
      );
      const response = await postPassword(
        "change-password",
        { currentPassword: password, newPassword: next },
        first,
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.getSetCookie().length, 2);
      for (const cookie of [first, second]) {
        assert.equal(
          (await http.request("/api/auth/me", { headers: { Cookie: cookie } }))
            .status,
          401,
        );
        assert.equal((await postPassword("refresh", {}, cookie)).status, 401);
      }
      assert.equal(
        (
          await postPassword("login", {
            identifier: account.username,
            password,
          })
        ).status,
        401,
      );
      await passwordLogin(account, next);
      const saved = await db.user.findUniqueOrThrow({
        where: { id: account.id },
      });
      assert(await bcrypt.compare(next, saved.passwordHash));
      assert.equal(bcrypt.getRounds(saved.passwordHash), 12);
      assert.equal(saved.emailVerifiedAt, account.emailVerifiedAt);
      assert.equal(saved.status, account.status);
      assert.equal(saved.roleId, account.roleId);
    },
  );
  await context.test(
    "real password recovery sends a six-digit code, verifies without changing credentials and consumes the reset grant once",
    async () => {
      const account = await user("SCHOOL_HEALTH_OFFICER", {
        schoolId: schoolA.id,
      });
      const old = await passwordLogin(account);
      const unknown = await postPassword("forgot-password", {
        email: randomUUID() + "@example.test",
      });
      const known = await postPassword("forgot-password", {
        email: account.email,
      });
      assert.equal(known.status, 200);
      assert.deepEqual(known.body, unknown.body);
      const code = resetCodes.get(account.email);
      assert(code && /^[0-9]{6}$/.test(code));
      assert.equal(
        (
          await postPassword("forgot-password/verify", {
            email: account.email,
            code: code === "000000" ? "111111" : "000000",
          })
        ).status,
        400,
      );
      const verified = await postPassword("forgot-password/verify", {
        email: account.email,
        code,
      });
      assert.equal(verified.status, 200);
      assert.equal(verified.headers.getSetCookie().length, 0);
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: account.id } }))
          .passwordHash,
        account.passwordHash,
      );
      assert.equal(
        (
          await postPassword("forgot-password/verify", {
            email: account.email,
            code,
          })
        ).status,
        400,
      );
      const resetToken = record(record(verified.body).data).resetToken;
      assert.equal(typeof resetToken, "string");
      const next = "Reset123!";
      const results = await Promise.all([
        postPassword("reset-password", { resetToken, newPassword: next }),
        postPassword("reset-password", { resetToken, newPassword: next }),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
      assert.equal(
        (await http.request("/api/auth/me", { headers: { Cookie: old } }))
          .status,
        401,
      );
      assert.equal((await postPassword("refresh", {}, old)).status, 401);
      await passwordLogin(account, next);
      const saved = await db.user.findUniqueOrThrow({
        where: { id: account.id },
      });
      assert.equal(saved.status, account.status);
      assert.equal(saved.emailVerifiedAt, account.emailVerifiedAt);
    },
  );
  await context.test(
    "concurrent password replacement and login cannot leave sessions issued with an old password usable",
    async () => {
      const account = await user("SCHOOL_HEALTH_OFFICER", {
        schoolId: schoolA.id,
      });
      const cookie = await passwordLogin(account);
      const next = "Concurrent123!";
      const [login, change] = await Promise.all([
        postPassword("login", { identifier: account.username, password }),
        postPassword(
          "change-password",
          { currentPassword: password, newPassword: next },
          cookie,
        ),
      ]);
      assert.equal(change.status, 200);
      assert([200, 401].includes(login.status));
      if (login.status === 200) {
        const oldCookie = login.headers
          .getSetCookie()
          .map((part) => part.split(";")[0])
          .join("; ");
        const refresh = parseCookie(oldCookie)[REFRESH_COOKIE];
        assert(refresh);
        refreshTokens.push(refresh);
        assert.equal(
          (
            await http.request("/api/auth/me", {
              headers: { Cookie: oldCookie },
            })
          ).status,
          401,
        );
      }
      await passwordLogin(account, next);
    },
  );
  await context.test(
    "Redis revocation failure rolls back password replacement and a stale principal cannot change a locked account",
    async () => {
      const account = await user("SCHOOL_HEALTH_OFFICER", {
        schoolId: schoolA.id,
      });
      const principal = await loadSessionUser(account.id, db);
      const failing = createPasswordRepository(getPrisma, {
        ...authSessions,
        revokeUser: () =>
          Promise.reject(new HttpError(503, "Redis test offline")),
      });
      const service = createPasswordService(
        resets.codes,
        resets.grants,
        undefined,
        failing,
      );
      await assert.rejects(
        () => service.change(principal, password, "Rollback123!"),
        (error: unknown) =>
          error instanceof HttpError && error.statusCode === 503,
      );
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: account.id } }))
          .passwordHash,
        account.passwordHash,
      );
      await db.user.update({
        where: { id: account.id },
        data: { status: "LOCKED" },
      });
      await assert.rejects(
        () => passwords.change(principal, password, "Refused123!"),
        (error: unknown) =>
          error instanceof HttpError && error.statusCode === 403,
      );
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: account.id } }))
          .passwordHash,
        account.passwordHash,
      );
    },
  );
  const headers = (id: string) => ({
    Authorization: "Bearer " + sessionFor(id).accessToken,
    "Content-Type": "application/json",
    "X-CSRF-Protection": "1",
  });
  const request = (url: string, id: string, method = "GET", body?: unknown) =>
    http.request(url, {
      method,
      headers: headers(id),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  async function grantIds(roleId: string) {
    return (await db.rolePermission.findMany({ where: { roleId } })).map(
      (row) => row.permissionId,
    );
  }

  await context.test(
    "personal profile updates are self-scoped, preserve protected fields and recheck locked accounts inside the write transaction",
    async () => {
      const before = await db.user.findUniqueOrThrow({
        where: { id: staffA.id },
      });
      const otherBefore = await db.user.findUniqueOrThrow({
        where: { id: staffB.id },
      });
      const principal = await loadPrincipal(staffA.id, db);
      assert(!principal.permissions.includes("user.manage"));
      const response = await request("/api/auth/me", staffA.id, "PATCH", {
        fullName: "  Nguyễn Văn A  ",
        phone: " +84 901 234 567 ",
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(response.headers.getSetCookie(), []);
      const profile = record(record(response.body).data);
      assert.equal(profile.id, staffA.id);
      assert.equal(profile.fullName, "Nguyễn Văn A");
      assert.equal(profile.phone, "+84 901 234 567");
      assert.equal(profile.email, before.email);
      for (const key of [
        "passwordHash",
        "password",
        "accessToken",
        "refreshToken",
      ])
        assert(!(key in profile));
      const after = await db.user.findUniqueOrThrow({
        where: { id: staffA.id },
      });
      for (const key of [
        "id",
        "username",
        "email",
        "passwordHash",
        "roleId",
        "roleCode",
        "schoolId",
        "supplierId",
        "communeFoodSafetyUnitId",
        "status",
        "emailVerifiedAt",
        "createdAt",
      ] as const)
        assert.deepEqual(after[key], before[key]);
      assert.deepEqual(
        await db.user.findUniqueOrThrow({ where: { id: staffB.id } }),
        otherBefore,
      );
      for (const extra of [
        { id: staffB.id },
        { roleId: system.roleId },
        { status: "ACTIVE" },
        { schoolId: schoolB.id },
        { email: "changed@example.test" },
        { passwordHash: "not allowed" },
      ]) {
        assert.equal(
          (
            await request("/api/auth/me", staffA.id, "PATCH", {
              fullName: "Should not write",
              ...extra,
            })
          ).status,
          400,
        );
      }
      assert.equal(
        (await request("/api/auth/me", staffA.id, "PATCH", {})).status,
        400,
      );
      const invalid = await db.user.findUniqueOrThrow({
        where: { id: staffA.id },
      });
      assert.equal(invalid.fullName, "Nguyễn Văn A");
      assert.equal(
        (await request("/api/auth/me", staffA.id, "PATCH", { phone: null }))
          .status,
        200,
      );
      const current = record(
        record((await request("/api/auth/me", staffA.id)).body).data,
      );
      assert.equal(current.fullName, "Nguyễn Văn A");
      assert.equal(current.phone, null);
      const stale = await loadSessionUser(staffA.id, db);
      await db.user.update({
        where: { id: staffA.id },
        data: { status: "LOCKED" },
      });
      try {
        await assert.rejects(
          () =>
            createProfileService(() => Promise.resolve(db)).update(stale, {
              fullName: "Blocked",
            }),
          (error: unknown) =>
            error instanceof HttpError && error.statusCode === 403,
        );
        assert.equal(
          (
            await request("/api/auth/me", staffA.id, "PATCH", {
              fullName: "Blocked HTTP",
            })
          ).status,
          403,
        );
        assert.equal(
          (await db.user.findUniqueOrThrow({ where: { id: staffA.id } }))
            .fullName,
          "Nguyễn Văn A",
        );
      } finally {
        await db.user.update({
          where: { id: staffA.id },
          data: { status: "ACTIVE" },
        });
      }
    },
  );
  await context.test(
    "login validates password and active account; JWT carries identity without cached grants",
    async () => {
      const response = await http.request("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Protection": "1",
        },
        body: JSON.stringify({ identifier: system.username, password }),
      });
      assert.equal(response.status, 200);
      const data = record(record(response.body).data);
      assert(!("accessToken" in data));
      const cookies = parseCookie(
        response.headers
          .getSetCookie()
          .map((cookie) => cookie.split(";")[0])
          .join("; "),
      );
      const access = cookies[ACCESS_COOKIE];
      const refresh = cookies[REFRESH_COOKIE];
      assert(access && refresh);
      refreshTokens.push(refresh);
      const claims = verifyToken(access);
      assert.equal(claims.sub, system.id);
      assert(!("role" in claims));
      assert(!("permissions" in claims));
      for (const identifier of [system.username, "unknown-user"]) {
        const rejected = await http.request("/api/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Protection": "1",
          },
          body: JSON.stringify({ identifier, password: "wrong-password" }),
        });
        assert.equal(rejected.status, 401);
      }
      assert.equal((await request("/api/auth/me", system.id)).status, 200);
      assert.equal(
        (await request("/api/menus", system.id)).status,
        403,
        "System Admin has no implicit menu grant",
      );
      const forged = await http.request("/api/permissions", {
        headers: {
          Authorization:
            "Bearer " +
            signToken({
              sub: staffA.id,
              sid: sessionFor(staffA.id).refreshToken.slice(0, 32),
              role: "SYSTEM_ADMIN",
              orgType: "SYSTEM",
            }),
        },
      });
      assert.equal(forged.status, 403);
    },
  );
  await context.test(
    "real cookie sessions refresh and logout through PostgreSQL and Redis",
    async () => {
      const login = await http.request("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Protection": "1",
        },
        body: JSON.stringify({ identifier: system.username, password }),
      });
      assert.equal(login.status, 200);
      const cookie = login.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      const loginCookies = parseCookie(cookie);
      assert(loginCookies[REFRESH_COOKIE]);
      refreshTokens.push(loginCookies[REFRESH_COOKIE]);
      assert.equal(
        (await http.request("/api/auth/me", { headers: { Cookie: cookie } }))
          .status,
        200,
      );
      const renewed = await http.request("/api/auth/refresh", {
        method: "POST",
        headers: { Cookie: cookie, "X-CSRF-Protection": "1" },
      });
      assert.equal(renewed.status, 200);
      const nextCookie = renewed.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      const nextRefresh = parseCookie(nextCookie)[REFRESH_COOKIE];
      assert(nextRefresh);
      refreshTokens.push(nextRefresh);
      assert.notEqual(nextRefresh, loginCookies[REFRESH_COOKIE]);
      assert.equal(
        (
          await http.request("/api/auth/logout", {
            method: "POST",
            headers: { Cookie: nextCookie, "X-CSRF-Protection": "1" },
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await http.request("/api/auth/me", {
            headers: { Cookie: nextCookie },
          })
        ).status,
        401,
      );
    },
  );
  const onboardingAccounts = new Map<string, { id: string; cookie: string }>();
  for (const [requestType, roleCode] of [
    ["SCHOOL", "SCHOOL_ADMINISTRATION"],
    ["SUPPLIER", "INGREDIENT_SUPPLIER_ADMIN"],
  ] as const) {
    await context.test(
      `signup ${requestType} sends a code, requires email verification and then permits onboarding-only sessions`,
      async () => {
        const username = "signup_" + randomUUID().replaceAll("-", "");
        const body = {
          username,
          email: username + "@example.test",
          password: "Signup123!",
          fullName: `New ${requestType} Applicant`,
          phone: "0911223344",
          requestType,
        };
        const response = await http.request("/api/auth/signup", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Protection": "1",
          },
          body: JSON.stringify(body),
        });
        assert.equal(response.status, 201);
        assert.deepEqual(response.headers.getSetCookie(), []);
        assert.equal(
          record(record(response.body).data).onboardingRequired,
          true,
        );
        const account = await db.user.findUniqueOrThrow({
          where: { username },
        });
        assert.equal(account.status, "UNVERIFIED");
        assert.equal(account.emailVerifiedAt, null);
        assert.equal(account.fullName, body.fullName);
        assert.equal(account.phone, body.phone);
        const receipt = record(record(response.body).data);
        assert.equal(receipt.emailVerificationRequired, true);
        assert.equal(receipt.verificationEmailSent, true);
        const verificationCode = sentCodes.get(body.email);
        assert(verificationCode);
        assert.deepEqual(Object.keys(receipt).sort(), [
          "emailVerificationRequired",
          "onboardingRequired",
          "user",
          "verificationEmailSent",
        ]);
        assert.equal(account.roleCode, roleCode);
        assert.equal(account.schoolId, null);
        assert.equal(account.supplierId, null);
        assert.equal(account.communeFoodSafetyUnitId, null);
        assert(await bcrypt.compare(body.password, account.passwordHash));
        const application = await db.registrationRequest.findUnique({
          where: { applicantUserId: account.id },
        });
        assert.equal(application, null);
        const duplicate = await http.request("/api/auth/signup", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Protection": "1",
          },
          body: JSON.stringify(body),
        });
        assert.equal(duplicate.status, 409);
        assert.equal(
          await db.registrationRequest.count({
            where: { applicantUserId: account.id },
          }),
          0,
        );
        const unverifiedLogin = await http.request("/api/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Protection": "1",
          },
          body: JSON.stringify({
            identifier: username,
            password: body.password,
          }),
        });
        assert.equal(unverifiedLogin.status, 403);
        assert.deepEqual(unverifiedLogin.headers.getSetCookie(), []);
        const verify = await http.request(
          "/api/auth/email-verification/verify",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Protection": "1",
            },
            body: JSON.stringify({ email: body.email, code: verificationCode }),
          },
        );
        assert.equal(verify.status, 200);
        assert.deepEqual(verify.headers.getSetCookie(), []);
        const verified = await db.user.findUniqueOrThrow({
          where: { id: account.id },
        });
        assert(verified.emailVerifiedAt);
        assert.equal(verified.status, "UNVERIFIED");
        assert.equal(verified.schoolId, null);
        assert.equal(verified.supplierId, null);
        assert.equal(
          (
            await http.request("/api/auth/email-verification/verify", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-CSRF-Protection": "1",
              },
              body: JSON.stringify({
                email: body.email,
                code: verificationCode,
              }),
            })
          ).status,
          400,
        );
        const pendingLogin = await http.request("/api/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Protection": "1",
          },
          body: JSON.stringify({
            identifier: username,
            password: body.password,
          }),
        });
        assert.equal(pendingLogin.status, 200);
        const limitedCookies = pendingLogin.headers
          .getSetCookie()
          .map((value) => value.split(";")[0])
          .join("; ");
        const refreshToken = parseCookie(limitedCookies)[REFRESH_COOKIE];
        assert(refreshToken);
        refreshTokens.push(refreshToken);
        const self = await http.request("/api/auth/me", {
          headers: { Cookie: limitedCookies },
        });
        assert.equal(self.status, 200);
        const pendingUser = record(record(self.body).data);
        assert.equal(pendingUser.status, "UNVERIFIED");
        assert.equal(pendingUser.onboardingRequired, true);
        assert.equal(pendingUser.registrationRequest, null);
        assert(!("permissions" in pendingUser));
        const pendingPermissions = await http.request(
          "/api/auth/me/permissions",
          { headers: { Cookie: limitedCookies } },
        );
        assert.deepEqual(
          record(record(pendingPermissions.body).data).permissions,
          [],
        );
        assert.equal(
          (
            await http.request("/api/schools", {
              headers: { Cookie: limitedCookies },
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await http.request("/api/permissions", {
              headers: { Cookie: limitedCookies },
            })
          ).status,
          403,
        );
        const refreshed = await http.request("/api/auth/refresh", {
          method: "POST",
          headers: { Cookie: limitedCookies, "X-CSRF-Protection": "1" },
        });
        assert.equal(refreshed.status, 200);
        assert.equal(
          record(record(record(refreshed.body).data).user).status,
          "UNVERIFIED",
        );
        const rotated = parseCookie(
          refreshed.headers
            .getSetCookie()
            .map((value) => value.split(";")[0])
            .join("; "),
        )[REFRESH_COOKIE];
        assert(rotated);
        refreshTokens.push(rotated);
        onboardingAccounts.set(requestType, {
          id: account.id,
          cookie: refreshed.headers
            .getSetCookie()
            .map((value) => value.split(";")[0])
            .join("; "),
        });
      },
    );
  }
  const postEmail = (
    action: "request" | "verify",
    email: string,
    code?: string,
  ) =>
    http.request(`/api/auth/email-verification/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Protection": "1" },
      body: JSON.stringify(code === undefined ? { email } : { email, code }),
    });
  async function codeAccount() {
    const id = randomUUID(),
      codeRole = await role("SCHOOL_ADMINISTRATION");
    return db.user.create({
      data: {
        username: "email_" + id,
        email: id + "@example.test",
        fullName: "Email test",
        passwordHash,
        status: "UNVERIFIED",
        roleId: codeRole.id,
        roleCode: codeRole.code,
      },
    });
  }
  const challengeKey = (email: string) =>
    emailPrefix + "challenge:" + verificationFingerprint("email:" + email);
  const releaseCooldown = (email: string) =>
    redis.del(
      emailPrefix + "cooldown:" + verificationFingerprint("email:" + email),
    );
  await context.test(
    "real Redis verification limits bad guesses, expires codes and consumes a valid code once under concurrency",
    async () => {
      const account = await codeAccount();
      assert.equal((await postEmail("request", account.email)).status, 200);
      const first = sentCodes.get(account.email);
      assert(first);
      const raw = await redis.get(challengeKey(account.email));
      assert(raw);
      const metadata = record(JSON.parse(raw) as unknown);
      assert.deepEqual(Object.keys(metadata).sort(), [
        "attempts",
        "codeHash",
        "expiresAt",
        "id",
        "userId",
      ]);
      assert.match(String(metadata.codeHash), /^[a-f0-9]{64}$/);
      const ttl = await redis.pTTL(challengeKey(account.email));
      assert(ttl > 0 && ttl <= 600000);
      const wrong = first === "000000" ? "111111" : "000000";
      for (let i = 0; i < 5; i++)
        assert.equal(
          (await postEmail("verify", account.email, wrong)).status,
          400,
        );
      assert.equal(
        (await postEmail("verify", account.email, first)).status,
        400,
      );
      assert.equal(await redis.exists(challengeKey(account.email)), 0);
      const limited = await postEmail("request", account.email);
      assert.equal(limited.status, 429);
      assert(Number(limited.headers.get("retry-after")) > 0);
      await releaseCooldown(account.email);
      assert.equal((await postEmail("request", account.email)).status, 200);
      const expires = sentCodes.get(account.email);
      assert(expires);
      await redis.pExpire(challengeKey(account.email), 1);
      await setTimeout(20);
      assert.equal(
        (await postEmail("verify", account.email, expires)).status,
        400,
      );
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: account.id } }))
          .emailVerifiedAt,
        null,
      );
      await releaseCooldown(account.email);
      assert.equal((await postEmail("request", account.email)).status, 200);
      const valid = sentCodes.get(account.email);
      assert(valid);
      const results = await Promise.all([
        postEmail("verify", account.email, valid),
        postEmail("verify", account.email, valid),
      ]);
      assert.deepEqual(results.map((value) => value.status).sort(), [200, 400]);
      const verified = await db.user.findUniqueOrThrow({
        where: { id: account.id },
      });
      assert(verified.emailVerifiedAt);
      assert.equal(verified.status, "UNVERIFIED");
      assert.equal(verified.schoolId, null);
    },
  );
  await context.test(
    "resend replaces the live challenge; unknown addresses get a generic response with the same cooldown",
    async () => {
      const account = await codeAccount();
      await postEmail("request", account.email);
      const oldCode = sentCodes.get(account.email);
      assert(oldCode);
      const oldState = await emailStore.get(
        verificationFingerprint("email:" + account.email),
      );
      assert(oldState);
      await releaseCooldown(account.email);
      assert.equal((await postEmail("request", account.email)).status, 200);
      const newCode = sentCodes.get(account.email);
      assert(newCode);
      const newState = await emailStore.get(
        verificationFingerprint("email:" + account.email),
      );
      assert(newState);
      assert.notEqual(newState.id, oldState.id);
      assert.notEqual(newState.codeHash, oldState.codeHash);
      await emailStore.discard(
        verificationFingerprint("email:" + account.email),
        oldState.id,
      );
      assert.equal(
        (
          await emailStore.get(
            verificationFingerprint("email:" + account.email),
          )
        )?.id,
        newState.id,
      );
      // Six-digit random values can coincide; the generation/nonce must still always change.
      if (oldCode !== newCode)
        assert.equal(
          (await postEmail("verify", account.email, oldCode)).status,
          400,
        );
      assert.equal(
        (await postEmail("verify", account.email, newCode)).status,
        200,
      );
      const unknown = randomUUID() + "@example.test";
      assert.equal((await postEmail("request", unknown)).status, 200);
      assert(!sentCodes.has(unknown));
      assert.equal((await postEmail("request", unknown)).status, 429);
    },
  );
  await context.test(
    "real Redis enforces hourly email and IP request budgets atomically",
    async () => {
      const emailKey = verificationFingerprint("budget-email:" + randomUUID()),
        ipKey = verificationFingerprint("budget-ip:" + randomUUID());
      for (let n = 0; n < 5; n++) {
        assert.equal(
          await emailStore.reserve(
            emailKey,
            ipKey,
            randomUUID().replaceAll("-", ""),
          ),
          0,
        );
        await redis.del(emailPrefix + "cooldown:" + emailKey);
      }
      assert(
        (await emailStore.reserve(
          emailKey,
          ipKey,
          randomUUID().replaceAll("-", ""),
        )) > 0,
      );
      const sharedIp = verificationFingerprint("shared-ip:" + randomUUID());
      for (let n = 0; n < 20; n++)
        assert.equal(
          await emailStore.reserve(
            verificationFingerprint("budget-email:" + randomUUID()),
            sharedIp,
            randomUUID().replaceAll("-", ""),
          ),
          0,
        );
      assert(
        (await emailStore.reserve(
          verificationFingerprint("budget-email:" + randomUUID()),
          sharedIp,
          randomUUID().replaceAll("-", ""),
        )) > 0,
      );
    },
  );
  await context.test(
    "a mail failure after signup leaves a recoverable account and cannot bypass email verification",
    async () => {
      const username = "mailfail_" + randomUUID(),
        email = username + "@example.test";
      emailProviderDown = true;
      try {
        const result = await http.request("/api/auth/signup", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Protection": "1",
          },
          body: JSON.stringify({
            username,
            email,
            password: "MailFailure123!",
            fullName: "Mail failure",
            requestType: "SCHOOL",
          }),
        });
        assert.equal(result.status, 201);
        assert.equal(
          record(record(result.body).data).verificationEmailSent,
          false,
        );
        const account = await db.user.findUniqueOrThrow({ where: { email } });
        assert.equal(account.emailVerifiedAt, null);
        assert.equal(account.status, "UNVERIFIED");
        assert.equal(await redis.exists(challengeKey(email)), 0);
        assert.equal(
          (
            await http.request("/api/auth/login", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-CSRF-Protection": "1",
              },
              body: JSON.stringify({
                identifier: username,
                password: "MailFailure123!",
              }),
            })
          ).status,
          403,
        );
      } finally {
        emailProviderDown = false;
      }
      await releaseCooldown(email);
      assert.equal((await postEmail("request", email)).status, 200);
      const code = sentCodes.get(email);
      assert(code);
      assert.equal((await postEmail("verify", email, code)).status, 200);
    },
  );
  const applicationIds = new Map<string, string>();
  const certificateNo = "ONBOARDING-" + randomUUID();
  function applicantHeaders(type: string) {
    const account = onboardingAccounts.get(type);
    assert(account);
    return { Cookie: account.cookie, "X-CSRF-Protection": "1" };
  }
  await context.test(
    "verified UNVERIFIED applicants can edit their personal contact without creating or activating an organization profile",
    async () => {
      for (const type of ["SCHOOL", "SUPPLIER"]) {
        const account = onboardingAccounts.get(type);
        assert(account);
        const before = await db.user.findUniqueOrThrow({
          where: { id: account.id },
        });
        const result = await http.request("/api/auth/me", {
          method: "PATCH",
          headers: {
            ...applicantHeaders(type),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fullName: `Updated ${type} applicant`,
            phone: "0901234567",
          }),
        });
        assert.equal(result.status, 200);
        const profile = record(record(result.body).data);
        assert.equal(profile.id, account.id);
        assert.equal(profile.status, "UNVERIFIED");
        assert.equal(profile.onboardingRequired, true);
        assert(!("permissions" in profile));
        assert.equal(profile.email, before.email);
        assert.equal(profile.phone, "0901234567");
        assert.equal(profile.schoolId, null);
        assert.equal(profile.supplierId, null);
        const after = await db.user.findUniqueOrThrow({
          where: { id: account.id },
        });
        assert.deepEqual(after.emailVerifiedAt, before.emailVerifiedAt);
        assert.equal(after.roleCode, before.roleCode);
        assert.equal(after.status, "UNVERIFIED");
        assert.equal(
          await db.registrationRequest.count({
            where: { applicantUserId: account.id },
          }),
          0,
        );
      }
    },
  );
  function applicationId(type: string) {
    const id = applicationIds.get(type);
    assert(id);
    return id;
  }
  await context.test(
    "Figma profile submission stays UNVERIFIED and stores multiple certificates only in the pending application",
    async () => {
      for (const type of ["SCHOOL", "SUPPLIER"]) {
        const ownHeaders = applicantHeaders(type);
        const account = onboardingAccounts.get(type);
        assert(account);
        const before = await http.request("/api/auth/onboarding", {
          headers: ownHeaders,
        });
        assert.equal(before.status, 200);
        assert.equal(record(before.body).data, null);
        const form = new FormData();
        form.set(
          "profile",
          JSON.stringify({
            name: "New supplier from Figma",
            certifications: [
              {
                certificationType: "ATTP",
                certificateNo,
                issuedDate: "2024-02-29",
                expiryDate: "2027-01-01",
              },
              { certificationType: "ISO", certificateNo: certificateNo + "-2" },
            ],
          }),
        );
        form.set(
          "certificate_0",
          new Blob(["%PDF-1.7\ncertificate one"], { type: "application/pdf" }),
          "one.pdf",
        );
        form.set(
          "certificate_1",
          new Blob(["%PDF-1.7\ncertificate two"], { type: "application/pdf" }),
          "two.pdf",
        );
        if (type === "SCHOOL") {
          form.set(
            "profile",
            JSON.stringify({
              name: "New school from Figma",
              code: "ONBOARDING-" + randomUUID(),
            }),
          );
          form.delete("certificate_0");
          form.delete("certificate_1");
          for (const name of ["school-one.pdf", "school-two.pdf"])
            form.append(
              "legalDocument",
              new Blob(["%PDF-1.7\nschool legal file"], {
                type: "application/pdf",
              }),
              name,
            );
        } else
          form.append(
            "certificate_0",
            new Blob(["%PDF-1.7\nextra certificate"], {
              type: "application/pdf",
            }),
            "extra.pdf",
          );
        const response = await http.request("/api/auth/onboarding", {
          method: "POST",
          headers: ownHeaders,
          body: form,
        });
        assert.equal(response.status, 201);
        const data = record(record(response.body).data);
        assert.equal(data.status, "PENDING");
        assert.equal(data.accountStatus, "UNVERIFIED");
        const id = String(data.id);
        applicationIds.set(type, id);
        const userAfter = await db.user.findUniqueOrThrow({
          where: { id: account.id },
        });
        assert.equal(userAfter.status, "UNVERIFIED");
        assert.equal(userAfter.schoolId, null);
        assert.equal(userAfter.supplierId, null);
        assert.equal(
          await db.school.count({ where: { name: "New school from Figma" } }),
          0,
        );
        assert.equal(
          await db.supplier.count({
            where: { name: "New supplier from Figma" },
          }),
          0,
        );
        assert.equal(
          await db.supplierCertification.count({ where: { certificateNo } }),
          0,
        );
        const current = await http.request("/api/auth/onboarding", {
          headers: ownHeaders,
        });
        assert.equal(current.status, 200);
        assert.equal(record(record(current.body).data).id, id);
        const currentData = record(record(current.body).data);
        const editBody = {
          ...record(currentData.profileData),
          retainedDocuments: (
            currentData.documents as { id: string; field: string }[]
          ).map(({ id, field }) => ({ id, field })),
          expectedUpdatedAt: currentData.updatedAt,
        };
        const pendingEdit = await http.request("/api/auth/onboarding", {
          method: "POST",
          headers: { ...ownHeaders, "Content-Type": "application/json" },
          body: JSON.stringify(editBody),
        });
        assert.equal(pendingEdit.status, 201);
        assert.equal(record(record(pendingEdit.body).data).id, id);
        const staleEdit = await http.request("/api/auth/onboarding", {
          method: "POST",
          headers: { ...ownHeaders, "Content-Type": "application/json" },
          body: JSON.stringify(editBody),
        });
        assert.equal(staleEdit.status, 409);
        const detail = await request(
          `/api/registration-requests/${id}`,
          system.id,
        );
        assert.equal(detail.status, 200);
        assert(!JSON.stringify(detail.body).includes("publicId"));
        const detailData = record(record(detail.body).data);
        const applicantData = record(detailData.applicantUser);
        const applicantAccount = await db.user.findUniqueOrThrow({
          where: { id: String(detailData.applicantUserId) },
        });
        assert.deepEqual(applicantData, {
          id: applicantAccount.id,
          username: applicantAccount.username,
          fullName: applicantAccount.fullName,
          email: applicantAccount.email,
          phone: applicantAccount.phone,
          status: applicantAccount.status,
          emailVerifiedAt:
            applicantAccount.emailVerifiedAt?.toISOString() ?? null,
        });
        assert.equal(applicantData.fullName, `Updated ${type} applicant`);
        assert.equal(applicantData.phone, "0901234567");
        const listed = await request(
          "/api/registration-requests?page=1&limit=5",
          system.id,
        );
        assert.equal(listed.status, 200);
        const listedRequest = rows(listed.body).find((item) => item.id === id);
        assert(listedRequest);
        assert.deepEqual(listedRequest.applicantUser, applicantData);
        assert(!JSON.stringify(listed.body).includes("passwordHash"));
        assert(
          !JSON.stringify(listed.body).includes(applicantAccount.passwordHash),
        );
        assert.equal(
          (
            await request(
              "/api/registration-requests?page=1&limit=5",
              adminA.id,
            )
          ).status,
          403,
        );
        assert.equal(detailData.reviewedByUserId, null);
        assert.equal(detailData.reviewedByUser, null);
        assert(!JSON.stringify(detail.body).includes("passwordHash"));
        assert(
          !JSON.stringify(detail.body).includes(applicantAccount.passwordHash),
        );
        assert.equal(
          (
            await http.request(`/api/registration-requests/${id}`, {
              headers: ownHeaders,
            })
          ).status,
          403,
        );
      }
      const supplierDocuments = record(
        record(
          (
            await request(
              `/api/registration-requests/${applicationId("SUPPLIER")}`,
              system.id,
            )
          ).body,
        ).data,
      ).documents;
      assert(Array.isArray(supplierDocuments));
      assert.equal(supplierDocuments.length, 3);
      const documentId = String(record(supplierDocuments[0]).id);
      assert.equal(
        (
          await http.request(`/api/auth/onboarding/documents/${documentId}`, {
            headers: applicantHeaders("SUPPLIER"),
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await http.request(`/api/auth/onboarding/documents/${documentId}`, {
            headers: applicantHeaders("SCHOOL"),
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await request(
            `/api/registration-requests/${applicationId("SUPPLIER")}/documents/${documentId}`,
            system.id,
          )
        ).status,
        200,
      );
    },
  );
  await context.test(
    "registration approval requires an assigned permission and rejection/resubmission keeps the existing account and application",
    async () => {
      const id = applicationId("SCHOOL");
      const approvePermission = await permission("registration.approve");
      await db.rolePermission.delete({
        where: {
          roleId_permissionId: {
            roleId: system.roleId,
            permissionId: approvePermission.id,
          },
        },
      });
      try {
        assert.equal(
          (
            await request(
              `/api/registration-requests/${id}/approve`,
              system.id,
              "POST",
              {},
            )
          ).status,
          403,
        );
      } finally {
        await db.rolePermission.create({
          data: { roleId: system.roleId, permissionId: approvePermission.id },
        });
      }
      // A school admin still cannot review, even if its role accidentally receives the permission.
      await db.rolePermission.create({
        data: { roleId: adminA.roleId, permissionId: approvePermission.id },
      });
      try {
        assert.equal(
          (
            await request(
              `/api/registration-requests/${id}/approve`,
              adminA.id,
              "POST",
              {},
            )
          ).status,
          403,
        );
      } finally {
        await db.rolePermission.delete({
          where: {
            roleId_permissionId: {
              roleId: adminA.roleId,
              permissionId: approvePermission.id,
            },
          },
        });
      }
      assert.equal(
        (
          await request(
            `/api/registration-requests/${id}/reject`,
            system.id,
            "POST",
            { rejectionReason: " " },
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            `/api/registration-requests/${id}/reject`,
            system.id,
            "POST",
            { rejectionReason: "Bổ sung mã trường" },
          )
        ).status,
        200,
      );
      const account = onboardingAccounts.get("SCHOOL");
      assert(account);
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: account.id } })).status,
        "UNVERIFIED",
      );
      const afterReject = await http.request("/api/auth/me", {
        headers: applicantHeaders("SCHOOL"),
      });
      assert.equal(
        record(record(record(afterReject.body).data).registrationRequest)
          .status,
        "REJECTED",
      );
      const resubmitted = await http.request("/api/auth/onboarding", {
        method: "POST",
        headers: {
          ...applicantHeaders("SCHOOL"),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Corrected school",
          address: "Preserved school profile address",
          code: "ONBOARDING-" + randomUUID(),
        }),
      });
      assert.equal(resubmitted.status, 201);
      const data = record(record(resubmitted.body).data);
      assert.equal(data.id, id);
      assert.equal(data.status, "PENDING");
      assert.equal(data.rejectionReason, null);
      assert.equal(data.reviewedAt, null);
      assert.equal(
        await db.registrationRequest.count({
          where: { applicantUserId: account.id },
        }),
        1,
      );
    },
  );
  await context.test(
    "failed file upload cleans only new assets, and successful resubmission replaces old assets after commit",
    async () => {
      const id = applicationId("SUPPLIER");
      assert.equal(
        (
          await request(
            `/api/registration-requests/${id}/reject`,
            system.id,
            "POST",
            { rejectionReason: "Thay tài liệu" },
          )
        ).status,
        200,
      );
      const before = await db.registrationRequest.findUniqueOrThrow({
        where: { id },
      });
      const oldIds = [...uploadedFiles.keys()];
      assert.equal(oldIds.length, 3);
      function replacementForm() {
        const form = new FormData();
        form.set(
          "profile",
          JSON.stringify({
            name: "New supplier from Figma",
            certifications: [
              {
                certificationType: "ATTP",
                certificateNo,
                issuedDate: "2024-02-29",
                expiryDate: "2027-01-01",
              },
              { certificationType: "ISO", certificateNo: certificateNo + "-2" },
            ],
          }),
        );
        for (const index of [0, 1])
          form.set(
            `certificate_${index}`,
            new Blob(["%PDF-1.7\nreplacement"], { type: "application/pdf" }),
            `replacement-${index}.pdf`,
          );
        form.append(
          "certificate_0",
          new Blob(["%PDF-1.7\nextra replacement"], {
            type: "application/pdf",
          }),
          "extra-replacement.pdf",
        );
        return form;
      }
      failedUploadField = "certificate_1";
      try {
        assert.equal(
          (
            await http.request("/api/auth/onboarding", {
              method: "POST",
              headers: applicantHeaders("SUPPLIER"),
              body: replacementForm(),
            })
          ).status,
          503,
        );
        assert.deepEqual([...uploadedFiles.keys()], oldIds);
        const failed = await db.registrationRequest.findUniqueOrThrow({
          where: { id },
        });
        assert.equal(failed.status, "REJECTED");
        assert.deepEqual(
          failed.supportingDocuments,
          before.supportingDocuments,
        );
      } finally {
        failedUploadField = undefined;
      }
      const succeeded = await http.request("/api/auth/onboarding", {
        method: "POST",
        headers: applicantHeaders("SUPPLIER"),
        body: replacementForm(),
      });
      assert.equal(succeeded.status, 201);
      assert.equal(record(record(succeeded.body).data).id, id);
      assert.equal(uploadedFiles.size, 3);
      assert(oldIds.every((documentId) => !uploadedFiles.has(documentId)));
      const after = await db.registrationRequest.findUniqueOrThrow({
        where: { id },
      });
      assert.equal(after.status, "PENDING");
      assert.equal(after.reviewedAt, null);
    },
  );
  await context.test(
    "duplicate organization identifiers roll approval back and preserve the pending account",
    async () => {
      const id = applicationId("SCHOOL");
      const row = await db.registrationRequest.findUniqueOrThrow({
        where: { id },
      });
      const code = String(record(row.profileData).code);
      await db.school.update({ where: { id: schoolA.id }, data: { code } });
      try {
        assert.equal(
          (
            await request(
              `/api/registration-requests/${id}/approve`,
              system.id,
              "POST",
              {},
            )
          ).status,
          409,
        );
        const unchanged = await db.registrationRequest.findUniqueOrThrow({
          where: { id },
        });
        assert.equal(unchanged.status, "PENDING");
        assert.equal(unchanged.reviewedAt, null);
        const applicant = await db.user.findUniqueOrThrow({
          where: { id: row.applicantUserId },
        });
        assert.equal(applicant.status, "UNVERIFIED");
        assert.equal(applicant.schoolId, null);
        assert.equal(
          await db.school.count({ where: { name: "Corrected school" } }),
          0,
        );
      } finally {
        await db.school.update({
          where: { id: schoolA.id },
          data: { code: null },
        });
      }
    },
  );
  await context.test(
    "concurrent approvals create exactly one organization and activate the same account with current role permissions",
    async () => {
      for (const type of ["SCHOOL", "SUPPLIER"]) {
        const id = applicationId(type);
        const results = await Promise.all([
          request(
            `/api/registration-requests/${id}/approve`,
            system.id,
            "POST",
            {},
          ),
          request(
            `/api/registration-requests/${id}/approve`,
            system.id,
            "POST",
            {},
          ),
        ]);
        assert.deepEqual(
          results.map((result) => result.status).sort(),
          [200, 409],
        );
        const account = onboardingAccounts.get(type);
        assert(account);
        const after = await db.user.findUniqueOrThrow({
          where: { id: account.id },
        });
        assert.equal(after.status, "ACTIVE");
        assert.equal(Boolean(after.schoolId), type === "SCHOOL");
        assert.equal(Boolean(after.supplierId), type === "SUPPLIER");
        const reviewedDetail = await request(
          `/api/registration-requests/${id}`,
          system.id,
        );
        assert.equal(reviewedDetail.status, 200);
        const reviewedData = record(record(reviewedDetail.body).data);
        assert.equal(record(reviewedData.applicantUser).status, "ACTIVE");
        assert.equal(reviewedData.reviewedByUserId, system.id);
        assert.deepEqual(reviewedData.reviewedByUser, {
          id: system.id,
          fullName: system.fullName,
        });
        if (type === "SCHOOL") {
          assert(after.schoolId);
          assert.equal(
            (
              await db.school.findUniqueOrThrow({
                where: { id: after.schoolId },
              })
            ).address,
            "Preserved school profile address",
          );
        }
        const self = await http.request("/api/auth/me", {
          headers: applicantHeaders(type),
        });
        assert.equal(self.status, 200);
        const data = record(record(self.body).data);
        assert.equal(data.status, "ACTIVE");
        assert.equal(data.onboardingRequired, false);
        assert(Array.isArray(data.permissions));
        if (type === "SUPPLIER") {
          const certificates = await db.supplierCertification.findMany({
            where: { supplierId: after.supplierId! },
            orderBy: { certificateNo: "asc" },
          });
          assert.equal(certificates.length, 2);
          assert.equal(
            certificates[0].issuedDate?.toISOString().slice(0, 10),
            "2024-02-29",
          );
          assert(
            certificates.every((item) =>
              item.documentUrl?.startsWith(
                `/api/registration-requests/${id}/documents/`,
              ),
            ),
          );
          const documentId = certificates[0].documentUrl!.split("/").at(-1);
          assert(documentId);
          const groupedDocuments = record(
            record(reviewedDetail.body).data,
          ).documents;
          assert(Array.isArray(groupedDocuments));
          const sibling = groupedDocuments
            .map(record)
            .find(
              (document) =>
                document.field === "certificate_0" &&
                document.id !== documentId,
            );
          assert(sibling);
          const sameTenantStaff = await user("INGREDIENT_SUPPLIER_STAFF", {
            supplierId: after.supplierId!,
          });
          const session = await authSessions.issue(sameTenantStaff.id);
          issued.set(sameTenantStaff.id, session);
          refreshTokens.push(session.refreshToken);
          assert.equal(
            (
              await request(
                `/api/registration-requests/${id}/documents/${documentId}`,
                sameTenantStaff.id,
              )
            ).status,
            403,
          );
          const grant = await permission("supplier_certification.view");
          await db.rolePermission.create({
            data: { roleId: sameTenantStaff.roleId, permissionId: grant.id },
          });
          try {
            assert.equal(
              (
                await request(
                  `/api/registration-requests/${id}/documents/${String(sibling.id)}`,
                  sameTenantStaff.id,
                )
              ).status,
              200,
            );
            assert.equal(
              (
                await request(
                  `/api/registration-requests/${id}/documents/${String(sibling.id)}`,
                  supplierStaffA.id,
                )
              ).status,
              404,
            );
            assert.equal(
              (
                await request(
                  `/api/registration-requests/${id}/documents/${documentId}`,
                  sameTenantStaff.id,
                )
              ).status,
              200,
            );
            assert.equal(
              (
                await request(
                  `/api/registration-requests/${id}/documents/${documentId}`,
                  supplierStaffA.id,
                )
              ).status,
              404,
            );
            // SupplierCertification owns the asset even if the original applicant moves organizations.
            await db.user.update({
              where: { id: account.id },
              data: { supplierId: supplierB.id },
            });
            try {
              assert.equal(
                (
                  await request(
                    `/api/registration-requests/${id}/documents/${documentId}`,
                    sameTenantStaff.id,
                  )
                ).status,
                200,
              );
              assert.equal(
                (
                  await request(
                    `/api/registration-requests/${id}/documents/${documentId}`,
                    supplierStaffB.id,
                  )
                ).status,
                404,
              );
            } finally {
              await db.user.update({
                where: { id: account.id },
                data: { supplierId: after.supplierId },
              });
            }
          } finally {
            await db.rolePermission.delete({
              where: {
                roleId_permissionId: {
                  roleId: sameTenantStaff.roleId,
                  permissionId: grant.id,
                },
              },
            });
          }
        }
        assert.equal(
          (
            await request(
              `/api/registration-requests/${id}/reject`,
              system.id,
              "POST",
              { rejectionReason: "Too late" },
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await http.request("/api/auth/onboarding", {
              method: "POST",
              headers: {
                ...applicantHeaders(type),
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ name: "Cannot reopen" }),
            })
          ).status,
          403,
        );
      }
      assert.equal(
        await db.school.count({ where: { name: "Corrected school" } }),
        1,
      );
      assert.equal(
        await db.supplier.count({ where: { name: "New supplier from Figma" } }),
        1,
      );
    },
  );
  await context.test(
    "catalog create is System-only and own System role cannot be edited",
    async () => {
      const body = {
        code: "menu.export",
        name: "Export menu",
        module: "menu",
        action: "export",
      };
      assert.equal(
        (await request("/api/permissions", adminA.id, "POST", body)).status,
        403,
      );
      assert.equal(
        (await request("/api/permissions", system.id, "POST", body)).status,
        201,
      );
      assert.equal(
        (await request("/api/permissions", system.id, "POST", body)).status,
        409,
      );
      const before = await grantIds(system.roleId);
      assert.equal(
        (
          await request(
            "/api/roles/" + system.roleId + "/permissions",
            system.id,
            "PUT",
            { permissionIds: [] },
          )
        ).status,
        403,
      );
      assert.deepEqual(await grantIds(system.roleId), before);
      assert.equal((await request("/api/permissions", system.id)).status, 200);
    },
  );
  const view = await permission("menu.view");
  const roleUrl = "/api/roles/" + staffA.roleId + "/permissions";
  const denyA = "/api/users/" + staffA.id + "/permission-denials/" + view.id;
  await context.test(
    "System Admin loses access when an assigned management permission is absent",
    async () => {
      const create = await permission("permission.create");
      await db.rolePermission.deleteMany({
        where: { roleId: system.roleId, permissionId: create.id },
      });
      assert.equal(
        (
          await request("/api/permissions", system.id, "POST", {
            code: "menu.blocked",
            name: "Blocked",
            module: "menu",
            action: "blocked",
          })
        ).status,
        403,
      );
      await db.rolePermission.create({
        data: { roleId: system.roleId, permissionId: create.id },
      });
      assert.equal(
        (
          await request(
            "/api/users/" + randomUUID() + "/permissions",
            adminA.id,
          )
        ).status,
        404,
      );
    },
  );
  await context.test(
    "scoped menu reads exclude other schools and refuse client-selected organization filters",
    async () => {
      const a = await request("/api/menus", staffA.id);
      const b = await request("/api/menus", staffB.id);
      assert.equal(a.status, 200);
      assert.equal(b.status, 200);
      assert.deepEqual(
        rows(a.body).map((row) => row.id),
        [menuA.id],
      );
      assert.deepEqual(
        rows(b.body).map((row) => row.id),
        [menuB.id],
      );
      assert.equal(
        (await request("/api/menus?schoolId=" + schoolB.id, staffA.id)).status,
        400,
      );
    },
  );
  await context.test(
    "organization admins cannot edit global grants, grant outside a role or affect another organization",
    async () => {
      assert.equal(
        (await request(roleUrl, adminA.id, "PUT", { permissionIds: [] }))
          .status,
        403,
      );
      assert.equal((await request(denyA, adminB.id, "PUT")).status, 404);
      const unrelated = await permission("supplier.manage");
      assert.equal(
        (
          await request(
            "/api/users/" + staffA.id + "/permission-denials/" + unrelated.id,
            adminA.id,
            "PUT",
          )
        ).status,
        400,
      );
      await db.user.update({
        where: { id: staffB.id },
        data: { status: "LOCKED" },
      });
      assert.equal(
        (await request("/api/users/" + staffB.id + "/permissions", adminA.id))
          .status,
        404,
      );
      assert.equal(
        (
          await request(
            "/api/users/" + staffB.id + "/permission-denials/" + view.id,
            adminA.id,
            "PUT",
          )
        ).status,
        404,
      );
      await db.user.update({
        where: { id: staffB.id },
        data: { status: "ACTIVE" },
      });
      assert.equal(await db.userPermissionDenial.count(), 0);
    },
  );
  await context.test(
    "concurrent disable is idempotent, affects the next request, and enable removes the denial",
    async () => {
      const results = await Promise.all([
        request(denyA, adminA.id, "PUT"),
        request(denyA, adminA.id, "PUT"),
      ]);
      assert(results.every((r) => r.status === 200));
      assert.equal(
        await db.userPermissionDenial.count({
          where: { userId: staffA.id, permissionId: view.id },
        }),
        1,
      );
      assert.equal((await request("/api/menus", staffA.id)).status, 403);
      assert.equal((await request("/api/menus", staffB.id)).status, 200);
      assert.equal((await request(denyA, adminA.id, "DELETE")).status, 200);
      assert.equal((await request(denyA, adminA.id, "DELETE")).status, 200);
      assert.equal(await db.userPermissionDenial.count(), 0);
      assert.equal((await request("/api/menus", staffA.id)).status, 200);
    },
  );
  await context.test(
    "global role edits affect both schools while preserving per-account exceptions",
    async () => {
      assert.equal((await request(denyA, adminA.id, "PUT")).status, 200);
      const grants = await grantIds(staffA.roleId);
      assert.equal(
        (
          await request(roleUrl, system.id, "PUT", {
            permissionIds: grants.filter((id) => id !== view.id),
          })
        ).status,
        200,
      );
      assert.equal((await request("/api/menus", staffA.id)).status, 403);
      assert.equal((await request("/api/menus", staffB.id)).status, 403);
      assert.equal(
        (await request(roleUrl, system.id, "PUT", { permissionIds: grants }))
          .status,
        200,
      );
      assert.equal((await request("/api/menus", staffA.id)).status, 403);
      assert.equal((await request("/api/menus", staffB.id)).status, 200);
      assert.equal((await request(denyA, adminA.id, "DELETE")).status, 200);
      await bootstrapAuthorization(db);
      await db.rolePermission.deleteMany({
        where: { roleId: staffA.roleId, permissionId: view.id },
      });
      await bootstrapAuthorization(db);
      assert.equal(
        await db.rolePermission.count({
          where: { roleId: staffA.roleId, permissionId: view.id },
        }),
        0,
        "bootstrap must not undo runtime role edits",
      );
      await db.rolePermission.create({
        data: { roleId: staffA.roleId, permissionId: view.id },
      });
    },
  );
  await context.test(
    "supplier reads and denials remain isolated to their supplier",
    async () => {
      const ingredientView = await permission("ingredient.view");
      const grants = await grantIds(supplierStaffA.roleId);
      assert.equal(
        (
          await request(
            "/api/roles/" + supplierStaffA.roleId + "/permissions",
            system.id,
            "PUT",
            { permissionIds: [...grants, ingredientView.id] },
          )
        ).status,
        200,
      );
      const response = await request("/api/ingredients", supplierStaffA.id);
      assert.equal(response.status, 200);
      assert.deepEqual(
        rows(response.body).map((row) => row.id),
        [ingredientA.id],
      );
      const url =
        "/api/users/" +
        supplierStaffA.id +
        "/permission-denials/" +
        ingredientView.id;
      assert.equal((await request(url, supplierAdmin.id, "PUT")).status, 200);
      assert.equal(
        (await request("/api/ingredients", supplierStaffA.id)).status,
        403,
      );
      assert.equal(
        (await request("/api/ingredients", supplierStaffB.id)).status,
        200,
      );
      assert.equal(
        (
          await request(
            "/api/users/" +
              supplierStaffB.id +
              "/permission-denials/" +
              ingredientView.id,
            supplierAdmin.id,
            "PUT",
          )
        ).status,
        404,
      );
    },
  );
  await context.test(
    "authority sees only forwarded reports and never gains permission-administration functions",
    async () => {
      const result = await request("/api/food-safety-reports", officerA.id);
      assert.equal(result.status, 200);
      assert.deepEqual(
        rows(result.body).map((row) => row.id),
        [reportA.id],
      );
      assert.deepEqual(
        rows(
          (await request("/api/food-safety-incidents", officerA.id)).body,
        ).map((row) => row.id),
        [incidentA.id],
      );
      assert.equal(
        rows((await request("/api/food-safety-reports", officerB.id)).body)
          .length,
        1,
      );
      const adminPerms = await db.permission.findMany({
        where: {
          code: {
            in: [
              "permission.create",
              "role_permission.manage",
              "school_user.manage",
              "supplier_staff.manage",
            ],
          },
        },
      });
      await db.rolePermission.createMany({
        data: adminPerms.map((p) => ({
          roleId: officerA.roleId,
          permissionId: p.id,
        })),
        skipDuplicates: true,
      });
      assert.equal((await request(denyA, officerA.id, "PUT")).status, 403);
      assert.equal(
        (await request(roleUrl, officerA.id, "PUT", { permissionIds: [] }))
          .status,
        403,
      );
      assert.equal(
        (
          await request("/api/permissions", officerA.id, "POST", {
            code: "menu.test",
            name: "test",
            module: "menu",
            action: "test",
          })
        ).status,
        403,
      );
    },
  );
  await context.test(
    "inactive users and inactive permissions are rejected without changing existing tokens",
    async () => {
      const token = headers(staffA.id);
      await db.user.update({
        where: { id: staffA.id },
        data: { status: "LOCKED" },
      });
      assert.equal(
        (await http.request("/api/menus", { headers: token })).status,
        403,
      );
      await db.user.update({
        where: { id: staffA.id },
        data: { status: "ACTIVE" },
      });
      await db.permission.update({
        where: { id: view.id },
        data: { isActive: false },
      });
      assert.equal(
        (await http.request("/api/menus", { headers: token })).status,
        403,
      );
      await db.permission.update({
        where: { id: view.id },
        data: { isActive: true },
      });
      assert.equal(
        (await http.request("/api/menus", { headers: token })).status,
        200,
      );
    },
  );
  await context.test(
    "SQL permits multiple staff and enforces one admin even under concurrent inserts",
    async () => {
      await assert.rejects(() =>
        user("SCHOOL_ADMINISTRATION", { schoolId: schoolA.id }),
      );
      await assert.rejects(() =>
        user("INGREDIENT_SUPPLIER_ADMIN", { supplierId: supplierA.id }),
      );
      const schoolC = await db.school.create({
        data: { name: "Concurrent school" },
      });
      const result = await Promise.allSettled([
        user("SCHOOL_ADMINISTRATION", { schoolId: schoolC.id }),
        user("SCHOOL_ADMINISTRATION", { schoolId: schoolC.id }),
      ]);
      assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
      const failure: unknown = result.find(
        (entry) => entry.status === "rejected",
      )?.reason;
      assert(
        failure &&
          typeof failure === "object" &&
          "code" in failure &&
          failure.code === "P2002",
      );
      assert.equal(
        await db.user.count({
          where: { schoolId: schoolC.id, roleCode: "SCHOOL_ADMINISTRATION" },
        }),
        1,
      );
      await Promise.all([
        user("SCHOOL_KITCHEN_STAFF", { schoolId: schoolC.id }),
        user("SCHOOL_KITCHEN_STAFF", { schoolId: schoolC.id }),
      ]);
      const pendingRole = await role("INGREDIENT_SUPPLIER_ADMIN");
      const pending = await db.user.create({
        data: {
          roleId: pendingRole.id,
          roleCode: pendingRole.code,
          username: "pending_supplier",
          email: "pending_supplier@example.test",
          passwordHash,
          fullName: "Pending applicant",
          status: "UNVERIFIED",
        },
      });
      await assert.rejects(() => loadPrincipal(pending.id));
      await assert.rejects(() =>
        db.user.update({
          where: { id: pending.id },
          data: { status: "ACTIVE" },
        }),
      );
      const r = await role("SCHOOL_KITCHEN_STAFF");
      await assert.rejects(() =>
        db.user.create({
          data: {
            roleId: r.id,
            roleCode: "SCHOOL_ADMINISTRATION",
            schoolId: schoolC.id,
            username: "mismatch",
            email: "mismatch@example.test",
            passwordHash,
            fullName: "Mismatch",
          },
        }),
      );
      assert.equal((await loadPrincipal(staffA.id)).schoolId, schoolA.id);
    },
  );
  await context.test(
    "migration refuses legacy duplicate admins without deleting or reassigning accounts",
    async () => {
      const owner = new Client({ connectionString: base });
      await owner.connect();
      const legacy =
        "foodprint_authorization_legacy_" + randomUUID().replaceAll("-", "");
      await owner.query('CREATE DATABASE "' + legacy + '"');
      await owner.end();
      const legacyUrl = new URL(base);
      legacyUrl.pathname = "/" + legacy;
      const sql = new Client({ connectionString: legacyUrl.toString() });
      await sql.connect();
      try {
        await sql.query(
          await readFile(
            path.join(root, "prisma/migrations/0_init/migration.sql"),
            "utf8",
          ),
        );
        await sql.query("SET search_path TO foodprint, public");
        await sql.query(
          "INSERT INTO roles(code,name,type) VALUES ('SCHOOL_ADMINISTRATION','Admin','SCHOOL')",
        );
        await sql.query("INSERT INTO schools(name) VALUES ('Legacy school')");
        await sql.query(
          "INSERT INTO users(role_id,school_id,username,email,password_hash,full_name) SELECT r.id,s.id,v,v||'@example.test','preserved-test-hash','Legacy admin' FROM roles r CROSS JOIN schools s CROSS JOIN unnest(ARRAY['legacy_a','legacy_b']) v",
        );
        const migration = await readFile(
          path.join(
            root,
            "prisma/migrations/20261029000200_single_organization_admin/migration.sql",
          ),
          "utf8",
        );
        await assert.rejects(
          () => sql.query(migration),
          (error: unknown) =>
            error !== null &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "23505",
        );
        await sql.query("ROLLBACK");
        const remaining = await sql.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM users WHERE password_hash='preserved-test-hash'",
        );
        assert.equal(remaining.rows[0].count, 2);
        const columns = await sql.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema='foodprint' AND table_name='users' AND column_name='role_code'",
        );
        assert.equal(
          columns.rows[0].count,
          0,
          "failed migration must roll back the column/backfill as well",
        );
      } finally {
        await sql.query("ROLLBACK");
        await sql.end();
      }
    },
  );
});
