import type { Prisma } from "../src/generated/prisma/client";
import { ROLES } from "../src/constants/roles";
import { recordLocalTestDatabase } from "./helpers/local-test-database";
import { createSupplierStaffService } from "../src/modules/supplier-staff/supplier-staff.service";
import {
  createSupplierStaffRepository,
  supplierStaffRepository,
} from "../src/modules/supplier-staff/supplier-staff.repository";
import {
  createPermissionRepository,
  permissionConcurrencyRepository,
} from "../src/modules/permission/permission.repository";
import { createSupplyOrderService } from "../src/modules/supply-order/supply-order.service";
import { createSupplyOrderRepository } from "../src/modules/supply-order/supply-order.repository";
import { createIntakeAccessService } from "../src/modules/account-lifecycle/intake-access.service";
import { createIntakeAccessRepository } from "../src/modules/account-lifecycle/intake-access.repository";
import { authorizationTransaction } from "../src/utils/authorization";
import {
  createIngredientService,
  ingredientService,
} from "../src/modules/ingredient/ingredient.service";
import { ingredientRepository } from "../src/modules/ingredient/ingredient.repository";
import {
  createSourceFacilityService,
  sourceFacilityService,
} from "../src/modules/source-facility/source-facility.service";
import { createSourceFacilityRepository } from "../src/modules/source-facility/source-facility.repository";
import { validateSourceFacilityCreate } from "../src/modules/source-facility/source-facility.validation";
import { createBarrier } from "./helpers/account-lifecycle-database";
import {
  documentFormat,
  documentStorage,
} from "../src/utils/onboarding-documents";
import { withReadTransaction } from "../src/utils/read-transaction";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
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
import { createIngredientQualityFeedbackRepository } from "../src/modules/ingredient-quality-feedback/ingredient-quality-feedback.repository";
import { createIngredientQualityFeedbackService } from "../src/modules/ingredient-quality-feedback/ingredient-quality-feedback.service";
import { createPermissionService } from "../src/modules/permission/permission.service";
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
  recordLocalTestDatabase(name);
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
      const format = documentFormat(file);
      const document: OnboardingDocument = {
        id,
        field: file.fieldname,
        publicId: `foodprint/onboarding/${userId}/${id}.${format}`,
        format,
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
    "supplier staff retries a real PostgreSQL serialization conflict during actor lookup",
    async () => {
      const organization = await db.supplier.create({
        data: { name: "Actor query serialization regression" },
      });
      const administrator = await user("INGREDIENT_SUPPLIER_ADMIN", {
        supplierId: organization.id,
      });
      const actor = await loadPrincipal(administrator.id, db);
      const repository = createSupplierStaffRepository(() =>
        Promise.resolve(db),
      );
      const transactions = new Set<Prisma.TransactionClient>();
      const conflictKinds: string[] = [];
      let injected = false,
        hashes = 0;
      const service = createSupplierStaffService(
        {
          ...repository,
          actor(id, tx) {
            transactions.add(tx);
            const actorTx = new Proxy(tx, {
              get(client, key, receiver) {
                if (key !== "user")
                  return Reflect.get(client, key, receiver) as unknown;
                return new Proxy(tx.user, {
                  get(delegate, method, delegateReceiver) {
                    if (method !== "findUnique")
                      return Reflect.get(
                        delegate,
                        method,
                        delegateReceiver,
                      ) as unknown;
                    return async (query: Prisma.UserFindUniqueArgs) => {
                      if (!injected) {
                        injected = true;
                        // Establish an old Serializable snapshot, then commit a concurrent profile update.
                        await tx.$queryRaw`SELECT id FROM foodprint.users WHERE id = ${id}::uuid`;
                        await db.user.update({
                          where: { id },
                          data: {
                            fullName: "Concurrently updated actor profile",
                          },
                        });
                        try {
                          // PostgreSQL must raise 40001 when this snapshot tries to lock the changed row.
                          await tx.$queryRaw`SELECT id FROM foodprint.users WHERE id = ${id}::uuid FOR UPDATE`;
                        } catch (error) {
                          const meta = record(record(error).meta);
                          const cause = record(
                            record(meta.driverAdapterError).cause,
                          );
                          conflictKinds.push(String(cause.kind));
                          throw error;
                        }
                        assert.fail(
                          "The actor query must encounter a real serialization conflict",
                        );
                      }
                      return tx.user.findUnique(query);
                    };
                  },
                });
              },
            });
            return repository.actor(id, actorTx);
          },
        },
        () => Promise.resolve(db),
        async (value) => {
          hashes++;
          return bcrypt.hash(value, 4);
        },
      );
      const suffix = randomUUID();
      const input = {
        username: `ci-retry-${suffix}`,
        email: `ci-retry-${suffix}@example.test`,
        fullName: "Retry staff",
        password: "RetryStaff123!",
        phone: null,
      };
      const created = await service.create(input, actor);
      assert.deepEqual(conflictKinds, ["TransactionWriteConflict"]);
      assert.equal(transactions.size, 2);
      assert.equal(hashes, 1);
      assert.equal(created.supplierId, organization.id);
      assert.equal(await db.user.count({ where: { email: input.email } }), 1);
      const saved = await db.user.findUniqueOrThrow({
        where: { id: created.id },
      });
      assert.equal(saved.roleCode, "INGREDIENT_SUPPLIER_STAFF");
      assert(await bcrypt.compare(input.password, saved.passwordHash));
    },
  );

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
          handlingType: "DIRECT_USE",
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
            schoolId: school.id,
            supplierId: supplierA.id,
            // Historical delivery fixture; no creation key/fingerprint from the management API.
            creationMode: null,
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
            ingredientId: ingredient.id,
            ingredientEntryId: entry.id,
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
      await db.schoolAcademicYear.createMany({
        data: [
          {
            schoolId: school.id,
            academicYear: "2029-2030",
            startDate: new Date("2029-09-03"),
            endDate: new Date("2030-05-31"),
            holidays: [],
          },
          {
            schoolId: school.id,
            academicYear: "2031-2032",
            startDate: new Date("2031-09-01"),
            endDate: new Date("2032-05-31"),
            holidays: [],
          },
        ],
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
      // Bếp chỉ nấu bữa của hôm nay: đặt "hôm nay" theo ngày thực đơn đang test.
      let kitchenToday = "";
      const batches = createKitchenService(
        undefined,
        () => Promise.resolve(db),
        () => kitchenToday,
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
          schoolId: school.id,
          supplierId: supplier.id,
          // Historical delivery fixture; no creation key/fingerprint from the management API.
          creationMode: null,
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
            ingredientId: ingredient.id,
            ingredientEntryId: entry.id,
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
          academicYear: "2029-2030",
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
      kitchenToday = day.menuDate.toISOString().slice(0, 10);
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
      assert.equal(lunchBatches.length, 1);
      assert.equal(
        await db.cookingBatch.count({
          where: { menuDayId: key.menuDayId, mealType: key.mealType },
        }),
        1,
      );
      assert(lunchBatches.every((child) => child.dishes.length === 1));
      const batch = lunchBatches.find((child) =>
        child.dishes.some((d) => d.dishId === mainDish.dishId),
      )!;
      assert.equal(batch.batchNumber, 1);
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
      const sidePlan = await batches.plan(
        { ...key, dishId: sideDish.dishId },
        chef,
      );
      assert.equal(sidePlan.created, true);
      assert.equal(sidePlan.batches.length, 2);
      assert.equal(
        await db.cookingBatch.count({
          where: { menuDayId: key.menuDayId, mealType: key.mealType },
        }),
        2,
      );
      const sideBatch = sidePlan.batches.find((child) =>
        child.dishes.some((d) => d.dishId === sideDish.dishId),
      )!;
      assert.equal(sideBatch.batchNumber, 1);
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
      const sideRetry = await batches.plan(
        { ...key, dishId: sideDish.dishId },
        chef,
      );
      assert.equal(sideRetry.created, false);
      const side = sideRetry.batches.find((child) =>
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
      // The side dish can reserve part of the first lot; only the main batch
      // has consumed stock so far, regardless of which dish was planned first.
      for (const lot of rice.lots) {
        const remaining = batch.dishes[0].cookingBatchLots
          .filter((usage) => usage.ingredientLotId === lot.id)
          .reduce(
            (quantity, usage) => quantity.minus(usage.quantityUsed),
            lot.availableQuantity,
          );
        assert.equal(
          (
            await db.ingredientLot.findUniqueOrThrow({ where: { id: lot.id } })
          ).availableQuantity.toString(),
          remaining.toString(),
        );
      }
      assert.equal(
        (await batches.complete(side.id, chef)).mealSeasoningsConsumed,
        true,
      );
      for (const lot of rice.lots) {
        assert.equal(
          (
            await db.ingredientLot.findUniqueOrThrow({ where: { id: lot.id } })
          ).availableQuantity.toString(),
          "0",
        );
      }
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
      // Mẫu lưu phải gắn với tủ lưu mẫu đang hoạt động của trường.
      const fridge = await db.sampleStorageUnit.create({
        data: {
          schoolId: school.id,
          code: "FRIDGE-1",
          name: "Fridge 1",
          location: "Kitchen",
        },
      });
      const sampleInput = validateFoodSample({
        dishId: mainDish.dishId,
        quantity: 150,
        unit: "g",
        storageUnitId: fridge.id,
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
                mealType: "AFTERNOON",
                dishes: [
                  {
                    name: "Group afternoon",
                    ingredients: [
                      {
                        ingredientId: grRice.ingredient.id,
                        quantityPerPortion: 80,
                        unit: "g",
                      },
                    ],
                  },
                ],
              },
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
      kitchenToday = grDay.menuDate.toISOString().slice(0, 10);
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
          academicYear: "2031-2032",
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
      // Without dishId the whole meal is planned; with dishId only that dish (kitchen-meal-workflow FR-001).
      const grPlan = await batches.plan(grKey, chef);
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
        4,
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
        revisedRows.map((row) => Number(row.allocatedPortions)),
        [10],
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
    account: { id: string; username: string; email: string },
    value = password,
  ) {
    const response = await postPassword("login", {
      identifier: account.email,
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
            identifier: account.email,
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
        postPassword("login", { identifier: account.email, password }),
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
    "supplier staff list is scoped, includes every status, paginates stably and rejects forbidden actors or query expansion",
    async () => {
      const route = "/api/supplier-staff";
      const organization = await db.supplier.create({
        data: { name: "Staff list supplier " + randomUUID() },
      });
      const foreignOrganization = await db.supplier.create({
        data: { name: "Staff list foreign supplier " + randomUUID() },
      });
      const administrator = await user("INGREDIENT_SUPPLIER_ADMIN", {
        supplierId: organization.id,
      });
      const foreignAdministrator = await user("INGREDIENT_SUPPLIER_ADMIN", {
        supplierId: foreignOrganization.id,
      });
      const foreignStaff = await user("INGREDIENT_SUPPLIER_STAFF", {
        supplierId: foreignOrganization.id,
      });
      const systemActor = await user("SYSTEM_ADMIN");
      const staffRole = await role("INGREDIENT_SUPPLIER_STAFF");
      const states = [
        "UNVERIFIED",
        "ACTIVE",
        "INACTIVE",
        "LOCKED",
        "DEACTIVATED",
      ] as const;
      const fixtures = Array.from({ length: 45 }, (_, index) => {
        const id = randomUUID();
        return {
          id,
          roleId: staffRole.id,
          roleCode: staffRole.code,
          supplierId: organization.id,
          username: "list_" + id.replaceAll("-", ""),
          email: id + "@staff-list.example.test",
          fullName: "Staff list member " + index,
          phone: index % 2 ? "0909123456" : null,
          passwordHash,
          status: states[index % states.length],
          createdAt: new Date(
            index < 22 ? "2026-01-01T00:00:00Z" : "2026-02-01T00:00:00Z",
          ),
        };
      });
      await db.user.createMany({ data: fixtures });
      const activeStaff = fixtures.find(
        (account) => account.status === "ACTIVE",
      );
      assert(activeStaff);
      for (const account of [
        administrator,
        foreignAdministrator,
        systemActor,
        activeStaff,
      ]) {
        const tokens = await authSessions.issue(account.id);
        issued.set(account.id, tokens);
        refreshTokens.push(tokens.refreshToken);
      }
      const expected = [...fixtures].sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() ||
          left.id.localeCompare(right.id),
      );
      const observed: Record<string, unknown>[] = [];
      for (const [page, expectedCount] of [
        [1, 20],
        [2, 20],
        [3, 5],
      ] as const) {
        const response = await request(
          route + "?page=" + page,
          administrator.id,
        );
        assert.equal(response.status, 200, JSON.stringify(response.body));
        const items = rows(response.body);
        assert.equal(items.length, expectedCount);
        assert.deepEqual(
          record(record(record(response.body).data).pagination),
          {
            page,
            limit: 20,
            hasNext: page < 3,
          },
        );
        assert.deepEqual(
          Object.keys(record(record(response.body).data)).sort(),
          ["items", "pagination"],
        );
        for (const item of items) {
          assert.deepEqual(Object.keys(item).sort(), [
            "email",
            "fullName",
            "id",
            "phone",
            "roleCode",
            "roleName",
            "status",
            "username",
          ]);
          assert.equal(item.roleCode, "INGREDIENT_SUPPLIER_STAFF");
          assert.equal(item.roleName, staffRole.name);
          const source = fixtures.find((fixture) => fixture.id === item.id);
          assert(source);
          assert.equal(item.username, source.username);
          assert.equal(item.email, source.email);
          assert.equal(item.fullName, source.fullName);
          assert.equal(item.phone, source.phone);
          assert.equal(item.status, source.status);
          assert.notEqual(item.id, administrator.id);
          assert.notEqual(item.id, foreignStaff.id);
        }
        observed.push(...items);
      }
      assert.deepEqual(
        observed.map((item) => item.id),
        expected.map((item) => item.id),
      );
      assert.equal(new Set(observed.map((item) => item.id)).size, 45);
      assert.deepEqual(
        [...new Set(observed.map((item) => item.status))].sort(),
        [...states].sort(),
      );
      assert(!JSON.stringify(observed).includes(passwordHash));
      const repeated = await request(route + "?page=1", administrator.id);
      assert.deepEqual(rows(repeated.body), observed.slice(0, 20));
      const first = await request(route, administrator.id);
      assert.deepEqual(rows(first.body), observed.slice(0, 20));
      const maximum = await request(route + "?limit=100", administrator.id);
      assert.equal(maximum.status, 200);
      assert.equal(rows(maximum.body).length, 45);
      const beyond = await request(route + "?page=4", administrator.id);
      assert.equal(beyond.status, 200);
      assert.deepEqual(rows(beyond.body), []);
      assert.deepEqual(record(record(record(beyond.body).data).pagination), {
        page: 4,
        limit: 20,
        hasNext: false,
      });
      const foreign = await request(route, foreignAdministrator.id);
      assert.equal(foreign.status, 200);
      assert.deepEqual(
        rows(foreign.body).map((item) => item.id),
        [foreignStaff.id],
      );
      const emptyOrganization = await db.supplier.create({
        data: { name: "Staff list empty supplier " + randomUUID() },
      });
      const emptyAdministrator = await user("INGREDIENT_SUPPLIER_ADMIN", {
        supplierId: emptyOrganization.id,
      });
      const emptyTokens = await authSessions.issue(emptyAdministrator.id);
      issued.set(emptyAdministrator.id, emptyTokens);
      refreshTokens.push(emptyTokens.refreshToken);
      const empty = await request(route, emptyAdministrator.id);
      assert.equal(empty.status, 200);
      assert.deepEqual(rows(empty.body), []);
      assert.deepEqual(record(record(record(empty.body).data).pagination), {
        page: 1,
        limit: 20,
        hasNext: false,
      });
      for (const query of [
        "?supplierId=" + foreignOrganization.id,
        "?schoolId=" + schoolA.id,
        "?role=INGREDIENT_SUPPLIER_ADMIN",
        "?status=ACTIVE",
        "?search=staff",
        "?page=0",
        "?page=-1",
        "?page=1.5",
        "?page=abc",
        "?page=9007199254740992",
        "?limit=0",
        "?limit=101",
        "?limit=1.5",
        "?limit=abc",
        "?page=2147483648&limit=100",
        "?page=1&page=2",
      ]) {
        const invalid = await request(route + query, administrator.id);
        assert.equal(
          invalid.status,
          400,
          query + ": " + JSON.stringify(invalid.body),
        );
      }
      const manage = await permission("supplier_staff.manage");
      const addedGrants: { roleId: string; permissionId: string }[] = [];
      try {
        for (const account of [activeStaff, systemActor]) {
          const key = { roleId: account.roleId, permissionId: manage.id };
          if (
            !(await db.rolePermission.findUnique({
              where: { roleId_permissionId: key },
            }))
          ) {
            await db.rolePermission.create({ data: key });
            addedGrants.push(key);
          }
          const actor = await loadPrincipal(account.id, db);
          assert(actor.permissions.includes("supplier_staff.manage"));
          assert.equal((await request(route, account.id)).status, 403);
        }
        assert.equal((await request(route, adminA.id)).status, 403);
        assert.equal((await request(route, officerA.id)).status, 403);
      } finally {
        for (const key of addedGrants) {
          await db.rolePermission.delete({
            where: { roleId_permissionId: key },
          });
        }
      }
      const denial = await db.userPermissionDenial.create({
        data: {
          userId: administrator.id,
          permissionId: manage.id,
          supplierId: organization.id,
          disabledByUserId: systemActor.id,
        },
      });
      try {
        assert.equal((await request(route, administrator.id)).status, 403);
      } finally {
        await db.userPermissionDenial.delete({ where: { id: denial.id } });
      }
      assert.equal((await request(route, administrator.id)).status, 200);
      await db.user.update({
        where: { id: administrator.id },
        data: { status: "LOCKED" },
      });
      try {
        assert.equal((await request(route, administrator.id)).status, 403);
      } finally {
        await db.user.update({
          where: { id: administrator.id },
          data: { status: "ACTIVE" },
        });
      }
      assert.equal((await request(route, administrator.id)).status, 200);
    },
  );

  await context.test(
    "supplier staff detail allows every target status, projects safe values and hides foreign, admin and missing targets alike",
    async () => {
      const route = "/api/supplier-staff/";
      const organization = await db.supplier.create({
        data: { name: "Staff detail supplier " + randomUUID() },
      });
      const foreignOrganization = await db.supplier.create({
        data: { name: "Staff detail foreign supplier " + randomUUID() },
      });
      const administrator = await user("INGREDIENT_SUPPLIER_ADMIN", {
        supplierId: organization.id,
      });
      const foreignAdministrator = await user("INGREDIENT_SUPPLIER_ADMIN", {
        supplierId: foreignOrganization.id,
      });
      const foreignStaff = await user("INGREDIENT_SUPPLIER_STAFF", {
        supplierId: foreignOrganization.id,
      });
      const staffRole = await role("INGREDIENT_SUPPLIER_STAFF");
      const createdAt = new Date("2026-01-01T01:02:03.000Z");
      const updatedAt = new Date("2026-01-02T04:05:06.000Z");
      const fixtures = [];
      for (const [index, state] of [
        "UNVERIFIED",
        "ACTIVE",
        "INACTIVE",
        "LOCKED",
        "DEACTIVATED",
      ].entries()) {
        const member = await user("INGREDIENT_SUPPLIER_STAFF", {
          supplierId: organization.id,
        });
        fixtures.push(
          await db.user.update({
            where: { id: member.id },
            data: {
              status: state as
                "UNVERIFIED" | "ACTIVE" | "INACTIVE" | "LOCKED" | "DEACTIVATED",
              phone: index % 2 ? "0909123456" : null,
              fullName: "Staff detail " + state,
              createdAt,
              updatedAt,
            },
          }),
        );
      }
      const tokens = await authSessions.issue(administrator.id);
      issued.set(administrator.id, tokens);
      refreshTokens.push(tokens.refreshToken);
      for (const member of fixtures) {
        const response = await request(route + member.id, administrator.id);
        assert.equal(response.status, 200, JSON.stringify(response.body));
        const data = record(record(response.body).data);
        assert.deepEqual(Object.keys(data).sort(), [
          "createdAt",
          "email",
          "fullName",
          "id",
          "phone",
          "roleCode",
          "roleName",
          "status",
          "supplierId",
          "updatedAt",
          "username",
        ]);
        assert.deepEqual(data, {
          id: member.id,
          username: member.username,
          fullName: member.fullName,
          email: member.email,
          phone: member.phone,
          roleCode: "INGREDIENT_SUPPLIER_STAFF",
          roleName: staffRole.name,
          status: member.status,
          supplierId: organization.id,
          createdAt: createdAt.toISOString(),
          updatedAt: updatedAt.toISOString(),
        });
        assert(!JSON.stringify(data).includes(passwordHash));
        assert.equal(
          new Date(String(data.createdAt)).toISOString(),
          data.createdAt,
        );
        assert.equal(
          new Date(String(data.updatedAt)).toISOString(),
          data.updatedAt,
        );
      }
      const missing = await request(route + randomUUID(), administrator.id);
      assert.equal(missing.status, 404);
      assert.equal(
        record(missing.body).message,
        "Không tìm thấy tài khoản nhân viên",
      );
      for (const targetId of [
        foreignStaff.id,
        foreignAdministrator.id,
        administrator.id,
        staffA.id,
        system.id,
      ]) {
        const hidden = await request(route + targetId, administrator.id);
        assert.equal(hidden.status, 404);
        assert.deepEqual(hidden.body, missing.body);
      }
      for (const targetId of ["not-a-uuid", "123", randomUUID() + "-extra"]) {
        const invalid = await request(route + targetId, administrator.id);
        assert.equal(invalid.status, 400);
      }
      const member = fixtures[0];
      assert.equal(
        (
          await request(
            route + member.id + "?supplierId=" + foreignOrganization.id,
            administrator.id,
          )
        ).status,
        400,
      );
      const manage = await permission("supplier_staff.manage");
      const denial = await db.userPermissionDenial.create({
        data: {
          userId: administrator.id,
          permissionId: manage.id,
          supplierId: organization.id,
          disabledByUserId: system.id,
        },
      });
      try {
        assert.equal(
          (await request(route + member.id, administrator.id)).status,
          403,
        );
      } finally {
        await db.userPermissionDenial.delete({ where: { id: denial.id } });
      }
      assert.equal(
        (await request(route + member.id, administrator.id)).status,
        200,
      );
    },
  );

  await context.test(
    "supplier staff creation preserves scoped usernames, global email uniqueness and email-only identity under concurrent requests",
    async (testContext) => {
      const initialReads = createBarrier(2);
      let duplicateReads = 0;
      const readDuplicate = supplierStaffRepository.duplicateExists.bind(
        supplierStaffRepository,
      );
      testContext.mock.method(
        supplierStaffRepository,
        "duplicateExists",
        async (...args: Parameters<typeof readDuplicate>) => {
          const exists = await readDuplicate(...args);
          // Force the first two independent suppliers to establish overlapping snapshots.
          if (++duplicateReads <= 2) await initialReads.wait();
          return exists;
        },
      );
      const route = "/api/supplier-staff";
      const suffix = randomUUID().replaceAll("-", "");
      const organizations = await Promise.all(
        [0, 1].map((index) =>
          db.supplier.create({
            data: { name: `Staff create ${suffix} ${index}` },
          }),
        ),
      );
      const administrators = await Promise.all(
        organizations.map((organization) =>
          user("INGREDIENT_SUPPLIER_ADMIN", { supplierId: organization.id }),
        ),
      );
      for (const administrator of administrators) {
        const tokens = await authSessions.issue(administrator.id);
        issued.set(administrator.id, tokens);
        refreshTokens.push(tokens.refreshToken);
      }
      const initialPassword = " StaffCreate123! ";
      const sharedUsername = "shared_" + suffix;
      const staffRole = await role("INGREDIENT_SUPPLIER_STAFF");
      const beforeGrants = await db.rolePermission.findMany({
        where: { roleId: staffRole.id },
        orderBy: { permissionId: "asc" },
      });
      const createPayload = (username: string, email: string) => ({
        username,
        email,
        fullName: " Created staff ",
        password: initialPassword,
      });
      const sharedResponses = await Promise.all(
        administrators.map((administrator, index) =>
          request(route, administrator.id, "POST", {
            ...createPayload(
              " " + sharedUsername + " ",
              ` SHARED-${index}-${suffix}@EXAMPLE.TEST `,
            ),
            ...(index === 0 ? { phone: " 0909123456 " } : {}),
          }),
        ),
      );
      const accounts = [];
      for (const [index, response] of sharedResponses.entries()) {
        assert.equal(response.status, 201, JSON.stringify(response.body));
        assert.deepEqual(
          response.headers.getSetCookie(),
          [],
          "Creating staff does not issue a session",
        );
        const data = record(record(response.body).data);
        assert.deepEqual(Object.keys(data).sort(), [
          "createdAt",
          "email",
          "fullName",
          "id",
          "phone",
          "roleCode",
          "roleName",
          "status",
          "supplierId",
          "updatedAt",
          "username",
        ]);
        assert.equal(data.username, sharedUsername);
        assert.equal(data.fullName, "Created staff");
        assert.equal(data.email, `shared-${index}-${suffix}@example.test`);
        assert.equal(data.phone, index === 0 ? "0909123456" : null);
        assert.equal(data.supplierId, organizations[index].id);
        assert.equal(data.roleCode, "INGREDIENT_SUPPLIER_STAFF");
        assert.equal(data.roleName, staffRole.name);
        assert.equal(data.status, "ACTIVE");
        assert.equal(typeof data.id, "string");
        assert.equal(
          new Date(String(data.createdAt)).toISOString(),
          data.createdAt,
        );
        assert.equal(
          new Date(String(data.updatedAt)).toISOString(),
          data.updatedAt,
        );
        const persisted = await db.user.findUniqueOrThrow({
          where: { id: String(data.id) },
        });
        assert.equal(persisted.roleId, staffRole.id);
        assert.equal(persisted.roleCode, "INGREDIENT_SUPPLIER_STAFF");
        assert.equal(persisted.supplierId, organizations[index].id);
        assert.equal(persisted.schoolId, null);
        assert.equal(persisted.communeFoodSafetyUnitId, null);
        assert.equal(persisted.emailVerifiedAt, null);
        assert.equal(persisted.status, "ACTIVE");
        assert.equal(
          await bcrypt.compare(initialPassword, persisted.passwordHash),
          true,
        );
        assert.equal(
          await bcrypt.compare(initialPassword.trim(), persisted.passwordHash),
          false,
        );
        assert.equal(bcrypt.getRounds(persisted.passwordHash), 12);
        assert(!JSON.stringify(data).includes(initialPassword));
        assert(!JSON.stringify(data).includes(persisted.passwordHash));
        assert.equal(
          await db.registrationRequest.count({
            where: { applicantUserId: persisted.id },
          }),
          0,
        );
        assert.equal(
          await db.userPermissionDenial.count({
            where: { userId: persisted.id },
          }),
          0,
        );
        accounts.push(persisted);
      }
      assert.notEqual(accounts[0].id, accounts[1].id);
      assert.deepEqual(
        await db.rolePermission.findMany({
          where: { roleId: staffRole.id },
          orderBy: { permissionId: "asc" },
        }),
        beforeGrants,
      );
      for (const account of accounts) {
        const login = await postPassword("login", {
          identifier: " " + account.email.toUpperCase() + " ",
          password: initialPassword,
        });
        assert.equal(login.status, 200, JSON.stringify(login.body));
        const sessionUser = record(record(record(login.body).data).user);
        assert.equal(sessionUser.id, account.id);
        assert.equal(sessionUser.supplierId, account.supplierId);
        assert.equal(sessionUser.role, "INGREDIENT_SUPPLIER_STAFF");
        assert.equal(sessionUser.orgType, "SUPPLIER");
        assert.equal(sessionUser.onboardingRequired, false);
        assert.equal(sessionUser.registrationRequest, null);
        const expectedPermissions = (await loadPrincipal(account.id, db))
          .permissions;
        assert.deepEqual(sessionUser.permissions, expectedPermissions);
        const cookie = login.headers
          .getSetCookie()
          .map((part) => part.split(";")[0])
          .join("; ");
        const refresh = parseCookie(cookie)[REFRESH_COOKIE];
        assert(refresh);
        refreshTokens.push(refresh);
        verificationKeys.add("foodprint:auth:session:user:" + account.id);
        const who = await http.request("/api/auth/me", {
          headers: { Cookie: cookie },
        });
        assert.equal(who.status, 200);
        assert.equal(record(record(who.body).data).id, account.id);
      }
      const usernameLogin = await postPassword("login", {
        identifier: sharedUsername,
        password: initialPassword,
      });
      assert.equal(usernameLogin.status, 401);
      assert.deepEqual(usernameLogin.headers.getSetCookie(), []);
      const unique = await request(
        route,
        administrators[0].id,
        "POST",
        createPayload("unique_" + suffix, `unique-${suffix}@example.test`),
      );
      assert.equal(unique.status, 201);
      const uniqueUsernameLogin = await postPassword("login", {
        identifier: "unique_" + suffix,
        password: initialPassword,
      });
      assert.equal(uniqueUsernameLogin.status, 401);
      assert.deepEqual(uniqueUsernameLogin.headers.getSetCookie(), []);
      const raceName = "race_" + suffix;
      const usernameRace = await Promise.all(
        [0, 1].map((index) =>
          request(
            route,
            administrators[0].id,
            "POST",
            createPayload(
              raceName,
              `name-race-${index}-${suffix}@example.test`,
            ),
          ),
        ),
      );
      assert.deepEqual(
        usernameRace.map((response) => response.status).sort(),
        [201, 409],
      );
      assert.equal(
        await db.user.count({
          where: { supplierId: organizations[0].id, username: raceName },
        }),
        1,
      );
      assert.equal(
        await db.user.count({
          where: {
            email: {
              in: [0, 1].map(
                (index) => `name-race-${index}-${suffix}@example.test`,
              ),
            },
          },
        }),
        1,
      );
      const adminCollision = await request(
        route,
        administrators[0].id,
        "POST",
        createPayload(
          administrators[0].username,
          `admin-name-${suffix}@example.test`,
        ),
      );
      assert.equal(adminCollision.status, 409);
      assert.equal(
        record(adminCollision.body).message,
        "Tên đăng nhập hoặc email đã được sử dụng",
      );
      assert.equal(
        await db.user.count({
          where: { email: `admin-name-${suffix}@example.test` },
        }),
        0,
      );
      const sharedEmail = `email-race-${suffix}@example.test`;
      const emailRace = await Promise.all(
        administrators.map((administrator, index) =>
          request(
            route,
            administrator.id,
            "POST",
            createPayload(
              "email_race_" + index + "_" + suffix,
              index === 0 ? sharedEmail : sharedEmail.toUpperCase(),
            ),
          ),
        ),
      );
      assert.deepEqual(
        emailRace.map((response) => response.status).sort(),
        [201, 409],
      );
      assert.equal(await db.user.count({ where: { email: sharedEmail } }), 1);
      const otherRole = await user("SCHOOL_NUTRITION_OFFICER", {
        schoolId: schoolA.id,
      });
      await db.user.update({
        where: { id: otherRole.id },
        data: { status: "INACTIVE" },
      });
      const inactiveEmail = await request(
        route,
        administrators[1].id,
        "POST",
        createPayload(
          "inactive_email_" + suffix,
          otherRole.email.toUpperCase(),
        ),
      );
      assert.equal(inactiveEmail.status, 409);
      assert.equal(
        record(inactiveEmail.body).message,
        record(adminCollision.body).message,
      );
      assert.equal(
        await db.user.count({
          where: {
            supplierId: organizations[1].id,
            username: "inactive_email_" + suffix,
          },
        }),
        0,
      );
      const roleRaceEmail = `role-race-${suffix}@example.test`;
      const roleRace = await Promise.all([
        request(
          route,
          administrators[0].id,
          "POST",
          createPayload("role_staff_" + suffix, roleRaceEmail),
        ),
        postPassword("signup", {
          ...createPayload(
            "role_applicant_" + suffix,
            roleRaceEmail.toUpperCase(),
          ),
          requestType: "SCHOOL",
        }),
      ]);
      assert.deepEqual(
        roleRace.map((response) => response.status).sort(),
        [201, 409],
      );
      assert.equal(await db.user.count({ where: { email: roleRaceEmail } }), 1);
      // Username is still case-sensitive data even though it is never a login key.
      const casedName = "Case_" + suffix;
      for (const [index, name] of [
        casedName,
        casedName.toLowerCase(),
      ].entries()) {
        assert.equal(
          (
            await request(
              route,
              administrators[0].id,
              "POST",
              createPayload(name, `case-${index}-${suffix}@example.test`),
            )
          ).status,
          201,
        );
      }
      // Non-staff retain their own username uniqueness without reserving staff names globally.
      const school = await db.school.create({
        data: { name: "Staff create compatibility " + suffix },
      });
      const schoolAdmin = await user("SCHOOL_ADMINISTRATION", {
        schoolId: school.id,
      });
      const schoolTokens = await authSessions.issue(schoolAdmin.id);
      issued.set(schoolAdmin.id, schoolTokens);
      refreshTokens.push(schoolTokens.refreshToken);
      const schoolCreate = (email: string) =>
        request(`/api/schools/${school.id}/accounts`, schoolAdmin.id, "POST", {
          ...createPayload(sharedUsername, email),
          roleCode: "SCHOOL_KITCHEN_STAFF",
        });
      const schoolCreated = await schoolCreate(
        `school-created-${suffix}@example.test`,
      );
      assert.equal(
        schoolCreated.status,
        201,
        JSON.stringify(schoolCreated.body),
      );
      assert.equal(
        (await schoolCreate(`school-duplicate-${suffix}@example.test`)).status,
        409,
      );
      const signupDuplicate = await postPassword("signup", {
        ...createPayload(
          sharedUsername,
          `signup-duplicate-${suffix}@example.test`,
        ),
        requestType: "SCHOOL",
      });
      assert.equal(signupDuplicate.status, 409);
      const signupStaffName = "unique_" + suffix;
      const signupCreated = await postPassword("signup", {
        ...createPayload(
          signupStaffName,
          `signup-created-${suffix}@example.test`,
        ),
        requestType: "SUPPLIER",
      });
      assert.equal(
        signupCreated.status,
        201,
        JSON.stringify(signupCreated.body),
      );
      assert.equal(
        (
          await postPassword("signup", {
            ...createPayload(
              signupStaffName,
              `signup-second-${suffix}@example.test`,
            ),
            requestType: "SCHOOL",
          })
        ).status,
        409,
      );
    },
  );

  await context.test(
    "SC-007 email-only login authenticates every role, collisions and status/onboarding without username fallback",
    async () => {
      const remember = (
        response: Awaited<ReturnType<typeof postPassword>>,
        id: string,
      ) => {
        const cookie = response.headers
          .getSetCookie()
          .map((value) => value.split(";")[0])
          .join("; ");
        const refresh = parseCookie(cookie)[REFRESH_COOKIE];
        assert(refresh);
        refreshTokens.push(refresh);
        verificationKeys.add("foodprint:auth:session:user:" + id);
        return cookie;
      };
      for (const code of Object.values(ROLES)) {
        const scope =
          code === ROLES.SYSTEM_ADMIN
            ? {}
            : code.startsWith("INGREDIENT_SUPPLIER_")
              ? {
                  supplierId: (
                    await db.supplier.create({
                      data: { name: `Email role ${code}` },
                    })
                  ).id,
                }
              : code === ROLES.COMMUNE_FOOD_SAFETY_OFFICER
                ? {
                    communeFoodSafetyUnitId: (
                      await db.communeFoodSafetyUnit.create({
                        data: {
                          code: `LOGIN_${randomUUID()}`,
                          name: "Email officer",
                        },
                      })
                    ).id,
                  }
                : {
                    schoolId: (
                      await db.school.create({
                        data: { name: `Email role ${code}` },
                      })
                    ).id,
                  };
        const account = await user(code, scope);
        const response = await postPassword("login", {
          identifier: ` ${account.email.toUpperCase()} `,
          password,
        });
        assert.equal(response.status, 200, code);
        const identity = record(record(record(response.body).data).user);
        assert.equal(identity.id, account.id);
        assert.equal(identity.role, code);
        assert.equal(identity.supplierId, account.supplierId);
        assert.equal(identity.schoolId, account.schoolId);
        assert.deepEqual(
          identity.permissions,
          (await loadPrincipal(account.id, db)).permissions,
        );
        remember(response, account.id);
        for (const identifier of [
          account.username,
          `unknown-${randomUUID()}@example.test`,
        ]) {
          const denied = await postPassword("login", { identifier, password });
          assert.equal(denied.status, 401, code);
          assert.equal(
            record(denied.body).message,
            "Email hoặc mật khẩu không đúng",
          );
          assert.deepEqual(denied.headers.getSetCookie(), []);
        }
      }
      const ownerA = await user(ROLES.INGREDIENT_SUPPLIER_STAFF, {
        supplierId: supplierA.id,
      });
      const ownerB = await user(ROLES.SCHOOL_NUTRITION_OFFICER, {
        schoolId: schoolA.id,
      });
      const passwordB = "CollisionB123!";
      await db.user.update({
        where: { id: ownerB.id },
        data: {
          username: ownerA.email,
          passwordHash: await bcrypt.hash(passwordB, 4),
        },
      });
      const a = await postPassword("login", {
        identifier: ownerA.email,
        password,
      });
      assert.equal(a.status, 200);
      assert.equal(record(record(record(a.body).data).user).id, ownerA.id);
      remember(a, ownerA.id);
      const wrong = await postPassword("login", {
        identifier: ownerA.email,
        password: passwordB,
      });
      assert.equal(wrong.status, 401);
      assert.deepEqual(wrong.headers.getSetCookie(), []);
      const b = await postPassword("login", {
        identifier: ownerB.email,
        password: passwordB,
      });
      assert.equal(b.status, 200);
      assert.equal(record(record(record(b.body).data).user).id, ownerB.id);
      remember(b, ownerB.id);
      for (const status of [
        "UNVERIFIED",
        "LOCKED",
        "INACTIVE",
        "DEACTIVATED",
      ] as const) {
        await db.user.update({ where: { id: ownerA.id }, data: { status } });
        const denied = await postPassword("login", {
          identifier: ownerA.email,
          password,
        });
        assert.equal(denied.status, 403);
        assert.deepEqual(denied.headers.getSetCookie(), []);
      }
      for (const code of [
        ROLES.SCHOOL_ADMINISTRATION,
        ROLES.INGREDIENT_SUPPLIER_ADMIN,
      ]) {
        const adminRole = await role(code);
        const pending = await db.user.create({
          data: {
            username: `pending-${randomUUID()}`,
            email: `pending-${randomUUID()}@example.test`,
            fullName: "Pending email admin",
            passwordHash,
            roleId: adminRole.id,
            roleCode: code,
            status: "UNVERIFIED",
          },
        });
        assert.equal(
          (await postPassword("login", { identifier: pending.email, password }))
            .status,
          403,
        );
        await db.user.update({
          where: { id: pending.id },
          data: { emailVerifiedAt: new Date() },
        });
        const verified = await postPassword("login", {
          identifier: pending.email,
          password,
        });
        assert.equal(verified.status, 200);
        assert.equal(
          record(record(record(verified.body).data).user).onboardingRequired,
          true,
        );
        remember(verified, pending.id);
      }
    },
  );
  await context.test(
    "staff recovery by email preserves accounts with shared username and email-username collision",
    async () => {
      const a = await user(ROLES.INGREDIENT_SUPPLIER_STAFF, {
        supplierId: supplierA.id,
      });
      const c = await user(ROLES.INGREDIENT_SUPPLIER_STAFF, {
        supplierId: supplierB.id,
      });
      const b = await user(ROLES.SCHOOL_NUTRITION_OFFICER, {
        schoolId: schoolA.id,
      });
      await db.user.update({
        where: { id: c.id },
        data: { username: a.username },
      });
      await db.user.update({
        where: { id: b.id },
        data: { username: a.email },
      });
      const cookies = await Promise.all(
        [a, b, c].map((account) => passwordLogin(account)),
      );
      const before = await db.user.findMany({
        where: { id: { in: [b.id, c.id] } },
        orderBy: { id: "asc" },
      });
      assert.equal(
        (await postPassword("forgot-password", { email: a.email })).status,
        200,
      );
      const code = resetCodes.get(a.email);
      assert(code);
      const grant = await postPassword("forgot-password/verify", {
        email: a.email,
        code,
      });
      assert.equal(grant.status, 200);
      const resetToken = record(record(grant.body).data).resetToken;
      assert.equal(
        (
          await postPassword("reset-password", {
            resetToken,
            newPassword: "StaffReset123!",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await http.request("/api/auth/me", {
            headers: { Cookie: cookies[0] },
          })
        ).status,
        401,
      );
      for (const cookie of cookies.slice(1))
        assert.equal(
          (await http.request("/api/auth/me", { headers: { Cookie: cookie } }))
            .status,
          200,
        );
      assert.deepEqual(
        await db.user.findMany({
          where: { id: { in: [b.id, c.id] } },
          orderBy: { id: "asc" },
        }),
        before,
      );
      assert(
        await bcrypt.compare(
          "StaffReset123!",
          (await db.user.findUniqueOrThrow({ where: { id: a.id } }))
            .passwordHash,
        ),
      );
    },
  );
  await context.test(
    "supplier staff locking blocks live access and refresh, unlocking preserves denials and history and paused intake stays independent",
    async () => {
      const suffix = randomUUID().replaceAll("-", "");
      const organization = await db.supplier.create({
        data: { name: "Staff status " + suffix },
      });
      const foreignOrganization = await db.supplier.create({
        data: { name: "Staff status foreign " + suffix },
      });
      const administrator = await user("INGREDIENT_SUPPLIER_ADMIN", {
        supplierId: organization.id,
      });
      const staff = await user("INGREDIENT_SUPPLIER_STAFF", {
        supplierId: organization.id,
      });
      const foreign = await user("INGREDIENT_SUPPLIER_STAFF", {
        supplierId: foreignOrganization.id,
      });
      await db.user.update({
        where: { id: foreign.id },
        data: { username: staff.username },
      });
      const adminTokens = await authSessions.issue(administrator.id);
      issued.set(administrator.id, adminTokens);
      refreshTokens.push(adminTokens.refreshToken);
      const route = `/api/supplier-staff/${staff.id}/status`;
      const manage = await permission("delivery.manage");
      const denial = await db.userPermissionDenial.create({
        data: {
          userId: staff.id,
          permissionId: manage.id,
          supplierId: organization.id,
          disabledByUserId: administrator.id,
        },
      });
      const history = await db.sourceFacility.create({
        data: {
          supplierId: organization.id,
          name: "Staff historical source " + suffix,
          createdByUserId: staff.id,
          updatedByUserId: administrator.id,
        },
      });
      const oldCookie = await passwordLogin(staff);
      const foreignCookie = await passwordLogin(foreign);
      const before = await db.user.findUniqueOrThrow({
        where: { id: staff.id },
      });
      const foreignBefore = await db.user.findUniqueOrThrow({
        where: { id: foreign.id },
      });
      const preservedFields = (account: typeof staff) => ({
        id: account.id,
        username: account.username,
        email: account.email,
        passwordHash: account.passwordHash,
        fullName: account.fullName,
        phone: account.phone,
        roleId: account.roleId,
        roleCode: account.roleCode,
        schoolId: account.schoolId,
        supplierId: account.supplierId,
        communeFoodSafetyUnitId: account.communeFoodSafetyUnitId,
        emailVerifiedAt: account.emailVerifiedAt,
        intakeState: account.intakeState,
        createdAt: account.createdAt,
      });
      const allowed = await loadPrincipal(staff.id, db);
      assert(allowed.permissions.includes("supply_request.view"));
      assert(!allowed.permissions.includes("delivery.manage"));
      assert.equal(
        (
          await http.request("/api/supply-requests", {
            headers: { Cookie: oldCookie },
          })
        ).status,
        200,
      );
      const locked = await request(route, administrator.id, "PATCH", {
        status: "LOCKED",
      });
      assert.equal(locked.status, 200, JSON.stringify(locked.body));
      const lockedData = record(record(locked.body).data);
      assert.equal(lockedData.id, staff.id);
      assert.equal(lockedData.status, "LOCKED");
      const afterLock = await db.user.findUniqueOrThrow({
        where: { id: staff.id },
      });
      assert.equal(afterLock.status, "LOCKED");
      assert.deepEqual(preservedFields(afterLock), preservedFields(before));
      assert.equal(lockedData.updatedAt, afterLock.updatedAt.toISOString());
      const sameLocked = await request(route, administrator.id, "PATCH", {
        status: "LOCKED",
      });
      assert.equal(sameLocked.status, 200);
      assert.equal(
        record(record(sameLocked.body).data).updatedAt,
        afterLock.updatedAt.toISOString(),
      );
      assert.deepEqual(
        await db.user.findUniqueOrThrow({ where: { id: staff.id } }),
        afterLock,
      );
      const refusedLogin = await postPassword("login", {
        identifier: staff.email,
        password,
      });
      assert.equal(refusedLogin.status, 403);
      assert.deepEqual(refusedLogin.headers.getSetCookie(), []);
      for (const path of ["/api/auth/me", "/api/supply-requests"]) {
        assert.equal(
          (await http.request(path, { headers: { Cookie: oldCookie } })).status,
          403,
        );
        assert.equal(
          (await http.request(path, { headers: { Cookie: foreignCookie } }))
            .status,
          200,
        );
      }
      assert.equal((await postPassword("refresh", {}, oldCookie)).status, 403);
      assert.deepEqual(
        await db.user.findUniqueOrThrow({ where: { id: foreign.id } }),
        foreignBefore,
      );
      const opened = await request(route, administrator.id, "PATCH", {
        status: "ACTIVE",
      });
      assert.equal(opened.status, 200, JSON.stringify(opened.body));
      assert.equal(record(record(opened.body).data).status, "ACTIVE");
      const afterOpen = await db.user.findUniqueOrThrow({
        where: { id: staff.id },
      });
      assert.deepEqual(preservedFields(afterOpen), preservedFields(before));
      const sameActive = await request(route, administrator.id, "PATCH", {
        status: "ACTIVE",
      });
      assert.equal(sameActive.status, 200);
      assert.equal(
        record(record(sameActive.body).data).updatedAt,
        afterOpen.updatedAt.toISOString(),
      );
      assert.deepEqual(
        await db.user.findUniqueOrThrow({ where: { id: staff.id } }),
        afterOpen,
      );
      const newCookie = await passwordLogin(staff);
      const me = await http.request("/api/auth/me", {
        headers: { Cookie: newCookie },
      });
      assert.equal(me.status, 200);
      const permissions = record(record(me.body).data).permissions;
      assert(Array.isArray(permissions));
      assert(!permissions.includes("delivery.manage"));
      assert.equal(
        (
          await http.request("/api/supply-requests", {
            headers: { Cookie: newCookie },
          })
        ).status,
        200,
      );
      assert.deepEqual(
        await db.userPermissionDenial.findUniqueOrThrow({
          where: { id: denial.id },
        }),
        denial,
      );
      assert.deepEqual(
        await db.sourceFacility.findUniqueOrThrow({
          where: { id: history.id },
        }),
        history,
      );
      for (const status of ["UNVERIFIED", "INACTIVE", "DEACTIVATED"] as const) {
        const unsupported = await user("INGREDIENT_SUPPLIER_STAFF", {
          supplierId: organization.id,
        });
        const original = await db.user.update({
          where: { id: unsupported.id },
          data: { status },
        });
        for (const requested of ["ACTIVE", "LOCKED"]) {
          const refused = await request(
            `/api/supplier-staff/${unsupported.id}/status`,
            administrator.id,
            "PATCH",
            { status: requested },
          );
          assert.equal(refused.status, 409);
          assert.equal(
            record(refused.body).message,
            "Trạng thái tài khoản không hỗ trợ khóa hoặc mở khóa",
          );
          assert.deepEqual(
            await db.user.findUniqueOrThrow({ where: { id: unsupported.id } }),
            original,
          );
        }
      }
      const foreignStatus = await request(
        `/api/supplier-staff/${foreign.id}/status`,
        administrator.id,
        "PATCH",
        { status: "LOCKED" },
      );
      assert.equal(foreignStatus.status, 404);
      assert.deepEqual(
        await db.user.findUniqueOrThrow({ where: { id: foreign.id } }),
        foreignBefore,
      );
      for (const intakeState of [
        "PAUSED_FOR_FOOD_SAFETY_INSPECTION",
      ] as const) {
        await db.supplier.update({
          where: { id: organization.id },
          data: { intakeState },
        });
        for (const status of ["LOCKED", "ACTIVE"]) {
          const changed = await request(route, administrator.id, "PATCH", {
            status,
          });
          assert.equal(changed.status, 200, JSON.stringify(changed.body));
          assert.equal(record(record(changed.body).data).status, status);
          assert.equal(
            (
              await db.supplier.findUniqueOrThrow({
                where: { id: organization.id },
              })
            ).intakeState,
            intakeState,
          );
          assert.equal(
            (
              await db.user.findUniqueOrThrow({
                where: { id: administrator.id },
              })
            ).status,
            "ACTIVE",
          );
        }
      }
      assert.deepEqual(
        await db.userPermissionDenial.findUniqueOrThrow({
          where: { id: denial.id },
        }),
        denial,
      );
      assert.deepEqual(
        await db.sourceFacility.findUniqueOrThrow({
          where: { id: history.id },
        }),
        history,
      );
      assert.deepEqual(
        await db.user.findUniqueOrThrow({ where: { id: foreign.id } }),
        foreignBefore,
      );
    },
  );

  await context.test(
    "supplier staff permissions apply to the next request, preserve scoped denials and reject inactive, foreign or ungranted targets",
    async () => {
      const suffix = randomUUID().replaceAll("-", "");
      const organization = await db.supplier.create({
        data: { name: "Staff permissions " + suffix },
      });
      const foreignOrganization = await db.supplier.create({
        data: { name: "Staff permissions foreign " + suffix },
      });
      const administrator = await user("INGREDIENT_SUPPLIER_ADMIN", {
        supplierId: organization.id,
      });
      const staff = await user("INGREDIENT_SUPPLIER_STAFF", {
        supplierId: organization.id,
      });
      const colleague = await user("INGREDIENT_SUPPLIER_STAFF", {
        supplierId: organization.id,
      });
      const foreign = await user("INGREDIENT_SUPPLIER_STAFF", {
        supplierId: foreignOrganization.id,
      });
      await db.user.update({
        where: { id: foreign.id },
        data: { username: staff.username },
      });
      const tokens = await authSessions.issue(administrator.id);
      issued.set(administrator.id, tokens);
      refreshTokens.push(tokens.refreshToken);
      const cookies = await Promise.all(
        [staff, colleague, foreign].map((account) => passwordLogin(account)),
      );
      const route = `/api/supplier-staff/${staff.id}/permissions`;
      const view = await permission("supply_request.view");
      const denialRoute = `/api/supplier-staff/${staff.id}/permission-denials/${view.id}`;
      const state = (body: unknown, permissionId: string) => {
        const data = record(record(body).data);
        assert(Array.isArray(data.permissions));
        return data.permissions
          .map((item: unknown) => record(item))
          .find((item) => item.id === permissionId);
      };
      const read = await request(route, administrator.id);
      assert.equal(read.status, 200, JSON.stringify(read.body));
      const data = record(record(read.body).data);
      assert.deepEqual(Object.keys(data).sort(), [
        "permissions",
        "roleId",
        "userId",
      ]);
      assert.equal(data.userId, staff.id);
      assert.equal(data.roleId, staff.roleId);
      assert(Array.isArray(data.permissions));
      const items = data.permissions.map((item: unknown) => record(item));
      assert.deepEqual(
        items.map((item) => item.code),
        items.map((item) => item.code).sort(),
      );
      for (const item of items)
        assert.deepEqual(Object.keys(item).sort(), [
          "action",
          "code",
          "description",
          "enabled",
          "id",
          "isActive",
          "module",
          "name",
        ]);
      assert.equal(state(read.body, view.id)?.enabled, true);
      for (const cookie of cookies)
        assert.equal(
          (
            await http.request("/api/supply-requests", {
              headers: { Cookie: cookie },
            })
          ).status,
          200,
        );
      const disabled = await request(denialRoute, administrator.id, "PUT");
      assert.equal(disabled.status, 200, JSON.stringify(disabled.body));
      assert.equal(state(disabled.body, view.id)?.enabled, false);
      const denials = await db.userPermissionDenial.findMany({
        where: { userId: staff.id, permissionId: view.id },
      });
      assert.equal(denials.length, 1);
      assert.equal(denials[0].supplierId, organization.id);
      assert.equal(denials[0].disabledByUserId, administrator.id);
      const disabledUser = await db.user.findUniqueOrThrow({
        where: { id: staff.id },
      });
      const repeated = await request(denialRoute, administrator.id, "PUT", {});
      assert.equal(repeated.status, 200);
      assert.equal(state(repeated.body, view.id)?.enabled, false);
      assert.deepEqual(
        await db.userPermissionDenial.findMany({
          where: { userId: staff.id, permissionId: view.id },
        }),
        denials,
      );
      assert.deepEqual(
        await db.user.findUniqueOrThrow({ where: { id: staff.id } }),
        disabledUser,
      );
      assert.equal(
        (
          await http.request("/api/supply-requests", {
            headers: { Cookie: cookies[0] },
          })
        ).status,
        403,
      );
      for (const cookie of cookies.slice(1))
        assert.equal(
          (
            await http.request("/api/supply-requests", {
              headers: { Cookie: cookie },
            })
          ).status,
          200,
        );
      assert.equal(
        await db.userPermissionDenial.count({
          where: { userId: { in: [colleague.id, foreign.id] } },
        }),
        0,
      );
      const grant = await db.rolePermission.findUniqueOrThrow({
        where: {
          roleId_permissionId: { roleId: staff.roleId, permissionId: view.id },
        },
      });
      const replaceGrant = async (present: boolean) =>
        authorizationTransaction(db, async (tx) => {
          await tx.$queryRaw`SELECT id FROM foodprint.roles WHERE id = ${staff.roleId}::uuid FOR UPDATE`;
          if (present)
            await tx.rolePermission.createMany({
              data: [grant],
              skipDuplicates: true,
            });
          else
            await tx.rolePermission.deleteMany({
              where: { roleId: staff.roleId, permissionId: view.id },
            });
          await permissionConcurrencyRepository.touchRole(tx, staff.roleId);
        });
      try {
        await replaceGrant(false);
        const revoked = await request(route, administrator.id);
        assert.equal(revoked.status, 200);
        assert.equal(state(revoked.body, view.id), undefined);
        assert.equal(
          (await request(denialRoute, administrator.id, "DELETE")).status,
          400,
        );
        assert.deepEqual(
          await db.userPermissionDenial.findMany({
            where: { userId: staff.id, permissionId: view.id },
          }),
          denials,
        );
      } finally {
        await replaceGrant(true);
      }
      const inheritedAgain = await request(route, administrator.id);
      assert.equal(state(inheritedAgain.body, view.id)?.enabled, false);
      assert.equal(
        (
          await http.request("/api/supply-requests", {
            headers: { Cookie: cookies[0] },
          })
        ).status,
        403,
      );
      const enabled = await request(
        denialRoute,
        administrator.id,
        "DELETE",
        {},
      );
      assert.equal(enabled.status, 200);
      assert.equal(state(enabled.body, view.id)?.enabled, true);
      assert.equal(
        await db.userPermissionDenial.count({
          where: { userId: staff.id, permissionId: view.id },
        }),
        0,
      );
      const enabledUser = await db.user.findUniqueOrThrow({
        where: { id: staff.id },
      });
      assert.equal(
        (await request(denialRoute, administrator.id, "DELETE")).status,
        200,
      );
      assert.deepEqual(
        await db.user.findUniqueOrThrow({ where: { id: staff.id } }),
        enabledUser,
      );
      assert.equal(
        (
          await http.request("/api/supply-requests", {
            headers: { Cookie: cookies[0] },
          })
        ).status,
        200,
      );
      const inactivePermission = await db.permission.create({
        data: {
          code: `staff_fixture_${suffix}.inactive`,
          name: "Inactive fixture",
          module: "staff_fixture",
          action: "inactive",
          isActive: false,
        },
      });
      const outsidePermission = await db.permission.create({
        data: {
          code: `staff_fixture_${suffix}.outside`,
          name: "Outside fixture",
          module: "staff_fixture",
          action: "outside",
        },
      });
      await db.rolePermission.create({
        data: { roleId: staff.roleId, permissionId: inactivePermission.id },
      });
      try {
        const inactive = state(
          (await request(route, administrator.id)).body,
          inactivePermission.id,
        );
        assert(inactive);
        assert.equal(inactive.isActive, false);
        assert.equal(inactive.enabled, false);
        for (const permissionId of [
          inactivePermission.id,
          outsidePermission.id,
          randomUUID(),
        ]) {
          for (const method of ["PUT", "DELETE"]) {
            assert.equal(
              (
                await request(
                  `/api/supplier-staff/${staff.id}/permission-denials/${permissionId}`,
                  administrator.id,
                  method,
                )
              ).status,
              400,
            );
          }
        }
        assert.equal(
          await db.userPermissionDenial.count({ where: { userId: staff.id } }),
          0,
        );
      } finally {
        await db.rolePermission.deleteMany({
          where: { roleId: staff.roleId, permissionId: inactivePermission.id },
        });
        await db.permission.deleteMany({
          where: { id: { in: [inactivePermission.id, outsidePermission.id] } },
        });
      }
      const locked = await user("INGREDIENT_SUPPLIER_STAFF", {
        supplierId: organization.id,
      });
      await db.user.update({
        where: { id: locked.id },
        data: { status: "LOCKED" },
      });
      await db.user.update({
        where: { id: foreign.id },
        data: { status: "LOCKED" },
      });
      const missing = await request(
        `/api/supplier-staff/${randomUUID()}/permissions`,
        administrator.id,
      );
      assert.equal(missing.status, 404);
      for (const target of [foreign, administrator]) {
        for (const [method, suffix] of [
          ["GET", "/permissions"],
          ["PUT", `/permission-denials/${view.id}`],
          ["DELETE", `/permission-denials/${view.id}`],
        ]) {
          const response = await request(
            `/api/supplier-staff/${target.id}` + suffix,
            administrator.id,
            method,
          );
          assert.equal(response.status, 404);
          assert.equal(
            record(response.body).message,
            record(missing.body).message,
          );
        }
      }
      for (const [method, suffix] of [
        ["GET", "/permissions"],
        ["PUT", `/permission-denials/${view.id}`],
        ["DELETE", `/permission-denials/${view.id}`],
      ]) {
        assert.equal(
          (
            await request(
              `/api/supplier-staff/${locked.id}` + suffix,
              administrator.id,
              method,
            )
          ).status,
          403,
        );
      }
      assert.equal(
        (await request(denialRoute, administrator.id, "PUT", { enabled: true }))
          .status,
        400,
      );
      assert.equal(
        (
          await request(
            denialRoute + "?supplierId=" + foreignOrganization.id,
            administrator.id,
            "DELETE",
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            `/api/supplier-staff/${staff.id}/permission-denials/not-a-uuid`,
            administrator.id,
            "PUT",
          )
        ).status,
        400,
      );
    },
  );

  await context.test(
    "supplier staff permission mutations recheck revoked actors, changed grants and status, serialize competing toggles and roll back failed writes",
    async () => {
      const organization = await db.supplier.create({
        data: { name: "Staff permission races " + randomUUID() },
      });
      const administrator = await user("INGREDIENT_SUPPLIER_ADMIN", {
        supplierId: organization.id,
      });
      const staff = await user("INGREDIENT_SUPPLIER_STAFF", {
        supplierId: organization.id,
      });
      const tokens = await authSessions.issue(administrator.id);
      issued.set(administrator.id, tokens);
      refreshTokens.push(tokens.refreshToken);
      const manage = await permission("supplier_staff.manage");
      const view = await permission("supply_request.view");
      const params = { userId: staff.id, permissionId: view.id };
      const repository = createSupplierStaffRepository(() =>
        Promise.resolve(db),
      );
      const normal = createSupplierStaffService(repository, () =>
        Promise.resolve(db),
      );
      const actorGrant = await db.rolePermission.findUniqueOrThrow({
        where: {
          roleId_permissionId: {
            roleId: administrator.roleId,
            permissionId: manage.id,
          },
        },
      });
      const targetGrant = await db.rolePermission.findUniqueOrThrow({
        where: {
          roleId_permissionId: { roleId: staff.roleId, permissionId: view.id },
        },
      });
      const setGrant = async (
        grant: { roleId: string; permissionId: string; assignedAt: Date },
        present: boolean,
      ) =>
        authorizationTransaction(db, async (tx) => {
          await tx.$queryRaw`SELECT id FROM foodprint.roles WHERE id = ${grant.roleId}::uuid FOR UPDATE`;
          if (present)
            await tx.rolePermission.createMany({
              data: [grant],
              skipDuplicates: true,
            });
          else
            await tx.rolePermission.deleteMany({
              where: { roleId: grant.roleId, permissionId: grant.permissionId },
            });
          await permissionConcurrencyRepository.touchRole(tx, grant.roleId);
        });
      const targetDenials = () =>
        db.userPermissionDenial.findMany({
          where: {
            userId: staff.id,
            supplierId: organization.id,
            permissionId: view.id,
          },
        });
      const pausedToggle = async (disabled: boolean) => {
        const principal = await loadPrincipal(administrator.id, db);
        let reached!: () => void;
        let release!: () => void;
        const entering = new Promise<void>((resolve) => {
          reached = resolve;
        });
        const resume = new Promise<void>((resolve) => {
          release = resolve;
        });
        let first = true;
        let actorReads = 0;
        const service = createSupplierStaffService(
          {
            ...repository,
            async actor(...args) {
              actorReads += 1;
              return repository.actor(...args);
            },
            async lock(...args) {
              if (first) {
                first = false;
                reached();
                await resume;
              }
              await repository.lock(...args);
            },
          },
          () => Promise.resolve(db),
        );
        const pending = service.togglePermission(params, disabled, principal);
        try {
          await Promise.race([
            entering,
            pending.then(() => {
              throw new Error(
                "Permission mutation ended before its lock barrier",
              );
            }),
          ]);
        } catch (error) {
          release();
          throw error;
        }
        return { pending, release, reads: () => actorReads };
      };
      const rejectedStatus = (status: number) => (error: unknown) =>
        error instanceof HttpError && error.statusCode === status;

      const deniedActor = await pausedToggle(true);
      let actorDenialId: string | undefined;
      try {
        actorDenialId = await authorizationTransaction(db, async (tx) => {
          await tx.$queryRaw`SELECT id FROM foodprint.users WHERE id = ${administrator.id}::uuid FOR UPDATE`;
          const denial = await tx.userPermissionDenial.create({
            data: {
              userId: administrator.id,
              permissionId: manage.id,
              supplierId: organization.id,
              disabledByUserId: system.id,
            },
          });
          await permissionConcurrencyRepository.touchUser(tx, administrator.id);
          return denial.id;
        });
      } finally {
        deniedActor.release();
      }
      try {
        await assert.rejects(deniedActor.pending, rejectedStatus(403));
        assert(
          deniedActor.reads() >= 2,
          "Actor revocation invalidates the stale authorization snapshot",
        );
        assert.deepEqual(await targetDenials(), []);
      } finally {
        if (actorDenialId)
          await authorizationTransaction(db, async (tx) => {
            await tx.userPermissionDenial.delete({
              where: { id: actorDenialId },
            });
            await permissionConcurrencyRepository.touchUser(
              tx,
              administrator.id,
            );
          });
      }
      const revokedActor = await pausedToggle(true);
      try {
        await setGrant(actorGrant, false);
      } finally {
        revokedActor.release();
      }
      try {
        await assert.rejects(revokedActor.pending, rejectedStatus(403));
        assert(
          revokedActor.reads() >= 2,
          "Role grant revocation retries/rechecks the old actor snapshot",
        );
        assert.deepEqual(await targetDenials(), []);
      } finally {
        await setGrant(actorGrant, true);
      }
      let principal = await loadPrincipal(administrator.id, db);
      await normal.togglePermission(params, true, principal);
      const retainedDenial = await targetDenials();
      assert.equal(retainedDenial.length, 1);
      const targetGrantRemoved = await pausedToggle(false);
      try {
        await setGrant(targetGrant, false);
      } finally {
        targetGrantRemoved.release();
      }
      try {
        await assert.rejects(targetGrantRemoved.pending, rejectedStatus(400));
        assert(targetGrantRemoved.reads() >= 2);
        assert.deepEqual(await targetDenials(), retainedDenial);
        assert(
          !(await loadPrincipal(staff.id, db)).permissions.includes(view.code),
        );
      } finally {
        await setGrant(targetGrant, true);
      }
      const targetLocked = await pausedToggle(false);
      try {
        const changed = await request(
          `/api/supplier-staff/${staff.id}/status`,
          administrator.id,
          "PATCH",
          { status: "LOCKED" },
        );
        assert.equal(changed.status, 200, JSON.stringify(changed.body));
      } finally {
        targetLocked.release();
      }
      try {
        await assert.rejects(targetLocked.pending, rejectedStatus(403));
        assert(targetLocked.reads() >= 2);
        assert.deepEqual(await targetDenials(), retainedDenial);
      } finally {
        assert.equal(
          (
            await request(
              `/api/supplier-staff/${staff.id}/status`,
              administrator.id,
              "PATCH",
              { status: "ACTIVE" },
            )
          ).status,
          200,
        );
      }
      principal = await loadPrincipal(administrator.id, db);
      await normal.togglePermission(params, false, principal);
      const concurrent = async (directions: [boolean, boolean]) => {
        const barrier = createBarrier(2);
        const metrics = [{ reads: 0 }, { reads: 0 }];
        const services = metrics.map((metric) =>
          createSupplierStaffService(
            {
              ...repository,
              async actor(...args) {
                const actor = await repository.actor(...args);
                metric.reads += 1;
                if (metric.reads === 1) await barrier.wait();
                return actor;
              },
            },
            () => Promise.resolve(db),
          ),
        );
        const results = await Promise.all(
          services.map((service, index) =>
            service.togglePermission(params, directions[index], principal),
          ),
        );
        assert.equal(results.length, 2);
        const denials = await targetDenials();
        assert(denials.length <= 1);
        const effective = await loadPrincipal(staff.id, db);
        assert.equal(
          effective.permissions.includes(view.code),
          denials.length === 0,
        );
        const response = await normal.getPermissions(
          { userId: staff.id },
          principal,
        );
        assert.equal(
          response.permissions.find((item) => item.id === view.id)?.enabled,
          denials.length === 0,
        );
        assert(metrics[0].reads + metrics[1].reads >= 4);
      };
      await concurrent([true, true]);
      assert.equal((await targetDenials()).length, 1);
      await concurrent([true, false]);
      await normal.togglePermission(params, false, principal);
      const beforeFailure = await db.user.findUniqueOrThrow({
        where: { id: staff.id },
      });
      const failing = createSupplierStaffService(
        {
          ...repository,
          async disablePermission(...args) {
            await repository.disablePermission(...args);
            throw new HttpError(409, "Injected denial write rollback");
          },
        },
        () => Promise.resolve(db),
      );
      await assert.rejects(
        failing.togglePermission(params, true, principal),
        rejectedStatus(409),
      );
      assert.deepEqual(await targetDenials(), []);
      assert.deepEqual(
        await db.user.findUniqueOrThrow({ where: { id: staff.id } }),
        beforeFailure,
      );
      assert(
        (await loadPrincipal(staff.id, db)).permissions.includes(view.code),
      );
    },
  );

  await context.test(
    "supplier intake: scoped list/detail, independent permissions and immutable receipt",
    async () => {
      const organization = await db.supplier.create({
        data: { name: "Intake supplier " + randomUUID() },
      });
      const school = await db.school.create({
        data: { name: "Intake school " + randomUUID() },
      });
      const schoolAdmin = await user("SCHOOL_ADMINISTRATION", {
        schoolId: school.id,
      });
      const manager = await user("INGREDIENT_SUPPLIER_ADMIN", {
        supplierId: organization.id,
      });
      const member = await user("INGREDIENT_SUPPLIER_STAFF", {
        supplierId: organization.id,
      });
      for (const account of [manager, member]) {
        const session = await authSessions.issue(account.id);
        issued.set(account.id, session);
        refreshTokens.push(session.refreshToken);
      }
      const ingredient = await db.ingredient.create({
        data: {
          supplierId: organization.id,
          name: "Intake historical rice",
          defaultUnit: "bag",
          status: "INACTIVE",
        },
      });
      const entry = await db.ingredientEntry.create({
        data: {
          schoolId: school.id,
          ingredientId: ingredient.id,
          handlingType: "DRY_STOCK",
          status: "INACTIVE",
        },
      });
      const otherIngredient = await db.ingredient.create({
        data: {
          supplierId: organization.id,
          name: "Intake second ingredient",
          defaultUnit: "kg",
        },
      });
      const otherEntry = await db.ingredientEntry.create({
        data: {
          schoolId: school.id,
          ingredientId: otherIngredient.id,
          handlingType: "DRY_STOCK",
        },
      });
      const makeOrder = (
        status:
          | "DRAFT"
          | "SENT"
          | "ACCEPTED"
          | "IN_PROGRESS"
          | "COMPLETED"
          | "CANCELLED",
      ) =>
        db.supplyRequest.create({
          data: {
            requestNo: randomUUID(),
            schoolId: school.id,
            supplierId: organization.id,
            createdByUserId: schoolAdmin.id,
            status,
            requestedDeliveryDate: new Date("2026-11-21"),
            sentAt:
              status === "DRAFT" ? null : new Date("2026-11-14T00:00:00Z"),
            note: "school note",
            contractSnapshot: { privateQuote: "do not expose" },
            supplyRequestItems: {
              create: [
                {
                  ingredientEntryId: entry.id,
                  requestedQuantity: "12345678901.123",
                  unit: "kg",
                  note: "line note",
                },
                {
                  ingredientEntryId: otherEntry.id,
                  requestedQuantity: "2.125",
                  unit: "g",
                },
              ],
            },
          },
        });
      const draft = await makeOrder("DRAFT"),
        sent = await makeOrder("SENT");
      const history = await makeOrder("ACCEPTED");
      await db.supplyRequest.update({
        where: { id: history.id },
        data: { sentAt: null },
      });
      for (const status of ["IN_PROGRESS", "COMPLETED", "CANCELLED"] as const)
        await makeOrder(status);
      for (const account of [manager, member]) {
        const list = await request("/api/supply-requests", account.id);
        assert.equal(list.status, 200);
        const items = rows(list.body);
        assert.equal(items.length, 5);
        assert(
          items.every(
            (x) => x.supplierId === organization.id && x.status !== "DRAFT",
          ),
        );
        assert(items.some((x) => x.id === history.id && x.sentAt === null));
        assert(
          items.every(
            (x) =>
              x.schoolName === school.name &&
              x.requestedDeliveryDate === "2026-11-21",
          ),
        );
        const filtered = await request(
          "/api/supply-requests?status=SENT&limit=1",
          account.id,
        );
        assert.deepEqual(
          rows(filtered.body).map((x) => x.id),
          [sent.id],
        );
        assert.deepEqual(record(record(filtered.body).data).pagination, {
          page: 1,
          limit: 1,
          hasNext: false,
        });
        assert.equal(
          (await request("/api/supply-requests?status=DRAFT", account.id))
            .status,
          400,
        );
        const detail = await request(
          `/api/supply-requests/${sent.id}`,
          account.id,
        );
        assert.equal(detail.status, 200);
        const data = record(record(detail.body).data);
        assert.equal(data.schoolName, school.name);
        const lines = data.items as Record<string, unknown>[];
        assert.equal(lines.length, 2);
        const line = lines.find((x) => x.ingredientEntryId === entry.id)!;
        assert.equal(line.ingredientName, ingredient.name);
        assert.equal(line.requestedQuantity, "12345678901.123");
        assert.equal(
          line.unit,
          "kg",
          "must not substitute current defaultUnit",
        );
        assert.equal(data.acceptedByUserId, null);
        assert.equal(data.acceptedAt, null);
        for (const key of [
          "contractSnapshot",
          "email",
          "phone",
          "passwordHash",
        ])
          assert(!JSON.stringify(detail.body).includes(key));
        for (const id of [draft.id, randomUUID()]) {
          assert.equal(
            (await request(`/api/supply-requests/${id}`, account.id)).status,
            404,
          );
          assert.equal(
            (
              await request(
                `/api/supply-requests/${id}/accept`,
                account.id,
                "POST",
                {},
              )
            ).status,
            404,
          );
        }
      }
      for (const method of ["GET", "POST"])
        assert.equal(
          (
            await request(
              `/api/supply-requests/${sent.id}${method === "POST" ? "/accept" : ""}`,
              supplierStaffB.id,
              method,
              method === "POST" ? {} : undefined,
            )
          ).status,
          404,
        );
      const view = await permission("supply_request.view"),
        accept = await permission("supply_request.accept");
      await db.userPermissionDenial.create({
        data: {
          userId: member.id,
          permissionId: view.id,
          supplierId: organization.id,
          disabledByUserId: manager.id,
        },
      });
      try {
        assert.equal(
          (await request("/api/supply-requests", member.id)).status,
          403,
        );
        assert.equal(
          (await request(`/api/supply-requests/${sent.id}`, member.id)).status,
          403,
        );
        const result = await request(
          `/api/supply-requests/${sent.id}/accept`,
          member.id,
          "POST",
          {},
        );
        assert.equal(result.status, 200, "accept does not require view");
        const receipt = record(record(result.body).data);
        assert.equal(receipt.acceptedByUserId, member.id);
        assert.deepEqual(Object.keys(receipt).sort(), [
          "acceptedAt",
          "acceptedByUserId",
          "id",
          "status",
        ]);
        const accepted = await db.supplyRequest.findUniqueOrThrow({
          where: { id: sent.id },
        });
        await db.supplier.update({
          where: { id: organization.id },
          data: { intakeState: "PAUSED_FOR_FOOD_SAFETY_INSPECTION" },
        });
        assert.deepEqual(
          record(
            record(
              (
                await request(
                  `/api/supply-requests/${sent.id}/accept`,
                  manager.id,
                  "POST",
                  {},
                )
              ).body,
            ).data,
          ),
          receipt,
        );
        const retry = await db.supplyRequest.findUniqueOrThrow({
          where: { id: sent.id },
        });
        assert.deepEqual(retry.updatedAt, accepted.updatedAt);
        assert.equal(retry.acceptedByUserId, member.id);
      } finally {
        await db.userPermissionDenial.deleteMany({
          where: { userId: member.id, permissionId: view.id },
        });
        await db.supplier.update({
          where: { id: organization.id },
          data: { intakeState: "ACTIVE" },
        });
      }
      await db.userPermissionDenial.create({
        data: {
          userId: member.id,
          permissionId: accept.id,
          supplierId: organization.id,
          disabledByUserId: manager.id,
        },
      });
      try {
        assert.equal(
          (await request(`/api/supply-requests/${sent.id}`, member.id)).status,
          200,
        );
        assert.equal(
          (
            await request(
              `/api/supply-requests/${sent.id}/accept`,
              member.id,
              "POST",
              {},
            )
          ).status,
          403,
        );
      } finally {
        await db.userPermissionDenial.deleteMany({
          where: { userId: member.id, permissionId: accept.id },
        });
      }
      const managerOrder = await makeOrder("SENT");
      assert.equal(
        (
          await request(
            `/api/supply-requests/${managerOrder.id}/accept`,
            manager.id,
            "POST",
            {},
          )
        ).status,
        200,
      );
      const detailAfter = record(
        record(
          (await request(`/api/supply-requests/${managerOrder.id}`, member.id))
            .body,
        ).data,
      );
      assert.equal(detailAfter.status, "ACCEPTED");
      assert.equal(detailAfter.acceptedByUserId, manager.id);
    },
  );

  await context.test(
    "supplier intake: concurrent receivers keep one receipt and failed writes roll back",
    async () => {
      const makeOrder = () =>
        db.supplyRequest.create({
          data: {
            requestNo: randomUUID(),
            schoolId: schoolA.id,
            supplierId: supplierA.id,
            createdByUserId: adminA.id,
            status: "SENT",
          },
        });
      const order = await makeOrder();
      const actors = await Promise.all(
        [supplierAdmin, supplierStaffA].map((x) => loadPrincipal(x.id, db)),
      );
      const rendezvous = createBarrier(2);
      const seen = new Set<string>();
      const locks = createIntakeAccessRepository();
      const guard = createIntakeAccessService({
        ...locks,
        async lockParents(tx, scope) {
          const actorId = scope.userIds![0];
          if (!seen.has(actorId)) {
            seen.add(actorId);
            await rendezvous.wait();
          }
          await locks.lockParents(tx, scope);
        },
      });
      const service = createSupplyOrderService(undefined, {
        transaction: (fn) => authorizationTransaction(db, fn),
        guard,
      });
      const results = await Promise.all(
        actors.map((actor) => service.accept({ id: order.id }, actor)),
      );
      assert.deepEqual(results[0], results[1]);
      assert(actors.some((actor) => actor.id === results[0].acceptedByUserId));
      const stored = await db.supplyRequest.findUniqueOrThrow({
        where: { id: order.id },
      });
      assert.equal(stored.status, "ACCEPTED");
      assert.equal(stored.acceptedByUserId, results[0].acceptedByUserId);
      assert.equal(stored.acceptedAt!.toISOString(), results[0].acceptedAt);
      await createSupplyOrderService().accept({ id: order.id }, actors[1]);
      assert.deepEqual(
        (await db.supplyRequest.findUniqueOrThrow({ where: { id: order.id } }))
          .updatedAt,
        stored.updatedAt,
      );
      const rollback = await makeOrder();
      const repository = createSupplyOrderRepository();
      const failing = createSupplyOrderService({
        ...repository,
        async accept(...args) {
          await repository.accept(...args);
          throw new HttpError(409, "Injected transaction failure");
        },
      });
      await assert.rejects(
        () => failing.accept({ id: rollback.id }, actors[0]),
        (error: unknown) =>
          error instanceof HttpError && error.statusCode === 409,
      );
      const unchanged = await db.supplyRequest.findUniqueOrThrow({
        where: { id: rollback.id },
      });
      assert.equal(unchanged.status, "SENT");
      assert.equal(unchanged.acceptedByUserId, null);
      assert.equal(unchanged.acceptedAt, null);
      assert.deepEqual(unchanged.updatedAt, rollback.updatedAt);
    },
  );

  await context.test(
    "supplier intake: cancellation winning the lock order prevents a partial acceptance",
    async () => {
      const actor = await loadPrincipal(supplierStaffA.id, db);
      const order = await db.supplyRequest.create({
        data: {
          requestNo: randomUUID(),
          schoolId: schoolA.id,
          supplierId: supplierA.id,
          createdByUserId: adminA.id,
          status: "SENT",
        },
      });
      const locks = createIntakeAccessRepository();
      let held!: () => void, release!: () => void, attempted!: () => void;
      const holding = new Promise<void>((resolve) => {
        held = resolve;
      });
      const proceed = new Promise<void>((resolve) => {
        release = resolve;
      });
      const entering = new Promise<void>((resolve) => {
        attempted = resolve;
      });
      const cancelling = authorizationTransaction(db, async (tx) => {
        await locks.lockParents(tx, {
          schoolId: schoolA.id,
          supplierId: supplierA.id,
        });
        await locks.lockOrder(tx, order.id);
        await tx.supplyRequest.update({
          where: { id: order.id },
          data: { status: "CANCELLED" },
        });
        held();
        await proceed;
      });
      await Promise.race([
        holding,
        cancelling.then(() => {
          throw new Error("Cancellation ended before barrier");
        }),
      ]);
      const service = createSupplyOrderService(undefined, {
        transaction: (fn) => authorizationTransaction(db, fn),
        guard: createIntakeAccessService({
          ...locks,
          async lockParents(tx, scope) {
            attempted();
            await locks.lockParents(tx, scope);
          },
        }),
      });
      const pending = service.accept({ id: order.id }, actor);
      const rejected = assert.rejects(
        () => pending,
        (error: unknown) =>
          error instanceof HttpError && error.statusCode === 409,
      );
      try {
        await Promise.race([
          entering,
          pending.then(() => {
            throw new Error("Accept ended before barrier");
          }),
        ]);
      } finally {
        release();
      }
      await Promise.all([cancelling, rejected]);
      const unchanged = await db.supplyRequest.findUniqueOrThrow({
        where: { id: order.id },
      });
      assert.equal(unchanged.status, "CANCELLED");
      assert.equal(unchanged.acceptedAt, null);
      assert.equal(unchanged.acceptedByUserId, null);
    },
  );

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
          schoolId: historySchool.id,
          supplierId: owner.supplier.id,
          // Historical delivery fixture; no creation key/fingerprint from the management API.
          creationMode: null,
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
          ingredientId: historyIngredient.id,
          ingredientEntryId: historyEntry.id,
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
          ["PATCH", "/" + ingredientA.id + "/status"],
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
        for (const method of ["GET", "PATCH", "STATUS"]) {
          const response = await request(
            base + "/" + foreignId + (method === "STATUS" ? "/status" : ""),
            supplierAdmin.id,
            method === "STATUS" ? "PATCH" : method,
            method === "PATCH"
              ? { name: "Refused" }
              : method === "STATUS"
                ? { status: "ACTIVE" }
                : undefined,
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
        (
          await request(
            base + "/" + id + "/status",
            supplierAdmin.id,
            "PATCH",
            { status: "INACTIVE" },
          )
        ).status,
        200,
      );
      const hidden = await db.ingredient.findUniqueOrThrow({ where: { id } });
      assert.equal(hidden.status, "INACTIVE");
      assert.equal(
        (
          await request(
            base + "/" + id + "/status",
            supplierAdmin.id,
            "PATCH",
            { status: "INACTIVE" },
          )
        ).status,
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
      // A pre-existing hidden ingredient can be restored without recreating it.
      const beforeCycles = await db.ingredient.findUniqueOrThrow({
        where: { id },
      });
      for (let cycle = 0; cycle < 3; cycle++) {
        for (const status of ["ACTIVE", "INACTIVE"] as const) {
          const changed = await request(
            base + "/" + id + "/status",
            supplierAdmin.id,
            "PATCH",
            { status },
          );
          assert.equal(changed.status, 200, JSON.stringify(changed.body));
          assert.equal(record(record(changed.body).data).status, status);
          const after = await db.ingredient.findUniqueOrThrow({
            where: { id },
          });
          assert.equal(after.status, status);
          assert.equal(after.id, beforeCycles.id);
          assert.equal(after.supplierId, beforeCycles.supplierId);
          assert.equal(after.name, beforeCycles.name);
          assert.equal(after.description, beforeCycles.description);
          assert.equal(after.categoryId, beforeCycles.categoryId);
          assert.equal(after.coverImage, beforeCycles.coverImage);
          assert.deepEqual(
            after.imageDescription,
            beforeCycles.imageDescription,
          );
          assert.equal(+after.createdAt, +beforeCycles.createdAt);
          const repeated = await request(
            base + "/" + id + "/status",
            supplierAdmin.id,
            "PATCH",
            { status },
          );
          assert.equal(repeated.status, 200);
          assert.equal(
            +(await db.ingredient.findUniqueOrThrow({ where: { id } }))
              .updatedAt,
            +after.updatedAt,
          );
          assert.equal(
            (
              await db.ingredientEntry.findUniqueOrThrow({
                where: { id: entry.id },
              })
            ).ingredientId,
            id,
          );
          const detail = await request(base + "/" + id, supplierAdmin.id);
          assert.equal(record(record(detail.body).data).status, status);
        }
      }
      assert.equal(
        (await request(base + "/" + id + "/hide", supplierAdmin.id, "POST"))
          .status,
        404,
      );
      assert.equal(
        (await db.ingredient.findUniqueOrThrow({ where: { id } })).status,
        "INACTIVE",
      );
      const beforeRollback = await db.ingredient.findUniqueOrThrow({
        where: { id },
      });
      const faultService = createIngredientService({
        ...ingredientRepository,
        async changeStatus(...args) {
          await ingredientRepository.changeStatus(...args);
          throw new Error("private driver details");
        },
      });
      const currentActor = await loadPrincipal(supplierAdmin.id, db);
      await assert.rejects(
        () =>
          faultService.changeStatus(
            { ingredientId: id },
            { status: "ACTIVE" },
            currentActor,
          ),
        (error: unknown) =>
          error instanceof HttpError &&
          error.statusCode === 503 &&
          !error.message.includes("private driver details"),
      );
      const afterRollback = await db.ingredient.findUniqueOrThrow({
        where: { id },
      });
      assert.equal(afterRollback.status, beforeRollback.status);
      assert.equal(+afterRollback.updatedAt, +beforeRollback.updatedAt);
      let attempts = 0;
      const conflictService = createIngredientService({
        ...ingredientRepository,
        changeStatus() {
          attempts++;
          return Promise.reject(
            Object.assign(new Error("test conflict"), { code: "P2034" }),
          );
        },
      });
      await assert.rejects(
        () =>
          conflictService.changeStatus(
            { ingredientId: id },
            { status: "ACTIVE" },
            currentActor,
          ),
        (error: unknown) =>
          error instanceof HttpError && error.statusCode === 503,
      );
      assert.equal(attempts, 3);
      assert.equal(
        (await db.ingredient.findUniqueOrThrow({ where: { id } })).status,
        "INACTIVE",
      );

      // A school with no other suppliers makes both option lists deterministic.
      const optionsSchool = await db.school.create({
        data: { name: "Status options " + id },
      });
      const optionsRelationship = await db.schoolSupplierRelationship.create({
        data: {
          schoolId: optionsSchool.id,
          supplierId: supplierA.id,
          status: "ACTIVE",
        },
      });
      const optionsEntry = await db.ingredientEntry.create({
        data: {
          schoolId: optionsSchool.id,
          ingredientId: id,
          handlingType: "DRY_STOCK",
          status: "ACTIVE",
        },
      });
      const optionsUser = await user("SCHOOL_NUTRITION_OFFICER", {
        schoolId: optionsSchool.id,
      });
      const ingredientReader = await user("INGREDIENT_MANAGEMENT_DEPARTMENT", {
        schoolId: optionsSchool.id,
      });
      const ingredientReaderSession = await authSessions.issue(
        ingredientReader.id,
      );
      issued.set(ingredientReader.id, ingredientReaderSession);
      refreshTokens.push(ingredientReaderSession.refreshToken);
      const optionsActor = await loadPrincipal(optionsUser.id, db);
      const menus = createMenuService(undefined, () => Promise.resolve(db));
      const optionList = async (kind: "main" | "seasoning") =>
        menus.getIngredientOptions(kind, { page: 1, limit: 100 }, optionsActor);
      const includesIngredient = (
        items: { id?: unknown; ingredientId?: unknown }[],
      ) => items.some((row) => row.id === id || row.ingredientId === id);
      const schoolIngredients = async () => {
        const result = await request(
          "/api/ingredients?limit=100",
          ingredientReader.id,
        );
        assert.equal(result.status, 200);
        return rows(result.body);
      };
      assert(!includesIngredient(await schoolIngredients()));
      assert(!includesIngredient((await optionList("main")).items));
      assert(!includesIngredient((await optionList("seasoning")).items));
      assert.equal(
        (
          await request(
            base + "/" + id + "/status",
            supplierAdmin.id,
            "PATCH",
            { status: "ACTIVE" },
          )
        ).status,
        200,
      );
      assert(includesIngredient((await optionList("main")).items));
      assert(includesIngredient((await optionList("seasoning")).items));
      assert(includesIngredient(await schoolIngredients()));
      await db.schoolSupplierRelationship.update({
        where: { id: optionsRelationship.id },
        data: {
          status: "SUSPENDED",
          suspendedAt: new Date(),
          suspensionReason: "Status selection test",
        },
      });
      assert(!includesIngredient(await schoolIngredients()));
      assert(!includesIngredient((await optionList("main")).items));
      // Seasoning selection is based on the school's active entry, independently of supplier relationships.
      assert(includesIngredient((await optionList("seasoning")).items));
      await db.schoolSupplierRelationship.update({
        where: { id: optionsRelationship.id },
        data: { status: "ACTIVE", suspendedAt: null, suspensionReason: null },
      });
      assert(includesIngredient(await schoolIngredients()));
      await db.ingredientEntry.update({
        where: { id: optionsEntry.id },
        data: { status: "INACTIVE" },
      });
      assert(!includesIngredient((await optionList("seasoning")).items));
      assert(includesIngredient((await optionList("main")).items));
      assert.equal(
        (
          await request(
            base + "/" + id + "/status",
            supplierAdmin.id,
            "PATCH",
            { status: "INACTIVE" },
          )
        ).status,
        200,
      );
      assert(!includesIngredient((await optionList("main")).items));
      assert(!includesIngredient(await schoolIngredients()));

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
          base + "/" + raceItems[0].id + "/status",
          supplierAdmin.id,
          "PATCH",
          { status: "INACTIVE" },
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
      assert.equal(
        (
          await db.ingredient.findUniqueOrThrow({
            where: { id: raceItems[0].id },
          })
        ).description,
        "Concurrent edit",
      );
      for (const status of ["ACTIVE", "INACTIVE"] as const) {
        const concurrent = await Promise.all(
          [1, 2].map(() =>
            request(
              base + "/" + raceItems[0].id + "/status",
              supplierAdmin.id,
              "PATCH",
              { status },
            ),
          ),
        );
        assert(concurrent.every((response) => response.status === 200));
        assert.equal(
          (
            await db.ingredient.findUniqueOrThrow({
              where: { id: raceItems[0].id },
            })
          ).status,
          status,
        );
      }
      // Start both operations together, then release the second only after the first commits.
      const rendezvous = createBarrier(2);
      let releaseSecond!: () => void;
      const firstCommitted = new Promise<void>((resolve) => {
        releaseSecond = resolve;
      });
      let firstStarted = false;
      let secondStarted = false;
      const firstService = createIngredientService({
        ...ingredientRepository,
        async lockSupplier(scope, tx) {
          if (!firstStarted) {
            firstStarted = true;
            await rendezvous.wait();
          }
          return ingredientRepository.lockSupplier(scope, tx);
        },
      });
      const secondService = createIngredientService({
        ...ingredientRepository,
        async lockSupplier(scope, tx) {
          if (!secondStarted) {
            secondStarted = true;
            await rendezvous.wait();
          }
          await firstCommitted;
          return ingredientRepository.lockSupplier(scope, tx);
        },
      });
      const first = firstService
        .changeStatus(
          { ingredientId: raceItems[0].id },
          { status: "ACTIVE" },
          currentActor,
        )
        .finally(releaseSecond);
      const second = secondService.changeStatus(
        { ingredientId: raceItems[0].id },
        { status: "INACTIVE" },
        currentActor,
      );
      const [firstResult, secondResult] = await Promise.all([first, second]);
      assert.equal(firstResult.status, "ACTIVE");
      assert.equal(secondResult.status, "INACTIVE");
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
      for (const status of ["ACTIVE", "INACTIVE"] as const) {
        await assert.rejects(
          () =>
            ingredientService.changeStatus(
              { ingredientId: id },
              { status },
              staleActor,
            ),
          (error: unknown) =>
            error instanceof HttpError && error.statusCode === 403,
        );
      }
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
          ingredientService.changeStatus(
            { ingredientId: id },
            { status: "INACTIVE" },
            staleActor,
          ),
        (error: unknown) =>
          error instanceof HttpError && error.statusCode === 403,
      );
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
          ingredientService.changeStatus(
            { ingredientId: id },
            { status: "ACTIVE" },
            staleActor,
          ),
        (error: unknown) =>
          error instanceof HttpError && error.statusCode === 403,
      );
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
      await db.ingredientEntry.delete({ where: { id: optionsEntry.id } });
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
    assert.match(String(detail.registrationID), /^FP-RG-[0-9]{5}$/);
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
        body: JSON.stringify({ identifier: system.email, password }),
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
        body: JSON.stringify({ identifier: system.email, password }),
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
          where: { email: body.email },
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
            identifier: body.email,
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
            identifier: body.email,
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
                identifier: email,
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
        assert.match(String(data.registrationID), /^FP-RG-[0-9]{5}$/);
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
    "role permission management US1 preserves inactive grants, denials and complete concurrent saves",
    async () => {
      const roleId = staffA.roleId;
      const original = await db.rolePermission.findMany({ where: { roleId } });
      const principal = await loadPrincipal(system.id, db);
      const repo = createPermissionRepository(() => Promise.resolve(db));
      const service = createPermissionService(() => Promise.resolve(db), repo);
      const code = "rp_" + randomUUID().replaceAll("-", "");
      const a = await db.permission.create({
        data: {
          code: code + ".first",
          name: "RP first",
          module: code,
          action: "first",
        },
      });
      const b = await db.permission.create({
        data: {
          code: code + ".second",
          name: "RP second",
          module: code,
          action: "second",
          isActive: false,
        },
      });
      const deny = await db.userPermissionDenial.create({
        data: {
          userId: staffA.id,
          permissionId: a.id,
          schoolId: schoolA.id,
          disabledByUserId: adminA.id,
        },
      });
      const snapshot = () =>
        db.rolePermission.findMany({
          where: { roleId },
          orderBy: { permissionId: "asc" },
        });
      try {
        await db.rolePermission.create({
          data: { roleId, permissionId: b.id },
        });
        const kept = await db.rolePermission.findUniqueOrThrow({
          where: { roleId_permissionId: { roleId, permissionId: b.id } },
        });
        await service.replaceRole(principal, roleId, [a.id, b.id]);
        assert.equal(
          (
            await db.rolePermission.findUniqueOrThrow({
              where: { roleId_permissionId: { roleId, permissionId: b.id } },
            })
          ).assignedAt.toISOString(),
          kept.assignedAt.toISOString(),
        );
        assert(
          await db.userPermissionDenial.findUnique({ where: { id: deny.id } }),
        );
        assert(
          !(await loadPrincipal(staffA.id, db)).permissions.includes(a.code),
        );
        assert(
          (await loadPrincipal(staffB.id, db)).permissions.includes(a.code),
        );
        await service.replaceRole(principal, roleId, [a.id]);
        await assert.rejects(
          service.replaceRole(principal, roleId, [a.id, b.id]),
          (e: unknown) => e instanceof HttpError && e.statusCode === 400,
        );
        const before = await snapshot();
        await assert.rejects(
          service.replaceRole(principal, system.roleId, []),
          (e: unknown) => e instanceof HttpError && e.statusCode === 403,
        );
        const faulty = createPermissionService(() => Promise.resolve(db), {
          ...repo,
          async replaceGrants(...args) {
            await repo.replaceGrants(...args);
            throw new Error("test rollback");
          },
        });
        await assert.rejects(
          faulty.replaceRole(principal, roleId, []),
          (e: unknown) => e instanceof HttpError && e.statusCode === 503,
        );
        assert.deepEqual(await snapshot(), before);
        const barrier = createBarrier(2);
        const counts = [0, 0];
        const competing = counts.map((_, i) =>
          createPermissionService(() => Promise.resolve(db), {
            ...repo,
            async lockSystem(...args) {
              if (++counts[i] === 1) await barrier.wait();
              return repo.lockSystem(...args);
            },
          }),
        );
        const outcomes = await Promise.allSettled([
          competing[0].replaceRole(principal, roleId, [a.id]),
          competing[1].replaceRole(principal, roleId, []),
        ]);
        assert(outcomes.every((result) => result.status === "fulfilled"));
        const final = (await snapshot()).map((row) => row.permissionId);
        assert(final.length === 0 || (final.length === 1 && final[0] === a.id));
        assert(
          await db.userPermissionDenial.findUnique({ where: { id: deny.id } }),
        );
        const roles = await request("/api/roles?limit=100", system.id);
        assert.equal(roles.status, 200);
        assert.equal(
          rows(roles.body).find((r) => r.code === "SYSTEM_ADMIN")?.editable,
          false,
        );
        assert.equal(
          (await request("/api/roles?schoolId=" + schoolB.id, system.id))
            .status,
          400,
        );
      } finally {
        await db.rolePermission.deleteMany({ where: { roleId } });
        if (original.length)
          await db.rolePermission.createMany({ data: original });
        await db.userPermissionDenial.deleteMany({ where: { id: deny.id } });
        await db.permission.deleteMany({ where: { id: { in: [a.id, b.id] } } });
      }
    },
  );

  await context.test(
    "role permission management US2 global state, guard races and self-disable",
    async () => {
      const code = "rp_" + randomUUID().replaceAll("-", "");
      const p = await db.permission.create({
        data: {
          code: code + ".state",
          name: "RP state",
          module: code,
          action: "state",
        },
      });
      const race = await db.permission.create({
        data: {
          code: code + ".race",
          name: "RP race",
          module: code,
          action: "race",
        },
      });
      const original = await db.rolePermission.findMany({
        where: { roleId: staffA.roleId },
      });
      await db.rolePermission.createMany({
        data: [
          { roleId: system.roleId, permissionId: p.id },
          { roleId: staffA.roleId, permissionId: p.id },
        ],
      });
      const denial = await db.userPermissionDenial.create({
        data: {
          userId: staffA.id,
          permissionId: p.id,
          schoolId: schoolA.id,
          disabledByUserId: adminA.id,
        },
      });
      const repo = createPermissionRepository(() => Promise.resolve(db));
      const service = createPermissionService(() => Promise.resolve(db), repo);
      const principal = await loadPrincipal(system.id, db);
      const guard = await permission("role_permission.manage");
      const grantsSnapshot = () =>
        db.rolePermission.findMany({
          orderBy: [{ roleId: "asc" }, { permissionId: "asc" }],
        });
      const denialSnapshot = () =>
        db.userPermissionDenial.findMany({ orderBy: { id: "asc" } });
      const signal = () => {
        let release!: () => void;
        const promise = new Promise<void>((resolve) => {
          release = resolve;
        });
        return { promise, release };
      };
      const baseIds = [...original.map((g) => g.permissionId), p.id];
      try {
        const grants = await grantsSnapshot(),
          denials = await denialSnapshot();
        const route = "/api/permissions/" + p.id + "/state";
        assert.equal(
          (await request(route, system.id, "PATCH", { isActive: false }))
            .status,
          200,
        );
        for (const account of [system, staffA, staffB])
          assert(
            !(await loadPrincipal(account.id, db)).permissions.includes(p.code),
          );
        assert.equal(
          (await request(route, system.id, "PATCH", { isActive: false }))
            .status,
          200,
        );
        assert.equal(
          (await request(route, system.id, "PATCH", { isActive: true })).status,
          200,
        );
        assert(
          (await loadPrincipal(staffB.id, db)).permissions.includes(p.code),
        );
        assert(
          (await loadPrincipal(system.id, db)).permissions.includes(p.code),
        );
        assert(
          !(await loadPrincipal(staffA.id, db)).permissions.includes(p.code),
        );
        assert.deepEqual(await grantsSnapshot(), grants);
        assert.deepEqual(await denialSnapshot(), denials);
        for (const offFirst of [true, false]) {
          await db.permission.update({
            where: { id: race.id },
            data: { isActive: true },
          });
          await service.replaceRole(principal, staffA.roleId, baseIds);
          const entered = signal(),
            resume = signal();
          let locks = 0;
          const paused = createPermissionService(() => Promise.resolve(db), {
            ...repo,
            async lockSystem(...args) {
              if (++locks === 1) {
                entered.release();
                await resume.promise;
              }
              return repo.lockSystem(...args);
            },
          });
          const pending = Promise.allSettled([
            offFirst
              ? paused.replaceRole(principal, staffA.roleId, [
                  ...baseIds,
                  race.id,
                ])
              : paused.setPermissionState(principal, race.id, {
                  isActive: false,
                }),
          ]);
          try {
            await entered.promise;
            if (offFirst)
              await service.setPermissionState(principal, race.id, {
                isActive: false,
              });
            else
              await service.replaceRole(principal, staffA.roleId, [
                ...baseIds,
                race.id,
              ]);
          } finally {
            resume.release();
          }
          const [outcome] = await pending;
          if (offFirst) {
            assert.equal(outcome.status, "rejected");
            if (outcome.status === "rejected")
              assert(
                outcome.reason instanceof HttpError &&
                  outcome.reason.statusCode === 400,
              );
          } else assert.equal(outcome.status, "fulfilled");
          assert.equal(
            await db.rolePermission.count({
              where: { roleId: staffA.roleId, permissionId: race.id },
            }),
            offFirst ? 0 : 1,
          );
          assert.equal(
            (await db.permission.findUniqueOrThrow({ where: { id: race.id } }))
              .isActive,
            false,
          );
          if (offFirst)
            assert(locks >= 2, "stale permission snapshot must retry");
        }
        // A state change must invalidate a stale permission snapshot. A grant
        // change alone may serialize without retry when no permission row changed.
        const schoolRole = await role("SCHOOL_KITCHEN_STAFF");
        for (const mutation of ["status", "role", "guard"] as const) {
          for (const commitFirst of [true, false]) {
            await db.permission.update({
              where: { id: p.id },
              data: { isActive: true },
            });
            const actor = await user("SYSTEM_ADMIN");
            const actorPrincipal = await loadPrincipal(actor.id, db);
            const entered = signal(),
              resume = signal();
            let calls = 0;
            const paused = createPermissionService(() => Promise.resolve(db), {
              ...repo,
              async lockSystem(...args) {
                const first = ++calls === 1;
                if (first && commitFirst) {
                  entered.release();
                  await resume.promise;
                }
                await repo.lockSystem(...args);
                if (first && !commitFirst) {
                  entered.release();
                  await resume.promise;
                }
              },
            });
            const revoke = () =>
              mutation === "guard"
                ? db.permission.update({
                    where: { id: guard.id },
                    data: { isActive: false },
                  })
                : db.user.update({
                    where: { id: actor.id },
                    data:
                      mutation === "status"
                        ? { status: "LOCKED" }
                        : {
                            roleId: schoolRole.id,
                            roleCode: schoolRole.code,
                            schoolId: schoolA.id,
                          },
                  });
            const pending = Promise.allSettled([
              paused.setPermissionState(actorPrincipal, p.id, {
                isActive: false,
              }),
            ]);
            let revoking: Promise<unknown> | undefined;
            try {
              await entered.promise;
              if (commitFirst) await revoke();
              else revoking = Promise.resolve(revoke());
            } finally {
              resume.release();
            }
            try {
              const [outcome] = await pending;
              await revoking;
              if (commitFirst) {
                assert.equal(
                  outcome.status,
                  "rejected",
                  mutation + " commits before point of acceptance",
                );
                if (outcome.status === "rejected")
                  assert(
                    outcome.reason instanceof HttpError &&
                      outcome.reason.statusCode === 403,
                  );
              } else
                assert.equal(
                  outcome.status,
                  "fulfilled",
                  mutation + " waits until the accepted write commits",
                );
              assert.equal(
                (await db.permission.findUniqueOrThrow({ where: { id: p.id } }))
                  .isActive,
                commitFirst,
              );
              await assert.rejects(
                service.setPermissionState(actorPrincipal, p.id, {
                  isActive: true,
                }),
                (error: unknown) =>
                  error instanceof HttpError && error.statusCode === 403,
              );
            } finally {
              await db.permission.update({
                where: { id: guard.id },
                data: { isActive: true },
              });
              await db.user.delete({ where: { id: actor.id } });
            }
          }
        }
        const statesBarrier = createBarrier(2);
        const stateCalls = [0, 0];
        const stateServices = stateCalls.map((_, index) =>
          createPermissionService(() => Promise.resolve(db), {
            ...repo,
            async lockSystem(...args) {
              if (++stateCalls[index] === 1) await statesBarrier.wait();
              return repo.lockSystem(...args);
            },
          }),
        );
        const states = await Promise.all(
          stateServices.map((writer, index) =>
            writer.setPermissionState(principal, p.id, {
              isActive: Boolean(index),
            }),
          ),
        );
        assert.deepEqual(
          states.map((row) => row.isActive),
          [false, true],
        );
        assert.equal(
          (
            await request(
              "/api/permissions/" + guard.id + "/state",
              system.id,
              "PATCH",
              { isActive: false },
            )
          ).status,
          200,
        );
        assert.equal(
          (await request(route, system.id, "PATCH", { isActive: false }))
            .status,
          403,
        );
      } finally {
        await db.permission.update({
          where: { id: guard.id },
          data: { isActive: true },
        });
        await db.rolePermission.deleteMany({
          where: { roleId: staffA.roleId },
        });
        if (original.length)
          await db.rolePermission.createMany({ data: original });
        await db.rolePermission.deleteMany({
          where: { permissionId: { in: [p.id, race.id] } },
        });
        await db.userPermissionDenial.deleteMany({ where: { id: denial.id } });
        await db.permission.deleteMany({
          where: { id: { in: [p.id, race.id] } },
        });
      }
    },
  );

  await context.test(
    "role permission management US3 create uniqueness and unassigned defaults",
    async () => {
      const principal = await loadPrincipal(system.id, db);
      const repo = createPermissionRepository(() => Promise.resolve(db));
      const code = "rp_" + randomUUID().replaceAll("-", "") + ".create";
      const body = {
        code,
        name: "RP create",
        module: "rp",
        action: "create",
        description: null,
      };
      const before = await db.rolePermission.findMany({
        orderBy: [{ roleId: "asc" }, { permissionId: "asc" }],
      });
      const barrier = createBarrier(2);
      const counts = [0, 0];
      const services = counts.map((_, i) =>
        createPermissionService(() => Promise.resolve(db), {
          ...repo,
          async lockSystem(...args) {
            if (++counts[i] === 1) await barrier.wait();
            return repo.lockSystem(...args);
          },
        }),
      );
      try {
        const outcomes = await Promise.allSettled(
          services.map((service) => service.create(principal, body)),
        );
        assert.equal(
          outcomes.filter((result) => result.status === "fulfilled").length,
          1,
        );
        const loser = outcomes.find((result) => result.status === "rejected");
        assert(
          loser?.status === "rejected" &&
            loser.reason instanceof HttpError &&
            loser.reason.statusCode === 409,
        );
        const row = await db.permission.findUniqueOrThrow({ where: { code } });
        assert.equal(row.isActive, true);
        assert.equal(
          await db.rolePermission.count({ where: { permissionId: row.id } }),
          0,
        );
        assert.deepEqual(
          await db.rolePermission.findMany({
            orderBy: [{ roleId: "asc" }, { permissionId: "asc" }],
          }),
          before,
        );
        await db.permission.update({
          where: { id: row.id },
          data: { isActive: false },
        });
        assert.equal(
          (await request("/api/permissions", system.id, "POST", body)).status,
          409,
        );
      } finally {
        await db.permission.deleteMany({ where: { code } });
      }
    },
  );

  await context.test(
    "role permission management US4 partial metadata never overwrites concurrent state",
    async () => {
      const code = "rp_" + randomUUID().replaceAll("-", "") + ".metadata";
      const p = await db.permission.create({
        data: { code, name: "Original", module: "rp", action: "metadata" },
      });
      await db.rolePermission.create({
        data: { roleId: staffA.roleId, permissionId: p.id },
      });
      const principal = await loadPrincipal(system.id, db);
      const repo = createPermissionRepository(() => Promise.resolve(db));
      const service = createPermissionService(() => Promise.resolve(db), repo);
      const grants = await db.rolePermission.findMany({
        where: { permissionId: p.id },
      });
      const signal = () => {
        let release!: () => void;
        const promise = new Promise<void>((resolve) => {
          release = resolve;
        });
        return { promise, release };
      };
      try {
        for (const metadataFirst of [true, false]) {
          await db.permission.update({
            where: { id: p.id },
            data: { name: "Original", description: null, isActive: true },
          });
          const entered = signal(),
            resume = signal();
          let locks = 0;
          const paused = createPermissionService(() => Promise.resolve(db), {
            ...repo,
            async lockSystem(...args) {
              if (++locks === 1) {
                entered.release();
                await resume.promise;
              }
              return repo.lockSystem(...args);
            },
          });
          const pending = Promise.allSettled([
            metadataFirst
              ? paused.setPermissionState(principal, p.id, { isActive: false })
              : paused.updatePermission(principal, p.id, {
                  name: "Updated",
                  description: "Nội dung",
                }),
          ]);
          try {
            await entered.promise;
            if (metadataFirst)
              await service.updatePermission(principal, p.id, {
                name: "Updated",
                description: "Nội dung",
              });
            else
              await service.setPermissionState(principal, p.id, {
                isActive: false,
              });
          } finally {
            resume.release();
          }
          assert.equal((await pending)[0].status, "fulfilled");
          const saved = await db.permission.findUniqueOrThrow({
            where: { id: p.id },
          });
          assert.equal(saved.name, "Updated");
          assert.equal(saved.description, "Nội dung");
          assert.equal(saved.isActive, false);
          assert.equal(saved.code, code);
          assert(locks >= 2);
        }
        const before = await db.permission.findUniqueOrThrow({
          where: { id: p.id },
        });
        const faulty = createPermissionService(() => Promise.resolve(db), {
          ...repo,
          async updateMetadata(...args) {
            await repo.updateMetadata(...args);
            throw new Error("test metadata rollback");
          },
        });
        await assert.rejects(
          faulty.updatePermission(principal, p.id, { description: null }),
          (e: unknown) => e instanceof HttpError && e.statusCode === 503,
        );
        assert.deepEqual(
          await db.permission.findUniqueOrThrow({ where: { id: p.id } }),
          before,
        );
        assert.deepEqual(
          await db.rolePermission.findMany({ where: { permissionId: p.id } }),
          grants,
        );
        assert.equal(
          (
            await request("/api/permissions/" + p.id, system.id, "PATCH", {
              description: null,
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await request("/api/permissions/" + p.id, system.id, "PATCH", {
              code: "forged.code",
            })
          ).status,
          400,
        );
        const detail = await request(
          "/api/roles/" + staffA.roleId + "/permissions",
          system.id,
        );
        const dto = record(detail.body).data as {
          permissions: { id: string; name: string; isActive: boolean }[];
        };
        assert.equal(
          dto.permissions.find((row) => row.id === p.id)?.name,
          "Updated",
        );
        assert.equal(
          dto.permissions.find((row) => row.id === p.id)?.isActive,
          false,
        );
      } finally {
        await db.rolePermission.deleteMany({ where: { permissionId: p.id } });
        await db.permission.delete({ where: { id: p.id } });
      }
    },
  );

  await context.test(
    "permission name search filters before pagination and treats wildcard characters literally",
    async () => {
      const prefix = "ps_" + randomUUID().replaceAll("-", "");
      const input = [
        { code: prefix + ".a", name: prefix + " Xem quyền alpha" },
        {
          code: prefix + ".b",
          name: prefix + " xEM QUYỀN beta",
          isActive: false,
        },
        { code: prefix + ".c", name: prefix + " Xem quyền gamma" },
        {
          code: prefix + ".codeonly",
          name: "Tên không khớp",
          description: prefix + " Xem quyền",
        },
        { code: prefix + ".percent", name: prefix + " percent%literal" },
        { code: prefix + ".percent_decoy", name: prefix + " percentXliteral" },
        { code: prefix + ".under", name: prefix + " under_score" },
        { code: prefix + ".under_decoy", name: prefix + " underXscore" },
        { code: prefix + ".slash", name: prefix + " slash\\path" },
        { code: prefix + ".slash_decoy", name: prefix + " slashpath" },
      ];
      const created: { id: string }[] = [];
      try {
        for (const data of input)
          created.push(
            await db.permission.create({
              data: { module: prefix, action: "search", ...data },
            }),
          );
        const search = "  " + prefix.toUpperCase() + " XEM QUYỀN  ";
        for (let page = 1; page <= 4; page++) {
          const response = await request(
            "/api/permissions?search=" +
              encodeURIComponent(search) +
              "&limit=1&page=" +
              page,
            system.id,
          );
          assert.equal(response.status, 200);
          assert.deepEqual(
            rows(response.body).map((row) => row.id),
            page <= 3 ? [created[page - 1].id] : [],
          );
          assert.equal(
            record(record(record(response.body).data).pagination).hasNext,
            page < 3,
          );
          if (page === 2) assert.equal(rows(response.body)[0].isActive, false);
        }
        const allMatches = await request(
          "/api/permissions?search=" + encodeURIComponent(prefix),
          system.id,
        );
        assert.equal(rows(allMatches.body).length, 9);
        assert(
          !rows(allMatches.body).some((row) => row.id === created[3].id),
          "code and description alone do not match",
        );
        for (const [suffix, index] of [
          ["percent%literal", 4],
          ["under_score", 6],
          ["slash\\path", 8],
        ] as const) {
          const response = await request(
            "/api/permissions?search=" +
              encodeURIComponent(prefix + " " + suffix),
            system.id,
          );
          assert.equal(response.status, 200);
          assert.deepEqual(
            rows(response.body).map((row) => row.id),
            [created[index].id],
          );
        }
        const none = await request(
          "/api/permissions?search=" + encodeURIComponent(prefix + " missing"),
          system.id,
        );
        assert.deepEqual(rows(none.body), []);
        const baseline = await request("/api/permissions", system.id);
        const blank = await request(
          "/api/permissions?search=%20%20",
          system.id,
        );
        assert.deepEqual(record(blank.body).data, record(baseline.body).data);
        assert.equal(
          (await request("/api/permissions?search=a&search=b", system.id))
            .status,
          400,
        );
        assert.equal(
          (await request("/api/roles?search=name", system.id)).status,
          400,
        );
        assert.equal(
          (await request("/api/permissions?search=name", adminA.id)).status,
          403,
        );
      } finally {
        await db.permission.deleteMany({
          where: { id: { in: created.map((row) => row.id) } },
        });
      }
    },
  );

  await context.test(
    "inactive permission API pages five disabled permissions without mixing active entries",
    async () => {
      const prefix = "ip_" + randomUUID().replaceAll("-", "");
      const baseline = await db.permission.findMany({
        where: { isActive: false },
        select: { id: true, code: true },
      });
      const created: { id: string; code: string; isActive: boolean }[] = [];
      try {
        for (let i = 0; i < 8; i++)
          created.push(
            await db.permission.create({
              data: {
                code: prefix + ".p_" + i,
                name: "Quyền chưa bật " + i,
                module: prefix,
                action: "test",
                isActive: i === 7,
              },
            }),
          );
        const expected = [
          ...baseline,
          ...created.filter((row) => !row.isActive),
        ]
          .sort((a, b) => a.code.localeCompare(b.code))
          .map((row) => row.id);
        const found: string[] = [];
        for (let page = 1; page <= Math.ceil(expected.length / 5) + 1; page++) {
          const response = await request(
            "/api/permissions/inactive?page=" + page,
            system.id,
          );
          assert.equal(response.status, 200);
          const items = rows(response.body);
          assert(items.every((row) => row.isActive === false));
          assert.deepEqual(
            items.map((row) => row.id),
            expected.slice((page - 1) * 5, page * 5),
          );
          found.push(...items.map((row) => String(row.id)));
          assert.deepEqual(
            record(record(record(response.body).data).pagination),
            { page, limit: 5, hasNext: page * 5 < expected.length },
          );
        }
        assert.equal(new Set(found).size, expected.length);
        assert(!found.includes(created[7].id));
        assert.equal(
          (await request("/api/permissions/inactive", system.id)).status,
          200,
        );
        assert.equal(
          (await request("/api/permissions/inactive?limit=20", system.id))
            .status,
          400,
        );
        assert.equal(
          (await request("/api/permissions/inactive", adminA.id)).status,
          403,
        );
      } finally {
        await db.permission.deleteMany({
          where: { id: { in: created.map((row) => row.id) } },
        });
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
      const denialBaseline = await db.userPermissionDenial.count();
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
      assert.equal(await db.userPermissionDenial.count(), denialBaseline);
    },
  );
  await context.test(
    "concurrent disable is idempotent, affects the next request, and enable removes the denial",
    async () => {
      const denialBaseline = await db.userPermissionDenial.count();
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
      assert.equal(await db.userPermissionDenial.count(), denialBaseline);
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
    "v1 supplier order HTTP lifecycle verifies arrival, four-role inspection rollback/receipt, reject recovery, and public allowlist",
    async (t) => {
      t.mock.method(
        documentStorage,
        "upload",
        (userId: string, file: Express.Multer.File) =>
          testDocumentStorage.upload(userId, file),
      );
      t.mock.method(documentStorage, "remove", (document: OnboardingDocument) =>
        testDocumentStorage.remove(document),
      );
      const inspect = (
        deliveryId: string,
        reviewerId: string,
        decision: "APPROVE" | "REJECT",
        reason?: string,
      ) => {
        const form = new FormData();
        form.set("decision", decision);
        if (reason) form.set("reason", reason);
        form.set(
          "photo",
          new Blob([new Uint8Array([255, 216, 255, 0, 1])], {
            type: "image/jpeg",
          }),
          "inspection.jpg",
        );
        const requestHeaders = new Headers(headers(reviewerId));
        requestHeaders.delete("Content-Type");
        return http.request(`/api/deliveries/${deliveryId}/inspection`, {
          method: "POST",
          headers: requestHeaders,
          body: form,
        });
      };
      const previousOrigin = process.env.PUBLIC_TRACE_ORIGIN;
      process.env.PUBLIC_TRACE_ORIGIN = "https://trace.example.test";
      try {
        const suffix = randomUUID().slice(0, 8);
        const v1School = await db.school.create({
          data: { name: `V1 Auth School ${suffix}` },
        });
        const v1OtherSchool = await db.school.create({
          data: { name: `V1 Auth Other School ${suffix}` },
        });
        const v1Supplier = await db.supplier.create({
          data: { name: `V1 Auth Supplier ${suffix}` },
        });
        const v1OtherSupplier = await db.supplier.create({
          data: { name: `V1 Auth Other Supplier ${suffix}` },
        });
        const v1Category = await db.ingredientCategory.create({
          data: { categoryName: `V1 Auth Cat ${suffix}` },
        });
        const v1Ingredient1 = await db.ingredient.create({
          data: {
            supplierId: v1Supplier.id,
            categoryId: v1Category.id,
            name: `Thit heo HTTP ${suffix}`,
            defaultUnit: "kg",
          },
        });
        const v1Ingredient2 = await db.ingredient.create({
          data: {
            supplierId: v1Supplier.id,
            categoryId: v1Category.id,
            name: `Cai xanh HTTP ${suffix}`,
            defaultUnit: "kg",
          },
        });
        await db.schoolSupplierRelationship.create({
          data: {
            schoolId: v1School.id,
            supplierId: v1Supplier.id,
            status: "ACTIVE",
          },
        });
        const v1Source = await db.sourceFacility.create({
          data: {
            supplierId: v1Supplier.id,
            name: `HTX Rau HTTP ${suffix}`,
            facilityCode: `HTX-${suffix}`,
            address: "Thon 1, Huyen X",
            contactName: "Chu ho bi mat",
            contactPhone: "0909123456",
            contactEmail: `secret-${suffix}@farm.test`,
            status: "ACTIVE",
            isVisible: true,
          },
        });
        const v1Entry1 = await db.ingredientEntry.create({
          data: {
            schoolId: v1School.id,
            ingredientId: v1Ingredient1.id,
            handlingType: "DIRECT_USE",
            status: "ACTIVE",
          },
        });

        const v1SupplierStaff = await user("INGREDIENT_SUPPLIER_STAFF", {
          supplierId: v1Supplier.id,
        });
        const v1OtherSupplierStaff = await user("INGREDIENT_SUPPLIER_STAFF", {
          supplierId: v1OtherSupplier.id,
        });
        const kitchenUser = await user("SCHOOL_KITCHEN_STAFF", {
          schoolId: v1School.id,
        });
        const nutritionUser = await user("SCHOOL_NUTRITION_OFFICER", {
          schoolId: v1School.id,
        });
        const parentUser = await user("PARENTS_COMMITTEE", {
          schoolId: v1School.id,
        });
        const deptUser = await user("INGREDIENT_MANAGEMENT_DEPARTMENT", {
          schoolId: v1School.id,
        });
        const otherDeptUser = await user("INGREDIENT_MANAGEMENT_DEPARTMENT", {
          schoolId: v1OtherSchool.id,
        });
        for (const account of [
          v1SupplierStaff,
          v1OtherSupplierStaff,
          kitchenUser,
          nutritionUser,
          parentUser,
          deptUser,
          otherDeptUser,
        ]) {
          const session = await authSessions.issue(account.id);
          issued.set(account.id, session);
          refreshTokens.push(session.refreshToken);
        }

        const v1Request = await db.supplyRequest.create({
          data: {
            requestNo: `SR-T090-${suffix}`,
            schoolId: v1School.id,
            supplierId: v1Supplier.id,
            createdByUserId: deptUser.id,
            status: "ACCEPTED",
            requestedDeliveryDate: new Date("2026-11-20T00:00:00.000Z"),
            supplyRequestItems: {
              create: [
                {
                  ingredientEntryId: v1Entry1.id,
                  requestedQuantity: 25,
                  unit: "kg",
                },
              ],
            },
          },
          include: { supplyRequestItems: true },
        });

        // 1. REQUEST two-stage creation (PREPARING -> dispatch -> IN_TRANSIT) -> supplier/wrong-school arrival denied -> school arrival -> REJECT
        const createReqRes = await http.request("/api/deliveries/management", {
          method: "POST",
          headers: {
            ...headers(v1SupplierStaff.id),
            "Idempotency-Key": randomUUID(),
          },
          body: JSON.stringify({
            sourceType: "REQUEST",
            supplyRequestId: v1Request.id,
            sources: [
              {
                supplyRequestItemId: v1Request.supplyRequestItems[0].id,
                sourceFacilityId: v1Source.id,
                actualQuantity: "25",
              },
            ],
          }),
        });
        assert.equal(createReqRes.status, 201);
        const createdReqDelivery = record(record(createReqRes.body).data);
        const reqDeliveryId = String(createdReqDelivery.id);
        assert.equal(createdReqDelivery.status, "PREPARING");
        assert.equal(createdReqDelivery.statusLabel, "Đang chuẩn bị hàng");
        assert.equal(createdReqDelivery.traceabilityVersion, 1);

        const dispatchReqRes = await http.request(
          `/api/deliveries/management/${reqDeliveryId}/dispatch`,
          {
            method: "POST",
            headers: headers(v1SupplierStaff.id),
            body: JSON.stringify({
              expectedArrivalAt: "2026-11-20T06:30:00.000Z",
              vehiclePlate: "29C-11111",
            }),
          },
        );
        assert.equal(dispatchReqRes.status, 200);
        const reqDelivery = record(record(dispatchReqRes.body).data);
        assert.equal(reqDelivery.status, "IN_TRANSIT");
        assert.equal(reqDelivery.statusLabel, "Đang giao hàng");
        assert.equal(reqDelivery.traceabilityVersion, 1);
        const reqItems = reqDelivery.items as Array<Record<string, unknown>>;
        assert.equal(reqItems.length, 1);
        const reqQrUrl = String(reqItems[0].traceUrl);
        assert(
          reqQrUrl.startsWith(
            "https://trace.example.test/api/public/delivery-items/",
          ),
        );

        assert.equal(
          (
            await http.request(`/api/deliveries/${reqDeliveryId}/arrival`, {
              method: "POST",
              headers: headers(v1SupplierStaff.id),
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await http.request(`/api/deliveries/${reqDeliveryId}/arrival`, {
              method: "POST",
              headers: headers(otherDeptUser.id),
            })
          ).status,
          404,
        );

        const reqArrival1 = await http.request(
          `/api/deliveries/${reqDeliveryId}/arrival`,
          {
            method: "POST",
            headers: headers(kitchenUser.id),
          },
        );
        assert.equal(reqArrival1.status, 200);
        const reqArrivalData = record(record(reqArrival1.body).data);
        assert.equal(reqArrivalData.status, "ARRIVED");
        assert.equal(reqArrivalData.statusLabel, "Đã đến nơi");
        assert(typeof reqArrivalData.arrivedAt === "string");

        const reqArrivalReplay = await http.request(
          `/api/deliveries/${reqDeliveryId}/arrival`,
          {
            method: "POST",
            headers: headers(nutritionUser.id),
          },
        );
        assert.equal(reqArrivalReplay.status, 200);
        assert.equal(
          record(record(reqArrivalReplay.body).data).arrivedAt,
          reqArrivalData.arrivedAt,
        );

        const uploadedBeforeMissingPhoto = uploadedFiles.size;
        const missingPhotoRes = await http.request(
          `/api/deliveries/${reqDeliveryId}/inspection`,
          {
            method: "POST",
            headers: headers(kitchenUser.id),
            body: JSON.stringify({
              decision: "REJECT",
              reason: "Nhiệt độ xe chưa đạt",
            }),
          },
        );
        assert.equal(missingPhotoRes.status, 400);
        assert.equal(uploadedFiles.size, uploadedBeforeMissingPhoto);
        assert.equal(
          await db.deliveryApproval.count({
            where: { deliveryId: reqDeliveryId },
          }),
          0,
        );
        assert.equal(
          (
            await db.delivery.findUniqueOrThrow({
              where: { id: reqDeliveryId },
            })
          ).status,
          "ARRIVED",
        );
        const rejectRes = await inspect(
          reqDeliveryId,
          kitchenUser.id,
          "REJECT",
          "Nhiệt độ xe chưa đạt",
        );
        assert.equal(rejectRes.status, 200, JSON.stringify(rejectRes.body));
        const rejectedRow = await db.delivery.findUniqueOrThrow({
          where: { id: reqDeliveryId },
        });
        assert.equal(rejectedRow.status, "REJECTED");
        assert.equal(
          await db.inventoryTransaction.count({
            where: {
              IngredientLot: {
                DeliveryItem: { deliveryId: reqDeliveryId },
              },
            },
          }),
          0,
        );
        assert.equal(
          (await inspect(reqDeliveryId, nutritionUser.id, "APPROVE")).status,
          409,
        );

        // 2. Manual replacement via STANDALONE: two-stage creation -> dispatch -> fresh deliveryNo, fresh qrUrl, fresh approvals;
        //    missing IngredientEntry is reported on arrival and blocks the first APPROVE (FR-014), then succeeds once attached.
        const standaloneRes = await http.request("/api/deliveries/management", {
          method: "POST",
          headers: {
            ...headers(v1SupplierStaff.id),
            "Idempotency-Key": randomUUID(),
          },
          body: JSON.stringify({
            sourceType: "STANDALONE",
            schoolId: v1School.id,
            items: [
              {
                ingredientId: v1Ingredient2.id,
                sourceFacilityId: v1Source.id,
                actualQuantity: "15",
                unit: "kg",
              },
            ],
          }),
        });
        assert.equal(standaloneRes.status, 201);
        const createdStandaloneData = record(record(standaloneRes.body).data);
        const standaloneId = String(createdStandaloneData.id);
        assert.equal(createdStandaloneData.status, "PREPARING");
        assert.equal(createdStandaloneData.statusLabel, "Đang chuẩn bị hàng");
        const dispatchStandaloneRes = await http.request(
          `/api/deliveries/management/${standaloneId}/dispatch`,
          {
            method: "POST",
            headers: headers(v1SupplierStaff.id),
            body: JSON.stringify({
              expectedArrivalAt: "2026-11-20T08:00:00.000Z",
              vehiclePlate: "29C-22222",
            }),
          },
        );
        assert.equal(dispatchStandaloneRes.status, 200);
        const standaloneData = record(record(dispatchStandaloneRes.body).data);
        assert.equal(standaloneData.status, "IN_TRANSIT");
        assert.equal(standaloneData.statusLabel, "Đang giao hàng");
        assert.notEqual(standaloneData.deliveryNo, reqDelivery.deliveryNo);
        const standaloneItems = standaloneData.items as Array<
          Record<string, unknown>
        >;
        const standaloneQrUrl = String(standaloneItems[0].traceUrl);
        assert(
          standaloneQrUrl.startsWith(
            "https://trace.example.test/api/public/delivery-items/",
          ),
        );
        assert.notEqual(standaloneQrUrl, reqQrUrl);

        const missingEntryIssue =
          "Chưa cấu hình danh mục nguyên liệu đang hoạt động của trường để tiếp nhận lô";
        // Only the school's PRIMARY inspection role (kitchen staff by default)
        // may confirm arrival; REQUIRED/OPTIONAL roles receive 403.
        assert.equal(
          (
            await http.request(`/api/deliveries/${standaloneId}/arrival`, {
              method: "POST",
              headers: headers(deptUser.id),
            })
          ).status,
          403,
        );
        const standaloneArrival = await http.request(
          `/api/deliveries/${standaloneId}/arrival`,
          {
            method: "POST",
            headers: headers(kitchenUser.id),
          },
        );
        assert.equal(standaloneArrival.status, 200);
        // FR-014: the receipt problem is reported as soon as the vehicle arrives.
        assert.equal(
          record(record(standaloneArrival.body).data).receiptIssue,
          missingEntryIssue,
        );

        // Missing IngredientEntry blocks the FIRST APPROVE -> 409 rollback (no decision, zero warehouse writes)
        const uploadsBeforeRollback = uploadedFiles.size;
        const rollbackRes = await inspect(
          standaloneId,
          kitchenUser.id,
          "APPROVE",
        );
        assert.equal(rollbackRes.status, 409);
        assert.equal(record(rollbackRes.body).message, missingEntryIssue);
        assert.equal(uploadedFiles.size, uploadsBeforeRollback);
        assert.equal(
          await db.deliveryApproval.count({
            where: { deliveryId: standaloneId },
          }),
          0,
        );
        assert.equal(
          (await db.delivery.findUniqueOrThrow({ where: { id: standaloneId } }))
            .status,
          "ARRIVED",
        );
        const plannedLotBeforeEntry = await db.ingredientLot.findFirstOrThrow({
          where: {
            DeliveryItem: { deliveryId: standaloneId },
          },
        });
        assert.equal(plannedLotBeforeEntry.status, "BLOCKED");
        assert.equal(plannedLotBeforeEntry.availableQuantity.toString(), "0");
        assert.equal(
          await db.inventoryTransaction.count({
            where: {
              IngredientLot: {
                DeliveryItem: { deliveryId: standaloneId },
              },
            },
          }),
          0,
        );

        const v1Entry2 = await db.ingredientEntry.create({
          data: {
            schoolId: v1School.id,
            ingredientId: v1Ingredient2.id,
            handlingType: "DIRECT_USE",
            status: "ACTIVE",
          },
        });
        for (const reviewer of [kitchenUser, nutritionUser, parentUser]) {
          const ok = await inspect(standaloneId, reviewer.id, "APPROVE");
          assert.equal(ok.status, 200, JSON.stringify(ok.body));
        }
        assert.equal(
          (await db.delivery.findUniqueOrThrow({ where: { id: standaloneId } }))
            .status,
          "PENDING_APPROVAL",
        );
        const receiveRes = await inspect(standaloneId, deptUser.id, "APPROVE");
        assert.equal(receiveRes.status, 200, JSON.stringify(receiveRes.body));
        const receivedDelivery = await db.delivery.findUniqueOrThrow({
          where: { id: standaloneId },
          include: {
            deliveryItems: { include: { ingredientLots: true } },
            deliveryApprovals: true,
          },
        });
        assert.equal(receivedDelivery.status, "RECEIVED");
        assert.equal(receivedDelivery.receivedByUserId, deptUser.id);
        assert.equal(receivedDelivery.deliveryApprovals.length, 4);
        for (const approval of receivedDelivery.deliveryApprovals) {
          assert(approval.photoPublicId?.endsWith(".jpg"));
          assert.match(approval.photoHash ?? "", /^[a-f0-9]{64}$/);
        }
        assert.equal(
          receivedDelivery.deliveryItems[0].ingredientEntryId,
          v1Entry2.id,
        );
        assert.equal(
          receivedDelivery.deliveryItems[0].ingredientLots.length,
          1,
        );
        assert.equal(
          receivedDelivery.deliveryItems[0].ingredientLots[0].sourceFacilityId,
          v1Source.id,
        );
        assert.equal(
          await db.inventoryTransaction.count({
            where: {
              movementType: "RECEIPT",
              ingredientLotId:
                receivedDelivery.deliveryItems[0].ingredientLots[0].id,
            },
          }),
          1,
        );

        // 3. School detail, cross-tenant isolation, and unauthenticated public trace allowlist
        const schoolDetail = await http.request(
          `/api/deliveries/${standaloneId}/inspection`,
          { headers: headers(deptUser.id) },
        );
        assert.equal(schoolDetail.status, 200);
        const detailData = record(record(schoolDetail.body).data);
        assert.equal(detailData.statusLabel, "Hoàn thành");
        assert.equal(
          (
            await http.request(`/api/deliveries/${standaloneId}/inspection`, {
              headers: headers(otherDeptUser.id),
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await http.request(`/api/deliveries/management/${standaloneId}`, {
              headers: headers(v1OtherSupplierStaff.id),
            })
          ).status,
          404,
        );

        const tracePath = new URL(standaloneQrUrl).pathname;
        const publicRes = await http.request(tracePath, {
          headers: { Accept: "application/json" },
        });
        assert.equal(publicRes.status, 200);
        const traceData = record(record(publicRes.body).data);
        assert.deepEqual(Object.keys(traceData).sort(), [
          "actualQuantity",
          "deliveryNo",
          "ingredientName",
          "sourceFacility",
          "status",
          "statusLabel",
          "supplierName",
          "unit",
        ]);
        const traceFacility = record(traceData.sourceFacility);
        assert.deepEqual(Object.keys(traceFacility).sort(), [
          "facilityCode",
          "name",
        ]);
        assert.equal(traceFacility.name, v1Source.name);
        assert.equal(traceFacility.facilityCode, v1Source.facilityCode);
        assert.equal(traceData.status, "RECEIVED");
        assert.equal(traceData.statusLabel, "Hoàn thành");
        const serializedTrace = JSON.stringify(traceData);
        assert(!serializedTrace.includes("Chu ho bi mat"));
        assert(!serializedTrace.includes("0909123456"));
        assert(!serializedTrace.includes(`secret-${suffix}@farm.test`));
        assert(!serializedTrace.includes("29C-22222"));
      } finally {
        if (previousOrigin === undefined) {
          delete process.env.PUBLIC_TRACE_ORIGIN;
        } else {
          process.env.PUBLIC_TRACE_ORIGIN = previousOrigin;
        }
      }
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
      recordLocalTestDatabase(legacy);
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
  await context.test(
    "supplier-school endpoints enforce real-login default view, OR view/manage, admin-only role and live session recheck for JSON and binary",
    async () => {
      const localStore = new MemoryStore();
      const srv = createApp(
        createApiRateLimiter(localStore, { windowMs: 60_000, limit: 5000 }),
        undefined,
        {
          session: sessionService,
          signup: createSignupService(undefined, verification),
          emailVerification: verification,
          password: passwords,
          onboarding: createOnboardingService(getPrisma, testDocumentStorage),
        },
      ).listen(0, "127.0.0.1");
      await once(srv, "listening");
      const addr = srv.address();
      assert(addr && typeof addr !== "string");
      const base = `http://127.0.0.1:${addr.port}/api`;
      const loginReal = async (email: string) => {
        const res = await fetch(base + "/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Protection": "1",
          },
          body: JSON.stringify({ identifier: email, password }),
        });
        assert.equal(res.status, 200);
        const cookie = res.headers
          .getSetCookie()
          .map((c) => c.split(";")[0])
          .join("; ");
        const refresh = parseCookie(cookie)[REFRESH_COOKIE];
        assert(refresh);
        refreshTokens.push(refresh);
        return cookie;
      };
      try {
        const sup1 = await db.supplier.create({
          data: { name: "AuthZ Supplier School 1" },
        });
        const sup2 = await db.supplier.create({
          data: { name: "AuthZ Supplier School 2" },
        });
        const sup3 = await db.supplier.create({
          data: { name: "AuthZ Supplier School 3" },
        });
        const sch1 = await db.school.create({
          data: { name: "AuthZ Linked School 1", code: "AZ-SCH-1" },
        });
        const rel1 = await db.schoolSupplierRelationship.create({
          data: { schoolId: sch1.id, supplierId: sup1.id, status: "ACTIVE" },
        });
        const rel2 = await db.schoolSupplierRelationship.create({
          data: { schoolId: sch1.id, supplierId: sup2.id, status: "ACTIVE" },
        });
        const pdfBytes = Buffer.from("%PDF-1.4\nAuthZ check bytes");
        const c1 = await db.supplierContract.create({
          data: {
            schoolId: sch1.id,
            supplierId: sup1.id,
            relationshipId: rel1.id,
            number: "AZ-HD-1",
            status: "ACTIVE",
            signedOn: new Date("2026-11-01"),
            startsOn: new Date("2026-11-01"),
            endsOn: new Date("2026-12-31"),
            snapshot: {},
            createdByUserId: system.id,
            activatedByUserId: system.id,
            activatedAt: new Date("2026-11-01T08:00:00Z"),
          },
        });
        const d1 = await db.supplierContractDocument.create({
          data: {
            contractId: c1.id,
            kind: "SIGNED_CONTRACT",
            fileName: "az-1.pdf",
            mimeType: "application/pdf",
            size: pdfBytes.length,
            sha256: "a".repeat(64),
            content: pdfBytes,
            uploadedByUserId: system.id,
          },
        });
        const c2 = await db.supplierContract.create({
          data: {
            schoolId: sch1.id,
            supplierId: sup2.id,
            relationshipId: rel2.id,
            number: "AZ-HD-2",
            status: "ACTIVE",
            signedOn: new Date("2026-11-01"),
            startsOn: new Date("2026-11-01"),
            endsOn: new Date("2026-12-31"),
            snapshot: {},
            createdByUserId: system.id,
            activatedByUserId: system.id,
            activatedAt: new Date("2026-11-01T08:00:00Z"),
          },
        });
        const d2 = await db.supplierContractDocument.create({
          data: {
            contractId: c2.id,
            kind: "SIGNED_CONTRACT",
            fileName: "az-2.pdf",
            mimeType: "application/pdf",
            size: pdfBytes.length,
            sha256: "b".repeat(64),
            content: pdfBytes,
            uploadedByUserId: system.id,
          },
        });

        const admin1 = await user("INGREDIENT_SUPPLIER_ADMIN", {
          supplierId: sup1.id,
        });
        const admin2 = await user("INGREDIENT_SUPPLIER_ADMIN", {
          supplierId: sup2.id,
        });
        const staffSup1 = await user("INGREDIENT_SUPPLIER_STAFF", {
          supplierId: sup1.id,
        });
        const cookieAdmin1 = await loginReal(admin1.email);
        const cookieAdmin2 = await loginReal(admin2.email);
        const cookieStaff1 = await loginReal(staffSup1.email);
        const cookieSystem = await loginReal(system.email);

        const viewPerm = await permission("supplier_relationship.view");
        const managePerm = await permission("supplier_relationship.manage");
        const supAdminRoleId = admin1.roleId;
        const supStaffRoleId = staffSup1.roleId;

        const callCookie = (urlPath: string, cookie: string) =>
          fetch(base + urlPath, { headers: { Cookie: cookie } });

        // 1. Fresh admin default view grant works on JSON and binary
        assert.equal(
          (await callCookie("/supplier-schools", cookieAdmin1)).status,
          200,
        );
        assert.equal(
          (await callCookie(`/supplier-schools/${sch1.id}`, cookieAdmin1))
            .status,
          200,
        );
        assert.equal(
          (
            await callCookie(
              `/supplier-schools/${sch1.id}/contracts`,
              cookieAdmin1,
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await callCookie(
              `/supplier-schools/${sch1.id}/contracts/${c1.id}`,
              cookieAdmin1,
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await callCookie(
              `/supplier-schools/${sch1.id}/contracts/${c1.id}/documents/${d1.id}`,
              cookieAdmin1,
            )
          ).status,
          200,
        );

        // 2. Staff and SYSTEM_ADMIN get 403 even when granted both view & manage permissions
        await db.rolePermission.createMany({
          data: [
            { roleId: supStaffRoleId, permissionId: viewPerm.id },
            { roleId: supStaffRoleId, permissionId: managePerm.id },
            { roleId: system.roleId, permissionId: viewPerm.id },
            { roleId: system.roleId, permissionId: managePerm.id },
          ],
          skipDuplicates: true,
        });
        try {
          for (const actorCookie of [cookieStaff1, cookieSystem]) {
            assert.equal(
              (await callCookie("/supplier-schools", actorCookie)).status,
              403,
            );
            assert.equal(
              (
                await callCookie(
                  `/supplier-schools/${sch1.id}/contracts/${c1.id}/documents/${d1.id}`,
                  actorCookie,
                )
              ).status,
              403,
            );
          }

          // 3. OR view/manage + current-org denial + inactive permission on SAME session (cookieAdmin2)
          await db.userPermissionDenial.create({
            data: {
              userId: admin2.id,
              permissionId: viewPerm.id,
              supplierId: sup2.id,
              disabledByUserId: system.id,
            },
          });
          assert.equal(
            (await callCookie("/supplier-schools", cookieAdmin2)).status,
            403,
          );
          assert.equal(
            (
              await callCookie(
                `/supplier-schools/${sch1.id}/contracts/${c2.id}/documents/${d2.id}`,
                cookieAdmin2,
              )
            ).status,
            403,
          );

          // Grant manage to INGREDIENT_SUPPLIER_ADMIN -> admin2 with view denied can STILL read via manage OR
          await db.rolePermission.create({
            data: { roleId: supAdminRoleId, permissionId: managePerm.id },
          });
          assert.equal(
            (await callCookie("/supplier-schools", cookieAdmin2)).status,
            200,
          );
          assert.equal(
            (
              await callCookie(
                `/supplier-schools/${sch1.id}/contracts/${c2.id}/documents/${d2.id}`,
                cookieAdmin2,
              )
            ).status,
            200,
          );

          // Inactive manage permission while view is denied -> 403 for JSON and binary
          await db.permission.update({
            where: { id: managePerm.id },
            data: { isActive: false },
          });
          assert.equal(
            (await callCookie("/supplier-schools", cookieAdmin2)).status,
            403,
          );
          assert.equal(
            (
              await callCookie(
                `/supplier-schools/${sch1.id}/contracts/${c2.id}/documents/${d2.id}`,
                cookieAdmin2,
              )
            ).status,
            403,
          );
          await db.permission.update({
            where: { id: managePerm.id },
            data: { isActive: true },
          });

          // Denying both view and manage -> 403
          await db.userPermissionDenial.create({
            data: {
              userId: admin2.id,
              permissionId: managePerm.id,
              supplierId: sup2.id,
              disabledByUserId: system.id,
            },
          });
          assert.equal(
            (await callCookie("/supplier-schools", cookieAdmin2)).status,
            403,
          );

          // 4. Same live session (cookieAdmin1) observes lock, supplier change, role change (JSON + binary)
          await db.user.update({
            where: { id: admin1.id },
            data: { status: "LOCKED" },
          });
          assert.equal(
            (await callCookie("/supplier-schools", cookieAdmin1)).status,
            403,
          );
          assert.equal(
            (
              await callCookie(
                `/supplier-schools/${sch1.id}/contracts/${c1.id}/documents/${d1.id}`,
                cookieAdmin1,
              )
            ).status,
            403,
          );
          await db.user.update({
            where: { id: admin1.id },
            data: { status: "ACTIVE" },
          });

          // Move admin1 to sup3 (unlinked) -> same session loses access to sup1's school/file
          await db.user.update({
            where: { id: admin1.id },
            data: { supplierId: sup3.id },
          });
          const movedList = await callCookie("/supplier-schools", cookieAdmin1);
          assert.equal(movedList.status, 200);
          assert.deepEqual(
            ((await movedList.json()) as { data: { items: unknown[] } }).data
              .items,
            [],
          );
          assert.equal(
            (await callCookie(`/supplier-schools/${sch1.id}`, cookieAdmin1))
              .status,
            404,
          );
          assert.equal(
            (
              await callCookie(
                `/supplier-schools/${sch1.id}/contracts/${c1.id}/documents/${d1.id}`,
                cookieAdmin1,
              )
            ).status,
            404,
          );

          // Move back to sup1 and downgrade role to INGREDIENT_SUPPLIER_STAFF -> 403 JSON & binary
          await db.user.update({
            where: { id: admin1.id },
            data: {
              supplierId: sup1.id,
              roleId: supStaffRoleId,
              roleCode: "INGREDIENT_SUPPLIER_STAFF",
            },
          });
          assert.equal(
            (await callCookie("/supplier-schools", cookieAdmin1)).status,
            403,
          );
          assert.equal(
            (
              await callCookie(
                `/supplier-schools/${sch1.id}/contracts/${c1.id}/documents/${d1.id}`,
                cookieAdmin1,
              )
            ).status,
            403,
          );
        } finally {
          await db.user.update({
            where: { id: admin1.id },
            data: {
              supplierId: sup1.id,
              roleId: supAdminRoleId,
              roleCode: "INGREDIENT_SUPPLIER_ADMIN",
              status: "ACTIVE",
            },
          });
          await db.permission.update({
            where: { id: managePerm.id },
            data: { isActive: true },
          });
          await db.userPermissionDenial.deleteMany({
            where: { userId: admin2.id },
          });
          await db.rolePermission.deleteMany({
            where: {
              OR: [
                { roleId: supAdminRoleId, permissionId: managePerm.id },
                { roleId: supStaffRoleId, permissionId: viewPerm.id },
                { roleId: supStaffRoleId, permissionId: managePerm.id },
                { roleId: system.roleId, permissionId: managePerm.id },
              ],
            },
          });
        }
      } finally {
        await new Promise<void>((resolve, reject) => {
          srv.close((err) => (err ? reject(err) : resolve()));
          srv.closeAllConnections();
        });
        localStore.shutdown();
      }
    },
  );

  await context.test(
    "ingredient-quality-feedback POST response enforces Serializable single winner and deterministic barrier interleavings with denial, status lock, and role grant replacement",
    async () => {
      const iqfRepo = createIngredientQualityFeedbackRepository();
      const sup1 = await db.supplier.create({
        data: { name: "IQF Race Supplier 1" },
      });
      const sch1 = await db.school.create({
        data: { name: "IQF Race School 1", code: "IQF-RACE" },
      });
      const raceAdmin = await user("INGREDIENT_SUPPLIER_ADMIN", {
        supplierId: sup1.id,
      });
      const raceStaff1 = await user("INGREDIENT_SUPPLIER_STAFF", {
        supplierId: sup1.id,
      });
      const raceStaff2 = await user("INGREDIENT_SUPPLIER_STAFF", {
        supplierId: sup1.id,
      });
      const raceSubmitter = await user("SCHOOL_KITCHEN_STAFF", {
        schoolId: sch1.id,
      });
      const del1 = await db.delivery.create({
        data: {
          deliveryNo: `FP-DE-R1-${randomUUID().slice(0, 6)}`,
          schoolId: sch1.id,
          supplierId: sup1.id,
          creationMode: "STANDALONE",
          creationKey: randomUUID(),
          creationFingerprint: "a".repeat(64),
          createdByUserId: raceAdmin.id,
          status: "RECEIVED",
          receivedAt: new Date("2026-09-10T08:00:00Z"),
          receivedByUserId: raceSubmitter.id,
        },
      });
      const mkFeedback = async (title: string) =>
        db.$transaction(async (tx) => {
          return tx.ingredientQualityFeedback.create({
            data: {
              complaintCode: await iqfRepo.allocateComplaintCode(tx),
              deliveryId: del1.id,
              submittedByUserId: raceSubmitter.id,
              title,
              description: `${title} description`,
            },
          });
        });

      const principalAdmin = await loadPrincipal(raceAdmin.id, db);
      const principalStaff1 = await loadPrincipal(raceStaff1.id, db);
      const principalStaff2 = await loadPrincipal(raceStaff2.id, db);
      const staffRepo = createSupplierStaffRepository();
      const staffService = createSupplierStaffService(staffRepo, () =>
        Promise.resolve(db),
      );
      const permService = createPermissionService(() => Promise.resolve(db));
      const permissionSystem = await loadPrincipal(system.id, db);
      const respondPerm = await permission(
        "ingredient_quality_feedback.respond",
      );

      // 1. Concurrent valid responders (admin vs staff1) on same SUBMITTED complaint -> 1 fulfilled, 1 409 conflict
      const fRace = await mkFeedback("Concurrent responders");
      {
        const barrier = createBarrier(2);
        const counts = [0, 0];
        const services = counts.map((_, idx) =>
          createIngredientQualityFeedbackService(
            {
              ...iqfRepo,
              async lockResponseContext(...args) {
                counts[idx] += 1;
                if (counts[idx] === 1) await barrier.wait();
                return iqfRepo.lockResponseContext(...args);
              },
            },
            () => Promise.resolve(db),
          ),
        );
        const outcomes = await Promise.allSettled([
          services[0].respond(
            { feedbackId: fRace.id },
            { supplierResponse: "Phản hồi từ Admin" },
            principalAdmin,
          ),
          services[1].respond(
            { feedbackId: fRace.id },
            { supplierResponse: "Phản hồi từ Staff" },
            principalStaff1,
          ),
        ]);
        const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
        const rejected = outcomes.filter((o) => o.status === "rejected");
        assert.equal(fulfilled.length, 1);
        assert.equal(rejected.length, 1);
        assert(
          rejected[0].reason instanceof HttpError &&
            rejected[0].reason.statusCode === 409,
        );
        const winner = fulfilled[0].value;
        assert.equal(winner.id, fRace.id);
        assert.equal(winner.complaintCode, fRace.complaintCode);

        // Repeated POST preserves exact winner tuple and code
        await assert.rejects(
          () =>
            createIngredientQualityFeedbackService(iqfRepo, () =>
              Promise.resolve(db),
            ).respond(
              { feedbackId: fRace.id },
              { supplierResponse: "Thử ghi đè sau khi đã thắng" },
              principalAdmin,
            ),
          (err: unknown) => err instanceof HttpError && err.statusCode === 409,
        );
        const saved = await db.ingredientQualityFeedback.findUniqueOrThrow({
          where: { id: fRace.id },
        });
        assert.equal(saved.status, "RESPONDED");
        assert.equal(saved.supplierResponse, winner.supplierResponse);
        assert.equal(saved.respondedByUserId, winner.respondedBy?.id);
        assert.equal(saved.complaintCode, fRace.complaintCode);
      }

      // 2a. Order 1: Admin denial / status lock / role replacement commits BEFORE response acquires lock -> retries & fails 403
      const runCommitFirstRace = async (
        label: string,
        feedbackId: string,
        actorPrincipal: Awaited<ReturnType<typeof loadPrincipal>>,
        commitAdminAction: () => Promise<unknown>,
        restoreAction: () => Promise<unknown>,
      ) => {
        let txRuns = 0;
        let attempts = 0;
        const trackedDb = {
          $transaction(
            op: Parameters<typeof db.$transaction>[0],
            opts?: Parameters<typeof db.$transaction>[1],
          ) {
            txRuns++;
            return typeof op === "function"
              ? db.$transaction(op, opts)
              : db.$transaction(op);
          },
        } as unknown as typeof db;
        const respEntered = createBarrier(2);
        const adminDone = createBarrier(2);
        const rSvc = createIngredientQualityFeedbackService(
          {
            ...iqfRepo,
            async findResponseMetadata(...args) {
              attempts++;
              const meta = await iqfRepo.findResponseMetadata(...args);
              if (attempts === 1) {
                await respEntered.wait();
                await adminDone.wait();
              }
              return meta;
            },
          },
          () => Promise.resolve(trackedDb),
        );
        try {
          const respPromise = rSvc.respond(
            { feedbackId },
            { supplierResponse: `Attempt ${label}` },
            actorPrincipal,
          );
          await respEntered.wait();
          await commitAdminAction();
          await adminDone.wait();
          await assert.rejects(
            () => respPromise,
            (err: unknown) =>
              err instanceof HttpError && err.statusCode === 403,
            `${label} must refuse with 403 after retry, not 503`,
          );
          assert.equal(
            attempts,
            1,
            `${label} retry should fail in initial readActor before metadata`,
          );
          assert(
            txRuns >= 2,
            `${label} should retry stale snapshot instead of failing 503`,
          );
          const row = await db.ingredientQualityFeedback.findUniqueOrThrow({
            where: { id: feedbackId },
          });
          assert.equal(row.status, "SUBMITTED");
          assert.equal(row.supplierResponse, null);
        } finally {
          await restoreAction();
        }
      };

      const fDenial1 = await mkFeedback("Denial commit first");
      await runCommitFirstRace(
        "denial-first",
        fDenial1.id,
        principalStaff1,
        () =>
          staffService.togglePermission(
            { userId: raceStaff1.id, permissionId: respondPerm.id },
            true,
            principalAdmin,
          ),
        () =>
          staffService.togglePermission(
            { userId: raceStaff1.id, permissionId: respondPerm.id },
            false,
            principalAdmin,
          ),
      );

      const fLock1 = await mkFeedback("Status lock commit first");
      await runCommitFirstRace(
        "status-lock-first",
        fLock1.id,
        principalStaff1,
        () =>
          staffService.changeStatus(
            { userId: raceStaff1.id },
            { status: "LOCKED" },
            principalAdmin,
          ),
        () =>
          staffService.changeStatus(
            { userId: raceStaff1.id },
            { status: "ACTIVE" },
            principalAdmin,
          ),
      );

      const originalStaffGrants = (
        await db.rolePermission.findMany({
          where: { roleId: raceStaff1.roleId },
          select: { permissionId: true },
        })
      ).map((g) => g.permissionId);
      const fRole1 = await mkFeedback("Role grant replacement commit first");
      await runCommitFirstRace(
        "role-replace-first",
        fRole1.id,
        principalStaff2,
        () =>
          permService.replaceRole(
            permissionSystem,
            raceStaff1.roleId,
            originalStaffGrants.filter((id) => id !== respondPerm.id),
          ),
        () =>
          permService.replaceRole(
            permissionSystem,
            raceStaff1.roleId,
            originalStaffGrants,
          ),
      );

      // 2b. Order 2: Response acquires locks BEFORE admin action -> response commits 200 cleanly, then admin waits and commits -> next request gets 403
      const runResponseLocksFirstRace = async (
        label: string,
        feedbackId: string,
        followUpFeedbackId: string,
        actorPrincipal: Awaited<ReturnType<typeof loadPrincipal>>,
        adminAction: (beforeLock: () => Promise<void>) => Promise<unknown>,
        restoreAction: () => Promise<unknown>,
      ) => {
        const locksHeld = createBarrier(2);
        const adminReady = createBarrier(2);
        let respLocksCount = 0;
        const rSvc = createIngredientQualityFeedbackService(
          {
            ...iqfRepo,
            async lockResponseContext(...args) {
              await iqfRepo.lockResponseContext(...args);
              respLocksCount++;
              if (respLocksCount === 1) {
                await locksHeld.wait();
                await adminReady.wait();
              }
            },
          },
          () => Promise.resolve(db),
        );
        try {
          const respPromise = rSvc.respond(
            { feedbackId },
            { supplierResponse: `Lock-first ${label}` },
            actorPrincipal,
          );
          await locksHeld.wait();
          const adminPromise = adminAction(async () => {
            await adminReady.wait();
          });
          const [respResult] = await Promise.all([respPromise, adminPromise]);
          assert.equal(respResult.status, "RESPONDED");
          await assert.rejects(
            () =>
              createIngredientQualityFeedbackService(iqfRepo, () =>
                Promise.resolve(db),
              ).respond(
                { feedbackId: followUpFeedbackId },
                { supplierResponse: `Next op after ${label}` },
                actorPrincipal,
              ),
            (err: unknown) =>
              err instanceof HttpError && err.statusCode === 403,
          );
        } finally {
          await restoreAction();
        }
      };

      const fDenial2a = await mkFeedback("Denial response lock first");
      const fDenial2b = await mkFeedback("Denial follow-up");
      await runResponseLocksFirstRace(
        "denial-after-lock",
        fDenial2a.id,
        fDenial2b.id,
        principalStaff1,
        async (beforeLock) => {
          const hookedAdmin = createSupplierStaffService(
            {
              ...staffRepo,
              async lock(...args) {
                await beforeLock();
                return staffRepo.lock(...args);
              },
            },
            () => Promise.resolve(db),
          );
          return hookedAdmin.togglePermission(
            { userId: raceStaff1.id, permissionId: respondPerm.id },
            true,
            principalAdmin,
          );
        },
        () =>
          staffService.togglePermission(
            { userId: raceStaff1.id, permissionId: respondPerm.id },
            false,
            principalAdmin,
          ),
      );

      const fLock2a = await mkFeedback("Status lock response lock first");
      const fLock2b = await mkFeedback("Status lock follow-up");
      await runResponseLocksFirstRace(
        "status-after-lock",
        fLock2a.id,
        fLock2b.id,
        principalStaff1,
        async (beforeLock) => {
          const hookedAdmin = createSupplierStaffService(
            {
              ...staffRepo,
              async lock(...args) {
                await beforeLock();
                return staffRepo.lock(...args);
              },
            },
            () => Promise.resolve(db),
          );
          return hookedAdmin.changeStatus(
            { userId: raceStaff1.id },
            { status: "LOCKED" },
            principalAdmin,
          );
        },
        () =>
          staffService.changeStatus(
            { userId: raceStaff1.id },
            { status: "ACTIVE" },
            principalAdmin,
          ),
      );

      const fRole2a = await mkFeedback("Role replace response lock first");
      const fRole2b = await mkFeedback("Role replace follow-up");
      await runResponseLocksFirstRace(
        "role-replace-after-lock",
        fRole2a.id,
        fRole2b.id,
        principalStaff2,
        async (beforeLock) => {
          let waited = false;
          return authorizationTransaction(db, async (tx) => {
            if (!waited) {
              waited = true;
              await beforeLock();
            }
            await tx.$queryRaw`SELECT id FROM foodprint.roles WHERE id = ${raceStaff1.roleId}::uuid FOR UPDATE`;
            await tx.rolePermission.deleteMany({
              where: {
                roleId: raceStaff1.roleId,
                permissionId: respondPerm.id,
              },
            });
            await permissionConcurrencyRepository.touchRole(
              tx,
              raceStaff1.roleId,
            );
          });
        },
        () =>
          permService.replaceRole(
            permissionSystem,
            raceStaff1.roleId,
            originalStaffGrants,
          ),
      );
    },
  );

  await context.test(
    "ingredient-quality-feedback real-login dynamic authorization rejects locked/moved/demoted/denied/inactive permissions on live session and never trusts forged token claims",
    async () => {
      const localStore = new MemoryStore();
      const srv = createApp(
        createApiRateLimiter(localStore, { windowMs: 60_000, limit: 5000 }),
        undefined,
        {
          session: sessionService,
          signup: createSignupService(undefined, verification),
          emailVerification: verification,
          password: passwords,
          onboarding: createOnboardingService(getPrisma, testDocumentStorage),
        },
      ).listen(0, "127.0.0.1");
      await once(srv, "listening");
      const addr = srv.address();
      assert(addr && typeof addr !== "string");
      const base = `http://127.0.0.1:${addr.port}/api`;
      const loginReal = async (email: string) => {
        const res = await fetch(base + "/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Protection": "1",
          },
          body: JSON.stringify({ identifier: email, password }),
        });
        assert.equal(res.status, 200);
        const cookie = res.headers
          .getSetCookie()
          .map((c) => c.split(";")[0])
          .join("; ");
        const refresh = parseCookie(cookie)[REFRESH_COOKIE];
        assert(refresh);
        refreshTokens.push(refresh);
        return cookie;
      };
      const callApi = (
        pathUrl: string,
        cookie: string,
        method = "GET",
        body?: unknown,
      ) =>
        fetch(base + pathUrl, {
          method,
          headers: {
            Cookie: cookie,
            ...(method === "GET"
              ? {}
              : {
                  "X-CSRF-Protection": "1",
                  "Content-Type": "application/json",
                }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });

      const iqfRepo = createIngredientQualityFeedbackRepository();
      try {
        const sup1 = await db.supplier.create({
          data: { name: "Dyn Auth Sup 1" },
        });
        const sup2 = await db.supplier.create({
          data: { name: "Dyn Auth Sup 2" },
        });
        const sch1 = await db.school.create({
          data: { name: "Dyn Auth School 1", code: "DYN-1" },
        });
        const staff1 = await user("INGREDIENT_SUPPLIER_STAFF", {
          supplierId: sup1.id,
        });
        const supAdmin1 = await user("INGREDIENT_SUPPLIER_ADMIN", {
          supplierId: sup1.id,
        });
        const schoolSubmitter = await user("SCHOOL_KITCHEN_STAFF", {
          schoolId: sch1.id,
        });
        const sup2Staff = await user("INGREDIENT_SUPPLIER_STAFF", {
          supplierId: sup2.id,
        });
        const dynUnit = await db.communeFoodSafetyUnit.create({
          data: {
            code: `DYN_UNIT_${randomUUID().slice(0, 6)}`,
            name: "Dyn Auth Unit",
          },
        });
        const authOfficer = await user("COMMUNE_FOOD_SAFETY_OFFICER", {
          communeFoodSafetyUnitId: dynUnit.id,
        });

        const del1 = await db.delivery.create({
          data: {
            deliveryNo: `FP-DE-DYN-${randomUUID().slice(0, 6)}`,
            schoolId: sch1.id,
            supplierId: sup1.id,
            creationMode: "STANDALONE",
            creationKey: randomUUID(),
            creationFingerprint: "9".repeat(64),
            createdByUserId: supAdmin1.id,
            status: "RECEIVED",
            receivedAt: new Date("2026-09-10T08:00:00Z"),
            receivedByUserId: schoolSubmitter.id,
          },
        });
        const mkFb = async (title: string) =>
          db.$transaction(async (tx) => {
            return tx.ingredientQualityFeedback.create({
              data: {
                complaintCode: await iqfRepo.allocateComplaintCode(tx),
                deliveryId: del1.id,
                submittedByUserId: schoolSubmitter.id,
                title,
                description: "Dynamic auth test",
              },
            });
          });
        const fb1 = await mkFb("Dynamic feedback 1");

        const cookieStaff1 = await loginReal(staff1.email);
        const cookieSchool = await loginReal(schoolSubmitter.email);
        const cookieSystem = await loginReal(system.email);
        const cookieOfficer = await loginReal(authOfficer.email);
        const cookieSup2Staff = await loginReal(sup2Staff.email);

        const viewDetailsPerm = await permission(
          "ingredient_quality_feedback.view_details",
        );
        const viewOwnPerm = await permission(
          "ingredient_quality_feedback.view_own",
        );
        const respondPerm = await permission(
          "ingredient_quality_feedback.respond",
        );
        const staffRoleId = staff1.roleId;
        const origGrants = (
          await db.rolePermission.findMany({
            where: { roleId: staffRoleId },
            select: { permissionId: true },
          })
        ).map((g) => g.permissionId);

        try {
          // Baseline allowed before changes
          assert.equal(
            (await callApi("/ingredient-quality-feedback", cookieStaff1))
              .status,
            200,
          );
          assert.equal(
            (
              await callApi(
                `/ingredient-quality-feedback/${fb1.id}`,
                cookieStaff1,
              )
            ).status,
            200,
          );

          // SCHOOL / SYSTEM / AUTHORITY / foreign supplier POST -> 403 or 404 (no leak)
          assert.equal(
            (
              await callApi(
                `/ingredient-quality-feedback/${fb1.id}/response`,
                cookieSchool,
                "POST",
                { supplierResponse: "School forbidden" },
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await callApi(
                `/ingredient-quality-feedback/${fb1.id}/response`,
                cookieSystem,
                "POST",
                { supplierResponse: "System forbidden" },
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await callApi(
                `/ingredient-quality-feedback/${fb1.id}/response`,
                cookieOfficer,
                "POST",
                { supplierResponse: "Authority forbidden" },
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await callApi(
                `/ingredient-quality-feedback/${fb1.id}/response`,
                cookieSup2Staff,
                "POST",
                { supplierResponse: "Foreign supplier 404" },
              )
            ).status,
            404,
          );

          // Same live cookie session immediately observes account LOCKED on list/detail/POST
          await db.user.update({
            where: { id: staff1.id },
            data: { status: "LOCKED" },
          });
          assert.equal(
            (await callApi("/ingredient-quality-feedback", cookieStaff1))
              .status,
            403,
          );
          assert.equal(
            (
              await callApi(
                `/ingredient-quality-feedback/${fb1.id}`,
                cookieStaff1,
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await callApi(
                `/ingredient-quality-feedback/${fb1.id}/response`,
                cookieStaff1,
                "POST",
                { supplierResponse: "Locked account" },
              )
            ).status,
            403,
          );
          await db.user.update({
            where: { id: staff1.id },
            data: { status: "ACTIVE" },
          });

          // Move supplierId on live session -> list empty, detail/POST 404 (foreign scope)
          await db.user.update({
            where: { id: staff1.id },
            data: { supplierId: sup2.id },
          });
          const movedList = await callApi(
            "/ingredient-quality-feedback",
            cookieStaff1,
          );
          assert.equal(movedList.status, 200);
          assert.deepEqual(
            ((await movedList.json()) as { data: { items: unknown[] } }).data
              .items,
            [],
          );
          assert.equal(
            (
              await callApi(
                `/ingredient-quality-feedback/${fb1.id}`,
                cookieStaff1,
              )
            ).status,
            404,
          );
          assert.equal(
            (
              await callApi(
                `/ingredient-quality-feedback/${fb1.id}/response`,
                cookieStaff1,
                "POST",
                { supplierResponse: "Moved org cannot reply" },
              )
            ).status,
            404,
          );
          await db.user.update({
            where: { id: staff1.id },
            data: { supplierId: sup1.id },
          });

          // Change role on live session to non-supplier -> 403 (even forged JWT claim claiming supplier role is ignored!)
          const schoolRoleRow = await role("SCHOOL_KITCHEN_STAFF");
          await db.user.update({
            where: { id: staff1.id },
            data: {
              roleId: schoolRoleRow.id,
              roleCode: schoolRoleRow.code,
              supplierId: null,
              schoolId: sch1.id,
            },
          });
          const rawAccess = parseCookie(cookieStaff1)[ACCESS_COOKIE];
          assert(rawAccess);
          const payload = verifyToken(rawAccess);
          const customClaims = Object.fromEntries(
            Object.entries(payload).filter(
              ([k]) => !["iss", "aud", "exp", "iat", "nbf"].includes(k),
            ),
          );
          const forgedHeader = {
            Authorization:
              "Bearer " +
              signToken({
                ...customClaims,
                role: "INGREDIENT_SUPPLIER_ADMIN",
                orgType: "SUPPLIER",
                supplierId: sup1.id,
              }),
            "X-CSRF-Protection": "1",
            "Content-Type": "application/json",
          };
          const forgedPost = await fetch(
            `${base}/ingredient-quality-feedback/${fb1.id}/response`,
            {
              method: "POST",
              headers: forgedHeader,
              body: JSON.stringify({ supplierResponse: "Forged token" }),
            },
          );
          assert.equal(forgedPost.status, 403);
          await db.user.update({
            where: { id: staff1.id },
            data: {
              roleId: staffRoleId,
              roleCode: "INGREDIENT_SUPPLIER_STAFF",
              supplierId: sup1.id,
              schoolId: null,
            },
          });

          // Denial on respond -> reads 200, POST 403; denial on view_details -> list/detail/POST 403
          await db.userPermissionDenial.create({
            data: {
              userId: staff1.id,
              permissionId: respondPerm.id,
              supplierId: sup1.id,
              disabledByUserId: supAdmin1.id,
            },
          });
          assert.equal(
            (
              await callApi(
                `/ingredient-quality-feedback/${fb1.id}`,
                cookieStaff1,
              )
            ).status,
            200,
          );
          assert.equal(
            (
              await callApi(
                `/ingredient-quality-feedback/${fb1.id}/response`,
                cookieStaff1,
                "POST",
                { supplierResponse: "Respond denied" },
              )
            ).status,
            403,
          );
          await db.userPermissionDenial.deleteMany({
            where: { userId: staff1.id, permissionId: respondPerm.id },
          });

          await db.userPermissionDenial.create({
            data: {
              userId: staff1.id,
              permissionId: viewDetailsPerm.id,
              supplierId: sup1.id,
              disabledByUserId: supAdmin1.id,
            },
          });
          // Even if supplier has view_own only (e.g., via role grant) while view_details is denied -> 403 on list/detail/POST!
          await db.rolePermission.createMany({
            data: [{ roleId: staffRoleId, permissionId: viewOwnPerm.id }],
            skipDuplicates: true,
          });
          assert.equal(
            (await callApi("/ingredient-quality-feedback", cookieStaff1))
              .status,
            403,
          );
          assert.equal(
            (
              await callApi(
                `/ingredient-quality-feedback/${fb1.id}`,
                cookieStaff1,
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await callApi(
                `/ingredient-quality-feedback/${fb1.id}/response`,
                cookieStaff1,
                "POST",
                { supplierResponse: "Respond only without view_details" },
              )
            ).status,
            403,
          );
          await db.rolePermission.deleteMany({
            where: { roleId: staffRoleId, permissionId: viewOwnPerm.id },
          });
          await db.userPermissionDenial.deleteMany({
            where: { userId: staff1.id },
          });

          // Inactive permission isActive=false on respond -> POST 403; on view_details -> list/detail/POST 403
          await db.permission.update({
            where: { id: respondPerm.id },
            data: { isActive: false },
          });
          assert.equal(
            (
              await callApi(
                `/ingredient-quality-feedback/${fb1.id}/response`,
                cookieStaff1,
                "POST",
                { supplierResponse: "Inactive respond permission" },
              )
            ).status,
            403,
          );
          await db.permission.update({
            where: { id: respondPerm.id },
            data: { isActive: true },
          });

          await db.permission.update({
            where: { id: viewDetailsPerm.id },
            data: { isActive: false },
          });
          assert.equal(
            (await callApi("/ingredient-quality-feedback", cookieStaff1))
              .status,
            403,
          );
          assert.equal(
            (
              await callApi(
                `/ingredient-quality-feedback/${fb1.id}`,
                cookieStaff1,
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await callApi(
                `/ingredient-quality-feedback/${fb1.id}/response`,
                cookieStaff1,
                "POST",
                { supplierResponse: "Inactive view_details permission" },
              )
            ).status,
            403,
          );
          await db.permission.update({
            where: { id: viewDetailsPerm.id },
            data: { isActive: true },
          });

          // Removed role grant -> 403
          await db.rolePermission.deleteMany({
            where: { roleId: staffRoleId, permissionId: respondPerm.id },
          });
          assert.equal(
            (
              await callApi(
                `/ingredient-quality-feedback/${fb1.id}/response`,
                cookieStaff1,
                "POST",
                { supplierResponse: "Lost role grant" },
              )
            ).status,
            403,
          );
        } finally {
          await db.permission.update({
            where: { id: viewDetailsPerm.id },
            data: { isActive: true },
          });
          await db.permission.update({
            where: { id: respondPerm.id },
            data: { isActive: true },
          });
          await db.userPermissionDenial.deleteMany({
            where: { userId: staff1.id },
          });
          await db.rolePermission.deleteMany({
            where: { roleId: staffRoleId },
          });
          await db.rolePermission.createMany({
            data: origGrants.map((permissionId) => ({
              roleId: staffRoleId,
              permissionId,
            })),
            skipDuplicates: true,
          });
          await db.user.update({
            where: { id: staff1.id },
            data: {
              roleId: staffRoleId,
              roleCode: "INGREDIENT_SUPPLIER_STAFF",
              supplierId: sup1.id,
              schoolId: null,
              status: "ACTIVE",
            },
          });
        }
      } finally {
        await new Promise<void>((resolve, reject) => {
          srv.close((err) => (err ? reject(err) : resolve()));
          srv.closeAllConnections();
        });
        localStore.shutdown();
      }
    },
  );
});
