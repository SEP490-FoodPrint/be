import {
  createIngredientService,
  ingredientService,
} from "../src/modules/ingredient/ingredient.service";
import {
  createSourceFacilityService,
  sourceFacilityService,
} from "../src/modules/source-facility/source-facility.service";
import { createSourceFacilityRepository } from "../src/modules/source-facility/source-facility.repository";
import { validateSourceFacilityCreate } from "../src/modules/source-facility/source-facility.validation";
import { createBarrier } from "./helpers/account-lifecycle-database";
import { documentStorage } from "../src/utils/onboarding-documents";
import { withReadTransaction } from "../src/utils/read-transaction";
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
import {
  closeEmailQueue,
  closeEmailWorker,
  createEmailQueue,
  createEmailWorker,
  dispatchEmailOutbox,
  processEmailOutbox,
} from "../src/utils/email-outbox";
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
import { createOrganizationService } from "../src/modules/organization/organization.service";
import {
  validateMenuWrite,
  validateMenuReview,
  validateMenuPortionGroups,
} from "../src/modules/menu/menu.validation";
import { createKitchenService } from "../src/modules/kitchen/kitchen.service";
import { createDeliveryInspectionService } from "../src/modules/delivery/delivery.service";
import { validateDeliveryInspectionDecision } from "../src/modules/delivery/delivery.validation";
import { validateKitchenFilters } from "../src/modules/kitchen/kitchen.validation";
import { createRetainedSampleService } from "../src/modules/retained-sample/retained-sample.service";
import { createMealAttendanceService } from "../src/modules/meal-attendance/meal-attendance.service";
import { validateDailyPortionGroups } from "../src/modules/meal-attendance/meal-attendance.validation";
import { createMealAllocationService } from "../src/modules/meal-allocation/meal-allocation.service";
import { createFeedbackService } from "../src/modules/feedback/feedback.service";
import {
  allocationFixtureClock,
  loadAllocationFixture,
} from "./helpers/meal-allocation-fixture";
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
  const [database] = await db.$queryRaw<
    { name: string }[]
  >`SELECT current_database() AS name`;
  assert.equal(
    database.name,
    name,
    "Authorization fixtures must use the newly created disposable database, not the migration-test database",
  );
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
  const staffA = await user("SCHOOL_NUTRITION_OFFICER", {
    schoolId: schoolA.id,
  });
  const staffB = await user("SCHOOL_NUTRITION_OFFICER", {
    schoolId: schoolB.id,
  });
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
  context.mock.method(
    documentStorage,
    "download",
    (document: OnboardingDocument) => testDocumentStorage.download(document),
  );
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
    "four-role delivery inspections isolate two rounds, receive once under concurrency and cancel the remainder after the third rejection",
    async () => {
      const school = await db.school.create({
        data: { name: "Delivery inspection test school" },
      });
      const accounts = await Promise.all(
        [
          "SCHOOL_NUTRITION_OFFICER",
          "SCHOOL_KITCHEN_STAFF",
          "INGREDIENT_MANAGEMENT_DEPARTMENT",
          "PARENTS_COMMITTEE",
        ].map((code) => user(code, { schoolId: school.id })),
      );
      const actors = await Promise.all(
        accounts.map((account) => loadPrincipal(account.id, db)),
      );
      for (const actor of actors)
        assert(actor.permissions.includes("delivery.inspect"));
      const request = await db.supplyRequest.create({
        data: {
          schoolId: school.id,
          supplierId: supplierA.id,
          requestNo: randomUUID(),
          createdByUserId: actors[0].id,
          status: "IN_PROGRESS",
          acceptedByUserId: supplierAdmin.id,
          acceptedAt: new Date(),
          sentAt: new Date(),
        },
      });
      const ingredient = await db.ingredient.create({
        data: {
          supplierId: supplierA.id,
          name: "Inspection rice " + randomUUID(),
          defaultUnit: "kg",
        },
      });
      const entry = await db.ingredientEntry.create({
        data: {
          schoolId: school.id,
          ingredientId: ingredient.id,
          handlingType: "DRY_STOCK",
        },
      });
      const line = await db.supplyRequestItem.create({
        data: {
          supplyRequestId: request.id,
          ingredientEntryId: entry.id,
          requestedQuantity: "12.250",
          unit: "kg",
        },
      });
      const deliveries: {
        id: string;
        item: { id: string };
        lot: { id: string };
      }[] = [];
      for (let index = 0; index < 5; index++) {
        const delivery = await db.delivery.create({
          data: {
            supplyRequestId: request.id,
            supplierId: supplierA.id,
            deliveryNo: randomUUID(),
            status: "ARRIVED",
            arrivedAt: new Date(),
            createdByUserId: supplierAdmin.id,
          },
        });
        const item = await db.deliveryItem.create({
          data: {
            deliveryId: delivery.id,
            supplyRequestItemId: line.id,
            actualQuantity: "6.125",
            unit: "kg",
          },
        });
        const lot = await db.ingredientLot.create({
          data: {
            deliveryItemId: item.id,
            lotCode: randomUUID(),
            receivedQuantity: "6.125",
            availableQuantity: "0",
            unit: "kg",
            status: "BLOCKED",
          },
        });
        deliveries.push({ ...delivery, item, lot });
      }
      const service = createDeliveryInspectionService(() =>
        Promise.resolve(db),
      );
      const approve = validateDeliveryInspectionDecision({
        decision: "APPROVE",
      });
      const reject = validateDeliveryInspectionDecision({
        decision: "REJECT",
        reason: "Packaging rejected by inspection",
      });
      for (const actor of actors.slice(0, 3))
        assert.equal(
          (await service.decide(deliveries[0].id, approve, actor)).status,
          "PENDING_APPROVAL",
        );
      assert.equal(
        await db.inventoryTransaction.count({
          where: { ingredientLotId: deliveries[0].lot.id },
        }),
        0,
      );
      await db.deliveryItem.update({
        where: { id: deliveries[0].item.id },
        data: { actualQuantity: "7" },
      });
      await assert.rejects(
        () => service.decide(deliveries[0].id, approve, actors[3]),
        { statusCode: 409 },
      );
      assert.equal(
        await db.deliveryApproval.count({
          where: { deliveryId: deliveries[0].id },
        }),
        3,
      );
      assert.equal(
        (
          await db.ingredientLot.findUniqueOrThrow({
            where: { id: deliveries[0].lot.id },
          })
        ).availableQuantity.toString(),
        "0",
      );
      await db.deliveryItem.update({
        where: { id: deliveries[0].item.id },
        data: { actualQuantity: "6.125" },
      });
      const results = await Promise.all([
        service.decide(deliveries[0].id, approve, actors[3]),
        service.decide(deliveries[0].id, approve, actors[3]),
      ]);
      assert.equal(results.filter((result) => result.created).length, 1);
      assert.equal(
        await db.inventoryTransaction.count({
          where: {
            ingredientLotId: deliveries[0].lot.id,
            movementType: "RECEIPT",
          },
        }),
        1,
      );
      assert.equal(
        (
          await db.delivery.findUniqueOrThrow({
            where: { id: deliveries[1].id },
          })
        ).status,
        "ARRIVED",
      );
      assert.equal(
        await db.deliveryApproval.count({
          where: { deliveryId: deliveries[1].id },
        }),
        0,
      );
      const outsider = await loadPrincipal(staffB.id, db);
      await assert.rejects(() => service.detail(deliveries[0].id, outsider), {
        statusCode: 404,
      });
      await assert.rejects(
        () => service.decide(deliveries[0].id, reject, actors[3]),
        { statusCode: 409 },
      );
      for (const delivery of deliveries.slice(1, 3)) {
        await service.decide(delivery.id, reject, actors[0]);
        await service.decide(delivery.id, reject, actors[0]);
        assert.equal(
          (
            await db.supplyRequest.findUniqueOrThrow({
              where: { id: request.id },
            })
          ).status,
          "IN_PROGRESS",
        );
      }
      const cancelled = await service.decide(
        deliveries[3].id,
        reject,
        actors[2],
      );
      assert.equal(cancelled.redeliveryRequiredCount, 3);
      assert(cancelled.cancellationNotice);
      assert.equal(
        (
          await db.supplyRequest.findUniqueOrThrow({
            where: { id: request.id },
          })
        ).status,
        "CANCELLED",
      );
      assert.equal(
        (
          await db.delivery.findUniqueOrThrow({
            where: { id: deliveries[4].id },
          })
        ).status,
        "CANCELLED",
      );
      assert.equal(
        (
          await db.delivery.findUniqueOrThrow({
            where: { id: deliveries[0].id },
          })
        ).status,
        "RECEIVED",
      );
      assert.equal(
        (
          await db.ingredientLot.findUniqueOrThrow({
            where: { id: deliveries[0].lot.id },
          })
        ).availableQuantity.toString(),
        "6.125",
      );
      assert.equal(
        await db.inventoryTransaction.count({
          where: { ingredientLotId: deliveries[0].lot.id },
        }),
        1,
      );
      await assert.rejects(
        () => service.decide(deliveries[4].id, approve, actors[1]),
        { statusCode: 409 },
      );
    },
  );
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
      const healthAccount = await user("SCHOOL_NUTRITION_OFFICER", {
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
      const revisionPayload = () =>
        validateMenuWrite({
          weekStartDate: firstDay.menuDate,
          days: completeWeek.menuDays.map((entry) => ({
            menuDate: entry.menuDate.toISOString().slice(0, 10),
            note: entry.id === day.id ? "Updated before approval" : entry.note,
            meals: [
              ...new Set(entry.menuDayDishes.map((dish) => dish.mealType)),
            ].map((mealType) => ({
              mealType,
              dishes: entry.menuDayDishes
                .filter((dish) => dish.mealType === mealType)
                .map((dish) => ({
                  dishId: dish.dishId,
                  ingredients: dish.ingredients.map((line) => ({
                    ingredientId: line.ingredientId,
                    quantityPerPortion: line.quantityPerPortion.toString(),
                    unit: line.unit,
                  })),
                })),
              seasonings: entry.mealSeasonings
                .filter((line) => line.mealType === mealType)
                .map((line) => ({
                  ingredientEntryId: line.ingredientEntryId,
                  quantityPerPortion: line.quantityPerPortion.toString(),
                  unit: line.unit,
                })),
            })),
          })),
        });
      const revisedWeek = await menus.reviseAndSubmit(
        menu.id,
        revisionPayload(),
        health,
      );
      assert.equal(revisedWeek.id, menu.id);
      assert.equal(revisedWeek.status, "PENDING_APPROVAL");
      assert.ok(revisedWeek.submittedAt! > submittedWeek.submittedAt!);
      assert.equal(revisedWeek.menuDays[0].note, "Updated before approval");
      const invalidRevision = revisionPayload();
      invalidRevision.days[0].meals = [];
      await assert.rejects(
        () => menus.reviseAndSubmit(menu.id, invalidRevision, health),
        { statusCode: 422 },
      );
      const afterRejectedRevision = await menus.getOne(menu.id, health);
      assert.equal(afterRejectedRevision.status, "PENDING_APPROVAL");
      assert.equal(
        afterRejectedRevision.submittedAt?.toISOString(),
        revisedWeek.submittedAt?.toISOString(),
      );
      assert.equal(
        afterRejectedRevision.menuDays[0].note,
        "Updated before approval",
      );
      assert.equal(
        afterRejectedRevision.menuDays[0].menuDayDishes.length,
        revisedWeek.menuDays[0].menuDayDishes.length,
      );
      await menus.review(
        menu.id,
        validateMenuReview({ decision: "APPROVED" }),
        reviewer,
      );
      await assert.rejects(
        () => menus.update(menu.id, revisionPayload(), health),
        { statusCode: 409 },
      );
      await assert.rejects(
        () => menus.reviseAndSubmit(menu.id, revisionPayload(), health),
        { statusCode: 409 },
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
      const lunchBatches = plans[0].batches;
      assert.equal(lunchBatches.length, 2);
      assert.equal(
        await db.cookingBatch.count({
          where: { menuDayId: key.menuDayId, mealType: key.mealType },
        }),
        2,
      );
      assert(lunchBatches.every((child) => child.dishes.length === 1));
      const batch = lunchBatches.find((child) =>
        child.dishes.some((d) => d.dishId === mainDish.dishId),
      )!;
      const sideBatch = lunchBatches.find((child) =>
        child.dishes.some((d) => d.dishId === sideDish.dishId),
      )!;
      assert.equal(batch.status, "CONFIRMED");
      assert(batch.confirmedAt);
      assert.equal(batch.plannedPortions, 120);
      assert.equal(
        batch.dishes[0].cookingBatchLots.reduce(
          (n, l) => n + Number(l.quantityUsed),
          0,
        ),
        9.6,
      );
      assert.equal(
        sideBatch.dishes[0].cookingBatchLots.reduce(
          (n, l) => n + Number(l.quantityUsed),
          0,
        ),
        1.2,
      );
      await assert.rejects(
        () => batches.plan({ ...key, mealType: "AFTERNOON" }, chef),
        (e: unknown) => e instanceof HttpError && e.statusCode === 409,
      );
      const side = (
        await batches.plan({ ...key, dishId: sideDish.dishId }, chef)
      ).batches.find((child) =>
        child.dishes.some((d) => d.dishId === sideDish.dishId),
      )!;
      assert.equal(side.id, sideBatch.id);
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
      const completed = await Promise.all([
        batches.complete(batch.id, chef),
        batches.complete(batch.id, chef),
      ]);
      assert(completed.every((c) => c.inventoryDeducted));
      assert(completed.every((c) => !c.mealSeasoningsConsumed));
      assert.equal(
        await db.inventoryTransaction.count({
          where: { referenceType: "COOKING_BATCH", referenceId: batch.id },
        }),
        new Set(
          batch.dishes[0].cookingBatchLots.map((lot) => lot.ingredientLotId),
        ).size,
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
        (await batches.complete(side.id, chef)).mealSeasoningsConsumed,
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
        dishId: mainDish.dishId,
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
      assert.deepEqual(
        (await samples.forBatch(batch.id, chef)).map((sample) => sample.dishId),
        [mainDish.dishId],
      );
      assert.deepEqual(await samples.forBatch(side.id, chef), []);
      assert.equal(
        Date.parse(saved.expiresAt) - Date.parse(saved.sampledAt),
        86400000,
      );
      const disposal = validateSampleDisposal({
        disposedAt: new Date(Date.now() + 86400000).toISOString(),
        disposalNote: "Future date must not bypass retention",
      });
      await assert.rejects(
        () => samples.dispose(saved.id, disposal, chef),
        (e: unknown) => e instanceof HttpError && e.statusCode === 422,
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
      await db.classHomeroomAssignment.create({
        data: {
          classId: grClass.id,
          teacherUserId: teacher.id,
          assignedByUserId: health.id,
        },
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
      const organizations = createOrganizationService(undefined, () =>
        Promise.resolve(db),
      );
      await assert.rejects(
        organizations.updateCookingMode(
          { cookingMode: "SEPARATE_BY_LOT" },
          chef,
        ),
        (error: unknown) =>
          error instanceof HttpError && error.statusCode === 403,
      );
      assert.deepEqual(
        await organizations.updateCookingMode(
          { cookingMode: "SEPARATE_BY_LOT" },
          reviewer,
        ),
        { cookingMode: "SEPARATE_BY_LOT" },
      );
      assert.deepEqual(await organizations.getCookingMode(reviewer), {
        cookingMode: "SEPARATE_BY_LOT",
      });
      const grPlan = await batches.plan({ ...grKey, dishId: grCommon }, chef);
      assert.deepEqual(
        grPlan.batches.map((b) => b.plannedPortions).sort((a, b) => a! - b!),
        [13, 45, 75, 107],
      );
      assert(grPlan.batches.every((batch) => batch.dishes.length === 1));
      const grPlannedFor = (dishId: string) =>
        grPlan.batches
          .flatMap((batch) => batch.dishes)
          .filter((dish) => dish.dishId === dishId)
          .reduce((n, dish) => n + dish.plannedPortions!, 0);
      assert.equal(grPlannedFor(grCommon), 120);
      assert.equal(grPlannedFor(grRegular), 107);
      assert.equal(grPlannedFor(grAlt), 13);
      const grFirst = grPlan.batches[0];
      assert.equal("update" in batches, false);
      assert(grPlan.batches.every((batch) => batch.status === "CONFIRMED"));
      await assert.rejects(
        () => batches.remove(grFirst.id, chef),
        (error: unknown) =>
          error instanceof HttpError && error.statusCode === 409,
      );
      const repeatedPlan = await batches.plan(
        { ...grKey, dishId: grCommon },
        chef,
      );
      assert.equal(repeatedPlan.created, false);
      assert.deepEqual(
        repeatedPlan.batches.map((batch) => batch.id).sort(),
        grPlan.batches.map((batch) => batch.id).sort(),
      );
      assert.equal(
        grPlan.batches.reduce((n, b) => n + b.plannedPortions!, 0),
        // Portions are counted per dish: 120 common + 107 regular + 13 alternative.
        240,
      );
      await batches.confirm(grPlan.batches[0].id, chef);
      await assert.rejects(
        () => batches.remove(grPlan.batches[0].id, chef),
        (e: unknown) => e instanceof HttpError && e.statusCode === 409,
      );
      const grNormal = (
          await batches.plan({ ...grKey, dishId: grRegular }, chef)
        ).batches,
        grAlternative = (await batches.plan({ ...grKey, dishId: grAlt }, chef))
          .batches;
      assert.equal(
        grNormal
          .flatMap((b) => b.dishes)
          .filter((d) => d.dishId === grRegular)
          .reduce((n, d) => n + d.plannedPortions!, 0),
        107,
      );
      assert.equal(
        grAlternative
          .flatMap((b) => b.dishes)
          .filter((d) => d.dishId === grAlt)
          .reduce((n, d) => n + d.plannedPortions!, 0),
        13,
      );
      const grAll = grPlan.batches;
      for (const grBatch of grAll) await batches.confirm(grBatch.id, chef);
      for (const [index, grBatch] of grAll.entries()) {
        const grComplete = await batches.complete(grBatch.id, chef);
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
      const groupAllocation = createMealAllocationService(
        () => Promise.resolve(db),
        () => new Date("2032-01-05T03:00:00Z"),
      );
      assert.equal((await groupAllocation.getToday(chef)).status, "RECONCILE");

      const allocationService = createMealAllocationService(
        () => Promise.resolve(db),
        allocationFixtureClock,
      );
      const seed = (state: "cooking" | "samples" | "ready") =>
        loadAllocationFixture(db, school.id, chef.id, teacher.id, state);
      const {
        batchIds: [a, b],
        demandIds: [classA, classB, classC],
      } = await seed("cooking");
      assert.equal(
        (await allocationService.getToday(chef)).status,
        "COOKING_PENDING",
      );
      await seed("samples");
      const sampleGate = await allocationService.getToday(chef);
      assert.equal(sampleGate.status, "SAMPLES_PENDING");
      assert.equal(sampleGate.totals.sampled, 60);
      assert.equal(sampleGate.missingSampleBatches, 1);
      await seed("ready");
      const ready = await allocationService.getToday(chef);
      assert.equal(ready.status, "READY");
      assert.equal(ready.totals.sampled, 100);
      const payload = {
        revision: ready.revision,
        batches: [
          {
            cookingBatchId: a,
            entries: [
              { dailyMealPortionId: classA, allocatedPortions: 40 },
              { dailyMealPortionId: classB, allocatedPortions: 20 },
            ],
          },
          {
            cookingBatchId: b,
            entries: [
              { dailyMealPortionId: classB, allocatedPortions: 15 },
              { dailyMealPortionId: classC, allocatedPortions: 25 },
            ],
          },
        ],
      };
      const otherKitchen = await user("SCHOOL_KITCHEN_STAFF", {
        schoolId: schoolB.id,
      });
      const otherChef = await loadPrincipal(otherKitchen.id, db);
      assert.equal(
        (await allocationService.getToday(otherChef)).status,
        "EMPTY",
      );
      await assert.rejects(() => allocationService.apply(payload, otherChef), {
        statusCode: 409,
      });
      const invalid = structuredClone(payload);
      invalid.batches[1].entries[0].allocatedPortions += 1;
      await assert.rejects(() => allocationService.apply(invalid, chef), {
        statusCode: 409,
      });
      assert.equal(
        await db.mealAllocationBatch.count({
          where: { cookingBatchId: { in: [a, b] } },
        }),
        0,
      );
      const race = await Promise.allSettled([
        allocationService.apply(payload, chef),
        allocationService.apply(payload, chef),
      ]);
      assert.equal(
        race.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assert.equal(
        race.filter(
          (result) =>
            result.status === "rejected" &&
            result.reason instanceof HttpError &&
            result.reason.statusCode === 409,
        ).length,
        1,
      );
      const savedAllocation = await allocationService.getToday(chef);
      assert.equal(
        savedAllocation.batches
          .find((batch) => batch.id === a)
          ?.entries.reduce((sum, entry) => sum + entry.allocatedPortions, 0),
        60,
      );
      assert.equal(
        await db.mealAllocationBatch.count({
          where: { cookingBatchId: { in: [a, b] } },
        }),
        8,
      );
      const revisedBatches = structuredClone(payload.batches);
      revisedBatches[0].entries[1].allocatedPortions = 10;
      const revised = await allocationService.apply(
        { revision: savedAllocation.revision, batches: revisedBatches },
        chef,
      );
      const revisedRows = await db.mealAllocationBatch.findMany({
        where: {
          cookingBatchId: a,
          MealAllocation: { dailyMealPortionId: classB },
        },
        select: { allocatedPortions: true },
      });
      assert.deepEqual(
        revisedRows.map((row) => row.allocatedPortions),
        [10, 10],
      );
      assert.equal(
        revised.batches
          .find((batch) => batch.id === b)
          ?.entries.find((entry) => entry.dailyMealPortionId === classB)
          ?.allocatedPortions,
        15,
      );
      const cleared = await allocationService.apply(
        {
          revision: revised.revision,
          batches: payload.batches.map((batch) => ({ ...batch, entries: [] })),
        },
        chef,
      );
      assert.equal(cleared.batches.flatMap((batch) => batch.entries).length, 0);
      const restored = await allocationService.apply(
        { revision: cleared.revision, batches: payload.batches },
        chef,
      );
      assert.equal(
        restored.batches.flatMap((batch) => batch.entries).length,
        4,
      );
      const confirmation = { revision: restored.revision };
      await assert.rejects(
        () => allocationService.confirmDistribution(confirmation, otherChef),
        { statusCode: 409 },
      );
      await assert.rejects(
        () =>
          allocationService.confirmDistribution(confirmation, {
            ...chef,
            permissions: [],
          }),
        { statusCode: 403 },
      );
      await assert.rejects(
        () =>
          allocationService.confirmDistribution(confirmation, {
            ...chef,
            role: "HOMEROOM_TEACHER",
          }),
        { statusCode: 403 },
      );
      const distributionRace = await Promise.allSettled([
        allocationService.confirmDistribution(confirmation, chef),
        allocationService.apply(
          { ...confirmation, batches: revisedBatches },
          chef,
        ),
      ]);
      assert.equal(
        distributionRace.filter((result) => result.status === "fulfilled")
          .length,
        1,
      );
      const current = await allocationService.getToday(chef);
      if (current.distribution.status === "PENDING") {
        await assert.rejects(
          () =>
            allocationService.confirmDistribution(
              { revision: current.revision },
              chef,
            ),
          { statusCode: 409 },
        );
        const complete = await allocationService.apply(
          { revision: current.revision, batches: payload.batches },
          chef,
        );
        await allocationService.confirmDistribution(
          { revision: complete.revision },
          chef,
        );
      }
      const repeated = await allocationService.confirmDistribution(
        confirmation,
        chef,
      );
      assert.equal(repeated.distribution.status, "DISTRIBUTED");
      assert.ok(repeated.demands.every((demand) => demand.locked));
      const delivered = await db.mealAllocation.findMany({
        where: { dailyMealPortionId: { in: [classA, classB, classC] } },
      });
      assert.equal(delivered.length, 3);
      for (const allocation of delivered) {
        assert.equal(allocation.status, "DISTRIBUTED");
        assert.equal(allocation.distributedByUserId, chef.id);
        assert.deepEqual(allocation.distributedAt, allocationFixtureClock());
      }
      const nextDay = createMealAllocationService(
        () => Promise.resolve(db),
        () => new Date("2026-11-12T17:00:00Z"),
      );
      assert.equal((await nextDay.getToday(chef)).date, "2026-11-13");
      await assert.rejects(
        () => nextDay.confirmDistribution(confirmation, chef),
        { statusCode: 409 },
      );

      const feedback = createFeedbackService(
        undefined,
        () => Promise.resolve(db),
        allocationFixtureClock,
      );
      const parentAccount = await user("PARENTS_COMMITTEE", {
        schoolId: school.id,
      });
      const parent = await loadPrincipal(parentAccount.id, db);
      const parentOptions = await feedback.mealOptions(parent);
      assert.equal(parentOptions.mealDate, "2026-11-12");
      assert.ok(
        parentOptions.classes.some(
          (entry) =>
            entry.lunch?.dailyMealPortionId === classB &&
            entry.lunch.canComplain,
        ),
      );
      await assert.rejects(() => feedback.mealOptions(teacherPrincipal), {
        statusCode: 404,
      });
      const portion = await db.dailyMealPortion.findUniqueOrThrow({
        where: { id: classA },
        select: { classId: true },
      });
      await db.classHomeroomAssignment.create({
        data: {
          classId: portion.classId,
          teacherUserId: teacher.id,
          assignedByUserId: chef.id,
          assignedAt: new Date("2026-11-01T00:00:00Z"),
        },
      });
      assert.equal(
        (await feedback.mealOptions(teacherPrincipal)).classes.length,
        1,
      );
      const input = {
        dailyMealPortionId: classB,
        complaintType: "OTHER" as const,
        description: "Bữa ăn cần được kiểm tra.",
      };
      await assert.rejects(() => feedback.create(input, teacherPrincipal), {
        statusCode: 404,
      });
      await assert.rejects(() => feedback.create(input, chef), {
        statusCode: 403,
      });
      const sent = await feedback.create(input, parent);
      assert.equal(sent.status, "SUBMITTED");
      assert.equal(sent.meal.dailyMealPortionId, classB);
      const teacherSent = await feedback.create(
        { ...input, dailyMealPortionId: classA },
        teacherPrincipal,
      );
      assert.deepEqual(
        (await feedback.getAll({ page: 1, limit: 10 }, parent)).items.map(
          (item) => item.id,
        ),
        [sent.id],
      );
      await assert.rejects(() => feedback.getOne(teacherSent.id, parent), {
        statusCode: 404,
      });
      const boardAccount = await user("SCHOOL_MANAGEMENT_BOARD", {
        schoolId: school.id,
      });
      const board = await loadPrincipal(boardAccount.id, db);
      await feedback.respond(
        sent.id,
        { action: "RESOLVE", resolution: "Nhà trường đã kiểm tra suất ăn." },
        board,
      );
      assert.equal((await feedback.getOne(sent.id, parent)).status, "RESOLVED");
      const afterMidnight = createFeedbackService(
        undefined,
        () => Promise.resolve(db),
        () => new Date("2026-11-12T17:00:00Z"),
      );
      await assert.rejects(() => afterMidnight.create(input, parent), {
        statusCode: 404,
      });
      assert.equal(
        (await afterMidnight.getOne(sent.id, parent)).status,
        "RESOLVED",
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
      const account = await user("SCHOOL_NUTRITION_OFFICER", {
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
      const account = await user("SCHOOL_NUTRITION_OFFICER", {
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
      const account = await user("SCHOOL_NUTRITION_OFFICER", {
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
      const account = await user("SCHOOL_NUTRITION_OFFICER", {
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

  await context.test(
    "school grades are isolated and can be detached from historical classes",
    async () => {
      const route = "/api/school-grades";
      const board = await user("SCHOOL_MANAGEMENT_BOARD", {
        schoolId: schoolA.id,
      });
      const otherBoard = await user("SCHOOL_MANAGEMENT_BOARD", {
        schoolId: schoolB.id,
      });
      for (const account of [board, otherBoard]) {
        const session = await authSessions.issue(account.id);
        issued.set(account.id, session);
        refreshTokens.push(session.refreshToken);
      }
      assert.equal((await request(route, system.id)).status, 403);
      assert.equal((await request(route, adminA.id)).status, 403);
      const data = { name: "  Khối 5  " };
      const response = await request(route, board.id, "POST", data);
      assert.equal(response.status, 201);
      const grade = record(record(response.body).data);
      assert(typeof grade.id === "string");
      assert.equal(grade.name, "Khối 5");
      assert.equal("code" in grade, false);
      assert.equal((await request(route, board.id, "POST", data)).status, 409);
      assert.equal(
        (await request(route, otherBoard.id, "POST", data)).status,
        201,
      );
      const url = `${route}/${grade.id}`;
      assert.equal(
        (await request(url, otherBoard.id, "PATCH", { name: "Khối khác" }))
          .status,
        404,
      );
      assert.equal(
        (await request(url, board.id, "PATCH", { name: "Khối năm" })).status,
        200,
      );
      const classroom = await db.class.create({
        data: {
          schoolId: schoolA.id,
          name: "Lớp cũ",
          academicYear: "2000-2001",
          gradeId: grade.id,
        },
      });
      assert.equal((await request(url, board.id, "DELETE")).status, 409);
      assert.equal(
        (
          await request(
            `/api/classes/${classroom.id}`,
            otherBoard.id,
            "PATCH",
            { gradeId: null },
          )
        ).status,
        404,
      );
      const filtered = await request(
        `/api/classes?gradeId=${grade.id}`,
        board.id,
      );
      assert.equal(filtered.status, 200);
      assert.deepEqual(
        rows(filtered.body).map((item) => item.id),
        [classroom.id],
      );
      assert.equal(
        (
          await request(`/api/classes/${classroom.id}`, board.id, "PATCH", {
            gradeId: null,
          })
        ).status,
        200,
      );
      assert.equal((await request(url, board.id, "DELETE")).status, 200);
    },
  );

  async function sourceFacilityOwner(label: string) {
    const supplier = await db.supplier.create({ data: { name: label } });
    const account = await user("INGREDIENT_SUPPLIER_ADMIN", {
      supplierId: supplier.id,
    });
    const session = await authSessions.issue(account.id);
    issued.set(account.id, session);
    refreshTokens.push(session.refreshToken);
    return {
      supplier,
      account,
      principal: await loadPrincipal(account.id, db),
    };
  }
  const sourceFacilityStatus = (status: number) => (error: unknown) =>
    error instanceof HttpError && error.statusCode === status;

  await context.test(
    "source facility creation uses separate supplier codes and safe input",
    async () => {
      const base = "/api/source-facilities";
      const first = await request(base, supplierAdmin.id, "POST", {
        name: "SF first",
      });
      assert.equal(first.status, 201, JSON.stringify(first.body));
      const item = record(record(first.body).data);
      assert.equal(item.facilityCode, "FP-SF-00001");
      assert.equal(item.supplierId, supplierA.id);
      assert.equal(item.address, null);
      assert.equal(item.contactEmail, null);
      assert.equal(item.status, "ACTIVE");
      assert.equal(item.isVisible, true);
      assert.equal("createdByUserId" in item, false);
      const saved = await db.sourceFacility.findUniqueOrThrow({
        where: { id: String(item.id) },
      });
      assert.equal(saved.createdByUserId, supplierAdmin.id);
      assert.equal(saved.updatedByUserId, supplierAdmin.id);
      const second = await request(base, supplierAdmin.id, "POST", {
        name: "SF second",
      });
      assert.equal(second.status, 201);
      assert.equal(
        record(record(second.body).data).facilityCode,
        "FP-SF-00002",
      );
      const codeSupplierB = await db.supplier.create({
        data: { name: "SF first code B" },
      });
      const administratorB = await user("INGREDIENT_SUPPLIER_ADMIN", {
        supplierId: codeSupplierB.id,
      });
      const sessionB = await authSessions.issue(administratorB.id);
      issued.set(administratorB.id, sessionB);
      refreshTokens.push(sessionB.refreshToken);
      const other = await request(base, administratorB.id, "POST", {
        name: "SF first",
      });
      assert.equal(other.status, 201);
      assert.equal(record(record(other.body).data).facilityCode, "FP-SF-00001");
      assert.equal(
        (await request(base, supplierAdmin.id, "POST", { name: "SF first" }))
          .status,
        409,
      );
      for (const value of [null, "", "FP-SF-00003"])
        assert.equal(
          (
            await request(base, supplierAdmin.id, "POST", {
              name: "Cannot set code",
              facilityCode: value,
            })
          ).status,
          400,
        );
    },
  );

  await context.test(
    "source facility concurrent creates retry whole snapshots and rollback writes",
    async () => {
      const owner = await sourceFacilityOwner("SF concurrent supplier");
      const repository = createSourceFacilityRepository(() =>
        Promise.resolve(db),
      );
      const barrier = createBarrier(2);
      const metrics = [{ attempts: 0 }, { attempts: 0 }];
      const services = metrics.map((metric) =>
        createSourceFacilityService(
          {
            ...repository,
            async actor(id, tx) {
              const actor = await repository.actor(id, tx);
              metric.attempts += 1;
              // The actor read establishes each Serializable snapshot before locking.
              if (metric.attempts === 1) await barrier.wait();
              return actor;
            },
          },
          () => Promise.resolve(db),
        ),
      );
      const created = await Promise.all(
        services.map((service, index) =>
          service.create(
            validateSourceFacilityCreate({ name: "Concurrent " + index }),
            owner.principal,
          ),
        ),
      );
      assert.deepEqual(created.map((row) => row.facilityCode).sort(), [
        "FP-SF-00001",
        "FP-SF-00002",
      ]);
      assert(
        metrics[0].attempts + metrics[1].attempts >= 3,
        "A stale snapshot must retry the entire transaction",
      );
      assert.equal(
        await db.sourceFacility.count({
          where: { supplierId: owner.supplier.id },
        }),
        2,
      );

      const sameName = await Promise.all([
        request("/api/source-facilities", owner.account.id, "POST", {
          name: "Concurrent duplicate",
        }),
        request("/api/source-facilities", owner.account.id, "POST", {
          name: "Concurrent duplicate",
        }),
      ]);
      assert.deepEqual(
        sameName.map((response) => response.status).sort(),
        [201, 409],
      );

      const countBeforeRollback = await db.sourceFacility.count({
        where: { supplierId: owner.supplier.id },
      });
      const failed = createSourceFacilityService(
        {
          ...repository,
          async create(...args) {
            await repository.create(...args);
            throw new HttpError(
              503,
              "Forced error after insert in disposable test",
            );
          },
        },
        () => Promise.resolve(db),
      );
      await assert.rejects(
        () =>
          failed.create(
            validateSourceFacilityCreate({ name: "Rolled back source" }),
            owner.principal,
          ),
        sourceFacilityStatus(503),
      );
      assert.equal(
        await db.sourceFacility.count({
          where: { supplierId: owner.supplier.id },
        }),
        countBeforeRollback,
      );
      const restarted = createSourceFacilityService(repository, () =>
        Promise.resolve(db),
      );
      const afterRollback = await restarted.create(
        validateSourceFacilityCreate({ name: "After rollback" }),
        owner.principal,
      );
      assert.equal(afterRollback.facilityCode, "FP-SF-00004");

      let allocationAttempts = 0;
      const exhausted = createSourceFacilityService(
        {
          ...repository,
          highestCodeNumber() {
            allocationAttempts += 1;
            return Promise.resolve(0n);
          },
        },
        () => Promise.resolve(db),
      );
      await assert.rejects(
        () =>
          exhausted.create(
            validateSourceFacilityCreate({ name: "Exhausted code conflict" }),
            owner.principal,
          ),
        sourceFacilityStatus(503),
      );
      assert.equal(allocationAttempts, 3);
      assert.equal(
        await db.sourceFacility.count({
          where: {
            supplierId: owner.supplier.id,
            name: "Exhausted code conflict",
          },
        }),
        0,
      );

      const independent = await sourceFacilityOwner(
        "SF independent supplier lock",
      );
      let release!: () => void;
      let locked!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const holding = db.$transaction(
        async (tx) => {
          await repository.lockSupplier({ supplierId: owner.supplier.id }, tx);
          locked();
          await held;
        },
        { timeout: 10000 },
      );
      await ready;
      try {
        const result = await restarted.create(
          validateSourceFacilityCreate({ name: "Independent while A locked" }),
          independent.principal,
        );
        assert.equal(result.facilityCode, "FP-SF-00001");
      } finally {
        release();
        await holding;
      }
    },
  );

  await context.test(
    "source facility numbering preserves legacy and exact large values",
    async () => {
      const owner = await sourceFacilityOwner("SF legacy supplier");
      const legacy = await Promise.all(
        [
          null,
          "legacy-code",
          "fp-sf-88888",
          "FP-SF-000001",
          "FP-SF-00000",
          "FP-SF-99999\n",
        ].map((facilityCode, index) =>
          db.sourceFacility.create({
            data: {
              supplierId: owner.supplier.id,
              facilityCode,
              name: "Legacy source " + index,
            },
          }),
        ),
      );
      const create = (name: string) =>
        sourceFacilityService.create(
          validateSourceFacilityCreate({ name }),
          owner.principal,
        );
      assert.equal(
        (await create("First canonical source")).facilityCode,
        "FP-SF-00001",
      );
      await db.sourceFacility.create({
        data: {
          supplierId: owner.supplier.id,
          name: "Stopped highest",
          facilityCode: "FP-SF-00009",
          status: "INACTIVE",
          isVisible: false,
        },
      });
      assert.equal(
        (await create("After stopped source")).facilityCode,
        "FP-SF-00010",
      );
      await db.sourceFacility.create({
        data: {
          supplierId: owner.supplier.id,
          name: "Last five digits",
          facilityCode: "FP-SF-99999",
        },
      });
      assert.equal(
        (await create("First six digits")).facilityCode,
        "FP-SF-100000",
      );
      const large = 18_446_744_073_709_551_616n;
      await db.sourceFacility.create({
        data: {
          supplierId: owner.supplier.id,
          name: "Beyond 64-bit",
          facilityCode: "FP-SF-" + large.toString(),
        },
      });
      assert.equal(
        (await create("Exact beyond 64-bit")).facilityCode,
        "FP-SF-" + (large + 1n).toString(),
      );
      await db.sourceFacility.create({
        data: {
          supplierId: owner.supplier.id,
          name: "Storage maximum",
          facilityCode: "FP-SF-" + "9".repeat(74),
        },
      });
      const countBefore = await db.sourceFacility.count({
        where: { supplierId: owner.supplier.id },
      });
      await assert.rejects(
        () => create("Storage exhausted"),
        sourceFacilityStatus(503),
      );
      assert.equal(
        await db.sourceFacility.count({
          where: { supplierId: owner.supplier.id },
        }),
        countBefore,
      );
      for (const before of legacy) {
        assert.deepEqual(
          await db.sourceFacility.findUniqueOrThrow({
            where: { id: before.id },
          }),
          before,
        );
      }
    },
  );

  await context.test(
    "source facility management isolates reads, updates and historical deactivation",
    async () => {
      const base = "/api/source-facilities";
      const owner = await sourceFacilityOwner("SF management supplier");
      const other = await sourceFacilityOwner("SF management other supplier");
      await db.sourceFacility.createMany({
        data: Array.from({ length: 45 }, (_, index) => ({
          supplierId: owner.supplier.id,
          facilityCode: "FP-SF-" + String(index + 1).padStart(5, "0"),
          name: "Paged facility " + index,
          status: index % 2 === 0 ? ("INACTIVE" as const) : ("ACTIVE" as const),
          isVisible: index % 3 !== 0,
          createdByUserId: owner.account.id,
          updatedByUserId: owner.account.id,
        })),
      });
      const foreign = await db.sourceFacility.create({
        data: {
          supplierId: other.supplier.id,
          facilityCode: "FP-SF-00001",
          name: "Foreign source",
        },
      });
      const all = await db.sourceFacility.findMany({
        where: { supplierId: owner.supplier.id },
        orderBy: { id: "asc" },
      });
      const active = all.find((row) => row.status === "ACTIVE");
      const inactive = all.find((row) => row.status === "INACTIVE");
      assert(active && inactive);
      const listed: Record<string, unknown>[] = [];
      for (const [page, expected] of [
        [1, 20],
        [2, 20],
        [3, 5],
      ]) {
        const response = await request(
          base + "?page=" + page,
          owner.account.id,
        );
        assert.equal(response.status, 200, JSON.stringify(response.body));
        const items = rows(response.body);
        assert.equal(items.length, expected);
        assert.equal(
          record(record(record(response.body).data).pagination).hasNext,
          page < 3,
        );
        assert(items.every((row) => row.supplierId === owner.supplier.id));
        assert(
          items.every(
            (row) => !("address" in row) && !("createdByUserId" in row),
          ),
        );
        listed.push(...items);
      }
      assert.deepEqual(
        listed.map((row) => row.id),
        all.map((row) => row.id),
      );
      assert(listed.some((row) => row.status === "INACTIVE"));
      assert(listed.some((row) => row.isVisible === false));
      const empty = await request(base + "?page=4", owner.account.id);
      assert.deepEqual(rows(empty.body), []);
      assert.equal(
        record(record(record(empty.body).data).pagination).hasNext,
        false,
      );
      const detail = await request(base + "/" + active.id, owner.account.id);
      assert.equal(detail.status, 200);
      const detailData = record(record(detail.body).data);
      assert.equal(detailData.address, null);
      assert.equal(detailData.createdAt, active.createdAt.toISOString());
      assert.equal("createdByUserId" in detailData, false);
      assert.equal("Supplier" in detailData, false);
      assert.equal(
        (await request(base + "/FP-SF-00001", owner.account.id)).status,
        400,
      );
      assert.equal(
        (
          await request(
            base + "?supplierId=" + other.supplier.id,
            owner.account.id,
          )
        ).status,
        400,
      );
      for (const [method, suffix, body] of [
        ["GET", "", undefined],
        ["PATCH", "", { name: "Out of scope" }],
        ["POST", "/deactivate", {}],
      ] as const) {
        const outside = await request(
          base + "/" + foreign.id + suffix,
          owner.account.id,
          method,
          body,
        );
        const missing = await request(
          base + "/" + randomUUID() + suffix,
          owner.account.id,
          method,
          body,
        );
        assert.equal(outside.status, 404);
        assert.equal(missing.status, 404);
        assert.equal(
          record(outside.body).message,
          record(missing.body).message,
        );
      }

      const manage = await permission("source_facility.manage");
      const temporaryGrants: { roleId: string; permissionId: string }[] = [];
      for (const account of [supplierStaffA, system]) {
        const key = { roleId: account.roleId, permissionId: manage.id };
        if (
          !(await db.rolePermission.findUnique({
            where: { roleId_permissionId: key },
          }))
        ) {
          await db.rolePermission.create({ data: key });
          temporaryGrants.push(key);
        }
      }
      const operations = [
        ["GET", "", undefined],
        ["GET", "/" + active.id, undefined],
        ["POST", "", { name: "Blocked source" }],
        ["PATCH", "/" + active.id, { address: "Blocked" }],
        ["POST", "/" + active.id + "/deactivate", {}],
      ] as const;
      try {
        for (const account of [supplierStaffA, system, adminA]) {
          for (const [method, suffix, body] of operations) {
            assert.equal(
              (await request(base + suffix, account.id, method, body)).status,
              403,
            );
          }
        }
      } finally {
        for (const key of temporaryGrants)
          await db.rolePermission.delete({
            where: { roleId_permissionId: key },
          });
      }

      const stale = owner.principal;
      const denial = await db.userPermissionDenial.create({
        data: {
          userId: owner.account.id,
          permissionId: manage.id,
          supplierId: owner.supplier.id,
          disabledByUserId: system.id,
        },
      });
      try {
        for (const [method, suffix, body] of operations)
          assert.equal(
            (await request(base + suffix, owner.account.id, method, body))
              .status,
            403,
          );
        await assert.rejects(
          () =>
            sourceFacilityService.create(
              validateSourceFacilityCreate({ name: "Denied stale source" }),
              stale,
            ),
          sourceFacilityStatus(403),
        );
        await assert.rejects(
          () =>
            sourceFacilityService.update(
              { sourceFacilityId: active.id },
              { address: "Denied stale source" },
              stale,
            ),
          sourceFacilityStatus(403),
        );
        await assert.rejects(
          () =>
            sourceFacilityService.deactivate(
              { sourceFacilityId: active.id },
              {},
              stale,
            ),
          sourceFacilityStatus(403),
        );
      } finally {
        await db.userPermissionDenial.delete({ where: { id: denial.id } });
      }
      await db.user.update({
        where: { id: owner.account.id },
        data: { status: "LOCKED" },
      });
      try {
        await assert.rejects(
          () =>
            sourceFacilityService.create(
              validateSourceFacilityCreate({ name: "Locked stale source" }),
              stale,
            ),
          sourceFacilityStatus(403),
        );
      } finally {
        await db.user.update({
          where: { id: owner.account.id },
          data: { status: "ACTIVE" },
        });
      }
      const movedTo = await db.supplier.create({
        data: { name: "SF actor move target" },
      });
      await db.user.update({
        where: { id: owner.account.id },
        data: { supplierId: movedTo.id },
      });
      try {
        await assert.rejects(
          () =>
            sourceFacilityService.create(
              validateSourceFacilityCreate({ name: "Moved stale source" }),
              stale,
            ),
          sourceFacilityStatus(403),
        );
      } finally {
        await db.user.update({
          where: { id: owner.account.id },
          data: { supplierId: owner.supplier.id },
        });
      }
      await db.supplier.update({
        where: { id: owner.supplier.id },
        data: { status: "INACTIVE" },
      });
      try {
        for (const [method, suffix, body] of operations)
          assert.equal(
            (await request(base + suffix, owner.account.id, method, body))
              .status,
            403,
          );
      } finally {
        await db.supplier.update({
          where: { id: owner.supplier.id },
          data: { status: "ACTIVE" },
        });
      }

      const patch = await request(
        base + "/" + active.id,
        owner.account.id,
        "PATCH",
        { address: "  Updated source address  ", contactEmail: "" },
      );
      assert.equal(patch.status, 200, JSON.stringify(patch.body));
      const patched = await db.sourceFacility.findUniqueOrThrow({
        where: { id: active.id },
      });
      assert.equal(patched.address, "Updated source address");
      assert.equal(patched.contactEmail, null);
      assert.equal(patched.name, active.name);
      assert.equal(patched.facilityCode, active.facilityCode);
      assert.equal(patched.createdByUserId, active.createdByUserId);
      assert.equal(
        patched.createdAt.toISOString(),
        active.createdAt.toISOString(),
      );
      assert.equal(patched.updatedByUserId, owner.account.id);
      for (const code of [null, "", active.facilityCode])
        assert.equal(
          (
            await request(base + "/" + active.id, owner.account.id, "PATCH", {
              facilityCode: code,
            })
          ).status,
          400,
        );
      assert.equal(
        (await request(base + "/" + active.id, owner.account.id, "PATCH", {}))
          .status,
        400,
      );
      assert.equal(
        (
          await request(base + "/" + active.id, owner.account.id, "PATCH", {
            name: inactive.name,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await request(base + "/" + inactive.id, owner.account.id, "PATCH", {
            address: "Inactive can edit",
          })
        ).status,
        200,
      );
      const stillInactive = await db.sourceFacility.findUniqueOrThrow({
        where: { id: inactive.id },
      });
      assert.equal(stillInactive.status, "INACTIVE");
      assert.equal(stillInactive.facilityCode, inactive.facilityCode);
      const renameResults = await Promise.all([
        request(base + "/" + active.id, owner.account.id, "PATCH", {
          name: "Same renamed source",
        }),
        request(base + "/" + inactive.id, owner.account.id, "PATCH", {
          name: "Same renamed source",
        }),
      ]);
      assert.deepEqual(
        renameResults.map((response) => response.status).sort(),
        [200, 409],
      );

      const historySchool = await db.school.create({
        data: { name: "SF history school" },
      });
      const historyAdmin = await user("SCHOOL_ADMINISTRATION", {
        schoolId: historySchool.id,
      });
      const historyIngredient = await db.ingredient.create({
        data: {
          supplierId: owner.supplier.id,
          name: "SF history ingredient",
          defaultUnit: "kg",
        },
      });
      const historyEntry = await db.ingredientEntry.create({
        data: {
          schoolId: historySchool.id,
          ingredientId: historyIngredient.id,
          handlingType: "DRY_STOCK",
        },
      });
      const historyRequest = await db.supplyRequest.create({
        data: {
          schoolId: historySchool.id,
          supplierId: owner.supplier.id,
          requestNo: randomUUID(),
          createdByUserId: historyAdmin.id,
          status: "IN_PROGRESS",
          sentAt: new Date(),
          acceptedByUserId: owner.account.id,
          acceptedAt: new Date(),
        },
      });
      const historyLine = await db.supplyRequestItem.create({
        data: {
          supplyRequestId: historyRequest.id,
          ingredientEntryId: historyEntry.id,
          requestedQuantity: "1",
          unit: "kg",
        },
      });
      const historyDelivery = await db.delivery.create({
        data: {
          supplyRequestId: historyRequest.id,
          supplierId: owner.supplier.id,
          deliveryNo: randomUUID(),
          status: "ARRIVED",
          arrivedAt: new Date(),
          createdByUserId: owner.account.id,
        },
      });
      const historyItem = await db.deliveryItem.create({
        data: {
          deliveryId: historyDelivery.id,
          supplyRequestItemId: historyLine.id,
          actualQuantity: "1",
          unit: "kg",
        },
      });
      const lot = await db.ingredientLot.create({
        data: {
          deliveryItemId: historyItem.id,
          sourceFacilityId: active.id,
          lotCode: randomUUID(),
          receivedQuantity: "1",
          availableQuantity: "0",
          unit: "kg",
          status: "BLOCKED",
        },
      });
      const stopped = await request(
        base + "/" + active.id + "/deactivate",
        owner.account.id,
        "POST",
        {},
      );
      assert.equal(stopped.status, 200, JSON.stringify(stopped.body));
      assert.equal(record(record(stopped.body).data).status, "INACTIVE");
      const stoppedRow = await db.sourceFacility.findUniqueOrThrow({
        where: { id: active.id },
      });
      assert.equal(stoppedRow.facilityCode, active.facilityCode);
      assert.equal(stoppedRow.isVisible, active.isVisible);
      assert.equal(
        stoppedRow.createdAt.toISOString(),
        active.createdAt.toISOString(),
      );
      assert.equal(stoppedRow.createdByUserId, active.createdByUserId);
      assert.equal(stoppedRow.updatedByUserId, owner.account.id);
      assert.deepEqual(
        await db.ingredientLot.findUniqueOrThrow({ where: { id: lot.id } }),
        lot,
      );
      const again = await request(
        base + "/" + active.id + "/deactivate",
        owner.account.id,
        "POST",
      );
      assert.equal(again.status, 200);
      assert.deepEqual(
        await db.sourceFacility.findUniqueOrThrow({ where: { id: active.id } }),
        stoppedRow,
      );
      assert.equal(
        (await request(base + "/" + active.id, owner.account.id)).status,
        200,
      );
      assert.equal(
        (
          await request(base + "/" + active.id, owner.account.id, "PATCH", {
            address: "Editable after stop",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await db.sourceFacility.findUniqueOrThrow({
            where: { id: active.id },
          })
        ).status,
        "INACTIVE",
      );
      const next = await request(base, owner.account.id, "POST", {
        name: "Next after stopped",
      });
      assert.equal(next.status, 201);
      assert.equal(record(record(next.body).data).facilityCode, "FP-SF-00046");
      assert.equal(
        (await request(base + "/" + active.id, owner.account.id, "DELETE"))
          .status,
        404,
      );
      assert.equal(
        (await db.ingredientLot.findUniqueOrThrow({ where: { id: lot.id } }))
          .sourceFacilityId,
        active.id,
      );
    },
  );

  await context.test(
    "supplier ingredient management scopes create/edit/hide and preserves history",
    async () => {
      const base = "/api/ingredients/management";
      const category = await db.ingredientCategory.create({
        data: { categoryName: "Management category" },
      });
      const ingredientView = await permission("ingredient.view");
      const manage = await permission("ingredient.manage");
      const grant = await db.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: supplierStaffA.roleId,
            permissionId: manage.id,
          },
        },
        create: { roleId: supplierStaffA.roleId, permissionId: manage.id },
        update: {},
      });
      for (const actor of [supplierStaffA, system, adminA]) {
        for (const [method, suffix] of [
          ["GET", ""],
          ["GET", "/categories"],
          ["GET", "/" + ingredientA.id],
          ["POST", ""],
          ["PATCH", "/" + ingredientA.id],
          ["POST", "/" + ingredientA.id + "/hide"],
        ]) {
          assert.equal(
            (await request(base + suffix, actor.id, method)).status,
            403,
          );
        }
      }
      await db.rolePermission.delete({
        where: {
          roleId_permissionId: {
            roleId: grant.roleId,
            permissionId: grant.permissionId,
          },
        },
      });
      const payload = {
        name: "Managed " + randomUUID(),
        defaultUnit: "kg",
        categoryId: category.id,
        coverImage: "/cover.jpg",
        imageDescription: ["/1.jpg", "/2.jpg", "/3.jpg"],
      };
      const created = await request(base, supplierAdmin.id, "POST", payload);
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const item = record(record(created.body).data);
      const id = String(item.id);
      assert.equal(item.supplierId, supplierA.id);
      assert.deepEqual(item.imageDescription, payload.imageDescription);
      assert.equal(record(item.category).categoryName, category.categoryName);
      assert.equal(
        (await request(base, supplierAdmin.id, "POST", payload)).status,
        409,
      );
      assert.equal(
        (
          await request(base, supplierAdmin.id, "POST", {
            ...payload,
            name: "Forged",
            supplierId: supplierB.id,
          })
        ).status,
        400,
      );
      const catalog = await request(
        base + "/categories?limit=1",
        supplierAdmin.id,
      );
      assert.equal(catalog.status, 200);
      assert.equal(rows(catalog.body).length, 1);
      const list = await request(base + "?limit=100", supplierAdmin.id);
      assert.equal(list.status, 200);
      assert(rows(list.body).every((row) => row.supplierId === supplierA.id));
      const foreign = await db.ingredient.findFirstOrThrow({
        where: { supplierId: supplierB.id },
      });
      const absent = randomUUID();
      for (const foreignId of [foreign.id, absent]) {
        for (const method of ["GET", "PATCH", "POST"]) {
          const response = await request(
            base + "/" + foreignId + (method === "POST" ? "/hide" : ""),
            supplierAdmin.id,
            method,
            method === "PATCH" ? { name: "Refused" } : undefined,
          );
          assert.equal(response.status, 404);
          assert.equal(
            record(response.body).message,
            "Không tìm thấy nguyên liệu",
          );
        }
      }
      assert.equal(
        (
          await request(base + "/" + id, supplierAdmin.id, "PATCH", {
            description: "Updated",
            coverImage: null,
            imageDescription: [],
          })
        ).status,
        200,
      );
      const invalid = await request(
        base + "/" + id,
        supplierAdmin.id,
        "PATCH",
        { name: "Must rollback", categoryId: randomUUID() },
      );
      assert.equal(invalid.status, 400);
      assert.equal(
        (await db.ingredient.findUniqueOrThrow({ where: { id } })).name,
        payload.name,
      );
      const race = await Promise.all(
        [1, 2].map(() =>
          request(base, supplierAdmin.id, "POST", {
            name: "Race " + id,
            defaultUnit: "kg",
          }),
        ),
      );
      assert.deepEqual(race.map((r) => r.status).sort(), [201, 409]);
      const raceItems = await Promise.all(
        [1, 2].map((n) =>
          db.ingredient.create({
            data: {
              supplierId: supplierA.id,
              name: "Update " + id + " " + n,
              defaultUnit: "kg",
            },
          }),
        ),
      );
      const updateRace = await Promise.all(
        raceItems.map((r) =>
          request(base + "/" + r.id, supplierAdmin.id, "PATCH", {
            name: "Same " + id,
          }),
        ),
      );
      assert.deepEqual(updateRace.map((r) => r.status).sort(), [200, 409]);
      // Real history link retained when hidden.
      const entry = await db.ingredientEntry.create({
        data: {
          schoolId: schoolA.id,
          ingredientId: id,
          handlingType: "DRY_STOCK",
        },
      });
      assert.equal(
        (await request(base + "/" + id + "/hide", supplierAdmin.id, "POST"))
          .status,
        200,
      );
      const hidden = await db.ingredient.findUniqueOrThrow({ where: { id } });
      assert.equal(hidden.status, "INACTIVE");
      assert.equal(
        (await request(base + "/" + id + "/hide", supplierAdmin.id, "POST"))
          .status,
        200,
      );
      assert.equal(
        +(await db.ingredient.findUniqueOrThrow({ where: { id } })).updatedAt,
        +hidden.updatedAt,
      );
      assert.equal(
        (
          await request(base + "/" + id, supplierAdmin.id, "PATCH", {
            description: "Hidden edit",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await db.ingredientEntry.findUniqueOrThrow({
            where: { id: entry.id },
          })
        ).ingredientId,
        id,
      );
      assert.equal(
        (await db.ingredient.findUniqueOrThrow({ where: { id } })).status,
        "INACTIVE",
      );
      assert.equal(
        (await request(base, supplierAdmin.id, "POST", payload)).status,
        409,
      );
      // Same name remains allowed in another supplier.
      await db.ingredient.create({
        data: {
          supplierId: supplierB.id,
          name: payload.name,
          defaultUnit: "kg",
        },
      });
      const hideEdit = await Promise.all([
        request(
          base + "/" + raceItems[0].id + "/hide",
          supplierAdmin.id,
          "POST",
        ),
        request(base + "/" + raceItems[0].id, supplierAdmin.id, "PATCH", {
          description: "Concurrent edit",
        }),
      ]);
      assert(hideEdit.every((r) => r.status === 200));
      assert.equal(
        (
          await db.ingredient.findUniqueOrThrow({
            where: { id: raceItems[0].id },
          })
        ).status,
        "INACTIVE",
      );
      // Middleware reloads current grants/denials on each authenticated request.
      const staleActor = await loadPrincipal(supplierAdmin.id, db);
      const uploadCalls: string[] = [];
      const uploadInput = {
        file: {
          buffer: Buffer.from("test"),
          size: 4,
          mimeType: "image/jpeg",
          originalName: "test.jpg",
        },
      };
      const asset = {
        publicId: "test-image",
        url: "https://res.cloudinary.com/demo/image/upload/test.jpg",
        format: "jpg" as const,
        bytes: 4,
        width: 1,
        height: 1,
      };
      const uploadService = createIngredientService(undefined, undefined, {
        uploadImage: (_file, scope) => {
          uploadCalls.push(scope.ownerId);
          return Promise.resolve(asset);
        },
        uploadImages: (_files, scope) => {
          uploadCalls.push(scope.ownerId);
          return Promise.resolve([
            { index: 0, status: "success" as const, asset },
          ]);
        },
      });
      const beforeUpload = await db.ingredient.count();
      assert.equal(
        (await uploadService.uploadImage(uploadInput, staleActor)).url,
        asset.url,
      );
      assert.deepEqual(uploadCalls, [supplierA.id]);
      assert.equal(await db.ingredient.count(), beforeUpload);
      const denial = await db.userPermissionDenial.create({
        data: {
          userId: supplierAdmin.id,
          permissionId: manage.id,
          supplierId: supplierA.id,
          disabledByUserId: system.id,
        },
      });
      assert.equal((await request(base, supplierAdmin.id)).status, 403);
      assert.equal(
        (
          await request(base + "/" + id, supplierAdmin.id, "PATCH", {
            name: "Denied",
          })
        ).status,
        403,
      );
      await assert.rejects(
        () =>
          ingredientService.update(
            { ingredientId: id },
            { name: "Stale permission" },
            staleActor,
          ),
        (error: unknown) =>
          error instanceof HttpError && error.statusCode === 403,
      );
      await assert.rejects(
        () => uploadService.uploadImage(uploadInput, staleActor),
        (error: unknown) =>
          error instanceof HttpError && error.statusCode === 403,
      );
      assert.deepEqual(uploadCalls, [supplierA.id]);
      await db.userPermissionDenial.delete({ where: { id: denial.id } });
      await db.user.update({
        where: { id: supplierAdmin.id },
        data: { status: "LOCKED" },
      });
      await assert.rejects(
        () =>
          ingredientService.update(
            { ingredientId: id },
            { name: "Locked account" },
            staleActor,
          ),
        (error: unknown) =>
          error instanceof HttpError && error.statusCode === 403,
      );
      await assert.rejects(
        () => uploadService.uploadImage(uploadInput, staleActor),
        (error: unknown) =>
          error instanceof HttpError && error.statusCode === 403,
      );
      await db.user.update({
        where: { id: supplierAdmin.id },
        data: { status: "ACTIVE", supplierId: supplierB.id },
      });
      await assert.rejects(
        () =>
          ingredientService.update(
            { ingredientId: id },
            { name: "Changed membership" },
            staleActor,
          ),
        (error: unknown) =>
          error instanceof HttpError && error.statusCode === 403,
      );
      await assert.rejects(
        () => uploadService.uploadImage(uploadInput, staleActor),
        (error: unknown) =>
          error instanceof HttpError && error.statusCode === 403,
      );
      await db.user.update({
        where: { id: supplierAdmin.id },
        data: { supplierId: supplierA.id },
      });

      await db.supplier.update({
        where: { id: supplierA.id },
        data: { status: "INACTIVE" },
      });
      assert.equal((await request(base, supplierAdmin.id)).status, 403);
      await assert.rejects(
        () => uploadService.uploadImage(uploadInput, staleActor),
        (error: unknown) =>
          error instanceof HttpError && error.statusCode === 403,
      );
      assert.deepEqual(uploadCalls, [supplierA.id]);
      assert.equal(
        (
          await request(base, supplierAdmin.id, "POST", {
            name: "Inactive supplier",
            defaultUnit: "kg",
          })
        ).status,
        403,
      );
      await db.supplier.update({
        where: { id: supplierA.id },
        data: { status: "ACTIVE" },
      });
      await db.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: supplierStaffA.roleId,
            permissionId: ingredientView.id,
          },
        },
        create: {
          roleId: supplierStaffA.roleId,
          permissionId: ingredientView.id,
        },
        update: {},
      });
      assert.equal(
        (await request("/api/ingredients", supplierStaffA.id)).status,
        200,
      );
      await db.rolePermission.delete({
        where: {
          roleId_permissionId: {
            roleId: supplierStaffA.roleId,
            permissionId: ingredientView.id,
          },
        },
      });
      // Remove only this subtest's disposable fixture so later scope assertions keep their baseline.
      await db.ingredientEntry.delete({ where: { id: entry.id } });
      await db.ingredient.deleteMany({
        where: {
          OR: [
            { id },
            { name: "Race " + id },
            { name: "Same " + id },
            { name: { startsWith: "Update " + id } },
          ],
        },
      });
    },
  );

  await context.test(
    "directory filtered totals, literal search and independent summary",
    async () => {
      const marker = `directory-${randomUUID()}-%_`;
      await db.school.createMany({
        data: Array.from({ length: 100 }, (_, index) => ({
          name: `${marker}-${index}`,
          status: index < 85 ? ("ACTIVE" as const) : ("INACTIVE" as const),
        })),
      });
      const first = await request(
        `/api/schools?limit=5&search=${encodeURIComponent(marker)}&status=ACTIVE`,
        system.id,
      );
      assert.equal(first.status, 200);
      const data = record(record(first.body).data);
      assert.equal(record(data.pagination).total, 85);
      assert.equal(rows(first.body).length, 5);
      const last = await request(
        `/api/schools?page=18&limit=5&search=${encodeURIComponent(marker)}&status=ACTIVE`,
        system.id,
      );
      assert.equal(rows(last.body).length, 0);
      assert.equal(
        record(record(record(last.body).data).pagination).hasNext,
        false,
      );
      const summary = await request("/api/schools/summary", system.id);
      assert.equal(summary.status, 200);
      assert(Number(record(record(summary.body).data).total) >= 100);
      assert.equal(
        (await request("/api/schools/summary", adminA.id)).status,
        403,
      );
    },
  );
  await context.test(
    "directory details and child scopes remain independent",
    async () => {
      const school = await db.school.create({
        data: { name: "Directory inactive", status: "INACTIVE" },
      });
      assert.equal(
        (await request(`/api/schools/${school.id}`, system.id)).status,
        200,
      );
      assert.equal(
        (await request(`/api/schools/${school.id}`, adminA.id)).status,
        404,
      );
      for (const group of ["classes", "suppliers", "accounts"]) {
        const response = await request(
          `/api/schools/${school.id}/${group}`,
          system.id,
        );
        assert.equal(response.status, 200, `School detail group: ${group}`);
        assert.equal(
          record(record(record(response.body).data).pagination).total,
          0,
        );
      }
      const supplier = await db.supplier.create({
        data: { name: "Directory supplier inactive", status: "INACTIVE" },
      });
      assert.equal(
        (await request(`/api/suppliers/${supplier.id}`, system.id)).status,
        200,
      );
      const certificates = await request(
        `/api/suppliers/${supplier.id}/certifications`,
        system.id,
      );
      assert.equal(certificates.status, 200);
      assert.equal(
        record(record(record(certificates.body).data).pagination).total,
        0,
      );
      await withReadTransaction(async (tx) => {
        const before = await tx.school.findUniqueOrThrow({
          where: { id: school.id },
        });
        await db.school.update({
          where: { id: school.id },
          data: { name: "Directory changed" },
        });
        const after = await tx.school.findUniqueOrThrow({
          where: { id: school.id },
        });
        assert.equal(after.name, before.name);
      });
      assert.equal(
        (await db.school.findUniqueOrThrow({ where: { id: school.id } })).name,
        "Directory changed",
      );
    },
  );
  await context.test(
    "supplier directory searches codes and literal backslashes before pagination",
    async () => {
      const marker = `directory-supplier-${randomUUID()}`;
      const summaryBefore = await request("/api/suppliers/summary", system.id);
      const before = record(record(summaryBefore.body).data);
      await db.supplier.createMany({
        data: Array.from({ length: 100 }, (_, i) => ({
          name: `${marker}-${i}`,
          taxCode: `${marker}-code-${i}`,
          status: i < 85 ? ("ACTIVE" as const) : ("INACTIVE" as const),
        })),
      });
      const summaryAfter = await request("/api/suppliers/summary", system.id);
      const after = record(record(summaryAfter.body).data);
      assert.equal(Number(after.total) - Number(before.total), 100);
      assert.equal(Number(after.activeCount) - Number(before.activeCount), 85);
      const byCode = await request(
        `/api/suppliers?search=${marker}-code-99`,
        system.id,
      );
      assert.equal(rows(byCode.body).length, 1);
      for (const endpoint of ["schools", "suppliers"]) {
        const prefix = `${marker}-twelve`;
        if (endpoint === "schools")
          await db.school.createMany({
            data: Array.from({ length: 12 }, (_, i) => ({
              name: `${prefix}-${i}`,
            })),
          });
        else
          await db.supplier.createMany({
            data: Array.from({ length: 12 }, (_, i) => ({
              name: `${prefix}-${i}`,
            })),
          });
        const seen = new Set<string>();
        for (let page = 1; page <= 3; page++) {
          const result = await request(
            `/api/${endpoint}?search=${prefix}&page=${page}&limit=5`,
            system.id,
          );
          assert.equal(result.status, 200);
          const items = rows(result.body);
          assert.equal(items.length, page === 3 ? 2 : 5);
          const pagination = record(
            record(record(result.body).data).pagination,
          );
          assert.equal(pagination.total, 12);
          assert.equal(pagination.hasNext, page < 3);
          for (const item of items) {
            assert(!seen.has(String(item.id)));
            seen.add(String(item.id));
          }
        }
        assert.equal(seen.size, 12);
      }
    },
  );
  const applicationCodes = new Map<string, string>();
  const reviewVersion = async (id: string) => {
    const response = await request(
      `/api/registration-requests/${id}`,
      system.id,
    );
    assert.equal(response.status, 200);
    const detail = record(record(response.body).data);
    assert.match(String(detail.registrationID), /^FP-REG-[0-9]{5,}$/);
    if (applicationCodes.has(id))
      assert.equal(detail.registrationID, applicationCodes.get(id));
    assert(!JSON.stringify(response.body).includes("registrationNumber"));
    return String(detail.reviewVersion);
  };
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
        assert.match(String(data.registrationID), /^FP-REG-[0-9]{5,}$/);
        applicationCodes.set(id, String(data.registrationID));
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
        assert.equal(detailData.registrationID, applicationCodes.get(id));
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
      const originalVersion = await reviewVersion(id);
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
              { expectedReviewVersion: await reviewVersion(id) },
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
              { expectedReviewVersion: await reviewVersion(id) },
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
      for (const body of [
        { rejectionReason: " " },
        { expectedReviewVersion: await reviewVersion(id) },
        { expectedReviewVersion: "not-a-version", rejectionReason: "Lý do" },
        {
          expectedReviewVersion: await reviewVersion(id),
          rejectionReason: "x".repeat(4001),
        },
      ])
        assert.equal(
          (
            await request(
              `/api/registration-requests/${id}/reject`,
              system.id,
              "POST",
              body,
            )
          ).status,
          400,
        );
      assert.equal(
        (
          await request(
            `/api/registration-requests/${id}/approve`,
            system.id,
            "POST",
            {},
          )
        ).status,
        400,
      );
      const missingId = randomUUID();
      assert.equal(
        (await request(`/api/registration-requests/${missingId}`, system.id))
          .status,
        404,
      );
      assert.equal(
        (
          await request(
            `/api/registration-requests/${missingId}/approve`,
            system.id,
            "POST",
            { expectedReviewVersion: "a".repeat(64) },
          )
        ).status,
        404,
      );
      assert.equal(
        (await http.request(`/api/registration-requests/${id}`)).status,
        401,
      );
      const rejected = await request(
        `/api/registration-requests/${id}/reject`,
        system.id,
        "POST",
        {
          expectedReviewVersion: await reviewVersion(id),
          rejectionReason: "Bổ sung mã trường",
        },
      );
      assert.equal(rejected.status, 200);
      const rejectedData = record(record(rejected.body).data);
      assert.equal(rejectedData.registrationID, applicationCodes.get(id));
      assert.equal(rejectedData.status, "REJECTED");
      assert.equal(rejectedData.accountStatus, "UNVERIFIED");
      assert.equal(rejectedData.rejectionReason, "Bổ sung mã trường");
      assert.match(String(rejectedData.reviewVersion), /^[a-f0-9]{64}$/);
      const rejectedEmail = record(rejectedData.emailNotification);
      assert.match(String(rejectedEmail.id), /^[0-9a-f-]{36}$/);
      assert.equal(rejectedEmail.status, "PENDING");
      assert.equal(rejectedData.schoolId, undefined);
      assert.equal(rejectedData.supplierId, undefined);
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
      const notificationsBeforeStaleReview = await db.emailOutbox.count({
        where: { registrationId: id },
      });
      assert.equal(notificationsBeforeStaleReview, 3);
      const staleReview = await request(
        `/api/registration-requests/${id}/approve`,
        system.id,
        "POST",
        { expectedReviewVersion: originalVersion },
      );
      assert.equal(staleReview.status, 409);
      assert.equal(
        record(record(staleReview.body).error).code,
        "REGISTRATION_STALE",
      );
      assert.equal(
        await db.emailOutbox.count({ where: { registrationId: id } }),
        notificationsBeforeStaleReview,
      );
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
            {
              expectedReviewVersion: await reviewVersion(id),
              rejectionReason: "Thay tài liệu",
            },
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
      const versionBeforeContactChange = await reviewVersion(id);
      const notificationCount = await db.emailOutbox.count({
        where: { registrationId: id },
      });
      const row = await db.registrationRequest.findUniqueOrThrow({
        where: { id },
      });
      await db.user.update({
        where: { id: row.applicantUserId },
        data: { phone: "0909876543" },
      });
      const staleContact = await request(
        `/api/registration-requests/${id}/approve`,
        system.id,
        "POST",
        { expectedReviewVersion: versionBeforeContactChange },
      );
      assert.equal(staleContact.status, 409);
      assert.equal(
        record(record(staleContact.body).error).code,
        "REGISTRATION_STALE",
      );
      const code = String(record(row.profileData).code);
      await db.school.update({ where: { id: schoolA.id }, data: { code } });
      try {
        const organizationConflict = await request(
          `/api/registration-requests/${id}/approve`,
          system.id,
          "POST",
          { expectedReviewVersion: await reviewVersion(id) },
        );
        assert.equal(organizationConflict.status, 409);
        assert.equal(
          record(record(organizationConflict.body).error).code,
          "ORGANIZATION_CONFLICT",
        );
        const unchanged = await db.registrationRequest.findUniqueOrThrow({
          where: { id },
        });
        assert.equal(unchanged.status, "PENDING");
        assert.equal(unchanged.reviewedAt, null);
        assert.equal(
          await db.emailOutbox.count({ where: { registrationId: id } }),
          notificationCount,
        );
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
        const notificationsBeforeApproval = await db.emailOutbox.count({
          where: { registrationId: id },
        });
        const results = await Promise.all([
          request(
            `/api/registration-requests/${id}/approve`,
            system.id,
            "POST",
            { expectedReviewVersion: await reviewVersion(id) },
          ),
          request(
            `/api/registration-requests/${id}/approve`,
            system.id,
            "POST",
            { expectedReviewVersion: await reviewVersion(id) },
          ),
        ]);
        assert.deepEqual(
          results.map((result) => result.status).sort(),
          [200, 409],
        );
        const approvedResponse = results.find(
          (result) => result.status === 200,
        );
        assert(approvedResponse);
        const approvedData = record(record(approvedResponse.body).data);
        assert.equal(approvedData.registrationID, applicationCodes.get(id));
        assert.equal(approvedData.status, "APPROVED");
        assert.equal(approvedData.accountStatus, "ACTIVE");
        assert.equal(record(approvedData.applicantUser).status, "ACTIVE");
        const approvedEmail = record(approvedData.emailNotification);
        assert.match(String(approvedEmail.id), /^[0-9a-f-]{36}$/);
        assert.equal(approvedEmail.status, "PENDING");
        assert.match(String(approvedData.reviewVersion), /^[a-f0-9]{64}$/);
        assert.equal(Boolean(approvedData.schoolId), type === "SCHOOL");
        assert.equal(Boolean(approvedData.supplierId), type === "SUPPLIER");
        const conflict = results.find((result) => result.status === 409);
        assert(conflict);
        assert.equal(
          record(record(conflict.body).error).code,
          "REGISTRATION_ALREADY_REVIEWED",
        );
        assert.equal(
          await db.emailOutbox.count({ where: { registrationId: id } }),
          notificationsBeforeApproval + 1,
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
        assert.equal(reviewedData.reviewVersion, approvedData.reviewVersion);
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
          const certificateList = await request(
            `/api/suppliers/${after.supplierId}/certifications`,
            system.id,
          );
          assert.equal(certificateList.status, 200);
          const listed = rows(certificateList.body);
          assert.equal(listed.length, 2);
          assert(
            listed.some(
              (item) =>
                Array.isArray(item.documents) && item.documents.length === 2,
            ),
          );
          const cert = certificates.find((item) =>
            item.documentUrl?.endsWith(`/${documentId}`),
          );
          assert(cert);
          const opened = await request(
            `/api/supplier-certifications/${cert.id}/documents/${documentId}`,
            system.id,
          );
          assert.equal(opened.status, 200);
          assert.equal(opened.headers.get("cache-control"), "no-store");

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
              {
                expectedReviewVersion: await reviewVersion(id),
                rejectionReason: "Too late",
              },
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
    "review email outbox survives send failure, retries with a stable key, and dispatches through BullMQ",
    async () => {
      const row = await db.emailOutbox.findFirstOrThrow({
        where: { registrationId: applicationId("SCHOOL"), status: "PENDING" },
        orderBy: { createdAt: "asc" },
      });
      await assert.rejects(() =>
        processEmailOutbox(db, row.id, () =>
          Promise.reject(new Error("fake provider offline")),
        ),
      );
      const failed = await db.emailOutbox.findUniqueOrThrow({
        where: { id: row.id },
      });
      assert.equal(failed.status, "PENDING");
      assert.equal(failed.attempts, 1);
      assert(failed.firstAttemptAt);
      let calls = 0;
      await processEmailOutbox(db, row.id, (mail) => {
        calls++;
        assert.equal(mail.idempotencyKey, `registration-review/${row.id}`);
        return Promise.resolve({ id: "resend-test-accepted" });
      });
      await processEmailOutbox(db, row.id, () => {
        calls++;
        return Promise.resolve({ id: "duplicate" });
      });
      assert.equal(calls, 1);
      const accepted = await db.emailOutbox.findUniqueOrThrow({
        where: { id: row.id },
      });
      assert.equal(accepted.status, "ACCEPTED");
      assert.equal(accepted.attempts, 2);
      assert.equal(accepted.providerMessageId, "resend-test-accepted");
      assert.deepEqual(accepted.firstAttemptAt, failed.firstAttemptAt);

      const exhausted = await db.emailOutbox.create({
        data: {
          registrationId: applicationId("SCHOOL"),
          recipientEmail: "outbox-test@example.test",
          subject: "Test notification",
          text: "Test notification",
          html: "<p>Test notification</p>",
        },
      });
      for (let attempt = 0; attempt < 5; attempt++)
        await assert.rejects(() =>
          processEmailOutbox(db, exhausted.id, () =>
            Promise.reject(new Error("fake provider offline")),
          ),
        );
      const terminal = await db.emailOutbox.findUniqueOrThrow({
        where: { id: exhausted.id },
      });
      assert.equal(terminal.status, "FAILED");
      assert.equal(terminal.attempts, 5);

      const namespace = `foodprint:queue:test:${randomUUID()}`;
      const queue = createEmailQueue(namespace);
      let worker: ReturnType<typeof createEmailWorker> | undefined;
      try {
        const pending = await db.emailOutbox.findFirstOrThrow({
          where: { status: "PENDING" },
          select: { id: true },
        });
        await dispatchEmailOutbox(db, queue);
        const removed = await queue.getJob(pending.id);
        assert(removed);
        await removed.remove();
        await dispatchEmailOutbox(db, queue);
        assert(await queue.getJob(pending.id));
        await dispatchEmailOutbox(db, queue);
        assert.equal(
          (await queue.getWaiting()).filter((job) => job.id === pending.id)
            .length,
          1,
        );
        worker = createEmailWorker(
          db,
          (mail) => {
            assert.match(mail.idempotencyKey ?? "", /^registration-review\//);
            return Promise.resolve({ id: "resend-test-queue" });
          },
          namespace,
        );
        const deadline = Date.now() + 8000;
        while (
          (await db.emailOutbox.count({ where: { status: "PENDING" } })) > 0 &&
          Date.now() < deadline
        )
          await setTimeout(50);
        assert.equal(
          await db.emailOutbox.count({ where: { status: "PENDING" } }),
          0,
        );
      } finally {
        if (worker) await closeEmailWorker(worker);
        await closeEmailQueue(queue);
      }
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
      // The earlier CRUD scenario deliberately retains ingredient history.
      // These fixtures are independent so the exact row assertions stay meaningful.
      const supplierA = await db.supplier.create({
        data: { name: "Read isolation A" },
      });
      const supplierB = await db.supplier.create({
        data: { name: "Read isolation B" },
      });
      const supplierAdmin = await user("INGREDIENT_SUPPLIER_ADMIN", {
        supplierId: supplierA.id,
      });
      const supplierStaffA = await user("INGREDIENT_SUPPLIER_STAFF", {
        supplierId: supplierA.id,
      });
      const supplierStaffB = await user("INGREDIENT_SUPPLIER_STAFF", {
        supplierId: supplierB.id,
      });
      const ingredientA = await db.ingredient.create({
        data: {
          supplierId: supplierA.id,
          name: "Scoped ingredient A",
          defaultUnit: "kg",
        },
      });
      const ingredientB = await db.ingredient.create({
        data: {
          supplierId: supplierB.id,
          name: "Scoped ingredient B",
          defaultUnit: "kg",
        },
      });
      for (const account of [supplierAdmin, supplierStaffA, supplierStaffB]) {
        const session = await authSessions.issue(account.id);
        issued.set(account.id, session);
        refreshTokens.push(session.refreshToken);
      }
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
      const otherSupplier = await request(
        "/api/ingredients",
        supplierStaffB.id,
      );
      assert.equal(otherSupplier.status, 200);
      assert.deepEqual(
        rows(otherSupplier.body).map((row) => row.id),
        [ingredientB.id],
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
