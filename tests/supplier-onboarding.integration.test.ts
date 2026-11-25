import { recordLocalTestDatabase } from "./helpers/local-test-database";
import { withEmail } from "./helpers/account-email";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { Client } from "pg";
import bcrypt from "bcryptjs";
import { MemoryStore } from "express-rate-limit";
import { createApp } from "../src/app";
import {
  createAuthenticate,
  createSessionAuthenticate,
} from "../src/middlewares/auth.middleware";
import { createSessionService } from "../src/modules/auth/session.service";
import { signupService } from "../src/modules/auth/signup.service";
import { createAuthSessions } from "../src/utils/auth-sessions";
import { memorySessions } from "./helpers/auth-sessions";
import { createApiRateLimiter } from "../src/middlewares/rate-limit.middleware";
import { getPrisma } from "../src/utils/database";
import { bootstrapAuthorization } from "../src/utils/authorization-bootstrap";
import { assertLocalMigrationTarget } from "../src/utils/migration-target";
import {
  dayString,
  schoolToday,
} from "../src/modules/supplier-onboarding/supplier-onboarding.rules";
import { createIngredientQualityFeedbackRepository } from "../src/modules/ingredient-quality-feedback/ingredient-quality-feedback.repository";
import { createIngredientQualityFeedbackService } from "../src/modules/ingredient-quality-feedback/ingredient-quality-feedback.service";
import { loadPrincipal } from "../src/utils/authorization";
import { HttpError } from "../src/utils/http-error";

function record(value: unknown): Record<string, unknown> {
  assert(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function stringField(value: Record<string, unknown>, key: string) {
  assert.equal(typeof value[key], "string");
  return value[key] as string;
}
const execute = promisify(execFile);

void test("supplier onboarding with real login, PostgreSQL migration, files, concurrent activation and order traceability", async (context) => {
  const local = process.env.MIGRATION_TEST_DATABASE_URL;
  assert(
    local,
    "Configure an explicitly selected disposable local PostgreSQL instance.",
  );
  const target = assertLocalMigrationTarget(local);
  const databaseName =
    "foodprint_migration_test_suppliers_" +
    randomUUID().replaceAll("-", "").slice(0, 16);
  const owner = new Client({ connectionString: local });
  await owner.connect();
  try {
    await owner.query(`CREATE DATABASE "${databaseName}"`);
    recordLocalTestDatabase(databaseName);
  } finally {
    await owner.end();
  }
  target.pathname = "/" + databaseName;
  target.searchParams.set("schema", "foodprint");
  process.env.DATABASE_URL = target.toString();
  process.env.JWT_SECRET = "supplier-onboarding-integration-only-secret";
  await execute(
    process.execPath,
    [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"],
    { env: { ...process.env }, timeout: 90000 },
  );
  await execute(
    process.execPath,
    [
      path.resolve("node_modules/prisma/build/index.js"),
      "migrate",
      "diff",
      "--from-config-datasource",
      "--to-schema",
      "prisma/schema.prisma",
      "--exit-code",
    ],
    { env: { ...process.env }, timeout: 90000 },
  );
  const db = await getPrisma();
  context.after(() => db.$disconnect());
  await bootstrapAuthorization(db);
  const schoolA = randomUUID(),
    schoolB = randomUUID(),
    supplierA = randomUUID(),
    supplierB = randomUUID();
  const managerA = randomUUID(),
    managerB = randomUUID(),
    warehouseA = randomUUID(),
    healthA = randomUUID();
  const ingredientA = randomUUID(),
    otherIngredientA = randomUUID(),
    ingredientB = randomUUID();
  const entryA = randomUUID(),
    otherEntryA = randomUUID(),
    entryB = randomUUID();
  const province = randomUUID(),
    wardA = randomUUID(),
    wardB = randomUUID(),
    certificate = randomUUID();
  const passwordHash = await bcrypt.hash("123456", 4);
  const today = schoolToday(),
    end = new Date(today.getTime() + 30 * 86400000);
  await db.school.createMany({
    data: [
      { id: schoolA, name: "TEST School A" },
      { id: schoolB, name: "TEST School B" },
    ],
  });
  for (const [id, username, schoolId, roleCode] of [
    [managerA, "managerA", schoolA, "SCHOOL_MANAGEMENT_BOARD"],
    [managerB, "managerB", schoolB, "SCHOOL_MANAGEMENT_BOARD"],
    [warehouseA, "warehouseA", schoolA, "INGREDIENT_MANAGEMENT_DEPARTMENT"],
    [randomUUID(), "warehouseB", schoolB, "INGREDIENT_MANAGEMENT_DEPARTMENT"],
    [healthA, "healthA", schoolA, "SCHOOL_NUTRITION_OFFICER"],
  ]) {
    const role = await db.role.findUniqueOrThrow({ where: { code: roleCode } });
    await db.user.create({
      data: {
        id,
        username,
        email: `${username}@test.local`,
        fullName: username,
        schoolId,
        roleId: role.id,
        roleCode,
        passwordHash,
        status: "ACTIVE",
      },
    });
  }
  await db.location.create({
    data: {
      id: province,
      code: "TEST-P",
      name: "Test province",
      type: "CITY",
      level: 1,
    },
  });
  await db.location.createMany({
    data: [
      {
        id: wardA,
        code: "TEST-WA",
        name: "Test ward A",
        type: "WARD",
        level: 2,
        parentId: province,
      },
      {
        id: wardB,
        code: "TEST-WB",
        name: "Test ward B",
        type: "WARD",
        level: 2,
        parentId: province,
      },
    ],
  });
  await db.supplier.createMany({
    data: [
      { id: supplierA, name: "Supplier A", locationId: wardA },
      { id: supplierB, name: "Supplier B", locationId: wardB },
    ],
  });
  await db.supplierServiceArea.createMany({
    data: [
      { supplierId: supplierA, locationId: wardA },
      { supplierId: supplierB, locationId: province },
    ],
  });
  const grainsCategory = await db.ingredientCategory.create({
    data: { categoryName: "Grains" },
  });
  const vegetablesCategory = await db.ingredientCategory.create({
    data: { categoryName: "Vegetables" },
  });
  await db.ingredient.createMany({
    data: [
      {
        id: ingredientA,
        supplierId: supplierA,
        name: "Rice",
        categoryId: grainsCategory.id,
        defaultUnit: "kg",
      },
      {
        id: otherIngredientA,
        supplierId: supplierA,
        name: "Oil",
        defaultUnit: "l",
      },
      {
        id: ingredientB,
        supplierId: supplierB,
        name: "Vegetable",
        categoryId: vegetablesCategory.id,
        defaultUnit: "kg",
      },
    ],
  });
  await db.ingredientEntry.createMany({
    data: [
      {
        id: entryA,
        schoolId: schoolA,
        ingredientId: ingredientA,
        handlingType: "DRY_STOCK",
      },
      {
        id: otherEntryA,
        schoolId: schoolA,
        ingredientId: otherIngredientA,
        handlingType: "DRY_STOCK",
      },
      {
        id: entryB,
        schoolId: schoolB,
        ingredientId: ingredientB,
        handlingType: "DIRECT_USE",
      },
    ],
  });
  await db.supplierCertification.create({
    data: {
      id: certificate,
      supplierId: supplierA,
      certificationType: "TEST",
      certificateNo: "TEST-CERT",
      issuedDate: today,
      expiryDate: end,
    },
  });

  const sessions = createAuthSessions(memorySessions().store);
  const sessionService = createSessionService(getPrisma, sessions);
  const app = createApp(
    createApiRateLimiter(new MemoryStore(), { windowMs: 60000, limit: 1000 }),
    createAuthenticate(undefined, (payload) => sessions.assertAccess(payload)),
    {
      session: sessionService,
      signup: signupService,
      sessionAuthenticate: createSessionAuthenticate(
        (id) => sessionService.currentUser(id),
        (payload) => sessions.assertAccess(payload),
      ),
    },
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api`;
  const call = async (
    url: string,
    token: string,
    method = "GET",
    body?: unknown,
  ) => {
    const response = await fetch(base + url, {
      method,
      headers: {
        ...(token ? { Cookie: token } : {}),
        "X-CSRF-Protection": "1",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = record(await response.json());
    return {
      status: response.status,
      cookies: response.headers
        .getSetCookie()
        .map((cookie) => cookie.split(";")[0]),
      result,
      data: result.data ? record(result.data) : {},
    };
  };
  const login = async (email: string) => {
    const response = await call("/auth/login", "", "POST", {
      identifier: email,
      password: "123456",
    });
    assert.equal(response.status, 200);
    assert.equal(response.data.accessToken, undefined);
    assert.ok(
      response.cookies.some((cookie) => cookie.startsWith("foodprint_access=")),
    );
    return response.cookies.join("; ");
  };
  const tokenA = await login("managerA@test.local"),
    tokenB = await login("managerB@test.local"),
    warehouse = await login("warehouseA@test.local"),
    health = await login("healthA@test.local");
  const payload = (number: string) => ({
    supplierId: supplierA,
    number,
    signedOn: dayString(today),
    startsOn: dayString(today),
    endsOn: dayString(end),
    certificationId: certificate,
    items: [{ ingredientId: ingredientA, handlingType: "DRY_STOCK" }],
  });
  const pdf = Buffer.from(
    "%PDF-1.4\n[TEST ONLY] signed agreement evidence\n%%EOF",
  );
  const upload = async (id: string, kind: string, content = pdf) => {
    const form = new FormData();
    form.append("kind", kind);
    form.append(
      "file",
      new Blob([new Uint8Array(content)], { type: "application/pdf" }),
      "test-contract.pdf",
    );
    const response = await fetch(`${base}/supplier-contracts/${id}/documents`, {
      method: "POST",
      headers: { Cookie: tokenA, "X-CSRF-Protection": "1" },
      body: form,
    });
    return {
      status: response.status,
      data: record(record(await response.json()).data || {}),
    };
  };

  await context.test(
    "global directory, server filters and organization isolation",
    async () => {
      assert.equal((await call("/supplier-directory", "")).status, 401);
      const all = await call("/supplier-directory", tokenA);
      assert.equal(record(all.data.pagination).total, 2);
      const registered = await call(
        `/supplier-directory?wardId=${wardA}`,
        tokenA,
      );
      assert.equal(record(registered.data.pagination).total, 1);
      const serviceArea = await call(
        `/supplier-directory?wardId=${wardA}&locationMode=SERVICE`,
        tokenA,
      );
      assert.equal(record(serviceArea.data.pagination).total, 2);
      const search = await call("/supplier-directory?q=Supplier%20B", tokenA);
      assert.equal(record(search.data.pagination).total, 1);
      assert.equal(
        (await call("/supplier-directory?schoolId=" + schoolB, tokenA)).status,
        400,
      );
      assert.equal(
        (await call("/supplier-contracts", health, "POST", payload("DENIED")))
          .status,
        403,
      );
      assert.equal(
        (
          await call("/supplier-contracts", tokenA, "POST", {
            ...payload("FORGED"),
            schoolId: schoolB,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await call("/supplier-contracts", tokenA, "POST", {
            ...payload("BAD-SCOPE"),
            items: [{ ingredientId: ingredientB, handlingType: "DIRECT_USE" }],
          })
        ).status,
        400,
      );
    },
  );

  const first = await call(
    "/supplier-contracts",
    tokenA,
    "POST",
    payload("HD-1"),
  );
  assert.equal(first.status, 200);
  const firstId = stringField(first.data, "id");
  const second = await call(
    "/supplier-contracts",
    tokenA,
    "POST",
    payload("HD-2"),
  );
  const secondId = stringField(second.data, "id");
  await context.test(
    "real files are required and private, stale updates are rejected",
    async () => {
      assert.equal(
        (
          await call(
            `/supplier-contracts/${firstId}/activate`,
            tokenA,
            "POST",
            { revision: 1, verified: true },
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await call(
            `/supplier-contracts/${firstId}/activate`,
            tokenA,
            "POST",
            { revision: 1, verified: false },
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await upload(
            firstId,
            "SIGNED_CONTRACT",
            Buffer.from("<html>forged PDF</html>"),
          )
        ).status,
        400,
      );
      for (const id of [firstId, secondId]) {
        assert.equal((await upload(id, "SIGNED_CONTRACT")).status, 200);
        assert.equal((await upload(id, "COMPLIANCE")).status, 200);
      }
      assert.equal(
        (
          await call(`/supplier-contracts/${firstId}`, tokenA, "PUT", {
            ...payload("HD-1"),
            supplierId: undefined,
            revision: 1,
          })
        ).status,
        409,
      );
      assert.equal(
        (await call(`/supplier-contracts/${firstId}`, tokenB)).status,
        404,
      );
      const contract = await call(`/supplier-contracts/${firstId}`, tokenA);
      assert(Array.isArray(contract.data.documents));
      const file = record(contract.data.documents[0]);
      assert.equal(file.content, undefined);
      assert.equal(
        (
          await call(
            `/supplier-contract-documents/${stringField(file, "id")}`,
            tokenB,
          )
        ).status,
        404,
      );
      const response = await fetch(
        `${base}/supplier-contract-documents/${stringField(file, "id")}`,
        { headers: { Cookie: tokenA } },
      );
      assert.equal(response.status, 200);
      assert.match(
        response.headers.get("content-disposition") || "",
        /attachment/,
      );
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
    },
  );

  let activeId = "";
  await context.test(
    "concurrent activation cannot duplicate a relationship or overlapping scope",
    async () => {
      const drafts = await Promise.all(
        [firstId, secondId].map((id) =>
          call(`/supplier-contracts/${id}`, tokenA),
        ),
      );
      const results = await Promise.all(
        drafts.map((draft, index) =>
          call(
            `/supplier-contracts/${[firstId, secondId][index]}/activate`,
            tokenA,
            "POST",
            { revision: draft.data.revision, verified: true },
          ),
        ),
      );
      assert.deepEqual(results.map((item) => item.status).sort(), [200, 409]);
      activeId = stringField(
        results.find((item) => item.status === 200)!.data,
        "id",
      );
      assert.equal(
        await db.schoolSupplierRelationship.count({
          where: { schoolId: schoolA, supplierId: supplierA, status: "ACTIVE" },
        }),
        1,
      );
      assert.equal(
        await db.supplierRelationshipEvent.count({
          where: { action: "CONTRACT_ACTIVATED" },
        }),
        1,
      );
      const documents = await db.supplierContractDocument.findMany({
        where: { contractId: activeId },
        select: { id: true },
      });
      assert.equal(
        (
          await call(
            `/supplier-contract-documents/${documents[0].id}`,
            tokenA,
            "DELETE",
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await call(`/supplier-contracts/${activeId}`, tokenA, "PUT", {
            ...payload("CHANGED"),
            supplierId: undefined,
            revision: 4,
          })
        ).status,
        409,
      );
    },
  );

  const createOrder = async (entry: string, number: string) => {
    // Loại đơn phải khớp loại nguyên liệu (DIRECT_USE kèm đợt 1; DRY_STOCK không có đợt).
    const handling = (
      await db.ingredientEntry.findUnique({
        where: { id: entry },
        select: { handlingType: true },
      })
    )?.handlingType;
    const orderType = handling === "DIRECT_USE" ? "DIRECT_USE" : "DRY_STOCK";
    return call("/supply-requests", warehouse, "POST", {
      supplierId: supplierA,
      requestNo: number,
      orderType,
      batchNo: orderType === "DIRECT_USE" ? 1 : null,
      requestedDeliveryDate: dayString(today),
      items: [{ ingredientEntryId: entry, quantity: 10 }],
    });
  };
  let sentId = "";
  await context.test(
    "orders enforce supplier, school, scope and current compliance, and pin the contract snapshot",
    async () => {
      assert.equal((await createOrder(entryB, "FOREIGN-ENTRY")).status, 400);
      const outside = await createOrder(otherEntryA, "OUTSIDE-SCOPE");
      assert.equal(outside.status, 200, JSON.stringify(outside.data));
      assert.equal(
        (
          await call(
            `/supply-requests/${stringField(outside.data, "id")}/send`,
            warehouse,
            "POST",
            { contractId: activeId },
          )
        ).status,
        409,
      );
      const order = await createOrder(entryA, "VALID-ORDER");
      sentId = stringField(order.data, "id");
      await db.supplierCertification.update({
        where: { id: certificate },
        data: { status: "INACTIVE" },
      });
      assert.equal(
        (
          await call(`/supply-requests/${sentId}/send`, warehouse, "POST", {
            contractId: activeId,
          })
        ).status,
        409,
      );
      await db.supplierCertification.update({
        where: { id: certificate },
        data: { status: "ACTIVE" },
      });
      await db.ingredient.update({
        where: { id: ingredientA },
        data: { status: "INACTIVE" },
      });
      assert.equal(
        (
          await call(`/supply-requests/${sentId}/send`, warehouse, "POST", {
            contractId: activeId,
          })
        ).status,
        409,
      );
      await db.ingredient.update({
        where: { id: ingredientA },
        data: { status: "ACTIVE" },
      });
      assert.equal(
        (
          await call(`/supply-requests/${sentId}/send`, warehouse, "POST", {
            contractId: activeId,
          })
        ).status,
        200,
      );
      const evidence = await call(
        `/supply-requests/${sentId}/contract-evidence`,
        warehouse,
      );
      assert.equal(evidence.status, 200);
      assert.equal(
        (await call(`/supply-requests/${sentId}/contract-evidence`, tokenA))
          .status,
        200,
      );
      assert.equal(
        (await call(`/supply-requests/${sentId}/contract-evidence`, tokenB))
          .status,
        404,
      );
      assert.equal(evidence.data.contractId, activeId);
      assert.equal(record(evidence.data.contractSnapshot).contractId, activeId);
      assert.equal(
        (
          await call(
            `/supply-requests/${sentId}/contract-evidence`,
            await login("warehouseB@test.local"),
          )
        ).status,
        404,
      );
    },
  );

  await context.test(
    "suspension, resumption and unlink retain files, audit events and existing order evidence",
    async () => {
      const relationship = await db.schoolSupplierRelationship.findFirstOrThrow(
        {
          where: { schoolId: schoolA, supplierId: supplierA, status: "ACTIVE" },
        },
      );
      assert.equal(
        (
          await call(
            `/supplier-partnerships/${relationship.id}/suspend`,
            tokenB,
            "POST",
            { reason: "forged" },
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await call(
            `/supplier-partnerships/${relationship.id}/suspend`,
            tokenA,
            "POST",
            { reason: "" },
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await call(
            `/supplier-partnerships/${relationship.id}/suspend`,
            tokenA,
            "POST",
            { reason: "TEST suspend" },
          )
        ).status,
        200,
      );
      const order = await createOrder(entryA, "AFTER-SUSPEND");
      assert.equal(
        (
          await call(
            `/supply-requests/${stringField(order.data, "id")}/send`,
            warehouse,
            "POST",
            { contractId: activeId },
          )
        ).status,
        409,
      );
      await db.ingredient.update({
        where: { id: ingredientA },
        data: { status: "INACTIVE" },
      });
      assert.equal(
        (
          await call(
            `/supplier-partnerships/${relationship.id}/resume`,
            tokenA,
            "POST",
            { reason: "TEST invalid resume" },
          )
        ).status,
        409,
      );
      await db.ingredient.update({
        where: { id: ingredientA },
        data: { status: "ACTIVE" },
      });
      assert.equal(
        (
          await call(
            `/supplier-partnerships/${relationship.id}/resume`,
            tokenA,
            "POST",
            { reason: "TEST resume" },
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await call(
            `/supplier-partnerships/${relationship.id}/unlink`,
            tokenA,
            "POST",
            { reason: "TEST unlink" },
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await call(
            `/supply-requests/${stringField(order.data, "id")}/send`,
            warehouse,
            "POST",
            { contractId: activeId },
          )
        ).status,
        409,
      );
      const previous = await db.supplyRequest.findUniqueOrThrow({
        where: { id: sentId },
      });
      assert.equal(previous.status, "SENT");
      assert.equal(previous.contractId, activeId);
      assert(previous.contractSnapshot);
      assert.equal(
        await db.supplierContractDocument.count({
          where: { contractId: activeId },
        }),
        2,
      );
      assert.equal(
        await db.supplierRelationshipEvent.count({
          where: { relationshipId: relationship.id },
        }),
        5,
      );
      const foreignDetail = await call(
        `/supplier-directory/${supplierA}`,
        tokenB,
      );
      assert.deepEqual(foreignDetail.data.contracts, []);
    },
  );
  await context.test(
    "closing and re-linking creates a new relationship without rewriting old order evidence",
    async () => {
      const snapshot = (
        await db.supplyRequest.findUniqueOrThrow({ where: { id: sentId } })
      ).contractSnapshot;
      assert.equal(
        (
          await call(`/supplier-contracts/${activeId}/close`, tokenA, "POST", {
            reason: "TEST finish agreement",
          })
        ).status,
        200,
      );
      const nextId = activeId === firstId ? secondId : firstId;
      const next = await call(`/supplier-contracts/${nextId}`, tokenA);
      assert.equal(
        (
          await call(`/supplier-contracts/${nextId}/activate`, tokenA, "POST", {
            revision: next.data.revision,
            verified: true,
          })
        ).status,
        200,
      );
      assert.equal(
        await db.schoolSupplierRelationship.count({
          where: { schoolId: schoolA, supplierId: supplierA },
        }),
        2,
      );
      assert.equal(
        await db.schoolSupplierRelationship.count({
          where: { schoolId: schoolA, supplierId: supplierA, status: "ACTIVE" },
        }),
        1,
      );
      const previous = await db.supplyRequest.findUniqueOrThrow({
        where: { id: sentId },
      });
      assert.equal(previous.contractId, activeId);
      assert.deepEqual(previous.contractSnapshot, snapshot);
      assert.equal(
        await db.supplierContractDocument.count({
          where: { contractId: activeId },
        }),
        2,
      );
    },
  );
  await context.test(
    "hidden supplier ingredients leave new choices but retain menu, contract and order evidence",
    async () => {
      const role = await db.role.findUniqueOrThrow({
        where: { code: "INGREDIENT_SUPPLIER_ADMIN" },
      });
      await db.user.create({
        data: {
          username: "ingredient-admin",
          email: "ingredient-admin@test.local",
          fullName: "Ingredient admin",
          roleId: role.id,
          roleCode: role.code,
          supplierId: supplierA,
          passwordHash,
          status: "ACTIVE",
        },
      });
      const admin = await login("ingredient-admin@test.local");
      const menu = await db.weeklyMenu.create({
        data: {
          schoolId: schoolA,
          createdByUserId: healthA,
          weekStartDate: new Date("2026-10-26"),
          title: "Hidden history",
        },
      });
      const day = await db.menuDay.create({
        data: { weeklyMenuId: menu.id, menuDate: new Date("2026-10-26") },
      });
      const dish = await db.dish.create({
        data: {
          schoolId: schoolA,
          standardQuantity: "100",
          standardUnit: "g",
          name: "Hidden history dish",
        },
      });
      await db.menuDayDish.create({
        data: { menuDayId: day.id, dishId: dish.id, mealType: "LUNCH" },
      });
      await db.menuDayDishIngredient.create({
        data: {
          menuDayId: day.id,
          dishId: dish.id,
          mealType: "LUNCH",
          ingredientId: ingredientA,
          quantityPerPortion: 1,
          unit: "kg",
        },
      });
      const mainBefore = await call(
        "/v1/menus/ingredient-options/main",
        health,
      );
      assert.equal(mainBefore.status, 200);
      assert(
        (mainBefore.data.items as { id: string }[]).some(
          (row) => row.id === ingredientA,
        ),
      );
      assert.equal(
        record(
          (await call("/supplier-directory?category=Grains", tokenA)).data
            .pagination,
        ).total,
        1,
      );
      const oldSnapshot = (
        await db.supplyRequest.findUniqueOrThrow({ where: { id: sentId } })
      ).contractSnapshot;
      const hidden = await call(
        "/ingredients/management/" + ingredientA + "/status",
        admin,
        "PATCH",
        { status: "INACTIVE" },
      );
      assert.equal(hidden.status, 200);
      for (const kind of ["main", "seasoning"]) {
        const choices = await call(
          "/v1/menus/ingredient-options/" + kind,
          health,
        );
        assert.equal(choices.status, 200);
        assert(
          !(choices.data.items as { id: string; ingredientId?: string }[]).some(
            (row) => row.id === ingredientA || row.ingredientId === ingredientA,
          ),
        );
      }
      const filtered = await call(
        "/supplier-directory?category=Grains",
        tokenA,
      );
      assert.equal(record(filtered.data.pagination).total, 0);
      const filterNames = (await call("/supplier-directory-filters", tokenA))
        .data.categories;
      assert(Array.isArray(filterNames));
      assert(!filterNames.includes("Grains"));
      const history = await call("/v1/menus/" + menu.id, health);
      assert.equal(history.status, 200);
      const days = history.data.menuDays as {
        menuDayDishes: {
          ingredients: {
            ingredient: { id: string; category: string; coverImage?: string };
          }[];
        }[];
      }[];
      const historicalIngredient =
        days[0].menuDayDishes[0].ingredients[0].ingredient;
      assert.equal(historicalIngredient.id, ingredientA);
      assert.equal(historicalIngredient.category, "Grains");
      assert.equal(historicalIngredient.coverImage, undefined);
      const contract = await call("/supplier-contracts/" + activeId, tokenA);
      assert.equal(contract.status, 200);
      assert(
        (
          contract.data.items as {
            ingredient: { id: string; category: string };
          }[]
        ).some(
          (row) =>
            row.ingredient.id === ingredientA &&
            row.ingredient.category === "Grains",
        ),
      );
      assert.deepEqual(
        (await db.supplyRequest.findUniqueOrThrow({ where: { id: sentId } }))
          .contractSnapshot,
        oldSnapshot,
      );
      assert.equal(
        (await db.ingredientEntry.findUniqueOrThrow({ where: { id: entryA } }))
          .ingredientId,
        ingredientA,
      );
      const restored = await call(
        "/ingredients/management/" + ingredientA + "/status",
        admin,
        "PATCH",
        { status: "ACTIVE" },
      );
      assert.equal(restored.status, 200);
      const restoredChoices = await call(
        "/v1/menus/ingredient-options/main",
        health,
      );
      assert.equal(restoredChoices.status, 200);
      assert(
        (restoredChoices.data.items as { id: string }[]).some(
          (row) => row.id === ingredientA,
        ),
      );
      assert.deepEqual(
        (await db.supplyRequest.findUniqueOrThrow({ where: { id: sentId } }))
          .contractSnapshot,
        oldSnapshot,
      );
    },
  );
  await context.test(
    "supplier-linked-schools US1 list isolates suppliers, selects representative relationship before pagination, and keeps id+code distinct",
    async () => {
      const supRole = await db.role.findUniqueOrThrow({
        where: { code: "INGREDIENT_SUPPLIER_ADMIN" },
      });
      const sup1 = randomUUID();
      const sup2 = randomUUID();
      const supEmpty = randomUUID();
      await db.supplier.createMany({
        data: [
          { id: sup1, name: "Linked Schools Supplier 1" },
          { id: sup2, name: "Linked Schools Supplier 2" },
          { id: supEmpty, name: "Linked Schools Supplier Empty" },
        ],
      });
      for (const [uname, sid] of [
        ["ls-admin-1", sup1],
        ["ls-admin-2", sup2],
        ["ls-admin-empty", supEmpty],
      ] as const) {
        await db.user.create({
          data: {
            username: uname,
            email: `${uname}@test.local`,
            fullName: uname,
            roleId: supRole.id,
            roleCode: supRole.code,
            supplierId: sid,
            passwordHash,
            status: "ACTIVE",
          },
        });
      }
      const tokenSup1 = await login("ls-admin-1@test.local");
      const tokenSup2 = await login("ls-admin-2@test.local");
      const tokenEmpty = await login("ls-admin-empty@test.local");

      const emptyRes = await call("/supplier-schools", tokenEmpty);
      assert.equal(emptyRes.status, 200);
      assert.deepEqual(emptyRes.data, {
        items: [],
        pagination: { page: 1, limit: 20, hasNext: false },
      });

      const schOnly1 = "10000000-0000-4000-8000-000000000001";
      const schShared = "10000000-0000-4000-8000-000000000002";
      const schOnly2 = "10000000-0000-4000-8000-000000000003";
      const schNever = "10000000-0000-4000-8000-000000000004";
      const schDraftOnly = "10000000-0000-4000-8000-000000000005";
      const schInactive = "10000000-0000-4000-8000-000000000006";
      const schRelinkedOlderActive = "10000000-0000-4000-8000-000000000007";
      const schMultiUnlinked = "10000000-0000-4000-8000-000000000008";
      const schTieA = "10000000-0000-4000-8000-000000000009";
      const schTieB = "10000000-0000-4000-8000-00000000000a";
      const extraSchools = Array.from({ length: 15 }, (_, idx) => ({
        id: `10000000-0000-4000-8000-${String(100 + idx).padStart(12, "0")}`,
        name: `Extra Linked School ${idx + 1}`,
        code: `EX-${idx + 1}`,
        status: "ACTIVE" as const,
      }));

      await db.school.createMany({
        data: [
          {
            id: schOnly1,
            name: "School Only 1",
            code: "SCH-ONLY-1",
            address: "1 Nguyen Trai",
            email: "only1@school.test",
            phone: "0901111111",
            status: "ACTIVE",
          },
          {
            id: schShared,
            name: "School Shared No Code",
            code: null,
            status: "ACTIVE",
          },
          { id: schOnly2, name: "School Only 2", code: "SCH-ONLY-2" },
          { id: schNever, name: "School Never Linked", code: "SCH-NEVER" },
          { id: schDraftOnly, name: "School Draft Only", code: "SCH-DRAFT" },
          {
            id: schInactive,
            name: "School Inactive",
            code: "SCH-INACTIVE",
            status: "INACTIVE",
          },
          {
            id: schRelinkedOlderActive,
            name: "School Relinked Older Active",
            code: "SCH-RELINK",
          },
          {
            id: schMultiUnlinked,
            name: "School Multi Unlinked",
            code: "SCH-UNLINK",
          },
          { id: schTieA, name: "School Tie A", code: "SCH-TIE-A" },
          { id: schTieB, name: "School Tie B", code: "SCH-TIE-B" },
          ...extraSchools,
        ],
      });

      // DRAFT-only contract for schDraftOnly -> must NOT appear in list
      await db.supplierContract.create({
        data: {
          schoolId: schDraftOnly,
          supplierId: sup1,
          status: "DRAFT",
          createdByUserId: managerA,
          number: "DRAFT-ONLY-01",
        },
      });

      const t = (iso: string) => new Date(iso);
      await db.schoolSupplierRelationship.createMany({
        data: [
          {
            id: "20000000-0000-4000-8000-000000000001",
            schoolId: schOnly1,
            supplierId: sup1,
            status: "ACTIVE",
            linkedAt: t("2026-11-10T10:00:00.000Z"),
          },
          {
            id: "20000000-0000-4000-8000-000000000002",
            schoolId: schShared,
            supplierId: sup1,
            status: "UNLINKED",
            linkedAt: t("2026-11-09T10:00:00.000Z"),
            unlinkedAt: t("2026-11-09T12:00:00.000Z"),
            unlinkReason: "Expired",
          },
          {
            id: "20000000-0000-4000-8000-000000000003",
            schoolId: schShared,
            supplierId: sup2,
            status: "ACTIVE",
            linkedAt: t("2026-11-11T10:00:00.000Z"),
          },
          {
            id: "20000000-0000-4000-8000-000000000004",
            schoolId: schOnly2,
            supplierId: sup2,
            status: "ACTIVE",
            linkedAt: t("2026-11-12T10:00:00.000Z"),
          },
          {
            id: "20000000-0000-4000-8000-000000000005",
            schoolId: schInactive,
            supplierId: sup1,
            status: "SUSPENDED",
            linkedAt: t("2026-11-08T10:00:00.000Z"),
            suspendedAt: t("2026-11-08T15:00:00.000Z"),
            suspensionReason: "Paused",
          },
          // Abnormal historical timestamp: UNLINKED has NEWER linkedAt than ACTIVE -> ACTIVE must win
          {
            id: "20000000-0000-4000-8000-000000000006",
            schoolId: schRelinkedOlderActive,
            supplierId: sup1,
            status: "UNLINKED",
            linkedAt: t("2026-11-15T10:00:00.000Z"),
            unlinkedAt: t("2026-11-15T11:00:00.000Z"),
            unlinkReason: "Previous cycle ended",
          },
          {
            id: "20000000-0000-4000-8000-000000000007",
            schoolId: schRelinkedOlderActive,
            supplierId: sup1,
            status: "ACTIVE",
            linkedAt: t("2026-11-07T10:00:00.000Z"),
          },
          // Multiple UNLINKED with tie on linkedAt -> id ASC picks ...0008 over ...0009
          {
            id: "20000000-0000-4000-8000-000000000009",
            schoolId: schMultiUnlinked,
            supplierId: sup1,
            status: "UNLINKED",
            linkedAt: t("2026-11-06T10:00:00.000Z"),
            unlinkedAt: t("2026-11-06T12:00:00.000Z"),
            unlinkReason: "Reason 9",
          },
          {
            id: "20000000-0000-4000-8000-000000000008",
            schoolId: schMultiUnlinked,
            supplierId: sup1,
            status: "UNLINKED",
            linkedAt: t("2026-11-06T10:00:00.000Z"),
            unlinkedAt: t("2026-11-06T11:00:00.000Z"),
            unlinkReason: "Reason 8",
          },
          {
            id: "20000000-0000-4000-8000-00000000000a",
            schoolId: schMultiUnlinked,
            supplierId: sup1,
            status: "UNLINKED",
            linkedAt: t("2026-11-05T10:00:00.000Z"),
            unlinkedAt: t("2026-11-05T11:00:00.000Z"),
            unlinkReason: "Reason a",
          },
          // Two schools tied at same representative linkedAt -> school_id ASC (schTieA before schTieB)
          {
            id: "20000000-0000-4000-8000-00000000000b",
            schoolId: schTieB,
            supplierId: sup1,
            status: "ACTIVE",
            linkedAt: t("2026-11-04T10:00:00.000Z"),
          },
          {
            id: "20000000-0000-4000-8000-00000000000c",
            schoolId: schTieA,
            supplierId: sup1,
            status: "ACTIVE",
            linkedAt: t("2026-11-04T10:00:00.000Z"),
          },
          ...extraSchools.map((s, idx) => ({
            id: `20000000-0000-4000-8000-${String(200 + idx).padStart(12, "0")}`,
            schoolId: s.id,
            supplierId: sup1,
            status: "ACTIVE" as const,
            linkedAt: new Date(Date.UTC(2026, 9, 1 + idx, 10, 0, 0)),
          })),
        ],
      });

      // Default page=1 limit=20 returns 20 items, hasNext=true (total 22 for sup1: 7 named + 15 extra)
      const def1 = await call("/supplier-schools", tokenSup1);
      assert.equal(def1.status, 200);
      const def1Items = def1.data.items as Record<string, unknown>[];
      assert.equal(def1Items.length, 20);
      assert.deepEqual(def1.data.pagination, {
        page: 1,
        limit: 20,
        hasNext: true,
      });
      const def2 = await call("/supplier-schools?page=2", tokenSup1);
      assert.equal(def2.status, 200);
      const def2Items = def2.data.items as Record<string, unknown>[];
      assert.equal(def2Items.length, 2);
      assert.deepEqual(def2.data.pagination, {
        page: 2,
        limit: 20,
        hasNext: false,
      });

      // Full small-page traversal limit=3
      const allSup1: Record<string, unknown>[] = [];
      for (let page = 1; ; page++) {
        const res = await call(
          `/supplier-schools?page=${page}&limit=3`,
          tokenSup1,
        );
        assert.equal(res.status, 200);
        const items = res.data.items as Record<string, unknown>[];
        allSup1.push(...items);
        if (!record(res.data.pagination).hasNext) break;
      }
      assert.equal(allSup1.length, 22);
      const allIds = allSup1.map((item) => item.id as string);
      assert.equal(new Set(allIds).size, 22);
      assert(!allIds.includes(schOnly2));
      assert(!allIds.includes(schNever));
      assert(!allIds.includes(schDraftOnly));

      assert.deepEqual(allIds.slice(0, 7), [
        schOnly1,
        schShared,
        schInactive,
        schRelinkedOlderActive,
        schMultiUnlinked,
        schTieA,
        schTieB,
      ]);
      assert.equal(allSup1[0].code, "SCH-ONLY-1");
      assert.equal(allSup1[1].code, null);
      assert.equal(allSup1[2].status, "INACTIVE");
      assert.equal(record(allSup1[2].relationship).status, "SUSPENDED");
      assert.equal(record(allSup1[3].relationship).status, "ACTIVE");
      assert.equal(
        record(allSup1[3].relationship).linkedAt,
        "2026-11-07T10:00:00.000Z",
      );
      assert.equal(record(allSup1[4].relationship).status, "UNLINKED");

      // Out of range returns empty
      const overRes = await call(
        "/supplier-schools?page=99&limit=20",
        tokenSup1,
      );
      assert.equal(overRes.status, 200);
      assert.deepEqual(overRes.data, {
        items: [],
        pagination: { page: 99, limit: 20, hasNext: false },
      });

      // Supplier 2 sees only schOnly2 (Nov 12) and schShared (Nov 11 ACTIVE)
      const sup2Res = await call("/supplier-schools", tokenSup2);
      assert.equal(sup2Res.status, 200);
      const sup2Items = sup2Res.data.items as Record<string, unknown>[];
      assert.deepEqual(
        sup2Items.map((i) => i.id),
        [schOnly2, schShared],
      );
      assert.equal(record(sup2Items[1].relationship).status, "ACTIVE");
    },
  );
  await context.test(
    "supplier-linked-schools US2 direct detail enforces pair isolation, matches representative rules, and does not require calling list first",
    async () => {
      const supRole = await db.role.findUniqueOrThrow({
        where: { code: "INGREDIENT_SUPPLIER_ADMIN" },
      });
      const sup1 = randomUUID();
      const sup2 = randomUUID();
      await db.supplier.createMany({
        data: [
          { id: sup1, name: "US2 Supplier 1" },
          { id: sup2, name: "US2 Supplier 2" },
        ],
      });
      for (const [uname, sid] of [
        ["us2-admin-1", sup1],
        ["us2-admin-2", sup2],
      ] as const) {
        await db.user.create({
          data: {
            username: uname,
            email: `${uname}@test.local`,
            fullName: uname,
            roleId: supRole.id,
            roleCode: supRole.code,
            supplierId: sid,
            passwordHash,
            status: "ACTIVE",
          },
        });
      }
      const token1 = await login("us2-admin-1@test.local");
      const token2 = await login("us2-admin-2@test.local");

      const schShared = randomUUID();
      const schInactiveSusp = randomUUID();
      const schMultiUnlinked = randomUUID();
      const schOnly2 = randomUUID();
      const schDraftOnly = randomUUID();
      await db.school.createMany({
        data: [
          {
            id: schShared,
            name: "US2 Shared School",
            code: "US2-SHARED",
            address: "22 Hai Ba Trung",
            email: "shared@us2.test",
            phone: "0902222222",
            description: "Shared profile",
            websiteUrl: "https://us2.example.test",
            logoUrl: "https://cdn.example.test/us2-logo.png",
            coverImageUrl: "https://cdn.example.test/us2-cover.png",
            boardingScale: "800",
            status: "ACTIVE",
          },
          {
            id: schInactiveSusp,
            name: "US2 Inactive Suspended",
            code: null,
            status: "INACTIVE",
          },
          {
            id: schMultiUnlinked,
            name: "US2 Multi Unlinked",
            code: "US2-UNLINK",
          },
          { id: schOnly2, name: "US2 Only Sup 2", code: "US2-ONLY-2" },
          { id: schDraftOnly, name: "US2 Draft Only", code: "US2-DRAFT" },
        ],
      });
      await db.supplierContract.create({
        data: {
          schoolId: schDraftOnly,
          supplierId: sup1,
          status: "DRAFT",
          createdByUserId: managerA,
          number: "US2-DRAFT-ONLY",
        },
      });
      const t = (iso: string) => new Date(iso);
      await db.schoolSupplierRelationship.createMany({
        data: [
          // Shared school: UNLINKED with sup1 (newer linkedAt), ACTIVE with sup2, plus older ACTIVE with sup1 -> sup1 sees ACTIVE, sup2 sees ACTIVE of sup2
          {
            id: "30000000-0000-4000-8000-000000000001",
            schoolId: schShared,
            supplierId: sup1,
            status: "UNLINKED",
            linkedAt: t("2026-11-12T10:00:00.000Z"),
            unlinkedAt: t("2026-11-12T12:00:00.000Z"),
            unlinkReason: "Sup1 old unlink",
          },
          {
            id: "30000000-0000-4000-8000-000000000002",
            schoolId: schShared,
            supplierId: sup1,
            status: "ACTIVE",
            linkedAt: t("2026-11-10T10:00:00.000Z"),
          },
          {
            id: "30000000-0000-4000-8000-000000000003",
            schoolId: schShared,
            supplierId: sup2,
            status: "SUSPENDED",
            linkedAt: t("2026-11-11T10:00:00.000Z"),
            suspendedAt: t("2026-11-11T14:00:00.000Z"),
            suspensionReason: "Sup2 suspended",
          },
          {
            id: "30000000-0000-4000-8000-000000000004",
            schoolId: schInactiveSusp,
            supplierId: sup1,
            status: "SUSPENDED",
            linkedAt: t("2026-11-09T10:00:00.000Z"),
            suspendedAt: t("2026-11-09T15:00:00.000Z"),
            suspensionReason: "Tạm ngưng kiểm tra",
          },
          // Tie on linkedAt among UNLINKED: id ASC picks ...0005 over ...0006
          {
            id: "30000000-0000-4000-8000-000000000006",
            schoolId: schMultiUnlinked,
            supplierId: sup1,
            status: "UNLINKED",
            linkedAt: t("2026-11-08T10:00:00.000Z"),
            unlinkedAt: t("2026-11-08T13:00:00.000Z"),
            unlinkReason: "Second tie reason",
          },
          {
            id: "30000000-0000-4000-8000-000000000005",
            schoolId: schMultiUnlinked,
            supplierId: sup1,
            status: "UNLINKED",
            linkedAt: t("2026-11-08T10:00:00.000Z"),
            unlinkedAt: t("2026-11-08T12:00:00.000Z"),
            unlinkReason: "First tie reason",
          },
          {
            id: "30000000-0000-4000-8000-000000000007",
            schoolId: schOnly2,
            supplierId: sup2,
            status: "ACTIVE",
            linkedAt: t("2026-11-07T10:00:00.000Z"),
          },
        ],
      });

      // Direct detail without calling list first (fresh login token1/token2)
      const sharedDetail1 = await call(
        `/supplier-schools/${schShared}`,
        token1,
      );
      assert.equal(sharedDetail1.status, 200);
      assert.equal(sharedDetail1.data.id, schShared);
      assert.equal(sharedDetail1.data.code, "US2-SHARED");
      assert.equal(sharedDetail1.data.description, "Shared profile");
      assert.equal(sharedDetail1.data.websiteUrl, "https://us2.example.test");
      assert.equal(sharedDetail1.data.boardingScale, "800");
      assert.equal(record(sharedDetail1.data.relationship).status, "ACTIVE");
      assert.equal(
        record(sharedDetail1.data.relationship).linkedAt,
        "2026-11-10T10:00:00.000Z",
      );

      // Same shared school viewed by sup2 shows sup2's SUSPENDED relationship
      const sharedDetail2 = await call(
        `/supplier-schools/${schShared}`,
        token2,
      );
      assert.equal(sharedDetail2.status, 200);
      assert.equal(record(sharedDetail2.data.relationship).status, "SUSPENDED");
      assert.equal(
        record(sharedDetail2.data.relationship).suspensionReason,
        "Sup2 suspended",
      );

      // INACTIVE school + SUSPENDED relationship + no contracts -> 200 with nulls preserved
      const inactiveDetail = await call(
        `/supplier-schools/${schInactiveSusp}`,
        token1,
      );
      assert.equal(inactiveDetail.status, 200);
      assert.equal(inactiveDetail.data.status, "INACTIVE");
      assert.equal(inactiveDetail.data.code, null);
      assert.equal(inactiveDetail.data.description, null);
      assert.equal(
        record(inactiveDetail.data.relationship).suspensionReason,
        "Tạm ngưng kiểm tra",
      );

      // Tie among UNLINKED -> ...0005 chosen ("First tie reason")
      const tieDetail = await call(
        `/supplier-schools/${schMultiUnlinked}`,
        token1,
      );
      assert.equal(tieDetail.status, 200);
      assert.equal(record(tieDetail.data.relationship).status, "UNLINKED");
      assert.equal(
        record(tieDetail.data.relationship).unlinkReason,
        "First tie reason",
      );

      // Foreign school, DRAFT-only school, and unknown UUID -> identical 404
      const foreign = await call(`/supplier-schools/${schOnly2}`, token1);
      const draftOnly = await call(`/supplier-schools/${schDraftOnly}`, token1);
      const missing = await call(`/supplier-schools/${randomUUID()}`, token1);
      assert.equal(foreign.status, 404);
      assert.equal(draftOnly.status, 404);
      assert.equal(missing.status, 404);
      assert.equal(foreign.result.message, missing.result.message);
      assert.equal(draftOnly.result.message, missing.result.message);
    },
  );
  await context.test(
    "supplier-linked-schools US3 reads pair contracts and uploaded PDF/PNG/JPEG documents independently, excluding DRAFT and COMPLIANCE",
    async () => {
      const supRole = await db.role.findUniqueOrThrow({
        where: { code: "INGREDIENT_SUPPLIER_ADMIN" },
      });
      const sup1 = randomUUID();
      const sup2 = randomUUID();
      await db.supplier.createMany({
        data: [
          { id: sup1, name: "US3 Supplier 1" },
          { id: sup2, name: "US3 Supplier 2" },
        ],
      });
      for (const [uname, sid] of [
        ["us3-admin-1", sup1],
        ["us3-admin-2", sup2],
      ] as const) {
        await db.user.create({
          data: {
            username: uname,
            email: `${uname}@test.local`,
            fullName: uname,
            roleId: supRole.id,
            roleCode: supRole.code,
            supplierId: sid,
            passwordHash,
            status: "ACTIVE",
          },
        });
      }
      const token1 = await login("us3-admin-1@test.local");
      const token2 = await login("us3-admin-2@test.local");

      const sch1 = randomUUID();
      const sch2 = randomUUID();
      const schNoContract = randomUUID();
      const schDraftOnly = randomUUID();
      await db.school.createMany({
        data: [
          { id: sch1, name: "US3 School 1", code: "US3-SCH-1" },
          { id: sch2, name: "US3 School 2", code: "US3-SCH-2" },
          {
            id: schNoContract,
            name: "US3 School No Contracts",
            code: "US3-NOCONTRACT",
          },
          { id: schDraftOnly, name: "US3 Draft Only", code: "US3-DRAFT" },
        ],
      });

      const relUnlinkedId = randomUUID();
      const relActiveId = randomUUID();
      const relOtherSupplierId = randomUUID();
      const relOtherSchoolId = randomUUID();
      await db.schoolSupplierRelationship.createMany({
        data: [
          {
            id: relUnlinkedId,
            schoolId: sch1,
            supplierId: sup1,
            status: "UNLINKED",
            linkedAt: new Date("2026-10-01T08:00:00.000Z"),
            unlinkedAt: new Date("2026-10-20T08:00:00.000Z"),
            unlinkReason: "Hết kỳ 1",
          },
          {
            id: relActiveId,
            schoolId: sch1,
            supplierId: sup1,
            status: "ACTIVE",
            linkedAt: new Date("2026-11-01T08:00:00.000Z"),
          },
          {
            id: relOtherSupplierId,
            schoolId: sch1,
            supplierId: sup2,
            status: "ACTIVE",
            linkedAt: new Date("2026-11-02T08:00:00.000Z"),
          },
          {
            id: relOtherSchoolId,
            schoolId: sch2,
            supplierId: sup1,
            status: "ACTIVE",
            linkedAt: new Date("2026-11-03T08:00:00.000Z"),
          },
          {
            id: randomUUID(),
            schoolId: schNoContract,
            supplierId: sup1,
            status: "ACTIVE",
            linkedAt: new Date("2026-11-04T08:00:00.000Z"),
          },
        ],
      });

      // Ingredients (including an INACTIVE ingredient that must remain visible on historical contracts)
      const ingActiveId = "70000000-0000-4000-8000-000000000002";
      const ingInactiveId = "70000000-0000-4000-8000-000000000001";
      const ingSup2Id = "70000000-0000-4000-8000-000000000003";
      await db.ingredient.createMany({
        data: [
          {
            id: ingActiveId,
            supplierId: sup1,
            name: "Gạo thơm",
            defaultUnit: "kg",
            status: "ACTIVE",
          },
          {
            id: ingInactiveId,
            supplierId: sup1,
            name: "Đậu xanh (đã ẩn)",
            defaultUnit: "kg",
            status: "INACTIVE",
          },
          {
            id: ingSup2Id,
            supplierId: sup2,
            name: "Thịt gà Sup2",
            defaultUnit: "kg",
            status: "ACTIVE",
          },
        ],
      });

      // Contracts for (sch1, sup1):
      // - Closed legacy (relationshipId = null)
      // - Future-dated ACTIVE (createdAt tie with expired ACTIVE to verify id ASC tie-break)
      // - Expired ACTIVE
      // - DRAFT (must NOT appear)
      // Plus contracts for (sch1, sup2) and (sch2, sup1) to test cross-supplier & cross-school isolation
      const cClosedLegacy = "80000000-0000-4000-8000-000000000001";
      const cActiveFuture = "80000000-0000-4000-8000-000000000002";
      const cActiveExpired = "80000000-0000-4000-8000-000000000003";
      const cDraft = "80000000-0000-4000-8000-000000000004";
      const cOtherSupplier = "80000000-0000-4000-8000-000000000005";
      const cOtherSchool = "80000000-0000-4000-8000-000000000006";

      const tieCreated = new Date("2026-11-10T08:00:00.000Z");
      await db.supplierContract.createMany({
        data: [
          {
            id: cClosedLegacy,
            schoolId: sch1,
            supplierId: sup1,
            relationshipId: relUnlinkedId,
            number: "HD-LEGACY-01",
            status: "CLOSED",
            signedOn: new Date("2026-09-01"),
            startsOn: new Date("2026-09-05"),
            endsOn: new Date("2026-10-15"),
            scopeNote: "Hợp đồng đợt cũ",
            snapshot: { internalOnly: "do-not-expose" },
            createdByUserId: managerA,
            activatedByUserId: managerA,
            activatedAt: new Date("2026-09-02T09:00:00.000Z"),
            closedAt: new Date("2026-10-20T10:00:00.000Z"),
            closeReason: "Kết thúc đợt 1",
            createdAt: new Date("2026-11-05T08:00:00.000Z"),
          },
          {
            id: cActiveFuture,
            schoolId: sch1,
            supplierId: sup1,
            relationshipId: relActiveId,
            number: "HD-FUTURE-02",
            status: "ACTIVE",
            signedOn: new Date("2026-11-10"),
            startsOn: new Date("2099-01-01"),
            endsOn: new Date("2099-12-31"),
            scopeNote: "Hợp đồng tương lai",
            snapshot: { internalOnly: "do-not-expose" },
            createdByUserId: managerA,
            activatedByUserId: managerA,
            activatedAt: new Date("2026-11-10T08:05:00.000Z"),
            createdAt: tieCreated,
          },
          {
            id: cActiveExpired,
            schoolId: sch1,
            supplierId: sup1,
            relationshipId: relUnlinkedId,
            number: "HD-EXPIRED-03",
            status: "ACTIVE",
            signedOn: new Date("2020-01-01"),
            startsOn: new Date("2020-01-02"),
            endsOn: new Date("2020-12-31"),
            scopeNote: "Hợp đồng quá hạn nhưng vẫn ACTIVE",
            snapshot: { internalOnly: "do-not-expose" },
            createdByUserId: managerA,
            activatedByUserId: managerA,
            activatedAt: new Date("2020-01-01T10:00:00.000Z"),
            createdAt: tieCreated,
          },
          {
            id: cDraft,
            schoolId: sch1,
            supplierId: sup1,
            relationshipId: null,
            number: "HD-DRAFT-04",
            status: "DRAFT",
            createdByUserId: managerA,
            createdAt: new Date("2026-11-16T08:00:00.000Z"),
          },
          {
            id: cOtherSupplier,
            schoolId: sch1,
            supplierId: sup2,
            relationshipId: relOtherSupplierId,
            number: "HD-SUP2-05",
            status: "ACTIVE",
            signedOn: new Date("2026-11-11"),
            startsOn: new Date("2026-11-11"),
            endsOn: new Date("2026-12-31"),
            snapshot: { internalOnly: "do-not-expose" },
            createdByUserId: managerA,
            activatedByUserId: managerA,
            activatedAt: new Date("2026-11-11T08:00:00.000Z"),
            createdAt: new Date("2026-11-11T08:00:00.000Z"),
          },
          {
            id: cOtherSchool,
            schoolId: sch2,
            supplierId: sup1,
            relationshipId: relOtherSchoolId,
            number: "HD-SCH2-06",
            status: "ACTIVE",
            signedOn: new Date("2026-11-12"),
            startsOn: new Date("2026-11-12"),
            endsOn: new Date("2026-12-31"),
            snapshot: { internalOnly: "do-not-expose" },
            createdByUserId: managerA,
            activatedByUserId: managerA,
            activatedAt: new Date("2026-11-12T08:00:00.000Z"),
            createdAt: new Date("2026-11-12T08:00:00.000Z"),
          },
        ],
      });

      await db.supplierContractItem.createMany({
        data: [
          { contractId: cActiveFuture, ingredientId: ingActiveId },
          { contractId: cActiveFuture, ingredientId: ingInactiveId },
          { contractId: cClosedLegacy, ingredientId: ingInactiveId },
          { contractId: cOtherSupplier, ingredientId: ingSup2Id },
        ],
      });

      const pdfBytes = Buffer.from("%PDF-1.4\nSigned contract bytes");
      const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1]);
      const jpegBytes = Buffer.from([255, 216, 255, 224, 0, 16, 74, 70]);
      const complianceBytes = Buffer.from("%PDF-1.4\nPrivate compliance");
      const draftDocBytes = Buffer.from("%PDF-1.4\nPrivate draft");

      const docSignedPdf = "90000000-0000-4000-8000-000000000001";
      const docAppendixPng = "90000000-0000-4000-8000-000000000002";
      const docAppendixJpeg = "90000000-0000-4000-8000-000000000003";
      const docCompliance = "90000000-0000-4000-8000-000000000004";
      const docDraft = "90000000-0000-4000-8000-000000000005";
      const docOtherSupplier = "90000000-0000-4000-8000-000000000006";
      const docOtherSchool = "90000000-0000-4000-8000-000000000007";

      await db.supplierContractDocument.createMany({
        data: [
          {
            id: docSignedPdf,
            contractId: cActiveFuture,
            kind: "SIGNED_CONTRACT",
            fileName: "Hợp đồng đã ký (2026).pdf",
            mimeType: "application/pdf",
            size: pdfBytes.length,
            sha256: "a".repeat(64),
            content: pdfBytes,
            uploadedByUserId: managerA,
            createdAt: new Date("2026-11-10T08:01:00.000Z"),
          },
          {
            id: docAppendixPng,
            contractId: cActiveFuture,
            kind: "APPENDIX",
            fileName: "Phụ lục 1.png",
            mimeType: "image/png",
            size: pngBytes.length,
            sha256: "b".repeat(64),
            content: pngBytes,
            uploadedByUserId: managerA,
            createdAt: new Date("2026-11-10T08:02:00.000Z"),
          },
          {
            id: docAppendixJpeg,
            contractId: cActiveFuture,
            kind: "APPENDIX",
            fileName: "Phụ lục 2.jpg",
            mimeType: "image/jpeg",
            size: jpegBytes.length,
            sha256: "c".repeat(64),
            content: jpegBytes,
            uploadedByUserId: managerA,
            createdAt: new Date("2026-11-10T08:03:00.000Z"),
          },
          {
            id: docCompliance,
            contractId: cActiveFuture,
            kind: "COMPLIANCE",
            fileName: "compliance.pdf",
            mimeType: "application/pdf",
            size: complianceBytes.length,
            sha256: "d".repeat(64),
            content: complianceBytes,
            uploadedByUserId: managerA,
            createdAt: new Date("2026-11-10T08:04:00.000Z"),
          },
          {
            id: docDraft,
            contractId: cDraft,
            kind: "SIGNED_CONTRACT",
            fileName: "draft.pdf",
            mimeType: "application/pdf",
            size: draftDocBytes.length,
            sha256: "e".repeat(64),
            content: draftDocBytes,
            uploadedByUserId: managerA,
          },
          {
            id: docOtherSupplier,
            contractId: cOtherSupplier,
            kind: "SIGNED_CONTRACT",
            fileName: "sup2.pdf",
            mimeType: "application/pdf",
            size: pdfBytes.length,
            sha256: "f".repeat(64),
            content: pdfBytes,
            uploadedByUserId: managerA,
          },
          {
            id: docOtherSchool,
            contractId: cOtherSchool,
            kind: "SIGNED_CONTRACT",
            fileName: "sch2.pdf",
            mimeType: "application/pdf",
            size: pdfBytes.length,
            sha256: "0".repeat(64),
            content: pdfBytes,
            uploadedByUserId: managerA,
          },
        ],
      });

      // 1. Direct contract list traversal (limit=1) without calling school list/detail first
      const collectedContracts: Record<string, unknown>[] = [];
      for (let page = 1; ; page++) {
        const res = await call(
          `/supplier-schools/${sch1}/contracts?page=${page}&limit=1`,
          token1,
        );
        assert.equal(res.status, 200);
        const items = res.data.items as Record<string, unknown>[];
        collectedContracts.push(...items);
        if (!record(res.data.pagination).hasNext) break;
      }
      assert.deepEqual(
        collectedContracts.map((c) => c.id),
        [cActiveFuture, cActiveExpired, cClosedLegacy],
      );
      assert.equal(collectedContracts[0].startsOn, "2099-01-01");
      assert.equal(collectedContracts[1].endsOn, "2020-12-31");
      assert.equal(collectedContracts[2].status, "CLOSED");
      assert.equal(collectedContracts[2].closeReason, "Kết thúc đợt 1");

      // Ingredients sorted id ASC, includes INACTIVE ingredient
      assert.deepEqual(collectedContracts[0].ingredients, [
        { id: ingInactiveId, name: "Đậu xanh (đã ẩn)" },
        { id: ingActiveId, name: "Gạo thơm" },
      ]);
      // Documents include only SIGNED_CONTRACT & APPENDIX in createdAt ASC order
      const docs = collectedContracts[0].documents as Record<string, unknown>[];
      assert.deepEqual(
        docs.map((d) => d.id),
        [docSignedPdf, docAppendixPng, docAppendixJpeg],
      );

      // Valid linked school without contracts -> 200 items=[]
      const noContractsRes = await call(
        `/supplier-schools/${schNoContract}/contracts`,
        token1,
      );
      assert.equal(noContractsRes.status, 200);
      assert.deepEqual(noContractsRes.data, {
        items: [],
        pagination: { page: 1, limit: 20, hasNext: false },
      });

      // DRAFT-only school / non-linked school -> 404
      assert.equal(
        (await call(`/supplier-schools/${schDraftOnly}/contracts`, token1))
          .status,
        404,
      );

      // 2. Direct contract detail & cross-scope/DRAFT 404
      const detailOk = await call(
        `/supplier-schools/${sch1}/contracts/${cClosedLegacy}`,
        token1,
      );
      assert.equal(detailOk.status, 200);
      assert.equal(detailOk.data.number, "HD-LEGACY-01");

      for (const forbiddenUrl of [
        `/supplier-schools/${sch1}/contracts/${cDraft}`,
        `/supplier-schools/${sch1}/contracts/${cOtherSupplier}`,
        `/supplier-schools/${sch1}/contracts/${cOtherSchool}`,
        `/supplier-schools/${sch2}/contracts/${cActiveFuture}`,
        `/supplier-schools/${sch1}/contracts/${cActiveFuture}`, // viewed by sup2 below
      ]) {
        const actorToken =
          forbiddenUrl.endsWith(cActiveFuture) && forbiddenUrl.includes(sch1)
            ? token2
            : token1;
        assert.equal((await call(forbiddenUrl, actorToken)).status, 404);
      }

      // 3. Direct binary download (inline + attachment) for PDF, PNG, JPEG and 404 for COMPLIANCE/DRAFT/cross-pair
      const fetchRaw = async (urlPath: string, cookie: string) =>
        fetch(base + urlPath, { headers: { Cookie: cookie } });

      for (const [docId, expectedMime, expectedBytes] of [
        [docSignedPdf, "application/pdf", pdfBytes],
        [docAppendixPng, "image/png", pngBytes],
        [docAppendixJpeg, "image/jpeg", jpegBytes],
      ] as const) {
        const inlineRes = await fetchRaw(
          `/supplier-schools/${sch1}/contracts/${cActiveFuture}/documents/${docId}`,
          token1,
        );
        assert.equal(inlineRes.status, 200);
        assert.equal(inlineRes.headers.get("content-type"), expectedMime);
        assert.equal(
          inlineRes.headers.get("content-length"),
          String(expectedBytes.length),
        );
        assert.equal(
          inlineRes.headers.get("x-content-type-options"),
          "nosniff",
        );
        assert.equal(
          inlineRes.headers.get("content-security-policy"),
          "sandbox",
        );
        assert.equal(
          inlineRes.headers.get("cache-control"),
          "private, no-store",
        );
        assert.deepEqual(
          Buffer.from(await inlineRes.arrayBuffer()),
          expectedBytes,
        );

        const attachRes = await fetchRaw(
          `/supplier-schools/${sch1}/contracts/${cActiveFuture}/documents/${docId}?disposition=attachment`,
          token1,
        );
        assert.equal(attachRes.status, 200);
        assert(
          (attachRes.headers.get("content-disposition") ?? "").startsWith(
            "attachment;",
          ),
        );
        assert.deepEqual(
          Buffer.from(await attachRes.arrayBuffer()),
          expectedBytes,
        );
      }

      for (const [urlPath, cookie] of [
        [
          `/supplier-schools/${sch1}/contracts/${cActiveFuture}/documents/${docCompliance}`,
          token1,
        ],
        [
          `/supplier-schools/${sch1}/contracts/${cDraft}/documents/${docDraft}`,
          token1,
        ],
        [
          `/supplier-schools/${sch1}/contracts/${cOtherSupplier}/documents/${docOtherSupplier}`,
          token1,
        ],
        [
          `/supplier-schools/${sch1}/contracts/${cOtherSchool}/documents/${docOtherSchool}`,
          token1,
        ],
        [
          `/supplier-schools/${sch2}/contracts/${cActiveFuture}/documents/${docSignedPdf}`,
          token1,
        ],
        [
          `/supplier-schools/${sch1}/contracts/${cActiveFuture}/documents/${docSignedPdf}`,
          token2,
        ],
      ] as const) {
        const denied = await fetchRaw(urlPath, cookie);
        assert.equal(denied.status, 404, urlPath);
      }
    },
  );
  await context.test(
    "supplier-linked-schools does not mutate data and preserves school-side contract, document and relationship compatibility",
    async () => {
      const adminA = await login("ingredient-admin@test.local");
      const relBefore = await db.schoolSupplierRelationship.findMany({
        orderBy: { id: "asc" },
      });
      const contractsBefore = await db.supplierContract.findMany({
        orderBy: { id: "asc" },
      });
      const docsBefore = await db.supplierContractDocument.findMany({
        select: {
          id: true,
          contractId: true,
          kind: true,
          fileName: true,
          mimeType: true,
          size: true,
          sha256: true,
          uploadedByUserId: true,
          createdAt: true,
        },
        orderBy: { id: "asc" },
      });
      const eventsBefore = await db.supplierRelationshipEvent.findMany({
        orderBy: { id: "asc" },
      });

      // Invoke all 5 read endpoints (list, detail, contract list, contract detail, inline & attachment document)
      const listRes = await call("/supplier-schools", adminA);
      assert.equal(listRes.status, 200);
      assert.equal(
        (await call(`/supplier-schools/${schoolA}`, adminA)).status,
        200,
      );
      const contractsRes = await call(
        `/supplier-schools/${schoolA}/contracts`,
        adminA,
      );
      assert.equal(contractsRes.status, 200);
      const contractItems = contractsRes.data.items as Record<
        string,
        unknown
      >[];
      assert(contractItems.length >= 1);
      const targetContractId = contractItems[0].id as string;
      const targetDocs = contractItems[0].documents as Record<
        string,
        unknown
      >[];
      assert(targetDocs.length >= 1);
      const targetDocId = targetDocs[0].id as string;
      assert.equal(
        (
          await call(
            `/supplier-schools/${schoolA}/contracts/${targetContractId}`,
            adminA,
          )
        ).status,
        200,
      );
      for (const disp of ["inline", "attachment"]) {
        const docFetch = await fetch(
          `${base}/supplier-schools/${schoolA}/contracts/${targetContractId}/documents/${targetDocId}?disposition=${disp}`,
          { headers: { Cookie: adminA } },
        );
        assert.equal(docFetch.status, 200);
        await docFetch.arrayBuffer();
      }

      // Assert zero writes/mutations across relationships, contracts, documents, and events
      assert.deepEqual(
        await db.schoolSupplierRelationship.findMany({
          orderBy: { id: "asc" },
        }),
        relBefore,
      );
      assert.deepEqual(
        await db.supplierContract.findMany({ orderBy: { id: "asc" } }),
        contractsBefore,
      );
      assert.deepEqual(
        await db.supplierContractDocument.findMany({
          select: {
            id: true,
            contractId: true,
            kind: true,
            fileName: true,
            mimeType: true,
            size: true,
            sha256: true,
            uploadedByUserId: true,
            createdAt: true,
          },
          orderBy: { id: "asc" },
        }),
        docsBefore,
      );
      assert.deepEqual(
        await db.supplierRelationshipEvent.findMany({ orderBy: { id: "asc" } }),
        eventsBefore,
      );

      // School-side endpoints & lifecycle transitions keep their existing scope & behavior
      assert.equal(
        (await call(`/supplier-contracts/${targetContractId}`, tokenA)).status,
        200,
      );
      assert.equal(
        (await call(`/supplier-contracts/${targetContractId}`, tokenB)).status,
        404,
      );
      assert.equal(
        (await call(`/supplier-contracts/${targetContractId}`, adminA)).status,
        403,
      );
      assert.equal(
        (
          await fetch(`${base}/supplier-contract-documents/${targetDocId}`, {
            headers: { Cookie: adminA },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(`${base}/supplier-contract-documents/${targetDocId}`, {
            headers: { Cookie: tokenA },
          })
        ).status,
        200,
      );
      const schoolPartners = await call("/supplier-partnerships", tokenA);
      assert.equal(schoolPartners.status, 200);
      const activePartner = (
        schoolPartners.data.items as { id: string; status: string }[]
      ).find((p) => p.status === "ACTIVE");
      assert(activePartner);
      assert.equal(
        (
          await call(
            `/supplier-partnerships/${activePartner.id}/suspend`,
            tokenA,
            "POST",
            { reason: "Compatibility check suspend" },
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await call(
            `/supplier-partnerships/${activePartner.id}/resume`,
            tokenA,
            "POST",
            { reason: "Compatibility check resume" },
          )
        ).status,
        200,
      );
    },
  );

  // Shared producer-contract fixture helper for T006/US1/US2/US3 tests:
  // Proves storage/sequence/formatter contract only — BGH HTTP creator & default grants remain outside scope.
  const feedbackRepoFixture = createIngredientQualityFeedbackRepository();
  async function createComplaintViaProducerContract(input: {
    id?: string;
    deliveryId: string;
    ingredientLotId?: string | null;
    submittedByUserId: string;
    title: string;
    description: string;
    status?: "SUBMITTED" | "RESPONDED";
    supplierResponse?: string | null;
    respondedByUserId?: string | null;
    respondedAt?: Date | null;
    createdAt?: Date;
    updatedAt?: Date;
  }) {
    // Ticket model (specs/complaint-supertype): SUBMITTED cũ ↔ NEW; RESPONDED cũ ↔ RESOLVED + bình luận RESOLUTION.
    return db.$transaction(async (tx) => {
      const complaintCode = await feedbackRepoFixture.allocateComplaintCode(tx);
      const sender = await tx.user.findUniqueOrThrow({
        where: { id: input.submittedByUserId },
        select: { roleCode: true, schoolId: true },
      });
      const responded = input.status === "RESPONDED";
      const row = await tx.complaint.create({
        data: {
          ...(input.id ? { id: input.id } : {}),
          kind: "INGREDIENT",
          code: complaintCode,
          title: input.title,
          description: input.description,
          senderUserId: input.submittedByUserId,
          senderRoleCode: sender.roleCode,
          senderSchoolId: sender.schoolId,
          status: responded ? "RESOLVED" : "NEW",
          ...(responded
            ? {
                lastResolvedAt: input.respondedAt ?? new Date(),
                resolvedCount: 1,
              }
            : {}),
          ...(input.createdAt ? { submittedAt: input.createdAt } : {}),
          ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
          ingredientQualityFeedback: {
            create: {
              deliveryId: input.deliveryId,
              ingredientLotId: input.ingredientLotId ?? null,
              issueType: "SPOILED_OR_NOT_FRESH",
            },
          },
        },
      });
      if (responded && input.respondedByUserId && input.supplierResponse) {
        const responder = await tx.user.findUniqueOrThrow({
          where: { id: input.respondedByUserId },
          select: { roleCode: true },
        });
        await tx.complaintComment.create({
          data: {
            complaintId: row.id,
            authorUserId: input.respondedByUserId,
            authorRoleCode: responder.roleCode,
            authorSide: "HANDLER",
            commentType: "RESOLUTION",
            content: input.supplierResponse,
          },
        });
      }
      return {
        id: row.id,
        complaintCode: row.code,
        title: row.title,
        description: row.description,
        submittedByUserId: row.senderUserId,
        createdAt: row.submittedAt,
        updatedAt: row.updatedAt,
      };
    });
  }

  await context.test(
    "complaint-code producer contract allocates globally unique FP-CP codes across schools in-tx and allows rollback gaps (fixture contract only, not BGH HTTP creator)",
    async () => {
      const supRole = await db.role.findUniqueOrThrow({
        where: { code: "INGREDIENT_SUPPLIER_ADMIN" },
      });
      const schRole = await db.role.findUniqueOrThrow({
        where: { code: "SCHOOL_KITCHEN_STAFF" },
      });
      const contractSup = await db.supplier.create({
        data: { name: "Producer Contract Supplier" },
      });
      const contractSch1 = await db.school.create({
        data: { name: "Producer Contract School 1", code: "PCS-1" },
      });
      const contractSch2 = await db.school.create({
        data: { name: "Producer Contract School 2", code: null },
      });
      const supActor = await db.user.create({
        data: {
          roleId: supRole.id,
          roleCode: supRole.code,
          supplierId: contractSup.id,
          username: `pc-sup-${randomUUID().slice(0, 8)}`,
          email: `pc-sup-${randomUUID().slice(0, 8)}@test.local`,
          passwordHash,
          fullName: "PC Supplier Admin",
          status: "ACTIVE",
        },
      });
      const schActor1 = await db.user.create({
        data: {
          roleId: schRole.id,
          roleCode: schRole.code,
          schoolId: contractSch1.id,
          username: `pc-sch1-${randomUUID().slice(0, 8)}`,
          email: `pc-sch1-${randomUUID().slice(0, 8)}@test.local`,
          passwordHash,
          fullName: "PC School 1 Staff",
          status: "ACTIVE",
        },
      });
      const schActor2 = await db.user.create({
        data: {
          roleId: schRole.id,
          roleCode: schRole.code,
          schoolId: contractSch2.id,
          username: `pc-sch2-${randomUUID().slice(0, 8)}`,
          email: `pc-sch2-${randomUUID().slice(0, 8)}@test.local`,
          passwordHash,
          fullName: "PC School 2 Staff",
          status: "ACTIVE",
        },
      });
      const del1 = await db.delivery.create({
        data: {
          deliveryNo: `FP-DE-PC1-${randomUUID().slice(0, 6)}`,
          schoolId: contractSch1.id,
          supplierId: contractSup.id,
          creationMode: "STANDALONE",
          creationKey: randomUUID(),
          creationFingerprint: "c".repeat(64),
          createdByUserId: supActor.id,
          status: "RECEIVED",
          receivedAt: new Date("2026-09-10T08:00:00Z"),
          receivedByUserId: schActor1.id,
        },
      });
      const del2 = await db.delivery.create({
        data: {
          deliveryNo: `FP-DE-PC2-${randomUUID().slice(0, 6)}`,
          schoolId: contractSch2.id,
          supplierId: contractSup.id,
          creationMode: "STANDALONE",
          creationKey: randomUUID(),
          creationFingerprint: "d".repeat(64),
          createdByUserId: supActor.id,
          status: "RECEIVED",
          receivedAt: new Date("2026-09-10T08:00:00Z"),
          receivedByUserId: schActor2.id,
        },
      });

      const created = await Promise.all([
        createComplaintViaProducerContract({
          deliveryId: del1.id,
          submittedByUserId: schActor1.id,
          title: "School 1 complaint",
          description: "Allocated across schools concurrently",
        }),
        createComplaintViaProducerContract({
          deliveryId: del2.id,
          submittedByUserId: schActor2.id,
          title: "School 2 complaint",
          description: "Allocated across schools concurrently",
        }),
      ]);
      assert.equal(new Set(created.map((c) => c.id)).size, 2);
      assert.equal(new Set(created.map((c) => c.complaintCode)).size, 2);
      for (const c of created) {
        assert.match(c.complaintCode, /^FP-CP-[0-9]{5}$/);
        assert.notEqual(c.complaintCode, "FP-CP-00000");
      }

      // Rolled-back transaction must not persist the complaint row; the counter rolls back with it.
      const rolledBackId = randomUUID();
      let rolledBackCode = "";
      await assert.rejects(
        db.$transaction(async (tx) => {
          rolledBackCode = await feedbackRepoFixture.allocateComplaintCode(tx);
          await tx.complaint.create({
            data: {
              id: rolledBackId,
              kind: "INGREDIENT",
              code: rolledBackCode,
              senderUserId: schActor1.id,
              senderRoleCode: schActor1.roleCode,
              title: "Rolled back complaint",
              description: "Must not persist",
              ingredientQualityFeedback: {
                create: { deliveryId: del1.id, issueType: "OTHER" },
              },
            },
          });
          throw new Error("SIMULATED_PRODUCER_ROLLBACK");
        }),
        /SIMULATED_PRODUCER_ROLLBACK/,
      );
      assert.equal(
        await db.complaint.findUnique({ where: { id: rolledBackId } }),
        null,
      );

      const afterRollback = await createComplaintViaProducerContract({
        deliveryId: del2.id,
        submittedByUserId: schActor2.id,
        title: "After rollback",
        description: "Consumes next global sequence leaving gap",
      });
      // Bộ đếm rollback cùng transaction nên mã của lần thất bại được cấp lại, không trùng mã đã có.
      assert.equal(afterRollback.complaintCode, rolledBackCode);
      assert(
        !created.some((c) => c.complaintCode === afterRollback.complaintCode),
      );
      const reloaded = await db.complaint.findUniqueOrThrow({
        where: { id: afterRollback.id },
      });
      assert.equal(reloaded.code, afterRollback.complaintCode);
    },
  );

  await context.test(
    "US1 supplier complaint list enforces delivery isolation across shared schools/historical links, preserves deterministic pagination and never allocates sequence numbers",
    async () => {
      const supAdminRole = await db.role.findUniqueOrThrow({
        where: { code: "INGREDIENT_SUPPLIER_ADMIN" },
      });
      const supStaffRole = await db.role.findUniqueOrThrow({
        where: { code: "INGREDIENT_SUPPLIER_STAFF" },
      });
      const schRole = await db.role.findUniqueOrThrow({
        where: { code: "SCHOOL_KITCHEN_STAFF" },
      });
      const supA = await db.supplier.create({
        data: { name: "US1 Complaint Supplier A" },
      });
      const supB = await db.supplier.create({
        data: { name: "US1 Complaint Supplier B" },
      });
      const schX = await db.school.create({
        data: { name: "US1 School X", code: "SCH-SAME" },
      });
      const schY = await db.school.create({
        data: { name: "US1 School Y", code: null },
      });
      const schU = await db.school.create({
        data: {
          name: "US1 School U Inactive",
          code: "SCH-UNLINKED",
          status: "INACTIVE",
        },
      });
      const createTestUser = async (
        roleId: string,
        roleCode: string,
        prefix: string,
        org: { schoolId?: string; supplierId?: string },
      ) =>
        withEmail(
          await db.user.create({
            data: {
              roleId,
              roleCode,
              schoolId: org.schoolId ?? null,
              supplierId: org.supplierId ?? null,
              username: `${prefix}-${randomUUID().slice(0, 8)}`,
              email: `${prefix}-${randomUUID().slice(0, 8)}@test.local`,
              passwordHash,
              fullName: prefix,
              status: "ACTIVE",
            },
          }),
        );
      const supAdminUserA = await createTestUser(
        supAdminRole.id,
        supAdminRole.code,
        "us1-supA-admin",
        { supplierId: supA.id },
      );
      const supStaffUserA = await createTestUser(
        supStaffRole.id,
        supStaffRole.code,
        "us1-supA-staff",
        { supplierId: supA.id },
      );
      const supAdminUserB = await createTestUser(
        supAdminRole.id,
        supAdminRole.code,
        "us1-supB-admin",
        { supplierId: supB.id },
      );
      const schUserX1 = await createTestUser(
        schRole.id,
        schRole.code,
        "us1-schX-1",
        { schoolId: schX.id },
      );
      const schUserX2 = await createTestUser(
        schRole.id,
        schRole.code,
        "us1-schX-2",
        { schoolId: schX.id },
      );
      const schUserY = await createTestUser(
        schRole.id,
        schRole.code,
        "us1-schY",
        { schoolId: schY.id },
      );
      const schUserU = await createTestUser(
        schRole.id,
        schRole.code,
        "us1-schU",
        { schoolId: schU.id },
      );

      // Historical relationships + expired contract must not block reading complaints on past deliveries.
      const relActive = await db.schoolSupplierRelationship.create({
        data: {
          schoolId: schX.id,
          supplierId: supA.id,
          status: "ACTIVE",
          linkedAt: new Date("2026-09-01T00:00:00Z"),
        },
      });
      await db.schoolSupplierRelationship.create({
        data: {
          schoolId: schX.id,
          supplierId: supB.id,
          status: "ACTIVE",
          linkedAt: new Date("2026-09-01T00:00:00Z"),
        },
      });
      await db.schoolSupplierRelationship.create({
        data: {
          schoolId: schY.id,
          supplierId: supA.id,
          status: "SUSPENDED",
          linkedAt: new Date("2026-09-01T00:00:00Z"),
          suspendedAt: new Date("2026-09-10T00:00:00Z"),
          suspensionReason: "Temporary pause",
        },
      });
      const relUnlinked = await db.schoolSupplierRelationship.create({
        data: {
          schoolId: schU.id,
          supplierId: supA.id,
          status: "UNLINKED",
          linkedAt: new Date("2026-08-01T00:00:00Z"),
          unlinkedAt: new Date("2026-09-01T00:00:00Z"),
          unlinkReason: "Contract ended",
        },
      });
      await db.supplierContract.create({
        data: {
          relationshipId: relUnlinked.id,
          schoolId: schU.id,
          supplierId: supA.id,
          createdByUserId: schUserU.id,
          status: "CLOSED",
          number: `HD-US1-${randomUUID().slice(0, 6)}`,
          signedOn: new Date("2024-12-20"),
          startsOn: new Date("2025-01-01"),
          endsOn: new Date("2025-12-31"),
          activatedAt: new Date("2025-01-01T00:00:00Z"),
          activatedByUserId: schUserU.id,
          snapshot: { legacy: true },
          closedAt: new Date("2026-01-01T00:00:00Z"),
          closeReason: "Expired agreement",
        },
      });
      void relActive;

      const makeDelivery = async (
        schoolId: string,
        supplierId: string,
        creatorId: string,
        receiverId: string,
        no: string,
      ) =>
        db.delivery.create({
          data: {
            deliveryNo: no,
            schoolId,
            supplierId,
            creationMode: "STANDALONE",
            creationKey: randomUUID(),
            creationFingerprint: "e".repeat(64),
            createdByUserId: creatorId,
            status: "RECEIVED",
            receivedAt: new Date("2026-09-10T08:00:00Z"),
            receivedByUserId: receiverId,
          },
        });
      const delXA = await makeDelivery(
        schX.id,
        supA.id,
        supAdminUserA.id,
        schUserX1.id,
        "FP-DE-50001",
      );
      const delXB = await makeDelivery(
        schX.id,
        supB.id,
        supAdminUserB.id,
        schUserX2.id,
        "FP-DE-50001",
      );
      const delYA = await makeDelivery(
        schY.id,
        supA.id,
        supAdminUserA.id,
        schUserY.id,
        "FP-DE-50002",
      );
      const delUA = await makeDelivery(
        schU.id,
        supA.id,
        supAdminUserA.id,
        schUserU.id,
        "FP-DE-50003",
      );

      // Build 5 complaints for supA (including tied createdAt timestamps) + 1 for supB on shared school X.
      const tiedTime = new Date("2026-10-15T10:00:00.000Z");
      const aTieHigh = await createComplaintViaProducerContract({
        id: "70000000-0000-4000-8000-00000000000c",
        deliveryId: delXA.id,
        submittedByUserId: schUserX1.id,
        title: "Tied timestamp high id",
        description: "desc",
        createdAt: tiedTime,
        updatedAt: tiedTime,
      });
      const aTieLow = await createComplaintViaProducerContract({
        id: "70000000-0000-4000-8000-00000000000a",
        deliveryId: delXA.id,
        submittedByUserId: schUserX2.id,
        title: "Tied timestamp low id (different submitter)",
        description: "desc",
        status: "RESPONDED",
        supplierResponse: "Đã xử lý đổi lô",
        respondedByUserId: supAdminUserA.id,
        respondedAt: new Date("2026-10-15T11:00:00.000Z"),
        createdAt: tiedTime,
        updatedAt: new Date("2026-10-15T11:00:00.000Z"),
      });
      const aNewest = await createComplaintViaProducerContract({
        deliveryId: delYA.id,
        submittedByUserId: schUserY.id,
        title: "Suspended rel & null school code",
        description: "desc",
        createdAt: new Date("2026-10-16T10:00:00.000Z"),
        updatedAt: new Date("2026-10-16T10:00:00.000Z"),
      });
      const aOldest1 = await createComplaintViaProducerContract({
        deliveryId: delUA.id,
        submittedByUserId: schUserU.id,
        title: "Unlinked school inactive & expired contract",
        description: "desc",
        createdAt: new Date("2026-10-14T10:00:00.000Z"),
        updatedAt: new Date("2026-10-14T10:00:00.000Z"),
      });
      const aOldest2 = await createComplaintViaProducerContract({
        deliveryId: delXA.id,
        submittedByUserId: schUserX1.id,
        title: "Fifth page-3 item",
        description: "desc",
        createdAt: new Date("2026-10-13T10:00:00.000Z"),
        updatedAt: new Date("2026-10-13T10:00:00.000Z"),
      });
      const foreignB = await createComplaintViaProducerContract({
        deliveryId: delXB.id,
        submittedByUserId: schUserX1.id,
        title: "Shared school X complaint belonging to supplier B",
        description: "Must never leak to A",
        createdAt: new Date("2026-10-17T10:00:00.000Z"),
        updatedAt: new Date("2026-10-17T10:00:00.000Z"),
      });
      assert.equal(
        new Set([
          aTieHigh.complaintCode,
          aTieLow.complaintCode,
          aNewest.complaintCode,
          aOldest1.complaintCode,
          aOldest2.complaintCode,
          foreignB.complaintCode,
        ]).size,
        6,
      );

      const supACookie = await login(supAdminUserA.email);
      const supAStaffCookie = await login(supStaffUserA.email);
      const supBCookie = await login(supAdminUserB.email);

      const seqBefore = await db.$queryRaw<
        { code_type: string; last_sequence: number }[]
      >`SELECT code_type, last_sequence FROM foodprint.business_code_counters WHERE code_type = 'CP'`;

      for (const cookie of [supACookie, supAStaffCookie]) {
        const collected: Record<string, unknown>[] = [];
        for (let page = 1; ; page++) {
          const res = await call(
            `/ingredient-quality-feedback?page=${page}&limit=2`,
            cookie,
          );
          assert.equal(res.status, 200);
          const items = res.data.items as Record<string, unknown>[];
          collected.push(...items);
          if (!record(res.data.pagination).hasNext) break;
        }
        assert.deepEqual(
          collected.map((i) => ({ id: i.id, complaintCode: i.code })),
          [
            { id: aNewest.id, complaintCode: aNewest.complaintCode },
            { id: aTieLow.id, complaintCode: aTieLow.complaintCode },
            { id: aTieHigh.id, complaintCode: aTieHigh.complaintCode },
            { id: aOldest1.id, complaintCode: aOldest1.complaintCode },
            { id: aOldest2.id, complaintCode: aOldest2.complaintCode },
          ],
        );
        assert(!collected.some((i) => i.id === foreignB.id));
        assert.equal(record(collected[0].school).code, null);
        assert.equal(record(collected[1].school).code, "SCH-SAME");
        assert.equal(record(collected[3].school).code, "SCH-UNLINKED");
        assert.equal(collected[1].status, "RESOLVED");
        const beyond = await call(
          "/ingredient-quality-feedback?page=99&limit=2",
          cookie,
        );
        assert.equal(beyond.status, 200);
        assert.deepEqual(beyond.data, {
          items: [],
          pagination: { page: 99, limit: 2, hasNext: false },
        });
      }

      const bRes = await call("/ingredient-quality-feedback", supBCookie);
      assert.equal(bRes.status, 200);
      assert.deepEqual(
        (bRes.data.items as Record<string, unknown>[]).map((i) => ({
          id: i.id,
          complaintCode: i.code,
        })),
        [{ id: foreignB.id, complaintCode: foreignB.complaintCode }],
      );

      // Verify empty supplier sees valid empty page
      const supEmpty = await db.supplier.create({
        data: { name: "US1 Empty Supplier" },
      });
      const supEmptyUser = await createTestUser(
        supAdminRole.id,
        supAdminRole.code,
        "us1-sup-empty",
        { supplierId: supEmpty.id },
      );
      const emptyRes = await call(
        "/ingredient-quality-feedback",
        await login(supEmptyUser.email),
      );
      assert.equal(emptyRes.status, 200);
      assert.deepEqual(emptyRes.data, {
        items: [],
        pagination: { page: 1, limit: 20, hasNext: false },
      });

      const seqAfter = await db.$queryRaw<
        { code_type: string; last_sequence: number }[]
      >`SELECT code_type, last_sequence FROM foodprint.business_code_counters WHERE code_type = 'CP'`;
      assert.deepEqual(seqAfter, seqBefore);
    },
  );

  await context.test(
    "US2 detail enforces lot-delivery guard, SCHOOL own/details readback with original code, historical author/responder identities, and zero mutations on GET",
    async () => {
      const supAdminRole = await db.role.findUniqueOrThrow({
        where: { code: "INGREDIENT_SUPPLIER_ADMIN" },
      });
      const schBoardRole = await db.role.findUniqueOrThrow({
        where: { code: "SCHOOL_MANAGEMENT_BOARD" },
      });
      const schKitchenRole = await db.role.findUniqueOrThrow({
        where: { code: "SCHOOL_KITCHEN_STAFF" },
      });
      const schTeacherRole = await db.role.findUniqueOrThrow({
        where: { code: "HOMEROOM_TEACHER" },
      });
      const sup1 = await db.supplier.create({
        data: { name: "US2 Detail Supplier 1" },
      });
      const sup2 = await db.supplier.create({
        data: { name: "US2 Detail Supplier 2" },
      });
      const sch1 = await db.school.create({
        data: { name: "US2 Detail School 1", code: "SCH-US2" },
      });
      const sch2 = await db.school.create({
        data: { name: "US2 Detail School 2", code: "SCH-US2-O" },
      });
      const mkUser = async (
        roleId: string,
        roleCode: string,
        tag: string,
        org: { schoolId?: string; supplierId?: string },
      ) =>
        withEmail(
          await db.user.create({
            data: {
              roleId,
              roleCode,
              schoolId: org.schoolId ?? null,
              supplierId: org.supplierId ?? null,
              username: `${tag}-${randomUUID().slice(0, 8)}`,
              email: `${tag}-${randomUUID().slice(0, 8)}@test.local`,
              passwordHash,
              fullName: tag,
              status: "ACTIVE",
            },
          }),
        );
      const supStaffRole = await db.role.findUniqueOrThrow({
        where: { code: "INGREDIENT_SUPPLIER_STAFF" },
      });
      const supAdmin1 = await mkUser(
        supAdminRole.id,
        supAdminRole.code,
        "us2-sup1-admin",
        { supplierId: sup1.id },
      );
      const lockedResponder1 = await mkUser(
        supStaffRole.id,
        supStaffRole.code,
        "us2-sup1-former-responder",
        { supplierId: sup2.id },
      );
      const supAdmin2 = await mkUser(
        supAdminRole.id,
        supAdminRole.code,
        "us2-sup2-admin",
        { supplierId: sup2.id },
      );
      await db.user.update({
        where: { id: lockedResponder1.id },
        data: {
          status: "LOCKED",
        },
      });
      const submitter1 = await mkUser(
        schKitchenRole.id,
        schKitchenRole.code,
        "us2-submitter-own",
        { schoolId: sch1.id },
      );
      // Transfer submitter1's current school to sch2 later? Check historical identity preserved & no sch2 grant!
      // Q11 (specs/ingredient-feedback-submission): BGH là vai trò mặc định xem toàn trường.
      const peerViewer1 = await mkUser(
        schBoardRole.id,
        schBoardRole.code,
        "us2-peer-details",
        { schoolId: sch1.id },
      );
      // Grant view_details vs view_own via denials on US2 actors
      const viewDetailsPerm = await db.permission.findUniqueOrThrow({
        where: { code: "ingredient_quality_feedback.view_details" },
      });
      const viewOwnPerm = await db.permission.findUniqueOrThrow({
        where: { code: "ingredient_quality_feedback.view_own" },
      });
      void viewOwnPerm;
      // Disable view_details for submitter1 in sch1 so submitter1 has ONLY view_own!
      await db.userPermissionDenial.create({
        data: {
          userId: submitter1.id,
          permissionId: viewDetailsPerm.id,
          schoolId: sch1.id,
          disabledByUserId: peerViewer1.id,
        },
      });
      const peerOwnOnly = await mkUser(
        schKitchenRole.id,
        schKitchenRole.code,
        "us2-peer-own-only",
        { schoolId: sch1.id },
      );
      await db.userPermissionDenial.create({
        data: {
          userId: peerOwnOnly.id,
          permissionId: viewDetailsPerm.id,
          schoolId: sch1.id,
          disabledByUserId: peerViewer1.id,
        },
      });
      const otherSchoolViewer = await mkUser(
        schBoardRole.id,
        schBoardRole.code,
        "us2-sch2-board",
        { schoolId: sch2.id },
      );
      void schTeacherRole;
      void otherSchoolViewer;
      const sch2Kitchen = await mkUser(
        schKitchenRole.id,
        schKitchenRole.code,
        "us2-sch2-kitchen",
        { schoolId: sch2.id },
      );

      // Historical unlinked relationship
      await db.schoolSupplierRelationship.create({
        data: {
          schoolId: sch1.id,
          supplierId: sup1.id,
          status: "UNLINKED",
          linkedAt: new Date("2026-08-01T00:00:00Z"),
          unlinkedAt: new Date("2026-09-01T00:00:00Z"),
          unlinkReason: "Historical closure",
        },
      });
      const ing1 = await db.ingredient.create({
        data: { supplierId: sup1.id, name: "US2 Ing 1", defaultUnit: "kg" },
      });
      const ing2 = await db.ingredient.create({
        data: { supplierId: sup2.id, name: "US2 Ing 2", defaultUnit: "kg" },
      });
      const delSup1 = await db.delivery.create({
        data: {
          deliveryNo: "FP-DE-60001",
          schoolId: sch1.id,
          supplierId: sup1.id,
          creationMode: "STANDALONE",
          creationKey: randomUUID(),
          creationFingerprint: "f".repeat(64),
          createdByUserId: supAdmin1.id,
          status: "RECEIVED",
          receivedAt: new Date("2026-09-10T08:00:00Z"),
          receivedByUserId: submitter1.id,
        },
      });
      const delSup2 = await db.delivery.create({
        data: {
          deliveryNo: "FP-DE-60002",
          schoolId: sch1.id,
          supplierId: sup2.id,
          creationMode: "STANDALONE",
          creationKey: randomUUID(),
          creationFingerprint: "1".repeat(64),
          createdByUserId: supAdmin2.id,
          status: "RECEIVED",
          receivedAt: new Date("2026-09-10T08:00:00Z"),
          receivedByUserId: submitter1.id,
        },
      });
      const di1 = await db.deliveryItem.create({
        data: {
          deliveryId: delSup1.id,
          ingredientId: ing1.id,
          actualQuantity: "5.000",
          unit: "kg",
        },
      });
      const di2 = await db.deliveryItem.create({
        data: {
          deliveryId: delSup2.id,
          ingredientId: ing2.id,
          actualQuantity: "5.000",
          unit: "kg",
        },
      });
      const validLot = await db.ingredientLot.create({
        data: {
          deliveryItemId: di1.id,
          lotCode: "LOT-US2-VALID",
          receivedQuantity: "5.000",
          availableQuantity: "5.000",
          unit: "kg",
          status: "AVAILABLE",
        },
      });
      const foreignLot = await db.ingredientLot.create({
        data: {
          deliveryItemId: di2.id,
          lotCode: "LOT-US2-FOREIGN-SECRET",
          receivedQuantity: "5.000",
          availableQuantity: "5.000",
          unit: "kg",
          status: "AVAILABLE",
        },
      });

      const respondedFeedback = await createComplaintViaProducerContract({
        deliveryId: delSup1.id,
        ingredientLotId: validLot.id,
        submittedByUserId: submitter1.id,
        title: "US2 Responded with valid lot",
        description: "Full detail description",
        status: "RESPONDED",
        supplierResponse: "Câu trả lời chính thức từ nhà cung cấp",
        respondedByUserId: lockedResponder1.id,
        respondedAt: new Date("2026-10-20T12:00:00.000Z"),
        createdAt: new Date("2026-10-19T12:00:00.000Z"),
        updatedAt: new Date("2026-10-20T12:00:00.000Z"),
      });
      const wrongLotFeedback = await createComplaintViaProducerContract({
        deliveryId: delSup1.id,
        ingredientLotId: foreignLot.id,
        submittedByUserId: submitter1.id,
        title: "US2 Corrupt cross-delivery lot FK",
        description: "Foreign lot must fail closed with 503",
      });

      const sup1Cookie = await login(supAdmin1.email);
      const sup2Cookie = await login(supAdmin2.email);
      const submitterCookie = await login(submitter1.email);
      const peerDetailsCookie = await login(peerViewer1.email);
      const peerOwnCookie = await login(peerOwnOnly.email);
      const sch2Cookie = await login(sch2Kitchen.email);

      const beforeSeq = await db.$queryRaw<
        { code_type: string; last_sequence: number }[]
      >`SELECT code_type, last_sequence FROM foodprint.business_code_counters WHERE code_type = 'CP'`;
      const beforeRow = await db.complaint.findUniqueOrThrow({
        where: { id: respondedFeedback.id },
      });

      // Supplier 1, submitter (view_own), and school peer (view_details) all see exact same reply & original code.
      for (const cookie of [sup1Cookie, submitterCookie, peerDetailsCookie]) {
        const res = await call(
          `/ingredient-quality-feedback/${respondedFeedback.id}`,
          cookie,
        );
        assert.equal(res.status, 200);
        assert.equal(res.data.id, respondedFeedback.id);
        assert.equal(res.data.code, respondedFeedback.complaintCode);
        const resolution = (
          res.data.comments as Record<string, unknown>[]
        ).find((comment) => comment.commentType === "RESOLUTION");
        assert.equal(
          resolution?.content,
          "Câu trả lời chính thức từ nhà cung cấp",
        );
        assert.deepEqual(res.data.submittedBy, {
          id: submitter1.id,
          fullName: submitter1.fullName,
        });
        assert.deepEqual(resolution?.author, {
          id: lockedResponder1.id,
          fullName: lockedResponder1.fullName,
        });
        assert.deepEqual(res.data.ingredientLot, {
          id: validLot.id,
          lotCode: "LOT-US2-VALID",
        });
      }

      // Note: lockedResponder1 has supplierId=sup2, so moving/locking responder must NOT grant sup2 access,
      // and sup2 / peerOwnOnly / sch2Kitchen all get identical 404!
      const notFoundResponses = await Promise.all([
        call(
          `/ingredient-quality-feedback/${respondedFeedback.id}`,
          sup2Cookie,
        ),
        call(
          `/ingredient-quality-feedback/${respondedFeedback.id}`,
          peerOwnCookie,
        ),
        call(
          `/ingredient-quality-feedback/${respondedFeedback.id}`,
          sch2Cookie,
        ),
        call(
          "/ingredient-quality-feedback/99999999-9999-4999-8999-999999999999",
          sup1Cookie,
        ),
      ]);
      for (const nf of notFoundResponses) {
        assert.equal(nf.status, 404);
        assert.equal(nf.result.message, notFoundResponses[3].result.message);
      }

      // Cross-delivery lot FK triggers safe 503 without leaking foreign lotId/lotCode
      const wrongLotRes = await call(
        `/ingredient-quality-feedback/${wrongLotFeedback.id}`,
        sup1Cookie,
      );
      assert.equal(wrongLotRes.status, 503);
      assert(!JSON.stringify(wrongLotRes.result).includes(foreignLot.id));
      assert(
        !JSON.stringify(wrongLotRes.result).includes("LOT-US2-FOREIGN-SECRET"),
      );

      // Zero DB or sequence mutations on GET detail
      assert.deepEqual(
        await db.complaint.findUniqueOrThrow({
          where: { id: respondedFeedback.id },
        }),
        beforeRow,
      );
      assert.deepEqual(
        await db.$queryRaw<
          { code_type: string; last_sequence: number }[]
        >`SELECT code_type, last_sequence FROM foodprint.business_code_counters WHERE code_type = 'CP'`,
        beforeSeq,
      );
    },
  );

  await context.test(
    "US3 end-to-end supplier accept + resolve moves NEW → RESOLVED, preserves UUID+complaintCode for SCHOOL FR-011 readback, supports historical unlinked data, rolls back on readback error and mutates no external timestamps or sequence",
    async () => {
      const supAdminRole = await db.role.findUniqueOrThrow({
        where: { code: "INGREDIENT_SUPPLIER_ADMIN" },
      });
      const supStaffRole = await db.role.findUniqueOrThrow({
        where: { code: "INGREDIENT_SUPPLIER_STAFF" },
      });
      const schKitchenRole = await db.role.findUniqueOrThrow({
        where: { code: "SCHOOL_KITCHEN_STAFF" },
      });
      const schBoardRole = await db.role.findUniqueOrThrow({
        where: { code: "SCHOOL_MANAGEMENT_BOARD" },
      });
      const sup1 = await db.supplier.create({
        data: { name: "US3 Supplier 1" },
      });
      const sup2 = await db.supplier.create({
        data: { name: "US3 Supplier 2" },
      });
      const sch1 = await db.school.create({
        data: {
          name: "US3 Historical School",
          code: "SCH-US3",
          status: "INACTIVE",
        },
      });
      const sch2 = await db.school.create({
        data: { name: "US3 Foreign School", code: "SCH-US3-F" },
      });
      const mkActor = async (
        roleId: string,
        roleCode: string,
        tag: string,
        org: { schoolId?: string; supplierId?: string },
      ) =>
        withEmail(
          await db.user.create({
            data: {
              roleId,
              roleCode,
              schoolId: org.schoolId ?? null,
              supplierId: org.supplierId ?? null,
              username: `${tag}-${randomUUID().slice(0, 8)}`,
              email: `${tag}-${randomUUID().slice(0, 8)}@test.local`,
              passwordHash,
              fullName: tag,
              status: "ACTIVE",
            },
          }),
        );
      const supAdmin1 = await mkActor(
        supAdminRole.id,
        supAdminRole.code,
        "us3-sup1-admin",
        { supplierId: sup1.id },
      );
      const supStaff1 = await mkActor(
        supStaffRole.id,
        supStaffRole.code,
        "us3-sup1-staff",
        { supplierId: sup1.id },
      );
      const supAdmin2 = await mkActor(
        supAdminRole.id,
        supAdminRole.code,
        "us3-sup2-admin",
        { supplierId: sup2.id },
      );
      const submitter = await mkActor(
        schKitchenRole.id,
        schKitchenRole.code,
        "us3-submitter",
        { schoolId: sch1.id },
      );
      const schoolDetailsPeer = await mkActor(
        schBoardRole.id,
        schBoardRole.code,
        "us3-peer-details",
        { schoolId: sch1.id },
      );
      const foreignSchoolUser = await mkActor(
        schKitchenRole.id,
        schKitchenRole.code,
        "us3-sch2-user",
        { schoolId: sch2.id },
      );
      const viewDetailsPerm = await db.permission.findUniqueOrThrow({
        where: { code: "ingredient_quality_feedback.view_details" },
      });
      // Restrict submitter to view_own only to prove FR-011 works for both view_own & view_details
      await db.userPermissionDenial.create({
        data: {
          userId: submitter.id,
          permissionId: viewDetailsPerm.id,
          schoolId: sch1.id,
          disabledByUserId: schoolDetailsPeer.id,
        },
      });

      const relUnlinked = await db.schoolSupplierRelationship.create({
        data: {
          schoolId: sch1.id,
          supplierId: sup1.id,
          status: "UNLINKED",
          linkedAt: new Date("2026-07-01T00:00:00Z"),
          unlinkedAt: new Date("2026-08-01T00:00:00Z"),
          unlinkReason: "Historical closure",
        },
      });
      const expiredContract = await db.supplierContract.create({
        data: {
          relationshipId: relUnlinked.id,
          schoolId: sch1.id,
          supplierId: sup1.id,
          createdByUserId: submitter.id,
          status: "CLOSED",
          number: `HD-US3-${randomUUID().slice(0, 6)}`,
          signedOn: new Date("2024-12-20"),
          startsOn: new Date("2025-01-01"),
          endsOn: new Date("2025-12-31"),
          activatedAt: new Date("2025-01-01T00:00:00Z"),
          activatedByUserId: submitter.id,
          snapshot: { legacy: true },
          closedAt: new Date("2026-01-01T00:00:00Z"),
          closeReason: "Historical closure",
        },
      });
      const ing1 = await db.ingredient.create({
        data: { supplierId: sup1.id, name: "US3 Ing", defaultUnit: "kg" },
      });
      const del1 = await db.delivery.create({
        data: {
          deliveryNo: "FP-DE-70001",
          schoolId: sch1.id,
          supplierId: sup1.id,
          creationMode: "STANDALONE",
          creationKey: randomUUID(),
          creationFingerprint: "2".repeat(64),
          createdByUserId: supAdmin1.id,
          status: "RECEIVED",
          receivedAt: new Date("2026-09-10T08:00:00Z"),
          receivedByUserId: submitter.id,
        },
      });
      const di1 = await db.deliveryItem.create({
        data: {
          deliveryId: del1.id,
          ingredientId: ing1.id,
          actualQuantity: "3.000",
          unit: "kg",
        },
      });
      const lot1 = await db.ingredientLot.create({
        data: {
          deliveryItemId: di1.id,
          lotCode: "LOT-US3-01",
          receivedQuantity: "3.000",
          availableQuantity: "3.000",
          unit: "kg",
          status: "AVAILABLE",
        },
      });

      const fTarget = await createComplaintViaProducerContract({
        deliveryId: del1.id,
        ingredientLotId: lot1.id,
        submittedByUserId: submitter.id,
        title: "US3 Historical complaint",
        description: "Original immutable complaint content",
      });
      const fRollback = await createComplaintViaProducerContract({
        deliveryId: del1.id,
        ingredientLotId: lot1.id,
        submittedByUserId: submitter.id,
        title: "US3 Rollback test complaint",
        description: "Rollback must leave SUBMITTED untouched",
      });

      const sup1Cookie = await login(supAdmin1.email);
      const sup1StaffCookie = await login(supStaff1.email);
      const sup2Cookie = await login(supAdmin2.email);
      const submitterCookie = await login(submitter.email);
      const peerDetailsCookie = await login(schoolDetailsPeer.email);
      const foreignSchoolCookie = await login(foreignSchoolUser.email);

      // Foreign org POST -> 404 before any mutation
      for (const c of [sup2Cookie]) {
        const nf = await call(
          `/ingredient-quality-feedback/${fTarget.id}/accept`,
          c,
          "POST",
        );
        assert.equal(nf.status, 404);
      }
      assert.equal(
        (
          await call(
            `/ingredient-quality-feedback/${fTarget.id}/accept`,
            foreignSchoolCookie,
            "POST",
          )
        ).status,
        403,
      );

      // Snapshot external rows & timestamps before POST response
      const snapshotExternal = async () => ({
        delivery: await db.delivery.findUniqueOrThrow({
          where: { id: del1.id },
        }),
        lot: await db.ingredientLot.findUniqueOrThrow({
          where: { id: lot1.id },
        }),
        school: await db.school.findUniqueOrThrow({ where: { id: sch1.id } }),
        rel: await db.schoolSupplierRelationship.findUniqueOrThrow({
          where: { id: relUnlinked.id },
        }),
        contract: await db.supplierContract.findUniqueOrThrow({
          where: { id: expiredContract.id },
        }),
        submitterUser: await db.user.findUniqueOrThrow({
          where: { id: submitter.id },
        }),
        responderUser: await db.user.findUniqueOrThrow({
          where: { id: supStaff1.id },
        }),
        seq: await db.$queryRaw<
          { code_type: string; last_sequence: number }[]
        >`SELECT code_type, last_sequence FROM foodprint.business_code_counters WHERE code_type = 'CP'`,
      });
      const before = await snapshotExternal();

      const replyText =
        "  Phản hồi chính thức sau ngừng liên kết.\nĐang đổi lô bù. ";
      const expectedReply =
        "Phản hồi chính thức sau ngừng liên kết.\nĐang đổi lô bù.";
      const earlyResolve = await call(
        `/ingredient-quality-feedback/${fTarget.id}/resolve`,
        sup1StaffCookie,
        "POST",
        { content: replyText },
      );
      assert.equal(earlyResolve.status, 409);
      const acceptRes = await call(
        `/ingredient-quality-feedback/${fTarget.id}/accept`,
        sup1StaffCookie,
        "POST",
      );
      assert.equal(acceptRes.status, 200);
      assert.equal(acceptRes.data.status, "IN_PROGRESS");
      const postRes = await call(
        `/ingredient-quality-feedback/${fTarget.id}/resolve`,
        sup1StaffCookie,
        "POST",
        { content: replyText },
      );
      assert.equal(postRes.status, 200);
      assert.equal(postRes.data.id, fTarget.id);
      assert.equal(postRes.data.code, fTarget.complaintCode);
      assert.equal(postRes.data.status, "RESOLVED");
      assert.equal(postRes.data.resolvedCount, 1);
      const postResolution = (
        postRes.data.comments as Record<string, unknown>[]
      ).at(-1);
      assert.equal(postResolution?.commentType, "RESOLUTION");
      assert.equal(postResolution?.content, expectedReply);
      assert.deepEqual(postResolution?.author, {
        id: supStaff1.id,
        fullName: supStaff1.fullName,
      });

      // External entities and complaint sequence remain untouched
      assert.deepEqual(await snapshotExternal(), before);
      const updatedTarget = await db.complaint.findUniqueOrThrow({
        where: { id: fTarget.id },
      });
      assert.equal(updatedTarget.id, fTarget.id);
      assert.equal(updatedTarget.code, fTarget.complaintCode);
      assert.equal(updatedTarget.title, fTarget.title);
      assert.equal(updatedTarget.description, fTarget.description);
      assert.equal(updatedTarget.senderUserId, submitter.id);
      assert.equal(+updatedTarget.submittedAt, +fTarget.createdAt);
      assert(+updatedTarget.updatedAt >= +fTarget.updatedAt);

      // Both supplier admin and SCHOOL (own + details) read exact same reply & id & code
      for (const readerCookie of [
        sup1Cookie,
        submitterCookie,
        peerDetailsCookie,
      ]) {
        const readRes = await call(
          `/ingredient-quality-feedback/${fTarget.id}`,
          readerCookie,
        );
        assert.equal(readRes.status, 200);
        assert.equal(readRes.data.id, fTarget.id);
        assert.equal(readRes.data.code, fTarget.complaintCode);
        const readResolution = (
          readRes.data.comments as Record<string, unknown>[]
        ).find((comment) => comment.commentType === "RESOLUTION");
        assert.equal(readResolution?.content, expectedReply);
        assert.deepEqual(readResolution?.author, {
          id: supStaff1.id,
          fullName: supStaff1.fullName,
        });
      }

      // Simulated readback failure via repository injection rolls back DB write atomically (without disabling CHECKs)
      const rollbackSvc = createIngredientQualityFeedbackService(
        {
          ...feedbackRepoFixture,
          findLotInDelivery: async () => Promise.resolve(null),
        },
        () => Promise.resolve(db),
      );
      const staffPrincipal = await loadPrincipal(supStaff1.id, db);
      await assert.rejects(
        () => rollbackSvc.accept({ feedbackId: fRollback.id }, staffPrincipal),
        (err: unknown) => err instanceof HttpError && err.statusCode === 503,
      );
      const afterRb = await db.complaint.findUniqueOrThrow({
        where: { id: fRollback.id },
      });
      assert.equal(afterRb.status, "NEW");
      assert.equal(
        await db.complaintStatusHistory.count({
          where: { complaintId: fRollback.id },
        }),
        0,
      );
    },
  );

  await context.test(
    "C02 submission over HTTP (specs/ingredient-feedback-submission): BGH/kitchen/nutrition submit for RECEIVED/REJECTED deliveries of their school, Q11 read scopes, supplier handles the new ticket",
    async () => {
      const role = (code: string) =>
        db.role.findUniqueOrThrow({ where: { code } });
      const [boardRole, kitchenRole, nutritionRole, supAdminRole, teacherRole] =
        await Promise.all([
          role("SCHOOL_MANAGEMENT_BOARD"),
          role("SCHOOL_KITCHEN_STAFF"),
          role("SCHOOL_NUTRITION_OFFICER"),
          role("INGREDIENT_SUPPLIER_ADMIN"),
          role("HOMEROOM_TEACHER"),
        ]);
      const sup = await db.supplier.create({ data: { name: "PR3 Supplier" } });
      const supOther = await db.supplier.create({
        data: { name: "PR3 Other Supplier" },
      });
      const sch = await db.school.create({
        data: { name: "PR3 School", code: "SCH-PR3" },
      });
      const schOther = await db.school.create({
        data: { name: "PR3 Other School", code: "SCH-PR3-O" },
      });
      const mk = async (
        r: { id: string; code: string },
        tag: string,
        org: { schoolId?: string; supplierId?: string },
      ) =>
        withEmail(
          await db.user.create({
            data: {
              roleId: r.id,
              roleCode: r.code,
              schoolId: org.schoolId ?? null,
              supplierId: org.supplierId ?? null,
              username: `${tag}-${randomUUID().slice(0, 8)}`,
              email: `${tag}-${randomUUID().slice(0, 8)}@test.local`,
              passwordHash,
              fullName: tag,
              status: "ACTIVE",
            },
          }),
        );
      const board = await mk(boardRole, "pr3-board", { schoolId: sch.id });
      const kitchen = await mk(kitchenRole, "pr3-kitchen", {
        schoolId: sch.id,
      });
      const nutrition = await mk(nutritionRole, "pr3-nutrition", {
        schoolId: sch.id,
      });
      const teacher = await mk(teacherRole, "pr3-teacher", {
        schoolId: sch.id,
      });
      const otherBoard = await mk(boardRole, "pr3-other-board", {
        schoolId: schOther.id,
      });
      const supAdmin = await mk(supAdminRole, "pr3-sup", {
        supplierId: sup.id,
      });
      const mkDelivery = (
        deliveryNo: string,
        status: "RECEIVED" | "REJECTED" | "ARRIVED",
        schoolId = sch.id,
      ) =>
        db.delivery.create({
          data: {
            deliveryNo,
            schoolId,
            supplierId: sup.id,
            creationMode: "STANDALONE",
            creationKey: randomUUID(),
            creationFingerprint: "e".repeat(64),
            createdByUserId: supAdmin.id,
            status,
            ...(status === "RECEIVED"
              ? {
                  receivedAt: new Date("2026-11-20T08:00:00Z"),
                  receivedByUserId: kitchen.id,
                }
              : {}),
          },
        });
      const received = await mkDelivery("FP-DE-70001", "RECEIVED");
      const rejected = await mkDelivery("FP-DE-70002", "REJECTED");
      const arrived = await mkDelivery("FP-DE-70003", "ARRIVED");
      const foreign = await mkDelivery("FP-DE-70004", "RECEIVED", schOther.id);
      const ing = await db.ingredient.create({
        data: { supplierId: sup.id, name: "PR3 Ing", defaultUnit: "kg" },
      });
      const mkLot = async (deliveryId: string, lotCode: string) =>
        db.ingredientLot.create({
          data: {
            deliveryItemId: (
              await db.deliveryItem.create({
                data: {
                  deliveryId,
                  ingredientId: ing.id,
                  actualQuantity: "5.000",
                  unit: "kg",
                },
              })
            ).id,
            lotCode,
            receivedQuantity: "5.000",
            availableQuantity: "5.000",
            unit: "kg",
            status: "AVAILABLE",
          },
        });
      const lotReceived = await mkLot(received.id, "LOT-PR3-A");
      const lotRejected = await mkLot(rejected.id, "LOT-PR3-B");

      const [boardC, kitchenC, nutritionC, teacherC, otherBoardC, supC] =
        await Promise.all(
          [board, kitchen, nutrition, teacher, otherBoard, supAdmin].map((u) =>
            login(u.email),
          ),
        );
      // Tiêu đề và loại vấn đề bắt buộc từ specs/complaint-attachments (Q33, Q34).
      const submit = (cookie: string, body: Record<string, unknown>) =>
        call("/ingredient-quality-feedback", cookie, "POST", {
          title: "Rau cải bị dập",
          issueType: "SPOILED_OR_NOT_FRESH",
          ...body,
        });
      const countBefore = await db.complaint.count({
        where: { kind: "INGREDIENT" },
      });

      // Rejected inputs never create a row.
      const description = "Rau cải bị dập úng nhiều";
      for (const [cookie, body, status] of [
        [kitchenC, { deliveryId: arrived.id, description }, 409],
        [kitchenC, { deliveryId: foreign.id, description }, 404],
        [otherBoardC, { deliveryId: received.id, description }, 404],
        [
          kitchenC,
          {
            deliveryId: received.id,
            ingredientLotId: lotRejected.id,
            description,
          },
          400,
        ],
        [kitchenC, { deliveryId: received.id, description: "ngắn" }, 400],
        [kitchenC, { deliveryId: received.id, description, title: "x" }, 400],
        [
          kitchenC,
          { deliveryId: received.id, description, issueType: "BROKEN" },
          400,
        ],
        [
          kitchenC,
          { deliveryId: received.id, description, code: "FP-CP-1" },
          400,
        ],
        [teacherC, { deliveryId: received.id, description }, 403],
        [supC, { deliveryId: received.id, description }, 403],
      ] as const) {
        const res = await submit(cookie, body);
        assert.equal(res.status, status, JSON.stringify(body));
      }
      assert.equal(
        await db.complaint.count({ where: { kind: "INGREDIENT" } }),
        countBefore,
      );

      const byKitchen = await submit(kitchenC, {
        deliveryId: received.id,
        ingredientLotId: lotReceived.id,
        description: `  ${description}  `,
      });
      assert.equal(byKitchen.status, 201);
      assert.match(String(byKitchen.data.code), /^FP-CP-\d{5}$/);
      assert.equal(byKitchen.data.title, "Rau cải bị dập");
      assert.equal(byKitchen.data.issueType, "SPOILED_OR_NOT_FRESH");
      assert.deepEqual(byKitchen.data.attachments, []);
      assert.equal(byKitchen.data.description, description);
      assert.equal(byKitchen.data.displayStatus, "IN_PROGRESS");
      assert.deepEqual(byKitchen.data.ingredientLot, {
        id: lotReceived.id,
        lotCode: "LOT-PR3-A",
      });
      const byNutrition = await submit(nutritionC, {
        deliveryId: rejected.id,
        ingredientLotId: null,
        description: "Lô thịt bị từ chối vì có mùi lạ",
      });
      assert.equal(byNutrition.status, 201);
      const byBoard = await submit(boardC, {
        deliveryId: received.id,
        description: "Phản ánh thêm về chuyến giao này",
      });
      assert.equal(byBoard.status, 201);
      assert.notEqual(byBoard.data.code, byKitchen.data.code);

      const stored = await db.complaint.findUniqueOrThrow({
        where: { id: String(byKitchen.data.id) },
        select: {
          status: true,
          senderUserId: true,
          senderRoleCode: true,
          senderSchoolId: true,
          statusHistories: { select: { fromStatus: true, toStatus: true } },
        },
      });
      assert.deepEqual(stored, {
        status: "NEW",
        senderUserId: kitchen.id,
        senderRoleCode: "SCHOOL_KITCHEN_STAFF",
        senderSchoolId: sch.id,
        statusHistories: [{ fromStatus: null, toStatus: "NEW" }],
      });

      const ids = (res: { data: Record<string, unknown> }) =>
        (res.data.items as { id: string }[]).map((item) => item.id).sort();
      const all = [byKitchen, byNutrition, byBoard]
        .map((res) => String(res.data.id))
        .sort();
      // Q11: BGH sees the whole school; kitchen/nutrition see only their own.
      assert.deepEqual(
        ids(await call("/ingredient-quality-feedback", boardC)),
        all,
      );
      assert.deepEqual(
        ids(await call("/ingredient-quality-feedback", kitchenC)),
        [String(byKitchen.data.id)],
      );
      assert.equal(
        (
          await call(
            `/ingredient-quality-feedback/${String(byNutrition.data.id)}`,
            kitchenC,
          )
        ).status,
        404,
      );
      const boardView = await call(
        `/ingredient-quality-feedback/${String(byKitchen.data.id)}`,
        boardC,
      );
      assert.equal(boardView.status, 200);
      assert.deepEqual(boardView.data.allowedActions, []);
      assert.equal(
        (
          await call(
            `/ingredient-quality-feedback/${String(byKitchen.data.id)}/comments`,
            boardC,
            "POST",
            { content: "BGH không phải người gửi" },
          )
        ).status,
        404,
      );

      // Supplier of the delivery sees and handles the new tickets.
      assert.deepEqual(
        ids(await call("/ingredient-quality-feedback", supC)),
        all,
      );
      assert.equal(
        (
          await call(
            `/ingredient-quality-feedback/${String(byKitchen.data.id)}/accept`,
            supC,
            "POST",
          )
        ).status,
        200,
      );
      const resolved = await call(
        `/ingredient-quality-feedback/${String(byKitchen.data.id)}/resolve`,
        supC,
        "POST",
        { content: "Đã đổi lô mới cho trường" },
      );
      assert.equal(resolved.status, 200);
      assert.equal(resolved.data.status, "RESOLVED");
      void supOther;
    },
  );
});
