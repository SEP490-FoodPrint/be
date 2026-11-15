import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import type { Express } from "express";
import { MemoryStore } from "express-rate-limit";
import { createApp } from "../src/app";
import { createApiRateLimiter } from "../src/middlewares/rate-limit.middleware";
import { createSupplierOrderService } from "../src/modules/supplier-order/supplier-order.service";
import { validateCreateSupplierOrderBody } from "../src/modules/supplier-order/supplier-order.validation";
import { bootstrapAuthorization } from "../src/utils/authorization-bootstrap";
import { loadPrincipal } from "../src/utils/authorization";
import { getPrisma } from "../src/utils/database";
import { sendError } from "../src/utils/response";
import {
  documentFormat,
  documentStorage,
  type OnboardingDocument,
} from "../src/utils/onboarding-documents";
import { createLifecycleTestDatabase } from "./helpers/account-lifecycle-database";

async function startHttp(app: Express) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    async request(path: string, init?: RequestInit) {
      const response = await fetch(baseUrl + path, init);
      const text = await response.text();
      const contentType = response.headers.get("content-type") ?? "";
      const body: unknown =
        text && contentType.includes("application/json")
          ? JSON.parse(text)
          : text || null;
      return { status: response.status, headers: response.headers, body };
    },
    async close(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}

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
  const previousTraceOrigin = process.env.PUBLIC_TRACE_ORIGIN;
  process.env.DATABASE_URL = temporary.url;
  process.env.JWT_SECRET = "foodprint-supplier-order-integration-test-secret";
  process.env.PUBLIC_TRACE_ORIGIN = "https://trace.example.test";
  const db = await getPrisma().catch(async () => {
    await temporary.cleanup();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    if (previousTraceOrigin === undefined)
      delete process.env.PUBLIC_TRACE_ORIGIN;
    else process.env.PUBLIC_TRACE_ORIGIN = previousTraceOrigin;
    throw new Error("Không thể khởi tạo client cho database kiểm thử tạm");
  });

  context.after(async () => {
    await db.$disconnect();
    await temporary.cleanup();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    if (previousTraceOrigin === undefined)
      delete process.env.PUBLIC_TRACE_ORIGIN;
    else process.env.PUBLIC_TRACE_ORIGIN = previousTraceOrigin;
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
    include: { supplyRequestItems: true },
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
    include: { supplyRequestItems: true },
  });

  const facilityA1 = await db.sourceFacility.create({
    data: {
      supplierId: supplierA.id,
      facilityCode: "SF-A1",
      name: "Nông trại A1",
      status: "ACTIVE",
      isVisible: true,
    },
  });
  const facilityA2 = await db.sourceFacility.create({
    data: {
      supplierId: supplierA.id,
      facilityCode: null,
      name: "Nông trại A2 Chưa Mã",
      status: "ACTIVE",
      isVisible: false,
    },
  });
  const inactiveFacilityA = await db.sourceFacility.create({
    data: {
      supplierId: supplierA.id,
      facilityCode: "SF-OFF",
      name: "Cơ sở Ngừng",
      status: "INACTIVE",
      isVisible: true,
    },
  });
  const facilityB1 = await db.sourceFacility.create({
    data: {
      supplierId: supplierB.id,
      facilityCode: "SF-B1",
      name: "Nông trại B1",
      status: "ACTIVE",
      isVisible: true,
    },
  });

  const systemAdmin = await createAccount("SYSTEM_ADMIN", "sys_admin", {});

  // Keep HTTP, authorization and PostgreSQL real; replace only external photo storage.
  const uploadedPhotos = new Map<string, OnboardingDocument>();
  context.mock.method(
    documentStorage,
    "upload",
    (userId: string, file: Express.Multer.File) => {
      const id = randomUUID();
      const format = documentFormat(file);
      const photo: OnboardingDocument = {
        id,
        field: file.fieldname,
        publicId: `foodprint/inspection/${userId}/${id}.${format}`,
        format,
        fileName: file.originalname,
        bytes: file.size,
      };
      uploadedPhotos.set(photo.publicId, photo);
      return Promise.resolve(photo);
    },
  );
  context.mock.method(
    documentStorage,
    "remove",
    (photo: OnboardingDocument) => {
      uploadedPhotos.delete(photo.publicId);
      return Promise.resolve();
    },
  );
  context.mock.method(
    documentStorage,
    "download",
    (photo: OnboardingDocument) =>
      `https://photos.example.test/${photo.publicId}`,
  );

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
    const body = options.body;
    const isMultipart = body instanceof FormData;
    return http.request(path, {
      method: options.method ?? "GET",
      headers: {
        "X-Test-Principal": userId,
        Origin: "http://localhost:3001",
        "X-CSRF-Protection": "1",
        ...(!isMultipart ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      ...(body !== undefined
        ? { body: isMultipart ? body : JSON.stringify(body) }
        : {}),
    });
  }

  const photoBytes = new Uint8Array([255, 216, 255, 0, 1]);
  function inspectionForm(decision: "APPROVE" | "REJECT", reason?: string) {
    const form = new FormData();
    form.set("decision", decision);
    if (reason) form.set("reason", reason);
    form.set(
      "photo",
      new Blob([photoBytes], { type: "image/jpeg" }),
      "inspection.jpg",
    );
    return form;
  }

  const wheatB = await db.ingredient.create({
    data: {
      supplierId: supplierB.id,
      name: "Bột mì B",
      defaultUnit: "kg",
      status: "ACTIVE",
    },
  });
  await db.schoolSupplierRelationship.create({
    data: {
      schoolId: schoolA.id,
      supplierId: supplierB.id,
      linkedByUserId: schoolAdminA.id,
      status: "ACTIVE",
    },
  });

  // 1. Options endpoints exclude paused schools, inactive ingredients, inactive/foreign facilities, and keep null facilityCode
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

  const facilityOpts = await apiRequest(
    "/api/deliveries/management/options/source-facilities",
    supplierStaffA.id,
  );
  assert.equal(facilityOpts.status, 200);
  const facilitiesData = unwrap<{
    items: Array<{ id: string; facilityCode: string | null }>;
  }>(facilityOpts.body);
  assert.deepEqual(
    facilitiesData.items.map((item) => item.id).sort(),
    [facilityA1.id, facilityA2.id].sort(),
  );
  assert.equal(
    facilitiesData.items.some((item) => item.id === inactiveFacilityA.id),
    false,
  );
  assert.equal(
    facilitiesData.items.some((item) => item.id === facilityB1.id),
    false,
  );
  assert.equal(
    facilitiesData.items.find((item) => item.id === facilityA2.id)
      ?.facilityCode,
    null,
  );

  // 2. 20 + 20 concurrent creations across two suppliers start cleanly at FP-DE-00001..00020 + 99999->100000 boundary
  const concBatchA = Array.from({ length: 20 }, (_, i) =>
    apiRequest(
      "/api/deliveries/management",
      i % 2 === 0 ? supplierAdminA.id : supplierStaffA.id,
      {
        method: "POST",
        headers: { "Idempotency-Key": randomUUID() },
        body: {
          sourceType: "STANDALONE",
          schoolId: schoolA.id,
          expectedArrivalAt: "2026-11-16T08:00:00+07:00",
          vehiclePlate: `29A-${String(10000 + i)}`,
          items: [
            {
              ingredientId: riceA.id,
              sourceFacilityId: i % 2 === 0 ? facilityA1.id : facilityA2.id,
              actualQuantity: "1.500",
              unit: "kg",
            },
          ],
        },
      },
    ),
  );
  const concBatchB = Array.from({ length: 20 }, (_, i) =>
    apiRequest("/api/deliveries/management", supplierAdminB.id, {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        sourceType: "STANDALONE",
        schoolId: schoolA.id,
        expectedArrivalAt: "2026-11-16T08:00:00+07:00",
        vehiclePlate: `30B-${String(20000 + i)}`,
        items: [
          {
            ingredientId: wheatB.id,
            sourceFacilityId: facilityB1.id,
            actualQuantity: "2.000",
            unit: "kg",
          },
        ],
      },
    }),
  );

  const [resConcA, resConcB] = await Promise.all([
    Promise.all(concBatchA),
    Promise.all(concBatchB),
  ]);
  const committedA = resConcA.filter((r) => r.status === 201);
  const committedB = resConcB.filter((r) => r.status === 201);
  assert.equal(committedA.length, 20);
  assert.equal(committedB.length, 20);
  const expectedSeq = Array.from(
    { length: 20 },
    (_, i) => `FP-DE-${String(i + 1).padStart(5, "0")}`,
  );
  assert.deepEqual(
    committedA
      .map((r) => unwrap<{ deliveryNo: string }>(r.body).deliveryNo)
      .sort(),
    expectedSeq,
  );
  assert.deepEqual(
    committedB
      .map((r) => unwrap<{ deliveryNo: string }>(r.body).deliveryNo)
      .sort(),
    expectedSeq,
  );
  const dbConcurrentItems = await db.deliveryItem.findMany({
    where: {
      Delivery: {
        id: {
          in: [...committedA, ...committedB].map(
            (r) => unwrap<{ id: string }>(r.body).id,
          ),
        },
      },
    },
    select: { qrToken: true },
  });
  assert.equal(dbConcurrentItems.length, 40);
  assert.equal(new Set(dbConcurrentItems.map((row) => row.qrToken)).size, 40);

  // Legacy + FP-DE-99999 -> FP-DE-100000 boundary on Supplier B
  await db.delivery.create({
    data: {
      schoolId: schoolA.id,
      supplierId: supplierB.id,
      creationMode: "STANDALONE",
      creationKey: randomUUID(),
      creationFingerprint: "0".repeat(64),
      deliveryNo: "DG-LEGACY-B",
      status: "IN_TRANSIT",
      createdByUserId: supplierAdminB.id,
    },
  });
  await db.delivery.create({
    data: {
      schoolId: schoolA.id,
      supplierId: supplierB.id,
      creationMode: "STANDALONE",
      creationKey: randomUUID(),
      creationFingerprint: "1".repeat(64),
      deliveryNo: "FP-DE-99999",
      status: "IN_TRANSIT",
      createdByUserId: supplierAdminB.id,
    },
  });
  const boundaryRes = await apiRequest(
    "/api/deliveries/management",
    supplierAdminB.id,
    {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        sourceType: "STANDALONE",
        schoolId: schoolA.id,
        expectedArrivalAt: "2026-11-16T08:00:00+07:00",
        vehiclePlate: "30B-99999",
        items: [
          {
            ingredientId: wheatB.id,
            sourceFacilityId: facilityB1.id,
            actualQuantity: "3",
            unit: "kg",
          },
        ],
      },
    },
  );
  assert.equal(boundaryRes.status, 201);
  assert.equal(
    unwrap<{ deliveryNo: string }>(boundaryRes.body).deliveryNo,
    "FP-DE-100000",
  );

  // 3. REQUEST v1 creation moves ACCEPTED -> IN_PROGRESS + canonical replay/conflict + render 503 retry + 2-actor race
  const reqKey = randomUUID();
  const reqItemId = acceptedRequest.supplyRequestItems[0].id;
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
        note: "Giao cổng sau",
        sources: [
          { supplyRequestItemId: reqItemId, sourceFacilityId: facilityA1.id },
        ],
      },
    },
  );
  assert.equal(createReqRes.status, 201);
  const createdReq = unwrap<{
    id: string;
    deliveryNo: string;
    sourceType: string;
    traceabilityVersion: number;
    status: string;
    statusLabel: string;
    items: Array<{
      id: string;
      ingredientEntryId: string | null;
      actualQuantity: string;
      sourceFacility: {
        id: string;
        name: string;
        facilityCode: string | null;
      } | null;
      traceUrl: string | null;
    }>;
  }>(createReqRes.body);
  assert.equal(createdReq.sourceType, "REQUEST");
  assert.equal(createdReq.traceabilityVersion, 1);
  assert.equal(createdReq.status, "IN_TRANSIT");
  assert.equal(createdReq.statusLabel, "Đang giao");
  assert.equal(createdReq.deliveryNo, "FP-DE-00021");
  assert.equal(createdReq.items[0].ingredientEntryId, riceEntry.id);
  assert.equal(createdReq.items[0].actualQuantity, "15.5");
  assert.deepEqual(createdReq.items[0].sourceFacility, {
    id: facilityA1.id,
    name: "Nông trại A1",
    facilityCode: "SF-A1",
  });
  assert.match(
    createdReq.items[0].traceUrl ?? "",
    /^https:\/\/trace\.example\.test\/api\/public\/delivery-items\/[0-9a-f]{64}$/,
  );

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
        note: "Giao cổng sau",
        sources: [
          { supplyRequestItemId: reqItemId, sourceFacilityId: facilityA1.id },
        ],
      },
    },
  );
  assert.equal(replayReqRes.status, 200);
  assert.equal(unwrap<{ id: string }>(replayReqRes.body).id, createdReq.id);

  for (const conflictBody of [
    {
      sourceType: "REQUEST",
      supplyRequestId: acceptedRequest.id,
      expectedArrivalAt: "2026-11-16T08:00:00+07:00",
      vehiclePlate: "29A-99999",
      note: "Giao cổng sau",
      sources: [
        { supplyRequestItemId: reqItemId, sourceFacilityId: facilityA1.id },
      ],
    },
    {
      sourceType: "REQUEST",
      supplyRequestId: acceptedRequest.id,
      expectedArrivalAt: "2026-11-16T08:00:00+07:00",
      vehiclePlate: "29A-11111",
      note: "Giao cổng sau",
      sources: [
        { supplyRequestItemId: reqItemId, sourceFacilityId: facilityA2.id },
      ],
    },
  ]) {
    const conflictReqRes = await apiRequest(
      "/api/deliveries/management",
      supplierAdminA.id,
      {
        method: "POST",
        headers: { "Idempotency-Key": reqKey },
        body: conflictBody,
      },
    );
    assert.equal(conflictReqRes.status, 409);
  }

  // Concurrent race on the same SupplyRequest produces one 201 and one 409
  const raceItemId = raceRequest.supplyRequestItems[0].id;
  const raceResults = await Promise.all([
    apiRequest("/api/deliveries/management", supplierAdminA.id, {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        sourceType: "REQUEST",
        supplyRequestId: raceRequest.id,
        expectedArrivalAt: "2026-11-16T08:00:00+07:00",
        vehiclePlate: "29A-22222",
        sources: [
          { supplyRequestItemId: raceItemId, sourceFacilityId: facilityA1.id },
        ],
      },
    }),
    apiRequest("/api/deliveries/management", supplierStaffA.id, {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        sourceType: "REQUEST",
        supplyRequestId: raceRequest.id,
        expectedArrivalAt: "2026-11-16T08:00:00+07:00",
        vehiclePlate: "29A-22222",
        sources: [
          { supplyRequestItemId: raceItemId, sourceFacilityId: facilityA1.id },
        ],
      },
    }),
  ]);
  assert.deepEqual(raceResults.map((res) => res.status).sort(), [201, 409]);

  // Durable retry with same key + body after simulated 503 render failure creates exactly 1 row
  let simulateRenderDown = true;
  const flakyService = createSupplierOrderService(undefined, {
    publicTraceOrigin: "https://trace.example.test",
    renderQrBatch: (urls) =>
      simulateRenderDown
        ? Promise.reject(new Error("Simulated PNG failure"))
        : Promise.resolve(urls.map(() => "data:image/png;base64,ok")),
  });
  const retryKey = randomUUID();
  const retryBody = validateCreateSupplierOrderBody({
    sourceType: "STANDALONE",
    schoolId: schoolA.id,
    expectedArrivalAt: "2026-11-16T10:00:00+07:00",
    vehiclePlate: "29H-88888",
    items: [
      {
        ingredientId: riceA.id,
        sourceFacilityId: facilityA1.id,
        actualQuantity: "4.000",
        unit: "kg",
      },
    ],
  });
  const retryActor = await loadPrincipal(supplierStaffA.id, db);
  await assert.rejects(
    () =>
      flakyService.create(
        { idempotencyKey: retryKey, body: retryBody },
        retryActor,
      ),
    { statusCode: 503 },
  );
  assert.equal(
    await db.delivery.count({ where: { creationKey: retryKey } }),
    0,
  );
  simulateRenderDown = false;
  const recoveredCreate = await flakyService.create(
    { idempotencyKey: retryKey, body: retryBody },
    retryActor,
  );
  assert.equal(recoveredCreate.created, true);
  assert.equal(
    await db.delivery.count({ where: { creationKey: retryKey } }),
    1,
  );

  // Race guard checks: INACTIVE source -> 409, INACTIVE relationship -> 409
  const inactiveSrcRes = await apiRequest(
    "/api/deliveries/management",
    supplierStaffA.id,
    {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        sourceType: "STANDALONE",
        schoolId: schoolA.id,
        expectedArrivalAt: "2026-11-16T08:00:00+07:00",
        vehiclePlate: "29C-00001",
        items: [
          {
            ingredientId: chickenA.id,
            sourceFacilityId: inactiveFacilityA.id,
            actualQuantity: "1",
            unit: "kg",
          },
        ],
      },
    },
  );
  assert.equal(inactiveSrcRes.status, 409);

  await db.schoolSupplierRelationship.updateMany({
    where: { schoolId: schoolA.id, supplierId: supplierA.id },
    data: {
      status: "SUSPENDED",
      suspendedAt: new Date(),
      suspensionReason: "Tạm dừng kiểm tra",
    },
  });
  const pausedRelRes = await apiRequest(
    "/api/deliveries/management",
    supplierStaffA.id,
    {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        sourceType: "STANDALONE",
        schoolId: schoolA.id,
        expectedArrivalAt: "2026-11-16T08:00:00+07:00",
        vehiclePlate: "29C-00002",
        items: [
          {
            ingredientId: chickenA.id,
            sourceFacilityId: facilityA2.id,
            actualQuantity: "1",
            unit: "kg",
          },
        ],
      },
    },
  );
  assert.equal(pausedRelRes.status, 409);
  await db.schoolSupplierRelationship.updateMany({
    where: { schoolId: schoolA.id, supplierId: supplierA.id },
    data: {
      status: "ACTIVE",
      suspendedAt: null,
      suspensionReason: null,
    },
  });

  // 4. STANDALONE v1 full HTTP flow: pre-arrival 409 -> HTTP arrival -> missing entry rollback -> entry created -> 4th APPROVE -> RECEIVED -> snapshot preserved -> public trace -> labels
  const standaloneRes = await apiRequest(
    "/api/deliveries/management",
    supplierStaffA.id,
    {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        sourceType: "STANDALONE",
        schoolId: schoolA.id,
        expectedArrivalAt: "2026-11-16T08:00:00+07:00",
        vehiclePlate: "29C-77777",
        items: [
          {
            ingredientId: chickenA.id,
            sourceFacilityId: facilityA2.id,
            actualQuantity: "10.250",
            unit: "kg",
          },
        ],
      },
    },
  );
  assert.equal(standaloneRes.status, 201);
  const standaloneOrder = unwrap<{
    id: string;
    deliveryNo: string;
    sourceType: string;
    status: string;
    supplyRequestId: string | null;
    items: Array<{
      id: string;
      ingredientEntryId: string | null;
      traceUrl: string | null;
    }>;
  }>(standaloneRes.body);
  assert.equal(standaloneOrder.sourceType, "STANDALONE");
  assert.equal(standaloneOrder.status, "IN_TRANSIT");
  assert.equal(standaloneOrder.supplyRequestId, null);
  assert.equal(standaloneOrder.items[0].ingredientEntryId, null);

  // Missing photos fail before storage or writes; a valid photo reaches pre-arrival protection.
  const missingPhotoInspect = await apiRequest(
    `/api/deliveries/${standaloneOrder.id}/inspection`,
    inspectorUsers[0].id,
    { method: "POST", body: { decision: "APPROVE" } },
  );
  assert.equal(missingPhotoInspect.status, 400);
  assert.equal(uploadedPhotos.size, 0);
  assert.equal(
    await db.deliveryApproval.count({
      where: { deliveryId: standaloneOrder.id },
    }),
    0,
  );
  const preArrivalInspect = await apiRequest(
    `/api/deliveries/${standaloneOrder.id}/inspection`,
    inspectorUsers[0].id,
    { method: "POST", body: inspectionForm("APPROVE") },
  );
  assert.equal(
    preArrivalInspect.status,
    409,
    JSON.stringify(preArrivalInspect.body),
  );
  assert.equal(uploadedPhotos.size, 0);

  // Supplier cannot confirm school arrival (403)
  assert.equal(
    (
      await apiRequest(
        `/api/deliveries/${standaloneOrder.id}/arrival`,
        supplierStaffA.id,
        { method: "POST" },
      )
    ).status,
    403,
  );

  // School arrival succeeds + idempotent replay preserves arrivedAt
  const arrivalRes = await apiRequest(
    `/api/deliveries/${standaloneOrder.id}/arrival`,
    inspectorUsers[0].id,
    { method: "POST" },
  );
  assert.equal(arrivalRes.status, 200);
  const arrivedBody = unwrap<{ status: string; arrivedAt: string }>(
    arrivalRes.body,
  );
  assert.equal(arrivedBody.status, "ARRIVED");
  const arrivalReplay = await apiRequest(
    `/api/deliveries/${standaloneOrder.id}/arrival`,
    inspectorUsers[1].id,
    { method: "POST", body: {} },
  );
  assert.equal(arrivalReplay.status, 200);
  assert.equal(
    unwrap<{ arrivedAt: string }>(arrivalReplay.body).arrivedAt,
    arrivedBody.arrivedAt,
  );

  // PLAN-01 lot was created server-side with sourceFacilityId; update expiry before final receipt
  const createdLot = await db.ingredientLot.findFirstOrThrow({
    where: { deliveryItemId: standaloneOrder.items[0].id },
  });
  assert.equal(createdLot.lotCode, "PLAN-01");
  assert.equal(createdLot.status, "BLOCKED");
  assert.equal(createdLot.sourceFacilityId, facilityA2.id);

  for (const user of inspectorUsers.slice(0, 3)) {
    const approveRes = await apiRequest(
      `/api/deliveries/${standaloneOrder.id}/inspection`,
      user.id,
      { method: "POST", body: inspectionForm("APPROVE") },
    );
    assert.equal(approveRes.status, 200, JSON.stringify(approveRes.body));
  }
  assert.equal(uploadedPhotos.size, 3);
  const missingEntryApprove = await apiRequest(
    `/api/deliveries/${standaloneOrder.id}/inspection`,
    inspectorUsers[3].id,
    { method: "POST", body: inspectionForm("APPROVE") },
  );
  assert.equal(missingEntryApprove.status, 409);
  assert.equal(uploadedPhotos.size, 3);
  assert.equal(
    await db.deliveryApproval.count({
      where: { deliveryId: standaloneOrder.id },
    }),
    3,
  );

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
    { method: "POST", body: inspectionForm("APPROVE") },
  );
  assert.equal(finalApprove.status, 200, JSON.stringify(finalApprove.body));
  const savedApprovals = await db.deliveryApproval.findMany({
    where: { deliveryId: standaloneOrder.id },
  });
  assert.equal(savedApprovals.length, 4);
  assert.equal(uploadedPhotos.size, 4);
  for (const approval of savedApprovals) {
    assert(
      approval.photoPublicId && uploadedPhotos.has(approval.photoPublicId),
    );
    assert.equal(
      approval.photoHash,
      createHash("sha256").update(photoBytes).digest("hex"),
    );
  }
  assert.equal(
    unwrap<{ status: string }>(finalApprove.body).status,
    "RECEIVED",
  );
  const updatedItem = await db.deliveryItem.findUniqueOrThrow({
    where: { id: standaloneOrder.items[0].id },
  });
  assert.equal(updatedItem.ingredientEntryId, chickenEntry.id);

  // Rename & stop facilityA2 and rename chickenA -> snapshots + public trace stay preserved
  await db.sourceFacility.update({
    where: { id: facilityA2.id },
    data: { name: "Nông trại A2 ĐÃ ĐỔI TÊN", status: "INACTIVE" },
  });
  await db.ingredient.update({
    where: { id: chickenA.id },
    data: { name: "Thịt gà ĐÃ ĐỔI TÊN" },
  });

  const labelsRes = await apiRequest(
    `/api/deliveries/management/${standaloneOrder.id}/labels`,
    supplierStaffA.id,
  );
  assert.equal(labelsRes.status, 200);
  const labelsData = unwrap<{
    items: Array<{
      ingredientName: string;
      sourceFacility: { name: string; facilityCode: string | null };
      qrImageDataUrl: string;
    }>;
  }>(labelsRes.body);
  assert.equal(labelsData.items[0].ingredientName, "Thịt gà");
  assert.deepEqual(labelsData.items[0].sourceFacility, {
    name: "Nông trại A2 Chưa Mã",
    facilityCode: null,
  });
  assert.match(labelsData.items[0].qrImageDataUrl, /^data:image\/png;base64,/);

  // Unauthenticated public trace (JSON + HTML) preserves snapshot and hides private school/plate fields
  const standaloneToken = updatedItem.qrToken!;
  const pubJsonRes = await http.request(
    `/api/public/delivery-items/${standaloneToken}`,
    { headers: { Accept: "application/json" } },
  );
  assert.equal(pubJsonRes.status, 200);
  assert.match(pubJsonRes.headers.get("cache-control") ?? "", /no-store/);
  const pubData = unwrap<Record<string, unknown>>(pubJsonRes.body);
  assert.deepEqual(Object.keys(pubData).sort(), [
    "actualQuantity",
    "deliveryNo",
    "ingredientName",
    "sourceFacility",
    "status",
    "statusLabel",
    "supplierName",
    "unit",
  ]);
  assert.equal(pubData.ingredientName, "Thịt gà");
  assert.equal(pubData.status, "RECEIVED");
  assert.equal(pubData.statusLabel, "Hoàn thành");
  assert.deepEqual(pubData.sourceFacility, {
    name: "Nông trại A2 Chưa Mã",
    facilityCode: null,
  });

  const pubHtmlRes = await http.request(
    `/api/public/delivery-items/${standaloneToken}`,
    { headers: { Accept: "text/html" } },
  );
  assert.equal(pubHtmlRes.status, 200);
  assert.equal(typeof pubHtmlRes.body, "string");
  assert.match(pubHtmlRes.body as string, /Chưa có mã cơ sở/);
  assert.doesNotMatch(
    pubHtmlRes.body as string,
    /29C-77777|Integration School/,
  );

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

  // 5. REJECT -> manual STANDALONE creates fresh deliveryNo/QR/approvals and completes independently
  const rejectedReqRes = await apiRequest(
    `/api/deliveries/${createdReq.id}/arrival`,
    inspectorUsers[0].id,
    { method: "POST" },
  );
  assert.equal(rejectedReqRes.status, 200);
  const rejectedInspRes = await apiRequest(
    `/api/deliveries/${createdReq.id}/inspection`,
    inspectorUsers[0].id,
    { method: "POST", body: inspectionForm("REJECT", "Bao bì rách") },
  );
  assert.equal(
    rejectedInspRes.status,
    200,
    JSON.stringify(rejectedInspRes.body),
  );
  assert.equal(
    unwrap<{ status: string }>(rejectedInspRes.body).status,
    "REJECTED",
  );

  const replacementRes = await apiRequest(
    "/api/deliveries/management",
    supplierAdminA.id,
    {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        sourceType: "STANDALONE",
        schoolId: schoolA.id,
        expectedArrivalAt: "2026-11-17T08:00:00+07:00",
        vehiclePlate: "29C-66666",
        items: [
          {
            ingredientId: riceA.id,
            sourceFacilityId: facilityA1.id,
            actualQuantity: "5.000",
            unit: "kg",
          },
        ],
      },
    },
  );
  assert.equal(replacementRes.status, 201);
  const replacement = unwrap<{
    id: string;
    deliveryNo: string;
    items: Array<{ traceUrl: string }>;
  }>(replacementRes.body);
  assert.notEqual(replacement.id, createdReq.id);
  assert.notEqual(replacement.deliveryNo, createdReq.deliveryNo);
  assert.notEqual(replacement.items[0].traceUrl, createdReq.items[0].traceUrl);

  assert.equal(
    (
      await apiRequest(
        `/api/deliveries/${replacement.id}/arrival`,
        inspectorUsers[0].id,
        { method: "POST" },
      )
    ).status,
    200,
  );
  for (const user of inspectorUsers) {
    assert.equal(
      (
        await apiRequest(
          `/api/deliveries/${replacement.id}/inspection`,
          user.id,
          { method: "POST", body: inspectionForm("APPROVE") },
        )
      ).status,
      200,
    );
  }
  const repCheck = await db.delivery.findUniqueOrThrow({
    where: { id: replacement.id },
  });
  assert.equal(repCheck.status, "RECEIVED");

  // 6. Foreign supplier gets 404 on management detail and revoking delivery.manage blocks replay
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
      supplierId: supplierA.id,
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
        note: "Giao cổng sau",
        sources: [
          { supplyRequestItemId: reqItemId, sourceFacilityId: facilityA1.id },
        ],
      },
    },
  );
  assert.equal(revokedReplay.status, 403);
});
