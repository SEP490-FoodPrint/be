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
import "./helpers/authorization";
import { readBusinessCodeKey } from "../src/config/env";
import {
  businessCodeSuffix,
  formatBusinessCode,
} from "../src/utils/business-code";
import { feistelDecrypt } from "../src/utils/feistel";
import { supplierOrderRepository } from "../src/modules/supplier-order/supplier-order.repository";

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
  const schoolWildcardNullCode = await db.school.create({
    data: {
      name: "Trường 100%_test\\vn NullCode",
      code: null,
    },
  });
  await db.school.create({
    data: {
      name: "Integration School A",
      code: "UNLINKED-SA",
    },
  });
  const schoolForeignBOnly = await db.school.create({
    data: {
      name: "Integration School Foreign",
      code: "FOREIGN-B",
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
  // Default tiers: kitchen PRIMARY, nutrition + ingredient management REQUIRED,
  // parents OPTIONAL. Snapshot deliveries complete on the last REQUIRED approval,
  // so ingredient management signs last to keep four signatures before RECEIVED.
  const approvalOrder = [
    inspectorUsers[0],
    inspectorUsers[1],
    inspectorUsers[3],
    inspectorUsers[2],
  ];
  const finalApprover = inspectorUsers[2];
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
      {
        schoolId: schoolWildcardNullCode.id,
        supplierId: supplierA.id,
        linkedByUserId: schoolAdminA.id,
        status: "ACTIVE",
      },
      {
        schoolId: schoolForeignBOnly.id,
        supplierId: supplierB.id,
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

  // DIRECT_USE: các kịch bản ở đây kiểm tra phân bổ nguồn/tạo trùng/QR, không gửi ngày lô.
  // Quy tắc đồ lưu kho bắt buộc ngày sản xuất và hạn dùng có unit test riêng (supplier-order-creation.test.ts).
  const riceEntry = await db.ingredientEntry.create({
    data: {
      schoolId: schoolA.id,
      ingredientId: riceA.id,
      handlingType: "DIRECT_USE",
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

  // 1. Options endpoints exclude paused/foreign/unlinked schools, inactive ingredients, inactive/foreign facilities, support literal wildcard & code-null search, and keep POST recheck
  const schoolOpts = await apiRequest(
    "/api/deliveries/management/options/schools",
    supplierStaffA.id,
  );
  assert.equal(schoolOpts.status, 200);
  const schoolsData = unwrap<{
    items: Array<{ id: string; code: string | null }>;
  }>(schoolOpts.body);
  assert.deepEqual(
    schoolsData.items.map((item) => item.id).sort(),
    [schoolA.id, schoolWildcardNullCode.id].sort(),
  );

  // Case-insensitive name search excludes unlinked same-name school, paused school & foreign school
  const nameSearch = await apiRequest(
    "/api/deliveries/management/options/schools?search=integration%20school",
    supplierAdminA.id,
  );
  assert.equal(nameSearch.status, 200);
  assert.deepEqual(
    unwrap<{ items: Array<{ id: string }> }>(nameSearch.body).items.map(
      (i) => i.id,
    ),
    [schoolA.id],
  );

  // Code search (lowercase -> uppercase match)
  const codeSearch = await apiRequest(
    "/api/deliveries/management/options/schools?search=int-sa",
    supplierStaffA.id,
  );
  assert.equal(codeSearch.status, 200);
  assert.deepEqual(
    unwrap<{ items: Array<{ id: string }> }>(codeSearch.body).items.map(
      (i) => i.id,
    ),
    [schoolA.id],
  );

  // Literal wildcard escaping (%, _, \) finds school with code=null without matching everything
  const wildcardSearch = await apiRequest(
    `/api/deliveries/management/options/schools?search=${encodeURIComponent("100%_test\\vn")}`,
    supplierStaffA.id,
  );
  assert.equal(wildcardSearch.status, 200);
  assert.deepEqual(
    unwrap<{ items: Array<{ id: string; code: string | null }> }>(
      wildcardSearch.body,
    ).items.map((i) => ({ id: i.id, code: i.code })),
    [{ id: schoolWildcardNullCode.id, code: null }],
  );

  // Blank search acts as unfiltered + paging limit=1
  const pagedBlank = await apiRequest(
    "/api/deliveries/management/options/schools?search=%20%20&page=1&limit=1",
    supplierStaffA.id,
  );
  assert.equal(pagedBlank.status, 200);
  assert.deepEqual(
    unwrap<{ items: unknown[]; pagination: { hasNext: boolean } }>(
      pagedBlank.body,
    ).pagination,
    { page: 1, limit: 1, hasNext: true },
  );

  // No-match & strict validation/permission boundaries
  const noMatchSearch = await apiRequest(
    "/api/deliveries/management/options/schools?search=khong-ton-tai-xyz",
    supplierStaffA.id,
  );
  assert.equal(noMatchSearch.status, 200);
  assert.deepEqual(unwrap<{ items: unknown[] }>(noMatchSearch.body).items, []);
  assert.equal(
    (
      await apiRequest(
        `/api/deliveries/management/options/schools?search=${"x".repeat(101)}`,
        supplierStaffA.id,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await apiRequest(
        "/api/deliveries/management/options/ingredients?search=gao",
        supplierStaffA.id,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await apiRequest(
        "/api/deliveries/management/options/schools?q=hoa",
        supplierStaffA.id,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await apiRequest(
        "/api/deliveries/management/options/schools?search=integration",
        inspectorUsers[0].id,
      )
    ).status,
    403,
  );

  // Selecting a school via search then suspending relationship before POST still rejects 409 (no fake SupplyRequest/CONFIRMED)
  await db.schoolSupplierRelationship.updateMany({
    where: { schoolId: schoolWildcardNullCode.id, supplierId: supplierA.id },
    data: {
      status: "SUSPENDED",
      suspendedAt: new Date(),
      suspensionReason: "Ngừng sau bước tìm kiếm",
    },
  });
  const countReqBeforeStaleSearch = await db.supplyRequest.count();
  const staleSearchPost = await apiRequest(
    "/api/deliveries/management",
    supplierStaffA.id,
    {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        sourceType: "STANDALONE",
        schoolId: schoolWildcardNullCode.id,
        items: [
          {
            ingredientId: riceA.id,
            sourceFacilityId: facilityA1.id,
            actualQuantity: "5",
            unit: "kg",
          },
        ],
      },
    },
  );
  assert.equal(staleSearchPost.status, 409);
  assert.equal(await db.supplyRequest.count(), countReqBeforeStaleSearch);

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
  const concBatchB = Array.from({ length: 20 }, () =>
    apiRequest("/api/deliveries/management", supplierAdminB.id, {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        sourceType: "STANDALONE",
        schoolId: schoolA.id,
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
  // Mã mới dùng bộ đếm DE toàn hệ thống với hậu tố Feistel: 40 lần tạo đồng thời của 2 nhà cung cấp
  // cho 40 mã khác nhau, không phải FP-DE-00001..00020 lặp lại theo từng supplier.
  const businessKey = readBusinessCodeKey();
  const concurrentCodes = [...committedA, ...committedB].map(
    (r) => unwrap<{ deliveryNo: string }>(r.body).deliveryNo,
  );
  assert.equal(new Set(concurrentCodes).size, 40);
  for (const code of concurrentCodes) {
    assert.match(code, /^FP-DE-[0-9]{5}$/);
    assert.notEqual(code, "FP-DE-00000");
  }
  const decodedSequences = concurrentCodes
    .map((code) => feistelDecrypt(Number(code.slice(-5)), businessKey) + 1)
    .sort((a, b) => a - b);
  assert.equal(new Set(decodedSequences).size, 40);
  assert(decodedSequences.every((sequence) => sequence >= 1 && sequence <= 41));
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

  // Mã cũ (tuần tự / định dạng khác) được giữ nguyên; mã mới trùng mã cũ bị bỏ qua.
  const counterRow = await db.businessCodeCounter.findUniqueOrThrow({
    where: { codeType: "DE" },
  });
  let collidingSequence = counterRow.lastSequence + 1;
  while (businessCodeSuffix(collidingSequence, businessKey) === 0) {
    collidingSequence++;
  }
  const collidingCode = formatBusinessCode(
    "DE",
    businessCodeSuffix(collidingSequence, businessKey),
  );
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
      supplierId: supplierA.id,
      creationMode: "STANDALONE",
      creationKey: randomUUID(),
      creationFingerprint: "1".repeat(64),
      // Mã cũ của nhà cung cấp A trùng đúng mã kế tiếp: nhà cung cấp B vẫn không được nhận mã này.
      deliveryNo: collidingCode,
      status: "IN_TRANSIT",
      createdByUserId: supplierAdminA.id,
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
  const skippedCode = unwrap<{ deliveryNo: string }>(
    boundaryRes.body,
  ).deliveryNo;
  assert.match(skippedCode, /^FP-DE-[0-9]{5}$/);
  assert.notEqual(skippedCode, collidingCode);
  assert(
    feistelDecrypt(Number(skippedCode.slice(-5)), businessKey) + 1 >
      collidingSequence,
  );

  // Rollback sau khi đã cấp mã: bộ đếm rollback cùng transaction, lần cấp sau nhận lại đúng mã đó.
  const rollbackMarker = new Error("delivery code rollback test");
  let rolledBackCode = "";
  await assert.rejects(
    db.$transaction(async (tx) => {
      rolledBackCode = await supplierOrderRepository.allocateDeliveryNo(tx);
      throw rollbackMarker;
    }),
    (error: unknown) => error === rollbackMarker,
  );
  let reissuedCode = "";
  await assert.rejects(
    db.$transaction(async (tx) => {
      reissuedCode = await supplierOrderRepository.allocateDeliveryNo(tx);
      throw rollbackMarker;
    }),
    (error: unknown) => error === rollbackMarker,
  );
  assert.equal(reissuedCode, rolledBackCode);
  assert.equal(
    await db.delivery.count({ where: { deliveryNo: rolledBackCode } }),
    0,
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
        note: "Giao cổng sau",
        sources: [
          {
            supplyRequestItemId: reqItemId,
            sourceFacilityId: facilityA1.id,
            actualQuantity: "15.5",
          },
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
    workflowVersion: number | null;
    nextAction: string;
    status: string;
    statusLabel: string;
    expectedArrivalAt: string | null;
    vehiclePlate: string | null;
    updatedAt: string;
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
  assert.equal(createdReq.workflowVersion, 2);
  assert.equal(createdReq.status, "PREPARING");
  assert.equal(createdReq.statusLabel, "Đang chuẩn bị hàng");
  assert.equal(createdReq.nextAction, "ENTER_SHIPPING");
  assert.equal(createdReq.expectedArrivalAt, null);
  assert.equal(createdReq.vehiclePlate, null);
  assert.match(createdReq.deliveryNo, /^FP-DE-[0-9]{5}$/);
  assert(![...concurrentCodes, skippedCode].includes(createdReq.deliveryNo));
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

  // School cannot arrive while PREPARING (409)
  assert.equal(
    (
      await apiRequest(
        `/api/deliveries/${createdReq.id}/arrival`,
        inspectorUsers[1].id,
        { method: "POST" },
      )
    ).status,
    409,
  );

  const replayReqRes = await apiRequest(
    "/api/deliveries/management",
    supplierAdminA.id,
    {
      method: "POST",
      headers: { "Idempotency-Key": reqKey },
      body: {
        sourceType: "REQUEST",
        supplyRequestId: acceptedRequest.id,
        note: "Giao cổng sau",
        sources: [
          {
            supplyRequestItemId: reqItemId,
            sourceFacilityId: facilityA1.id,
            actualQuantity: "15.500",
          },
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
      note: "Giao cổng khác",
      sources: [
        {
          supplyRequestItemId: reqItemId,
          sourceFacilityId: facilityA1.id,
          actualQuantity: "15.5",
        },
      ],
    },
    {
      sourceType: "REQUEST",
      supplyRequestId: acceptedRequest.id,
      note: "Giao cổng sau",
      sources: [
        {
          supplyRequestItemId: reqItemId,
          sourceFacilityId: facilityA2.id,
          actualQuantity: "15.5",
        },
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

  // Stage 2 dispatch -> IN_TRANSIT + idempotent canonical replay keeps updatedAt + conflict 409
  const dispatchReqRes = await apiRequest(
    `/api/deliveries/management/${createdReq.id}/dispatch`,
    supplierAdminA.id,
    {
      method: "POST",
      body: {
        expectedArrivalAt: "2099-11-16T08:00:00+07:00",
        vehiclePlate: "29A-11111",
      },
    },
  );
  assert.equal(dispatchReqRes.status, 200);
  const dispatchedReq = unwrap<{
    status: string;
    statusLabel: string;
    nextAction: string;
    expectedArrivalAt: string | null;
    vehiclePlate: string | null;
    updatedAt: string;
  }>(dispatchReqRes.body);
  assert.equal(dispatchedReq.status, "IN_TRANSIT");
  assert.equal(dispatchedReq.statusLabel, "Đang giao hàng");
  assert.equal(dispatchedReq.nextAction, "TRACK_DELIVERY");
  assert.equal(dispatchedReq.expectedArrivalAt, "2099-11-16T01:00:00.000Z");
  assert.equal(dispatchedReq.vehiclePlate, "29A-11111");

  const dispatchReplayRes = await apiRequest(
    `/api/deliveries/management/${createdReq.id}/dispatch`,
    supplierStaffA.id,
    {
      method: "POST",
      body: {
        expectedArrivalAt: "2099-11-16T01:00:00Z",
        vehiclePlate: "  29A-11111  ",
      },
    },
  );
  assert.equal(dispatchReplayRes.status, 200);
  assert.equal(
    unwrap<{ updatedAt: string }>(dispatchReplayRes.body).updatedAt,
    dispatchedReq.updatedAt,
  );
  assert.equal(
    (
      await apiRequest(
        `/api/deliveries/management/${createdReq.id}/dispatch`,
        supplierStaffA.id,
        {
          method: "POST",
          body: {
            expectedArrivalAt: "2099-11-16T01:00:00Z",
            vehiclePlate: "29A-99999",
          },
        },
      )
    ).status,
    409,
  );

  // Concurrent race on the same SupplyRequest produces one 201 and one 409
  const raceItemId = raceRequest.supplyRequestItems[0].id;
  const raceResults = await Promise.all([
    apiRequest("/api/deliveries/management", supplierAdminA.id, {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        sourceType: "REQUEST",
        supplyRequestId: raceRequest.id,
        sources: [
          {
            supplyRequestItemId: raceItemId,
            sourceFacilityId: facilityA1.id,
            actualQuantity: "8.000",
          },
        ],
      },
    }),
    apiRequest("/api/deliveries/management", supplierStaffA.id, {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        sourceType: "REQUEST",
        supplyRequestId: raceRequest.id,
        sources: [
          {
            supplyRequestItemId: raceItemId,
            sourceFacilityId: facilityA1.id,
            actualQuantity: "8.000",
          },
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

  // T123: Multi-source STANDALONE (chickenA 6+4 across 2 facilities with entryId null, plus riceA across 2 facilities)
  const reqCountBeforeMultiStandalone = await db.supplyRequest.count();
  const entryCountBeforeMultiStandalone = await db.ingredientEntry.count({
    where: { schoolId: schoolA.id },
  });
  const dupStandalonePairRes = await apiRequest(
    "/api/deliveries/management",
    supplierStaffA.id,
    {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        sourceType: "STANDALONE",
        schoolId: schoolA.id,
        items: [
          {
            ingredientId: chickenA.id,
            sourceFacilityId: facilityA1.id,
            actualQuantity: "6.000",
            unit: "kg",
          },
          {
            ingredientId: chickenA.id,
            sourceFacilityId: facilityA1.id,
            actualQuantity: "4.000",
            unit: "kg",
          },
        ],
      },
    },
  );
  assert.equal(dupStandalonePairRes.status, 400);

  const multiStandaloneRes = await apiRequest(
    "/api/deliveries/management",
    supplierStaffA.id,
    {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        sourceType: "STANDALONE",
        schoolId: schoolA.id,
        items: [
          {
            ingredientId: chickenA.id,
            sourceFacilityId: facilityA1.id,
            actualQuantity: "6.000",
            unit: "kg",
          },
          {
            ingredientId: chickenA.id,
            sourceFacilityId: facilityA2.id,
            actualQuantity: "4.000",
            unit: "kg",
          },
          {
            ingredientId: riceA.id,
            sourceFacilityId: facilityA1.id,
            actualQuantity: "3.000",
            unit: "kg",
          },
          {
            ingredientId: riceA.id,
            sourceFacilityId: facilityA2.id,
            actualQuantity: "2.000",
            unit: "kg",
          },
        ],
      },
    },
  );
  assert.equal(multiStandaloneRes.status, 201);
  const multiStandalone = unwrap<{
    id: string;
    sourceType: string;
    status: string;
    statusLabel: string;
    workflowVersion: number | null;
    traceabilityVersion: number | null;
    nextAction: string;
    supplyRequestId: string | null;
    requestNo: string | null;
    expectedArrivalAt: string | null;
    vehiclePlate: string | null;
    items: Array<{
      id: string;
      ingredientId: string;
      ingredientEntryId: string | null;
      sourceFacility: { id: string } | null;
      traceUrl: string | null;
      actualQuantity: string;
    }>;
  }>(multiStandaloneRes.body);
  assert.equal(multiStandalone.sourceType, "STANDALONE");
  assert.equal(multiStandalone.status, "PREPARING");
  assert.equal(multiStandalone.statusLabel, "Đang chuẩn bị hàng");
  assert.equal(multiStandalone.workflowVersion, 2);
  assert.equal(multiStandalone.traceabilityVersion, 1);
  assert.equal(multiStandalone.nextAction, "ENTER_SHIPPING");
  assert.equal(multiStandalone.supplyRequestId, null);
  assert.equal(multiStandalone.requestNo, null);
  assert.equal(multiStandalone.expectedArrivalAt, null);
  assert.equal(multiStandalone.vehiclePlate, null);
  assert.equal(multiStandalone.items.length, 4);
  assert.equal(new Set(multiStandalone.items.map((item) => item.id)).size, 4);
  assert.equal(
    new Set(multiStandalone.items.map((item) => item.traceUrl)).size,
    4,
  );
  const sortedChickenActual = multiStandalone.items
    .filter((item) => item.ingredientId === chickenA.id)
    .map((item) => [
      item.sourceFacility?.id ?? null,
      item.ingredientEntryId,
      item.actualQuantity,
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const sortedChickenExpected = [
    [facilityA1.id, null, "6"],
    [facilityA2.id, null, "4"],
  ].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  assert.deepEqual(sortedChickenActual, sortedChickenExpected);
  const sortedRiceActual = multiStandalone.items
    .filter((item) => item.ingredientId === riceA.id)
    .map((item) => [
      item.sourceFacility?.id ?? null,
      item.ingredientEntryId,
      item.actualQuantity,
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const sortedRiceExpected = [
    [facilityA1.id, riceEntry.id, "3"],
    [facilityA2.id, riceEntry.id, "2"],
  ].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  assert.deepEqual(sortedRiceActual, sortedRiceExpected);
  assert.equal(await db.supplyRequest.count(), reqCountBeforeMultiStandalone);
  assert.equal(
    await db.ingredientEntry.count({ where: { schoolId: schoolA.id } }),
    entryCountBeforeMultiStandalone,
  );
  const multiStandaloneLots = await db.ingredientLot.findMany({
    where: {
      deliveryItemId: { in: multiStandalone.items.map((item) => item.id) },
    },
  });
  assert.equal(multiStandaloneLots.length, 4);
  assert.equal(new Set(multiStandaloneLots.map((lot) => lot.qrToken)).size, 4);
  for (const lot of multiStandaloneLots) {
    const matchedItem = multiStandalone.items.find(
      (item) => item.id === lot.deliveryItemId,
    )!;
    assert.match(lot.lotCode, /^FP-LO-[0-9]{5,}$/);
    assert.equal(lot.status, "BLOCKED");
    assert.equal(
      lot.receivedQuantity.toFixed(3),
      Number(matchedItem.actualQuantity).toFixed(3),
    );
    assert.equal(lot.availableQuantity.toFixed(3), "0.000");
  }

  // T136: PREPARING 6A+4B multi-source labels & public scan work BEFORE dispatch (no collapsing), and keep identical URLs on reprint
  const prepMultiLabelsRes = await apiRequest(
    `/api/deliveries/management/${multiStandalone.id}/labels`,
    supplierStaffA.id,
  );
  assert.equal(prepMultiLabelsRes.status, 200);
  const prepMultiLabels = unwrap<{
    items: Array<{
      deliveryItemId: string;
      ingredientName: string;
      actualQuantity: string;
      sourceFacility: { name: string; facilityCode: string | null };
      traceUrl: string;
      qrImageDataUrl: string;
    }>;
  }>(prepMultiLabelsRes.body);
  assert.equal(prepMultiLabels.items.length, 4);
  assert.equal(
    new Set(prepMultiLabels.items.map((item) => item.deliveryItemId)).size,
    4,
  );
  assert.equal(
    new Set(prepMultiLabels.items.map((item) => item.qrImageDataUrl)).size,
    4,
  );
  const chickenItems = multiStandalone.items.filter(
    (item) => item.ingredientId === chickenA.id,
  );
  const chickenLots = multiStandaloneLots.filter((lot) =>
    chickenItems.some((item) => item.id === lot.deliveryItemId),
  );
  assert.equal(chickenLots.length, 2);
  for (const chickenItem of chickenItems) {
    const lotForItem = chickenLots.find(
      (lot) => lot.deliveryItemId === chickenItem.id,
    );
    assert(lotForItem);
    const dbChickenItem = await db.deliveryItem.findUniqueOrThrow({
      where: { id: chickenItem.id },
      select: { qrToken: true },
    });
    assert(dbChickenItem.qrToken);
    assert(chickenItem.traceUrl?.endsWith(`/${dbChickenItem.qrToken}`));
    const scanPrepRes = await http.request(
      `/api/public/delivery-items/${dbChickenItem.qrToken}`,
      { headers: { Accept: "application/json" } },
    );
    assert.equal(scanPrepRes.status, 200);
    const scanPrepData = unwrap<Record<string, unknown>>(scanPrepRes.body);
    assert.deepEqual(Object.keys(scanPrepData).sort(), [
      "actualQuantity",
      "deliveryNo",
      "ingredientName",
      "sourceFacility",
      "status",
      "statusLabel",
      "supplierName",
      "unit",
    ]);
    assert.equal(scanPrepData.status, "PREPARING");
    assert.equal(scanPrepData.statusLabel, "Đang chuẩn bị hàng");
    assert.equal(scanPrepData.actualQuantity, chickenItem.actualQuantity);
    assert(
      chickenItem.actualQuantity === "6" || chickenItem.actualQuantity === "4",
    );
  }
  const reprintPrepLabelsRes = await apiRequest(
    `/api/deliveries/management/${multiStandalone.id}/labels`,
    supplierAdminA.id,
  );
  assert.equal(reprintPrepLabelsRes.status, 200);
  assert.deepEqual(
    unwrap<{ items: Array<{ traceUrl: string }> }>(
      reprintPrepLabelsRes.body,
    ).items.map((i) => i.traceUrl),
    prepMultiLabels.items.map((i) => i.traceUrl),
  );

  // 4. STANDALONE workflow2 full HTTP flow: create PREPARING -> pre-dispatch arrival/inspection 409 -> dispatch IN_TRANSIT -> HTTP arrival reports missing entry -> first APPROVE rollback (FR-014) -> entry created -> 4 APPROVE -> RECEIVED -> snapshot preserved -> public trace -> labels
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
    workflowVersion: number | null;
    supplyRequestId: string | null;
    expectedArrivalAt: string | null;
    vehiclePlate: string | null;
    items: Array<{
      id: string;
      ingredientEntryId: string | null;
      traceUrl: string | null;
    }>;
  }>(standaloneRes.body);
  assert.equal(standaloneOrder.sourceType, "STANDALONE");
  assert.equal(standaloneOrder.status, "PREPARING");
  assert.equal(standaloneOrder.workflowVersion, 2);
  assert.equal(standaloneOrder.supplyRequestId, null);
  assert.equal(standaloneOrder.expectedArrivalAt, null);
  assert.equal(standaloneOrder.vehiclePlate, null);
  assert.equal(standaloneOrder.items[0].ingredientEntryId, null);

  // Pre-dispatch arrival and inspection are rejected
  assert.equal(
    (
      await apiRequest(
        `/api/deliveries/${standaloneOrder.id}/arrival`,
        inspectorUsers[1].id,
        { method: "POST" },
      )
    ).status,
    409,
  );
  const missingPhotoInspect = await apiRequest(
    `/api/deliveries/${standaloneOrder.id}/inspection`,
    inspectorUsers[0].id,
    { method: "POST", body: { decision: "APPROVE" } },
  );
  assert.equal(missingPhotoInspect.status, 400);
  assert.match(
    (missingPhotoInspect.body as { message: string }).message,
    /Cần gửi ảnh/,
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
  assert.equal(
    await db.deliveryApproval.count({
      where: { deliveryId: standaloneOrder.id },
    }),
    0,
  );
  assert.equal(
    (await db.delivery.findUniqueOrThrow({ where: { id: standaloneOrder.id } }))
      .status,
    "PREPARING",
  );

  // Dispatch -> IN_TRANSIT before arrival/inspection flow
  const dispatchStandaloneRes = await apiRequest(
    `/api/deliveries/management/${standaloneOrder.id}/dispatch`,
    supplierStaffA.id,
    {
      method: "POST",
      body: {
        expectedArrivalAt: "2099-11-16T08:00:00+07:00",
        vehiclePlate: "29C-77777",
      },
    },
  );
  assert.equal(dispatchStandaloneRes.status, 200);
  assert.equal(
    unwrap<{ status: string }>(dispatchStandaloneRes.body).status,
    "IN_TRANSIT",
  );

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
    inspectorUsers[1].id,
    { method: "POST" },
  );
  assert.equal(arrivalRes.status, 200);
  const arrivedBody = unwrap<{
    status: string;
    arrivedAt: string;
    receiptIssue: string | null;
  }>(arrivalRes.body);
  assert.equal(arrivedBody.status, "ARRIVED");
  const missingEntryIssue =
    "Chưa cấu hình danh mục nguyên liệu đang hoạt động của trường để tiếp nhận lô";
  // FR-014: the missing school ingredient entry is reported on arrival.
  assert.equal(arrivedBody.receiptIssue, missingEntryIssue);
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

  // FP-LO lot was created server-side with sourceFacilityId; update expiry before final receipt
  const createdLot = await db.ingredientLot.findFirstOrThrow({
    where: { deliveryItemId: standaloneOrder.items[0].id },
  });
  assert.match(createdLot.lotCode, /^FP-LO-[0-9]{5,}$/);
  assert.equal(createdLot.status, "BLOCKED");
  assert.equal(createdLot.sourceFacilityId, facilityA2.id);

  // The FIRST APPROVE is blocked (no decision, uploaded photo removed), not the 4th.
  const missingEntryApprove = await apiRequest(
    `/api/deliveries/${standaloneOrder.id}/inspection`,
    inspectorUsers[0].id,
    { method: "POST", body: inspectionForm("APPROVE") },
  );
  assert.equal(missingEntryApprove.status, 409);
  assert.equal(uploadedPhotos.size, 0);
  assert.equal(
    await db.deliveryApproval.count({
      where: { deliveryId: standaloneOrder.id },
    }),
    0,
  );

  const chickenEntry = await db.ingredientEntry.create({
    data: {
      schoolId: schoolA.id,
      ingredientId: chickenA.id,
      handlingType: "DIRECT_USE",
      status: "ACTIVE",
    },
  });
  for (const user of approvalOrder.slice(0, 3)) {
    const approveRes = await apiRequest(
      `/api/deliveries/${standaloneOrder.id}/inspection`,
      user.id,
      { method: "POST", body: inspectionForm("APPROVE") },
    );
    assert.equal(approveRes.status, 200, JSON.stringify(approveRes.body));
  }
  assert.equal(uploadedPhotos.size, 3);
  const finalApprove = await apiRequest(
    `/api/deliveries/${standaloneOrder.id}/inspection`,
    finalApprover.id,
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
    inspectorUsers[1].id,
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
        `/api/deliveries/management/${replacement.id}/dispatch`,
        supplierAdminA.id,
        {
          method: "POST",
          body: {
            expectedArrivalAt: "2099-11-17T08:00:00+07:00",
            vehiclePlate: "29C-66666",
          },
        },
      )
    ).status,
    200,
  );

  assert.equal(
    (
      await apiRequest(
        `/api/deliveries/${replacement.id}/arrival`,
        inspectorUsers[1].id,
        { method: "POST" },
      )
    ).status,
    200,
  );
  for (const user of approvalOrder) {
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

  // T131: Concurrent real-DB dispatch same body -> both 200 & unchanged updatedAt; diff body -> 200/409; revoked perm blocks dispatch replay 403
  const concDispatchSame = await apiRequest(
    "/api/deliveries/management",
    supplierAdminA.id,
    {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        sourceType: "STANDALONE",
        schoolId: schoolA.id,
        items: [
          {
            ingredientId: riceA.id,
            sourceFacilityId: facilityA1.id,
            actualQuantity: "2.000",
            unit: "kg",
          },
        ],
      },
    },
  );
  assert.equal(concDispatchSame.status, 201);
  const concSameId = unwrap<{ id: string }>(concDispatchSame.body).id;
  const sameRace = await Promise.all([
    apiRequest(
      `/api/deliveries/management/${concSameId}/dispatch`,
      supplierAdminA.id,
      {
        method: "POST",
        body: {
          expectedArrivalAt: "2099-11-18T08:00:00+07:00",
          vehiclePlate: "29A-77701",
        },
      },
    ),
    apiRequest(
      `/api/deliveries/management/${concSameId}/dispatch`,
      supplierStaffA.id,
      {
        method: "POST",
        body: {
          expectedArrivalAt: "2099-11-18T01:00:00Z",
          vehiclePlate: "  29A-77701 ",
        },
      },
    ),
  ]);
  assert.deepEqual(
    sameRace.map((res) => res.status),
    [200, 200],
  );
  const sameRaceUpdatedAts = sameRace.map(
    (res) => unwrap<{ updatedAt: string }>(res.body).updatedAt,
  );
  assert.equal(sameRaceUpdatedAts[0], sameRaceUpdatedAts[1]);

  const concDispatchDiff = await apiRequest(
    "/api/deliveries/management",
    supplierAdminA.id,
    {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        sourceType: "STANDALONE",
        schoolId: schoolA.id,
        items: [
          {
            ingredientId: riceA.id,
            sourceFacilityId: facilityA1.id,
            actualQuantity: "2.500",
            unit: "kg",
          },
        ],
      },
    },
  );
  assert.equal(concDispatchDiff.status, 201);
  const concDiffId = unwrap<{ id: string }>(concDispatchDiff.body).id;
  const diffRace = await Promise.all([
    apiRequest(
      `/api/deliveries/management/${concDiffId}/dispatch`,
      supplierAdminA.id,
      {
        method: "POST",
        body: {
          expectedArrivalAt: "2099-11-18T08:00:00+07:00",
          vehiclePlate: "29A-77702",
        },
      },
    ),
    apiRequest(
      `/api/deliveries/management/${concDiffId}/dispatch`,
      supplierStaffA.id,
      {
        method: "POST",
        body: {
          expectedArrivalAt: "2099-11-18T08:00:00+07:00",
          vehiclePlate: "29A-77703",
        },
      },
    ),
  ]);
  assert.deepEqual(diffRace.map((res) => res.status).sort(), [200, 409]);

  // Pre-dispatch arrival/cancel race: cancel SupplyRequest leaves PREPARING delivery CANCELLED (metadata null) -> dispatch 409
  const cancelRaceReq = await db.supplyRequest.create({
    data: {
      schoolId: schoolA.id,
      supplierId: supplierA.id,
      requestNo: `SR-CDISP-${randomUUID().slice(0, 8)}`,
      createdByUserId: inspectorUsers[0].id,
      status: "ACCEPTED",
      acceptedByUserId: supplierAdminA.id,
      acceptedAt: new Date(),
      sentAt: new Date(),
      supplyRequestItems: {
        create: {
          ingredientEntryId: riceEntry.id,
          requestedQuantity: "3.000",
          unit: "kg",
        },
      },
    },
    include: { supplyRequestItems: true },
  });
  const cancelPreparingRes = await apiRequest(
    "/api/deliveries/management",
    supplierAdminA.id,
    {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        sourceType: "REQUEST",
        supplyRequestId: cancelRaceReq.id,
        sources: [
          {
            supplyRequestItemId: cancelRaceReq.supplyRequestItems[0].id,
            sourceFacilityId: facilityA1.id,
            actualQuantity: "3.000",
          },
        ],
      },
    },
  );
  assert.equal(cancelPreparingRes.status, 201);
  const cancelPreparingId = unwrap<{ id: string }>(cancelPreparingRes.body).id;
  await db.delivery.update({
    where: { id: cancelPreparingId },
    data: { status: "CANCELLED" },
  });
  await db.supplyRequest.update({
    where: { id: cancelRaceReq.id },
    data: { status: "CANCELLED" },
  });
  const cancelledPreDispatchRes = await apiRequest(
    `/api/deliveries/management/${cancelPreparingId}/dispatch`,
    supplierAdminA.id,
    {
      method: "POST",
      body: {
        expectedArrivalAt: "2099-11-18T08:00:00+07:00",
        vehiclePlate: "29A-77704",
      },
    },
  );
  assert.equal(cancelledPreDispatchRes.status, 409);

  // Post-RECEIVED dispatch replay on replacement -> 200 RECEIVED
  const receivedReplayDispatch = await apiRequest(
    `/api/deliveries/management/${replacement.id}/dispatch`,
    supplierAdminA.id,
    {
      method: "POST",
      body: {
        expectedArrivalAt: "2099-11-17T08:00:00+07:00",
        vehiclePlate: "29C-66666",
      },
    },
  );
  assert.equal(receivedReplayDispatch.status, 200);
  assert.equal(
    unwrap<{ status: string }>(receivedReplayDispatch.body).status,
    "RECEIVED",
  );

  // T141: Complete STANDALONE repeated-ingredient multiStandalone (even after facilityA2 became INACTIVE),
  // concurrent 4th approval, fresh REQUEST 6+4, negative grouped/identity/unit rollbacks, legacy partial/null-source,
  // and cap3 canceling PREPARING (null metadata) & post-dispatch while preserving RECEIVED stock/history/QR
  assert.equal(
    (
      await apiRequest(
        `/api/deliveries/management/${multiStandalone.id}/dispatch`,
        supplierStaffA.id,
        {
          method: "POST",
          body: {
            expectedArrivalAt: "2099-11-17T09:00:00+07:00",
            vehiclePlate: "29C-64002",
          },
        },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await apiRequest(
        `/api/deliveries/${multiStandalone.id}/arrival`,
        inspectorUsers[1].id,
        { method: "POST" },
      )
    ).status,
    200,
  );
  for (const user of approvalOrder.slice(0, 3)) {
    assert.equal(
      (
        await apiRequest(
          `/api/deliveries/${multiStandalone.id}/inspection`,
          user.id,
          { method: "POST", body: inspectionForm("APPROVE") },
        )
      ).status,
      200,
    );
  }
  const [concApprove1, concApprove2] = await Promise.all([
    apiRequest(
      `/api/deliveries/${multiStandalone.id}/inspection`,
      finalApprover.id,
      {
        method: "POST",
        body: inspectionForm("APPROVE"),
      },
    ),
    apiRequest(
      `/api/deliveries/${multiStandalone.id}/inspection`,
      finalApprover.id,
      {
        method: "POST",
        body: inspectionForm("APPROVE"),
      },
    ),
  ]);
  assert.equal(concApprove1.status, 200);
  assert.equal(concApprove2.status, 200);
  assert.equal(
    await db.deliveryApproval.count({
      where: { deliveryId: multiStandalone.id },
    }),
    4,
  );
  const completedMultiStandalone = await db.delivery.findUniqueOrThrow({
    where: { id: multiStandalone.id },
    include: {
      deliveryItems: { include: { ingredientLots: true } },
    },
  });
  assert.equal(completedMultiStandalone.status, "RECEIVED");
  for (const chItem of completedMultiStandalone.deliveryItems.filter(
    (item) => item.ingredientId === chickenA.id,
  )) {
    assert.equal(chItem.ingredientEntryId, chickenEntry.id);
    assert.equal(chItem.ingredientLots.length, 1);
    assert.equal(chItem.ingredientLots[0].status, "AVAILABLE");
  }
  assert.equal(
    await db.inventoryTransaction.count({
      where: {
        movementType: "RECEIPT",
        IngredientLot: { DeliveryItem: { deliveryId: multiStandalone.id } },
      },
    }),
    4,
  );

  // Fresh active facilityA3 for two-source 6+4 REQUEST workflow
  const facilityA3 = await db.sourceFacility.create({
    data: {
      supplierId: supplierA.id,
      name: "Nông trại A3",
      facilityCode: "SF-A3",
      address: "Ba Vì, Hà Nội",
      status: "ACTIVE",
    },
  });
  const splitReq = await db.supplyRequest.create({
    data: {
      schoolId: schoolA.id,
      supplierId: supplierA.id,
      requestNo: `SR-SPLIT-${randomUUID().slice(0, 8)}`,
      createdByUserId: inspectorUsers[0].id,
      status: "ACCEPTED",
      requestedDeliveryDate: new Date("2026-11-22T00:00:00.000Z"),
      acceptedAt: new Date(),
      sentAt: new Date(),
      supplyRequestItems: {
        create: {
          ingredientEntryId: riceEntry.id,
          requestedQuantity: "10.000",
          unit: "kg",
        },
      },
    },
    include: { supplyRequestItems: true },
  });
  const splitCreateRes = await apiRequest(
    "/api/deliveries/management",
    supplierAdminA.id,
    {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        sourceType: "REQUEST",
        supplyRequestId: splitReq.id,
        sources: [
          {
            supplyRequestItemId: splitReq.supplyRequestItems[0].id,
            sourceFacilityId: facilityA1.id,
            actualQuantity: "6.000",
          },
          {
            supplyRequestItemId: splitReq.supplyRequestItems[0].id,
            sourceFacilityId: facilityA3.id,
            actualQuantity: "4.000",
          },
        ],
      },
    },
  );
  assert.equal(splitCreateRes.status, 201);
  const splitOrder = unwrap<{ id: string }>(splitCreateRes.body);
  assert.equal(
    (
      await apiRequest(
        `/api/deliveries/management/${splitOrder.id}/dispatch`,
        supplierAdminA.id,
        {
          method: "POST",
          body: {
            expectedArrivalAt: "2099-11-22T07:00:00+07:00",
            vehiclePlate: "29C-64003",
          },
        },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await apiRequest(
        `/api/deliveries/${splitOrder.id}/arrival`,
        inspectorUsers[1].id,
        { method: "POST" },
      )
    ).status,
    200,
  );
  const splitDetailRes = await apiRequest(
    `/api/deliveries/${splitOrder.id}/inspection`,
    inspectorUsers[0].id,
  );
  assert.equal(splitDetailRes.status, 200);
  const splitDetailBody = unwrap<Record<string, unknown>>(splitDetailRes.body);
  assert.equal("workflowVersion" in splitDetailBody, false);

  for (const user of approvalOrder.slice(0, 3)) {
    assert.equal(
      (
        await apiRequest(
          `/api/deliveries/${splitOrder.id}/inspection`,
          user.id,
          { method: "POST", body: inspectionForm("APPROVE") },
        )
      ).status,
      200,
    );
  }
  const [splitFinal1, splitFinal2] = await Promise.all([
    apiRequest(
      `/api/deliveries/${splitOrder.id}/inspection`,
      finalApprover.id,
      {
        method: "POST",
        body: inspectionForm("APPROVE"),
      },
    ),
    apiRequest(
      `/api/deliveries/${splitOrder.id}/inspection`,
      finalApprover.id,
      {
        method: "POST",
        body: inspectionForm("APPROVE"),
      },
    ),
  ]);
  assert.equal(splitFinal1.status, 200);
  assert.equal(splitFinal2.status, 200);
  const completedSplit = await db.delivery.findUniqueOrThrow({
    where: { id: splitOrder.id },
    include: { deliveryItems: { include: { ingredientLots: true } } },
  });
  assert.equal(completedSplit.status, "RECEIVED");
  assert.equal(completedSplit.deliveryItems.length, 2);
  assert.equal(
    await db.inventoryTransaction.count({
      where: {
        movementType: "RECEIPT",
        IngredientLot: { DeliveryItem: { deliveryId: splitOrder.id } },
      },
    }),
    2,
  );

  // Controlled negative real-DB tests (6+6, missing group, wrong unit g vs kg, wrong entry, previous+current > budget) & rollback + legacy partial null-source
  const createNegReq = async () => {
    const req = await db.supplyRequest.create({
      data: {
        schoolId: schoolA.id,
        supplierId: supplierA.id,
        requestNo: `SR-NEG-${randomUUID().slice(0, 8)}`,
        createdByUserId: inspectorUsers[0].id,
        status: "IN_PROGRESS",
        requestedDeliveryDate: new Date("2026-11-23T00:00:00.000Z"),
        acceptedAt: new Date(),
        sentAt: new Date(),
        supplyRequestItems: {
          create: [
            {
              ingredientEntryId: riceEntry.id,
              requestedQuantity: "10.000",
              unit: "kg",
            },
            {
              ingredientEntryId: chickenEntry.id,
              requestedQuantity: "5.000",
              unit: "kg",
            },
          ],
        },
      },
      include: { supplyRequestItems: true },
    });
    return {
      req,
      riceItem: req.supplyRequestItems.find(
        (item) => item.ingredientEntryId === riceEntry.id,
      )!,
      chickenItem: req.supplyRequestItems.find(
        (item) => item.ingredientEntryId === chickenEntry.id,
      )!,
    };
  };

  const {
    req: negReq,
    riceItem: negRiceItem,
    chickenItem: negChickenItem,
  } = await createNegReq();

  // Prior legacy RECEIVED 4 kg on negRiceItem (creationMode: null obeys uq_deliveries_request_mode and DB CHECKs)
  const priorNegReceived = await db.delivery.create({
    data: {
      schoolId: schoolA.id,
      supplierId: supplierA.id,
      supplyRequestId: negReq.id,
      creationMode: null,
      deliveryNo: "FP-DE-90100",
      status: "RECEIVED",
      createdByUserId: supplierAdminA.id,
      receivedByUserId: inspectorUsers[3].id,
      receivedAt: new Date(),
      deliveryItems: {
        create: {
          supplyRequestItemId: negRiceItem.id,
          ingredientId: riceA.id,
          ingredientEntryId: riceEntry.id,
          actualQuantity: "4.000",
          unit: "kg",
          ingredientLots: {
            create: {
              lotCode: "LEG-1",
              qrToken:
                randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""),
              receivedQuantity: "4.000",
              availableQuantity: "4.000",
              unit: "kg",
              status: "AVAILABLE",
            },
          },
        },
      },
    },
  });
  assert.equal(priorNegReceived.status, "RECEIVED");

  let negDeliverySeq = 90101;
  const seedNegDelivery = async (
    supplyRequestId: string,
    items: Array<{
      supplyRequestItemId: string;
      ingredientId: string;
      ingredientEntryId: string;
      sourceFacilityId: string | null;
      actualQuantity: string;
      unit: string;
      lots?: Array<{ quantity: string; unit: string }>;
    }>,
    workflowVersion: number | null = 2,
    traceabilityVersion: number | null = 1,
  ) => {
    const seqNo = `FP-DE-${String(negDeliverySeq++).padStart(5, "0")}`;
    const isV1 = traceabilityVersion === 1;
    const created = await db.delivery.create({
      data: {
        schoolId: schoolA.id,
        supplierId: supplierA.id,
        supplyRequestId,
        creationMode: isV1 ? "REQUEST" : null,
        creationKey: isV1 ? randomUUID() : null,
        creationFingerprint: isV1 ? "d".repeat(64) : null,
        workflowVersion,
        traceabilityVersion,
        deliveryNo: seqNo,
        status: "ARRIVED",
        expectedArrivalAt: new Date("2099-11-23T06:00:00.000Z"),
        arrivedAt: new Date("2099-11-23T06:15:00.000Z"),
        vehiclePlate: "29C-64999",
        createdByUserId: supplierAdminA.id,
        deliveryItems: {
          create: items.map((item) => {
            const itemQr =
              randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
            return {
              supplyRequestItemId: item.supplyRequestItemId,
              ingredientId: item.ingredientId,
              ingredientEntryId: item.ingredientEntryId,
              sourceFacilityId: item.sourceFacilityId,
              sourceFacilityNameSnapshot: isV1 ? "Trang trại kiểm thử" : null,
              sourceFacilityCodeSnapshot: isV1 ? "SF-NEG" : null,
              ingredientNameSnapshot: isV1
                ? item.ingredientId === riceA.id
                  ? "Gạo ST25"
                  : "Thịt gà"
                : null,
              qrToken: isV1 ? itemQr : null,
              qrUrl: isV1
                ? `https://trace.example.test/api/public/delivery-items/${itemQr}`
                : null,
              actualQuantity: item.actualQuantity,
              unit: item.unit,
              ingredientLots: {
                create: (
                  item.lots ?? [
                    { quantity: item.actualQuantity, unit: item.unit },
                  ]
                ).map((lot, lotIdx) => ({
                  lotCode: `PLAN-0${lotIdx + 1}`,
                  qrToken:
                    randomUUID().replace(/-/g, "") +
                    randomUUID().replace(/-/g, ""),
                  sourceFacilityId: item.sourceFacilityId,
                  receivedQuantity: lot.quantity,
                  availableQuantity: "0",
                  unit: lot.unit,
                  status: "BLOCKED",
                })),
              },
            };
          }),
        },
      },
      include: { deliveryItems: { include: { ingredientLots: true } } },
    });
    return created;
  };
  // FR-014: invalid receipt data is rejected at the first APPROVE, so only valid deliveries collect three approvals first.
  const approveFirstThree = async (deliveryId: string) => {
    for (const user of inspectorUsers.slice(0, 3)) {
      const approval = await apiRequest(
        `/api/deliveries/${deliveryId}/inspection`,
        user.id,
        { method: "POST", body: inspectionForm("APPROVE") },
      );
      assert.equal(approval.status, 200, JSON.stringify(approval.body));
    }
  };

  const over66Req = await createNegReq();
  const missGrpReq = await createNegReq();
  const unitGReq = await createNegReq();
  const wrongEntReq = await createNegReq();

  const negCases = [
    await seedNegDelivery(over66Req.req.id, [
      {
        supplyRequestItemId: over66Req.riceItem.id,
        ingredientId: riceA.id,
        ingredientEntryId: riceEntry.id,
        sourceFacilityId: facilityA1.id,
        actualQuantity: "6.000",
        unit: "kg",
      },
      {
        supplyRequestItemId: over66Req.riceItem.id,
        ingredientId: riceA.id,
        ingredientEntryId: riceEntry.id,
        sourceFacilityId: facilityA3.id,
        actualQuantity: "6.000",
        unit: "kg",
      },
      {
        supplyRequestItemId: over66Req.chickenItem.id,
        ingredientId: chickenA.id,
        ingredientEntryId: chickenEntry.id,
        sourceFacilityId: facilityA1.id,
        actualQuantity: "5.000",
        unit: "kg",
      },
    ]),
    await seedNegDelivery(missGrpReq.req.id, [
      {
        supplyRequestItemId: missGrpReq.riceItem.id,
        ingredientId: riceA.id,
        ingredientEntryId: riceEntry.id,
        sourceFacilityId: facilityA1.id,
        actualQuantity: "10.000",
        unit: "kg",
      },
    ]),
    await seedNegDelivery(unitGReq.req.id, [
      {
        supplyRequestItemId: unitGReq.riceItem.id,
        ingredientId: riceA.id,
        ingredientEntryId: riceEntry.id,
        sourceFacilityId: facilityA1.id,
        actualQuantity: "10000.000",
        unit: "g",
      },
      {
        supplyRequestItemId: unitGReq.chickenItem.id,
        ingredientId: chickenA.id,
        ingredientEntryId: chickenEntry.id,
        sourceFacilityId: facilityA1.id,
        actualQuantity: "5.000",
        unit: "kg",
      },
    ]),
    await seedNegDelivery(wrongEntReq.req.id, [
      {
        supplyRequestItemId: wrongEntReq.riceItem.id,
        ingredientId: chickenA.id,
        ingredientEntryId: chickenEntry.id,
        sourceFacilityId: facilityA1.id,
        actualQuantity: "10.000",
        unit: "kg",
      },
      {
        supplyRequestItemId: wrongEntReq.chickenItem.id,
        ingredientId: chickenA.id,
        ingredientEntryId: chickenEntry.id,
        sourceFacilityId: facilityA3.id,
        actualQuantity: "5.000",
        unit: "kg",
      },
    ]),
    await seedNegDelivery(negReq.id, [
      {
        supplyRequestItemId: negRiceItem.id,
        ingredientId: riceA.id,
        ingredientEntryId: riceEntry.id,
        sourceFacilityId: facilityA1.id,
        actualQuantity: "6.000",
        unit: "kg",
      },
      {
        supplyRequestItemId: negRiceItem.id,
        ingredientId: riceA.id,
        ingredientEntryId: riceEntry.id,
        sourceFacilityId: facilityA3.id,
        actualQuantity: "4.000",
        unit: "kg",
      },
      {
        supplyRequestItemId: negChickenItem.id,
        ingredientId: chickenA.id,
        ingredientEntryId: chickenEntry.id,
        sourceFacilityId: facilityA1.id,
        actualQuantity: "5.000",
        unit: "kg",
      },
    ]),
  ];
  for (const negCase of negCases) {
    const blocked = await apiRequest(
      `/api/deliveries/${negCase.id}/inspection`,
      inspectorUsers[0].id,
      { method: "POST", body: inspectionForm("APPROVE") },
    );
    assert.equal(blocked.status, 409);
    const reloaded = await db.delivery.findUniqueOrThrow({
      where: { id: negCase.id },
      include: { deliveryItems: { include: { ingredientLots: true } } },
    });
    assert.equal(reloaded.status, "ARRIVED");
    assert.equal(
      await db.deliveryApproval.count({ where: { deliveryId: negCase.id } }),
      0,
    );
    assert.equal(
      await db.inventoryTransaction.count({
        where: {
          IngredientLot: { DeliveryItem: { deliveryId: negCase.id } },
        },
      }),
      0,
    );
    for (const item of reloaded.deliveryItems) {
      for (const lot of item.ingredientLots) {
        assert.equal(lot.status, "BLOCKED");
      }
    }
  }

  // Legacy/v1 partial (4 prior + 3 current <= 10 kg), multi-lot, convertQuantity (3000 g -> 3 kg), null source STILL passes cleanly
  const legacyPartial = await seedNegDelivery(
    negReq.id,
    [
      {
        supplyRequestItemId: negRiceItem.id,
        ingredientId: riceA.id,
        ingredientEntryId: riceEntry.id,
        sourceFacilityId: null,
        actualQuantity: "3000.000",
        unit: "g",
        lots: [
          { quantity: "1500.000", unit: "g" },
          { quantity: "1500.000", unit: "g" },
        ],
      },
    ],
    null,
    null,
  );
  await approveFirstThree(legacyPartial.id);
  const legacyApprove = await apiRequest(
    `/api/deliveries/${legacyPartial.id}/inspection`,
    inspectorUsers[3].id,
    { method: "POST", body: inspectionForm("APPROVE") },
  );
  assert.equal(legacyApprove.status, 200);
  assert.equal(
    (await db.delivery.findUniqueOrThrow({ where: { id: legacyPartial.id } }))
      .status,
    "RECEIVED",
  );
  assert.equal(
    await db.inventoryTransaction.count({
      where: {
        movementType: "RECEIPT",
        IngredientLot: { DeliveryItem: { deliveryId: legacyPartial.id } },
      },
    }),
    2,
  );

  // cap3 cancels queued PREPARING (keeping null metadata) & post-dispatch IN_TRANSIT (keeping metadata) while leaving RECEIVED/stock/history/QR intact
  const capReq = await db.supplyRequest.create({
    data: {
      schoolId: schoolA.id,
      supplierId: supplierA.id,
      requestNo: `SR-CAP3-${randomUUID().slice(0, 8)}`,
      createdByUserId: inspectorUsers[0].id,
      status: "ACCEPTED",
      requestedDeliveryDate: new Date("2026-11-24T00:00:00.000Z"),
      acceptedAt: new Date(),
      sentAt: new Date(),
      supplyRequestItems: {
        create: {
          ingredientEntryId: riceEntry.id,
          requestedQuantity: "10.000",
          unit: "kg",
        },
      },
    },
    include: { supplyRequestItems: true },
  });
  const capItemId = capReq.supplyRequestItems[0].id;

  // One RECEIVED delivery via full two-stage HTTP lifecycle before cap3 cancellations
  const capReceivedRes = await apiRequest(
    "/api/deliveries/management",
    supplierAdminA.id,
    {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        sourceType: "REQUEST",
        supplyRequestId: capReq.id,
        sources: [
          {
            supplyRequestItemId: capItemId,
            sourceFacilityId: facilityA1.id,
            actualQuantity: "10.000",
          },
        ],
      },
    },
  );
  assert.equal(capReceivedRes.status, 201);
  const capReceived = unwrap<{
    id: string;
    items: Array<{ traceUrl: string | null }>;
  }>(capReceivedRes.body);
  assert.equal(
    (
      await apiRequest(
        `/api/deliveries/management/${capReceived.id}/dispatch`,
        supplierAdminA.id,
        {
          method: "POST",
          body: {
            expectedArrivalAt: "2099-11-24T07:00:00+07:00",
            vehiclePlate: "29C-CAPRCV",
          },
        },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await apiRequest(
        `/api/deliveries/${capReceived.id}/arrival`,
        inspectorUsers[1].id,
        { method: "POST" },
      )
    ).status,
    200,
  );
  for (const user of approvalOrder) {
    assert.equal(
      (
        await apiRequest(
          `/api/deliveries/${capReceived.id}/inspection`,
          user.id,
          {
            method: "POST",
            body: inspectionForm("APPROVE"),
          },
        )
      ).status,
      200,
    );
  }

  let capDeliverySeq = 90201;
  const seedLegacyCapDelivery = async (
    supplyRequestId: string,
    requestItemId: string,
    status: "ARRIVED" | "IN_TRANSIT",
    plate: string | null,
  ) =>
    db.delivery.create({
      data: {
        schoolId: schoolA.id,
        supplierId: supplierA.id,
        supplyRequestId,
        creationMode: null,
        workflowVersion: null,
        traceabilityVersion: null,
        deliveryNo: `LEG-CAP-${String(capDeliverySeq++)}`,
        status,
        expectedArrivalAt: plate ? new Date("2099-11-24T08:00:00.000Z") : null,
        arrivedAt:
          status === "ARRIVED" ? new Date("2099-11-24T08:15:00.000Z") : null,
        vehiclePlate: plate,
        createdByUserId: supplierAdminA.id,
        deliveryItems: {
          create: {
            supplyRequestItemId: requestItemId,
            ingredientId: riceA.id,
            ingredientEntryId: riceEntry.id,
            sourceFacilityId: null,
            actualQuantity: "10.000",
            unit: "kg",
            ingredientLots: {
              create: {
                lotCode: "PLAN-01",
                qrToken:
                  randomUUID().replace(/-/g, "") +
                  randomUUID().replace(/-/g, ""),
                sourceFacilityId: null,
                receivedQuantity: "10.000",
                availableQuantity: "0",
                unit: "kg",
                status: "BLOCKED",
              },
            },
          },
        },
      },
    });

  // capReq tests RECEIVED (v2 REQUEST HTTP + QR/stock/history intact) + queued IN_TRANSIT + 3 ARRIVED rejects
  const rejCap1 = await seedLegacyCapDelivery(
    capReq.id,
    capItemId,
    "ARRIVED",
    "29C-CAPR1",
  );
  const rejCap2 = await seedLegacyCapDelivery(
    capReq.id,
    capItemId,
    "ARRIVED",
    "29C-CAPR2",
  );
  const rejCap3 = await seedLegacyCapDelivery(
    capReq.id,
    capItemId,
    "ARRIVED",
    "29C-CAPR3",
  );
  const queuedTransit = await seedLegacyCapDelivery(
    capReq.id,
    capItemId,
    "IN_TRANSIT",
    "29C-CAPTR",
  );

  // Separate capPrepReq has a single v2 REQUEST PREPARING delivery created via HTTP plus 3 ARRIVED rounds -> 3rd reject cancels PREPARING with null metadata
  const capPrepReq = await db.supplyRequest.create({
    data: {
      schoolId: schoolA.id,
      supplierId: supplierA.id,
      requestNo: `SR-CAPPREP-${randomUUID().slice(0, 8)}`,
      createdByUserId: inspectorUsers[0].id,
      status: "ACCEPTED",
      requestedDeliveryDate: new Date("2026-11-24T00:00:00.000Z"),
      acceptedAt: new Date(),
      sentAt: new Date(),
      supplyRequestItems: {
        create: {
          ingredientEntryId: riceEntry.id,
          requestedQuantity: "10.000",
          unit: "kg",
        },
      },
    },
    include: { supplyRequestItems: true },
  });
  const capPrepItemId = capPrepReq.supplyRequestItems[0].id;
  const queuedPreparingRes = await apiRequest(
    "/api/deliveries/management",
    supplierAdminA.id,
    {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        sourceType: "REQUEST",
        supplyRequestId: capPrepReq.id,
        sources: [
          {
            supplyRequestItemId: capPrepItemId,
            sourceFacilityId: facilityA1.id,
            actualQuantity: "10.000",
          },
        ],
      },
    },
  );
  assert.equal(queuedPreparingRes.status, 201);
  const queuedPreparing = unwrap<{ id: string }>(queuedPreparingRes.body);
  const prepRej1 = await seedLegacyCapDelivery(
    capPrepReq.id,
    capPrepItemId,
    "ARRIVED",
    "29C-PR1",
  );
  const prepRej2 = await seedLegacyCapDelivery(
    capPrepReq.id,
    capPrepItemId,
    "ARRIVED",
    "29C-PR2",
  );
  const prepRej3 = await seedLegacyCapDelivery(
    capPrepReq.id,
    capPrepItemId,
    "ARRIVED",
    "29C-PR3",
  );

  for (const rejTarget of [rejCap1, rejCap2, prepRej1, prepRej2]) {
    assert.equal(
      (
        await apiRequest(
          `/api/deliveries/${rejTarget.id}/inspection`,
          inspectorUsers[0].id,
          { method: "POST", body: inspectionForm("REJECT", "Chưa đạt") },
        )
      ).status,
      200,
    );
  }
  // After REJECT without CONFIRMED, standalone delivery can still be created
  assert.equal(
    (
      await apiRequest("/api/deliveries/management", supplierAdminA.id, {
        method: "POST",
        headers: { "Idempotency-Key": randomUUID() },
        body: {
          sourceType: "STANDALONE",
          schoolId: schoolA.id,
          items: [
            {
              ingredientId: riceA.id,
              sourceFacilityId: facilityA1.id,
              actualQuantity: "2.000",
              unit: "kg",
            },
          ],
        },
      })
    ).status,
    201,
  );

  // 3rd reject on capReq triggers cancelRemainder for queuedTransit while keeping RECEIVED/stock/QR intact
  assert.equal(
    (
      await apiRequest(
        `/api/deliveries/${rejCap3.id}/inspection`,
        inspectorUsers[1].id,
        {
          method: "POST",
          body: inspectionForm("REJECT", "Quá hạn giao"),
        },
      )
    ).status,
    200,
  );
  // 3rd reject on capPrepReq cancels queuedPreparing keeping null metadata
  assert.equal(
    (
      await apiRequest(
        `/api/deliveries/${prepRej3.id}/inspection`,
        inspectorUsers[1].id,
        {
          method: "POST",
          body: inspectionForm("REJECT", "Quá hạn giao"),
        },
      )
    ).status,
    200,
  );

  const cancelledPrepDb = await db.delivery.findUniqueOrThrow({
    where: { id: queuedPreparing.id },
  });
  const cancelledTransitDb = await db.delivery.findUniqueOrThrow({
    where: { id: queuedTransit.id },
  });
  const intactReceivedDb = await db.delivery.findUniqueOrThrow({
    where: { id: capReceived.id },
    include: { deliveryItems: { include: { ingredientLots: true } } },
  });
  assert.equal(cancelledPrepDb.status, "CANCELLED");
  assert.equal(cancelledPrepDb.expectedArrivalAt, null);
  assert.equal(cancelledPrepDb.vehiclePlate, null);
  assert.equal(cancelledTransitDb.status, "CANCELLED");
  assert.notEqual(cancelledTransitDb.expectedArrivalAt, null);
  assert.equal(cancelledTransitDb.vehiclePlate, "29C-CAPTR");
  assert.equal(intactReceivedDb.status, "RECEIVED");
  assert.equal(
    intactReceivedDb.deliveryItems[0].ingredientLots[0].status,
    "AVAILABLE",
  );
  assert.equal(
    await db.inventoryTransaction.count({
      where: {
        movementType: "RECEIPT",
        IngredientLot: { DeliveryItem: { deliveryId: capReceived.id } },
      },
    }),
    1,
  );
  const intactQrPath = new URL(capReceived.items[0].traceUrl!).pathname;
  const intactPublicRes = await http.request(intactQrPath, {
    headers: { Accept: "application/json" },
  });
  assert.equal(intactPublicRes.status, 200);
  assert.equal(
    unwrap<{ status: string }>(intactPublicRes.body).status,
    "RECEIVED",
  );

  // T147: Management list ?status=PREPARING excludes uncreated ACCEPTED requests, detail/reopen preserves multi-row UUIDs/QRs without collapse,
  // v3 reorder/normalize replay works post-dispatch & post-terminal even when origin/facility/renderer change, 5+5 conflict -> 409, old v1 key -> 409,
  // and /api/supply-requests projects CONFIRMED -> PREPARING -> IN_TRANSIT -> terminal transitions cleanly
  const uncreatedAcceptedReq = await db.supplyRequest.create({
    data: {
      schoolId: schoolA.id,
      supplierId: supplierA.id,
      requestNo: `SR-UNCREATED-${randomUUID().slice(0, 8)}`,
      createdByUserId: inspectorUsers[0].id,
      status: "ACCEPTED",
      requestedDeliveryDate: new Date("2026-11-25T00:00:00.000Z"),
      acceptedAt: new Date(),
      sentAt: new Date(),
      supplyRequestItems: {
        create: {
          ingredientEntryId: riceEntry.id,
          requestedQuantity: "10.000",
          unit: "kg",
        },
      },
    },
    include: { supplyRequestItems: true },
  });
  const us3PreparingStandaloneRes = await apiRequest(
    "/api/deliveries/management",
    supplierStaffA.id,
    {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: {
        sourceType: "STANDALONE",
        schoolId: schoolA.id,
        items: [
          {
            ingredientId: riceA.id,
            sourceFacilityId: facilityA1.id,
            actualQuantity: "6",
            unit: "kg",
          },
          {
            ingredientId: riceA.id,
            sourceFacilityId: facilityA3.id,
            actualQuantity: "4",
            unit: "kg",
          },
        ],
      },
    },
  );
  assert.equal(us3PreparingStandaloneRes.status, 201);
  const us3Prep = unwrap<{
    id: string;
    items: Array<{
      id: string;
      actualQuantity: string;
      sourceFacility: { id: string } | null;
      traceUrl: string | null;
    }>;
  }>(us3PreparingStandaloneRes.body);

  const prepFilterRes = await apiRequest(
    "/api/deliveries/management?status=PREPARING&page=1&limit=20",
    supplierStaffA.id,
  );
  assert.equal(prepFilterRes.status, 200);
  const prepFilterList = unwrap<{
    items: Array<{
      id: string;
      status: string;
      nextAction: string;
      supplyRequestId: string | null;
      expectedArrivalAt: string | null;
      vehiclePlate: string | null;
    }>;
  }>(prepFilterRes.body);
  assert.equal(
    prepFilterList.items.some((item) => item.id === us3Prep.id),
    true,
  );
  assert.equal(
    prepFilterList.items.every((item) => item.status === "PREPARING"),
    true,
  );
  assert.equal(
    prepFilterList.items.some(
      (item) => item.supplyRequestId === uncreatedAcceptedReq.id,
    ),
    false,
  );
  const us3PrepSummary = prepFilterList.items.find(
    (item) => item.id === us3Prep.id,
  )!;
  assert.equal(us3PrepSummary.nextAction, "ENTER_SHIPPING");
  assert.equal(us3PrepSummary.expectedArrivalAt, null);
  assert.equal(us3PrepSummary.vehiclePlate, null);

  const us3PrepDetailRes = await apiRequest(
    `/api/deliveries/management/${us3Prep.id}`,
    supplierStaffA.id,
  );
  assert.equal(us3PrepDetailRes.status, 200);
  const us3PrepDetail = unwrap<{
    items: Array<{
      id: string;
      actualQuantity: string;
      sourceFacility: { id: string } | null;
      traceUrl: string;
    }>;
  }>(us3PrepDetailRes.body);
  assert.deepEqual(
    us3PrepDetail.items.map((item) => [item.id, item.actualQuantity]),
    us3Prep.items.map((item) => [item.id, item.actualQuantity]),
  );
  assert.deepEqual(
    us3PrepDetail.items
      .map((item) => [item.sourceFacility?.id ?? null, item.actualQuantity])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    [
      [facilityA1.id, "6"],
      [facilityA3.id, "4"],
    ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
  const us3RawDetailText = JSON.stringify(us3PrepDetailRes.body);
  assert.equal(us3RawDetailText.includes("qrToken"), false);
  assert.equal(us3RawDetailText.includes("creationFingerprint"), false);
  assert.equal(us3RawDetailText.includes("qrImageDataUrl"), false);
  assert.equal(us3RawDetailText.includes('"created"'), false);

  // Fresh split REQUEST with key + reorder 4+6 replay post-dispatch & post-RECEIVED while origin/facility/renderer change
  const replayReq = await db.supplyRequest.create({
    data: {
      schoolId: schoolA.id,
      supplierId: supplierA.id,
      requestNo: `SR-REPLAY-${randomUUID().slice(0, 8)}`,
      createdByUserId: inspectorUsers[0].id,
      status: "ACCEPTED",
      requestedDeliveryDate: new Date("2026-11-26T00:00:00.000Z"),
      acceptedAt: new Date(),
      sentAt: new Date(),
      supplyRequestItems: {
        create: {
          ingredientEntryId: riceEntry.id,
          requestedQuantity: "10.000",
          unit: "kg",
        },
      },
    },
    include: { supplyRequestItems: true },
  });
  const replayReqItemId = replayReq.supplyRequestItems[0].id;
  const replayKey = randomUUID();
  const create64Res = await apiRequest(
    "/api/deliveries/management",
    supplierAdminA.id,
    {
      method: "POST",
      headers: { "Idempotency-Key": replayKey },
      body: {
        sourceType: "REQUEST",
        supplyRequestId: replayReq.id,
        sources: [
          {
            supplyRequestItemId: replayReqItemId,
            sourceFacilityId: facilityA1.id,
            actualQuantity: "6",
          },
          {
            supplyRequestItemId: replayReqItemId,
            sourceFacilityId: facilityA3.id,
            actualQuantity: "4",
          },
        ],
      },
    },
  );
  assert.equal(create64Res.status, 201);
  const created64 = unwrap<{
    id: string;
    updatedAt: string;
    items: Array<{ id: string; traceUrl: string }>;
  }>(create64Res.body);

  // 5+5 conflict with same total 10 rejects 409
  assert.equal(
    (
      await apiRequest("/api/deliveries/management", supplierAdminA.id, {
        method: "POST",
        headers: { "Idempotency-Key": replayKey },
        body: {
          sourceType: "REQUEST",
          supplyRequestId: replayReq.id,
          sources: [
            {
              supplyRequestItemId: replayReqItemId,
              sourceFacilityId: facilityA1.id,
              actualQuantity: "5",
            },
            {
              supplyRequestItemId: replayReqItemId,
              sourceFacilityId: facilityA3.id,
              actualQuantity: "5",
            },
          ],
        },
      })
    ).status,
    409,
  );

  // Supply-order intake shows CONFIRMED for uncreatedAcceptedReq and PREPARING/ENTER_SHIPPING for replayReq
  const intakeListRes = await apiRequest(
    "/api/supply-requests?page=1&limit=100",
    supplierAdminA.id,
  );
  assert.equal(intakeListRes.status, 200);
  const intakeItems = unwrap<{
    items: Array<{
      id: string;
      orderProgress: {
        stage: string;
        nextAction: string;
        deliveryId: string | null;
      } | null;
    }>;
  }>(intakeListRes.body).items;
  assert.deepEqual(
    intakeItems.find((item) => item.id === uncreatedAcceptedReq.id)
      ?.orderProgress,
    {
      stage: "CONFIRMED",
      statusLabel: "Đã xác nhận",
      deliveryId: null,
      nextAction: "ADD_INGREDIENTS",
    },
  );
  assert.equal(
    intakeItems.find((item) => item.id === replayReq.id)?.orderProgress
      ?.nextAction,
    "ENTER_SHIPPING",
  );

  // Dispatch replayReq -> IN_TRANSIT, deactivate facilityA3, override origin + failing renderer:
  // canonical v3 reorder 4+6 (with 4.000/6.000 formatting) MUST replay 200 preserving IDs, traceUrls, updatedAt!
  assert.equal(
    (
      await apiRequest(
        `/api/deliveries/management/${created64.id}/dispatch`,
        supplierAdminA.id,
        {
          method: "POST",
          body: {
            expectedArrivalAt: "2099-11-26T08:00:00+07:00",
            vehiclePlate: "29C-88864",
          },
        },
      )
    ).status,
    200,
  );
  const afterDispatchStamp = (
    await db.delivery.findUniqueOrThrow({ where: { id: created64.id } })
  ).updatedAt.toISOString();
  await db.sourceFacility.update({
    where: { id: facilityA3.id },
    data: { status: "INACTIVE" },
  });
  const replayIsolatedService = createSupplierOrderService(undefined, {
    publicTraceOrigin: "https://changed-origin.example.test",
    renderQrBatch: () =>
      Promise.reject(new Error("Renderer should not run on replay")),
  });
  const replayActorA = await loadPrincipal(supplierAdminA.id, db);
  const reorderedBody = validateCreateSupplierOrderBody({
    sourceType: "REQUEST",
    supplyRequestId: replayReq.id,
    sources: [
      {
        supplyRequestItemId: replayReqItemId,
        sourceFacilityId: facilityA3.id,
        actualQuantity: "4.000",
      },
      {
        supplyRequestItemId: replayReqItemId,
        sourceFacilityId: facilityA1.id,
        actualQuantity: "6.000",
      },
    ],
  });
  const postDispatchReplay = await replayIsolatedService.create(
    { idempotencyKey: replayKey, body: reorderedBody },
    replayActorA,
  );
  assert.equal(postDispatchReplay.created, false);
  assert.equal(postDispatchReplay.id, created64.id);
  assert.equal(postDispatchReplay.status, "IN_TRANSIT");
  assert.equal(postDispatchReplay.updatedAt, afterDispatchStamp);
  assert.deepEqual(
    postDispatchReplay.items.map((item) => [item.id, item.traceUrl]),
    created64.items.map((item) => [item.id, item.traceUrl]),
  );

  // Old v1 creationFingerprint (without "v3:") using its creationKey fails 409 under v2 endpoint
  const v1SeedKey = randomUUID();
  await db.delivery.create({
    data: {
      schoolId: schoolA.id,
      supplierId: supplierA.id,
      creationMode: "STANDALONE",
      creationKey: v1SeedKey,
      creationFingerprint: "a".repeat(64),
      deliveryNo: "FP-DE-90999",
      status: "IN_TRANSIT",
      expectedArrivalAt: new Date("2099-11-26T08:00:00.000Z"),
      vehiclePlate: "29C-V1OLD",
      traceabilityVersion: 1,
      workflowVersion: null,
      createdByUserId: supplierAdminA.id,
    },
  });
  assert.equal(
    (
      await apiRequest("/api/deliveries/management", supplierAdminA.id, {
        method: "POST",
        headers: { "Idempotency-Key": v1SeedKey },
        body: {
          sourceType: "STANDALONE",
          schoolId: schoolA.id,
          items: [
            {
              ingredientId: riceA.id,
              sourceFacilityId: facilityA1.id,
              actualQuantity: "1",
              unit: "kg",
            },
          ],
        },
      })
    ).status,
    409,
  );

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
        note: "Giao cổng sau",
        sources: [
          {
            supplyRequestItemId: reqItemId,
            sourceFacilityId: facilityA1.id,
            actualQuantity: "15.5",
          },
        ],
      },
    },
  );
  assert.equal(revokedReplay.status, 403);
  const revokedDispatchReplay = await apiRequest(
    `/api/deliveries/management/${createdReq.id}/dispatch`,
    supplierAdminA.id,
    {
      method: "POST",
      body: {
        expectedArrivalAt: "2099-11-16T08:00:00+07:00",
        vehiclePlate: "29A-11111",
      },
    },
  );
  assert.equal(revokedDispatchReplay.status, 403);

  // T136: Even with delivery.manage denied, supplierAdminA still has delivery.view read OR for /labels (200)
  // while /options/source-facilities stays 403; denying all read permissions drops /labels to 403
  assert.equal(
    (
      await apiRequest(
        `/api/deliveries/management/${createdReq.id}/labels`,
        supplierAdminA.id,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await apiRequest(
        "/api/deliveries/management/options/source-facilities",
        supplierAdminA.id,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await apiRequest(
        `/api/deliveries/management/${createdReq.id}/labels`,
        supplierAdminB.id,
      )
    ).status,
    404,
  );
  const viewPerm = await db.permission.findUnique({
    where: { code: "delivery.view" },
  });
  const receivePerm = await db.permission.findUnique({
    where: { code: "delivery.receive" },
  });
  for (const readPerm of [viewPerm, receivePerm]) {
    if (readPerm) {
      await db.userPermissionDenial.create({
        data: {
          userId: supplierAdminA.id,
          permissionId: readPerm.id,
          supplierId: supplierA.id,
          disabledByUserId: systemAdmin.id,
        },
      });
    }
  }
  assert.equal(
    (
      await apiRequest(
        `/api/deliveries/management/${createdReq.id}/labels`,
        supplierAdminA.id,
      )
    ).status,
    403,
  );
});
