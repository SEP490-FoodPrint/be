import { recordLocalTestDatabase } from "./helpers/local-test-database";
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
    ingredientIds: [ingredientA],
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
            ingredientIds: [ingredientB],
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

  const createOrder = async (entry: string, number: string) =>
    call("/supply-requests", warehouse, "POST", {
      supplierId: supplierA,
      requestNo: number,
      requestedDeliveryDate: dayString(today),
      items: [{ ingredientEntryId: entry, quantity: 10 }],
    });
  let sentId = "";
  await context.test(
    "orders enforce supplier, school, scope and current compliance, and pin the contract snapshot",
    async () => {
      assert.equal((await createOrder(entryB, "FOREIGN-ENTRY")).status, 400);
      const outside = await createOrder(otherEntryA, "OUTSIDE-SCOPE");
      assert.equal(outside.status, 200);
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
        data: { schoolId: schoolA, name: "Hidden history dish" },
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
});
