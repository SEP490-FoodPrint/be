import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { MemoryStore } from "express-rate-limit";
import { createApp } from "../src/app";
import { createApiRateLimiter } from "../src/middlewares/rate-limit.middleware";
import { bootstrapAuthorization } from "../src/utils/authorization-bootstrap";
import { loadPrincipal } from "../src/utils/authorization";
import { getPrisma } from "../src/utils/database";
import { sendError } from "../src/utils/response";
import { createLifecycleTestDatabase } from "./helpers/account-lifecycle-database";
import { startHttp } from "./helpers/http";

function unwrap<T = Record<string, unknown>>(body: unknown): T {
  const obj = body as { success: boolean; data: T };
  assert.equal(obj.success, true);
  return obj.data;
}

void test("supplier order creation end-to-end integration on disposable PostgreSQL", async (context) => {
  const base = process.env.MIGRATION_TEST_DATABASE_URL;
  assert(
    base,
    "Set MIGRATION_TEST_DATABASE_URL to a disposable local PostgreSQL instance",
  );
  const temporary = await createLifecycleTestDatabase(base);
  const previousUrl = process.env.DATABASE_URL;
  const previousSecret = process.env.JWT_SECRET;
  process.env.DATABASE_URL = temporary.url;
  process.env.JWT_SECRET = "foodprint-supplier-order-integration-test-secret";
  const db = await getPrisma().catch(async () => {
    await temporary.cleanup();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    throw new Error("Không thể khởi tạo client cho database kiểm thử tạm");
  });

  context.after(async () => {
    await db.$disconnect();
    await temporary.cleanup();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });

  await bootstrapAuthorization(db);

  async function createAccount(
    roleCode: string,
    label: string,
    scope: { schoolId?: string; supplierId?: string },
  ) {
    const role = await db.role.findUniqueOrThrow({ where: { code: roleCode } });
    const username = `${label}_${randomUUID().replaceAll("-", "")}`;
    return db.user.create({
      data: {
        roleId: role.id,
        roleCode,
        username,
        email: `${username}@example.test`,
        fullName: label,
        passwordHash: "integration-test-not-used",
        status: "ACTIVE",
        ...scope,
      },
    });
  }

  const schoolA = await db.school.create({
    data: { name: "Integration School A", code: "INT-SA" },
  });
  const schoolPaused = await db.school.create({
    data: {
      name: "Integration School Paused",
      code: "INT-SP",
      intakeState: "PAUSED",
    },
  });
  const supplierA = await db.supplier.create({
    data: { name: "Integration Supplier A" },
  });
  const supplierB = await db.supplier.create({
    data: { name: "Integration Supplier B" },
  });

  const schoolAdminA = await createAccount(
    "SCHOOL_ADMINISTRATION",
    "sa_admin",
    {
      schoolId: schoolA.id,
    },
  );
  const inspectorUsers = await Promise.all([
    createAccount("SCHOOL_NUTRITION_OFFICER", "insp_nutr", {
      schoolId: schoolA.id,
    }),
    createAccount("SCHOOL_KITCHEN_STAFF", "insp_chef", {
      schoolId: schoolA.id,
    }),
    createAccount("INGREDIENT_MANAGEMENT_DEPARTMENT", "insp_inv", {
      schoolId: schoolA.id,
    }),
    createAccount("PARENTS_COMMITTEE", "insp_parent", {
      schoolId: schoolA.id,
    }),
  ]);
  const supplierAdminA = await createAccount(
    "INGREDIENT_SUPPLIER_ADMIN",
    "supa_admin",
    { supplierId: supplierA.id },
  );
  const supplierStaffA = await createAccount(
    "INGREDIENT_SUPPLIER_STAFF",
    "supa_staff",
    { supplierId: supplierA.id },
  );
  const supplierAdminB = await createAccount(
    "INGREDIENT_SUPPLIER_ADMIN",
    "supb_admin",
    { supplierId: supplierB.id },
  );

  await db.schoolSupplierRelationship.createMany({
    data: [
      {
        schoolId: schoolA.id,
        supplierId: supplierA.id,
        linkedByUserId: schoolAdminA.id,
        status: "ACTIVE",
      },
      {
        schoolId: schoolPaused.id,
        supplierId: supplierA.id,
        linkedByUserId: schoolAdminA.id,
        status: "ACTIVE",
      },
    ],
  });

  const riceA = await db.ingredient.create({
    data: {
      supplierId: supplierA.id,
      name: "Gạo ST25",
      defaultUnit: "kg",
      status: "ACTIVE",
    },
  });
  const chickenA = await db.ingredient.create({
    data: {
      supplierId: supplierA.id,
      name: "Thịt gà",
      defaultUnit: "kg",
      status: "ACTIVE",
    },
  });
  const inactiveIng = await db.ingredient.create({
    data: {
      supplierId: supplierA.id,
      name: "Ngừng dùng",
      defaultUnit: "kg",
      status: "INACTIVE",
    },
  });

  const riceEntry = await db.ingredientEntry.create({
    data: {
      schoolId: schoolA.id,
      ingredientId: riceA.id,
      handlingType: "DRY_STOCK",
      status: "ACTIVE",
    },
  });

  const acceptedRequest = await db.supplyRequest.create({
    data: {
      schoolId: schoolA.id,
      supplierId: supplierA.id,
      requestNo: `SR-INT-${randomUUID().slice(0, 8)}`,
      createdByUserId: inspectorUsers[0].id,
      status: "ACCEPTED",
      acceptedByUserId: supplierAdminA.id,
      acceptedAt: new Date(),
      sentAt: new Date(),
      supplyRequestItems: {
        create: {
          ingredientEntryId: riceEntry.id,
          requestedQuantity: "15.500",
          unit: "kg",
          note: "Giao sáng",
        },
      },
    },
  });

  const raceRequest = await db.supplyRequest.create({
    data: {
      schoolId: schoolA.id,
      supplierId: supplierA.id,
      requestNo: `SR-RACE-${randomUUID().slice(0, 8)}`,
      createdByUserId: inspectorUsers[0].id,
      status: "IN_PROGRESS",
      acceptedByUserId: supplierAdminA.id,
      acceptedAt: new Date(),
      sentAt: new Date(),
      supplyRequestItems: {
        create: {
          ingredientEntryId: riceEntry.id,
          requestedQuantity: "8.000",
          unit: "kg",
        },
      },
    },
  });

  const systemAdmin = await createAccount("SYSTEM_ADMIN", "sys_admin", {});

  const app = createApp(
    createApiRateLimiter(new MemoryStore(), {
      windowMs: 60_000,
      limit: 10_000,
    }),
    (req, res, next) => {
      const userId = req.header("x-test-principal");
      if (!userId) {
        sendError(res, "Chưa đăng nhập", 401);
        return;
      }
      void loadPrincipal(userId, db)
        .then((actor) => {
          req.auth = actor;
          next();
        })
        .catch(next);
    },
  );
  const http = await startHttp(app);
  context.after(() => http.close());

  function apiRequest(
    path: string,
    userId: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
    } = {},
  ) {
    return http.request(path, {
      method: options.method ?? "GET",
      headers: {
        "X-Test-Principal": userId,
        Origin: "http://localhost:3001",
        "X-CSRF-Protection": "1",
        "Content-Type": "application/json",
        ...options.headers,
      },
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
    });
  }

  // 1. Options endpoints exclude paused schools and inactive ingredients
  const schoolOpts = await apiRequest(
    "/api/deliveries/management/options/schools",
    supplierStaffA.id,
  );
  assert.equal(schoolOpts.status, 200);
  const schoolsData = unwrap<{ items: Array<{ id: string }> }>(schoolOpts.body);
  assert.deepEqual(
    schoolsData.items.map((item) => item.id),
    [schoolA.id],
  );

  const ingOpts = await apiRequest(
    "/api/deliveries/management/options/ingredients",
    supplierStaffA.id,
  );
  assert.equal(ingOpts.status, 200);
  const ingsData = unwrap<{ items: Array<{ id: string }> }>(ingOpts.body);
  assert.equal(
    ingsData.items.some((item) => item.id === inactiveIng.id),
    false,
  );
  assert.equal(
    ingsData.items.some((item) => item.id === riceA.id),
    true,
  );

  // 2. REQUEST creation moves ACCEPTED -> IN_PROGRESS + idempotent replay/conflict
  const reqKey = randomUUID();
  const createReqRes = await apiRequest(
    "/api/deliveries/management",
    supplierAdminA.id,
    {
      method: "POST",
      headers: { "Idempotency-Key": reqKey },
      body: {
        sourceType: "REQUEST",
        supplyRequestId: acceptedRequest.id,
        expectedArrivalAt: "2026-11-16T08:00:00+07:00",
        vehiclePlate: "29A-11111",
      },
    },
  );
  assert.equal(createReqRes.status, 201);
  const createdReq = unwrap<{
    id: string;
    deliveryNo: string;
    sourceType: string;
    items: Array<{ ingredientEntryId: string | null; actualQuantity: string }>;
  }>(createReqRes.body);
  assert.equal(createdReq.sourceType, "REQUEST");
  assert.equal(createdReq.items[0].ingredientEntryId, riceEntry.id);
  assert.equal(createdReq.items[0].actualQuantity, "15.5");

  const updatedReq = await db.supplyRequest.findUniqueOrThrow({
    where: { id: acceptedRequest.id },
  });
  assert.equal(updatedReq.status, "IN_PROGRESS");

  const replayReqRes = await apiRequest(
    "/api/deliveries/management",
    supplierAdminA.id,
    {
      method: "POST",
      headers: { "Idempotency-Key": reqKey },
      body: {
        sourceType: "REQUEST",
        supplyRequestId: acceptedRequest.id,
        expectedArrivalAt: "2026-11-16T01:00:00Z",
        vehiclePlate: " 29A-11111 ",
      },
    },
  );
  assert.equal(replayReqRes.status, 200);
  assert.equal(unwrap<{ id: string }>(replayReqRes.body).id, createdReq.id);

  const conflictReqRes = await apiRequest(
    "/api/deliveries/management",
    supplierAdminA.id,
    {
      method: "POST",
      headers: { "Idempotency-Key": reqKey },
      body: {
        sourceType: "REQUEST",
        supplyRequestId: acceptedRequest.id,
        vehiclePlate: "29A-99999",
      },
    },
  );
  assert.equal(conflictReqRes.status, 409);

  // 3. Concurrent race on the same SupplyRequest produces one 201 and one 409
  const raceResults = await Promise.all([
    apiRequest("/api/deliveries/management", supplierAdminA.id, {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: { sourceType: "REQUEST", supplyRequestId: raceRequest.id },
    }),
    apiRequest("/api/deliveries/management", supplierStaffA.id, {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: { sourceType: "REQUEST", supplyRequestId: raceRequest.id },
    }),
  ]);
  assert.deepEqual(raceResults.map((res) => res.status).sort(), [201, 409]);

  // 4. STANDALONE creation without existing IngredientEntry -> later inspection 409 until entry created, then RECEIVED -> warehouse
  const standaloneRes = await apiRequest(
    "/api/deliveries/management",
    supplierStaffA.id,
    {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        sourceType: "STANDALONE",
        schoolId: schoolA.id,
        items: [
          { ingredientId: chickenA.id, actualQuantity: "10.250", unit: "kg" },
        ],
      },
    },
  );
  assert.equal(standaloneRes.status, 201);
  const standaloneOrder = unwrap<{
    id: string;
    sourceType: string;
    supplyRequestId: string | null;
    items: Array<{ id: string; ingredientEntryId: string | null }>;
  }>(standaloneRes.body);
  assert.equal(standaloneOrder.sourceType, "STANDALONE");
  assert.equal(standaloneOrder.supplyRequestId, null);
  assert.equal(standaloneOrder.items[0].ingredientEntryId, null);

  await db.delivery.update({
    where: { id: standaloneOrder.id },
    data: { status: "ARRIVED", arrivedAt: new Date() },
  });
  await db.ingredientLot.create({
    data: {
      deliveryItemId: standaloneOrder.items[0].id,
      lotCode: `LOT-INT-${randomUUID().slice(0, 6)}`,
      receivedQuantity: "10.250",
      availableQuantity: "0",
      unit: "kg",
      status: "BLOCKED",
      expiryDate: new Date("2035-01-31"),
    },
  });

  for (const user of inspectorUsers.slice(0, 3)) {
    const approveRes = await apiRequest(
      `/api/deliveries/${standaloneOrder.id}/inspection`,
      user.id,
      { method: "POST", body: { decision: "APPROVE" } },
    );
    assert.equal(approveRes.status, 200);
  }
  const missingEntryApprove = await apiRequest(
    `/api/deliveries/${standaloneOrder.id}/inspection`,
    inspectorUsers[3].id,
    { method: "POST", body: { decision: "APPROVE" } },
  );
  assert.equal(missingEntryApprove.status, 409);

  const chickenEntry = await db.ingredientEntry.create({
    data: {
      schoolId: schoolA.id,
      ingredientId: chickenA.id,
      handlingType: "DIRECT_USE",
      status: "ACTIVE",
    },
  });
  const finalApprove = await apiRequest(
    `/api/deliveries/${standaloneOrder.id}/inspection`,
    inspectorUsers[3].id,
    { method: "POST", body: { decision: "APPROVE" } },
  );
  assert.equal(finalApprove.status, 200);
  assert.equal(
    unwrap<{ status: string }>(finalApprove.body).status,
    "RECEIVED",
  );
  const updatedItem = await db.deliveryItem.findUniqueOrThrow({
    where: { id: standaloneOrder.items[0].id },
  });
  assert.equal(updatedItem.ingredientEntryId, chickenEntry.id);

  const warehouseRes = await apiRequest(
    "/api/ingredient-lots?page=1&limit=20",
    inspectorUsers[2].id,
  );
  assert.equal(warehouseRes.status, 200);
  const warehouseData = unwrap<{
    items: Array<{
      DeliveryItem: {
        Ingredient: { id: string };
        SupplyRequestItem: unknown;
      };
    }>;
  }>(warehouseRes.body);
  assert.equal(
    warehouseData.items.some(
      (lot) =>
        lot.DeliveryItem.Ingredient.id === chickenA.id &&
        lot.DeliveryItem.SupplyRequestItem === null,
    ),
    true,
  );

  // 5. Foreign supplier gets 404 on management detail and revoking delivery.manage blocks replay
  const foreignDetail = await apiRequest(
    `/api/deliveries/management/${standaloneOrder.id}`,
    supplierAdminB.id,
  );
  assert.equal(foreignDetail.status, 404);

  const managePerm = await db.permission.findUniqueOrThrow({
    where: { code: "delivery.manage" },
  });
  await db.userPermissionDenial.create({
    data: {
      userId: supplierAdminA.id,
      permissionId: managePerm.id,
      disabledByUserId: systemAdmin.id,
    },
  });
  const revokedReplay = await apiRequest(
    "/api/deliveries/management",
    supplierAdminA.id,
    {
      method: "POST",
      headers: { "Idempotency-Key": reqKey },
      body: {
        sourceType: "REQUEST",
        supplyRequestId: acceptedRequest.id,
        expectedArrivalAt: "2026-11-16T01:00:00Z",
        vehiclePlate: "29A-11111",
      },
    },
  );
  assert.equal(revokedReplay.status, 403);
});
