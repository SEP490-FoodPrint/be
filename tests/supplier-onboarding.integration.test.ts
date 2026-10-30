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
  const local =
    process.env.LOCAL_DATABASE_URL || process.env.MIGRATION_TEST_DATABASE_URL;
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
  await owner.query(`CREATE DATABASE "${databaseName}"`);
  await owner.end();
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
    [healthA, "healthA", schoolA, "SCHOOL_HEALTH_OFFICER"],
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
  await db.ingredient.createMany({
    data: [
      {
        id: ingredientA,
        supplierId: supplierA,
        name: "Rice",
        category: "Grains",
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
        category: "Vegetables",
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

  const app = createApp(
    createApiRateLimiter(new MemoryStore(), { windowMs: 60000, limit: 1000 }),
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
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = record(await response.json());
    return {
      status: response.status,
      result,
      data: result.data ? record(result.data) : {},
    };
  };
  const login = async (username: string) => {
    const response = await call("/auth/login", "", "POST", {
      identifier: username,
      password: "123456",
    });
    assert.equal(response.status, 200);
    return stringField(response.data, "accessToken");
  };
  const tokenA = await login("managerA"),
    tokenB = await login("managerB"),
    warehouse = await login("warehouseA"),
    health = await login("healthA");
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
      headers: { Authorization: `Bearer ${tokenA}` },
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
        { headers: { Authorization: `Bearer ${tokenA}` } },
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
            await login("warehouseB"),
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
});
