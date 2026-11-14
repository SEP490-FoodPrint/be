import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateIngredientCreate,
  validateIngredientUpdate,
  validateIngredientQuery,
  validateIngredientHide,
} from "../src/modules/ingredient/ingredient.validation";
import { RequestValidationError } from "../src/utils/request-validation";

void test("ingredient create normalizes defaults and preserves ordered images", () => {
  const value = validateIngredientCreate({
    name: " Rice ",
    defaultUnit: " kg ",
  });
  assert.deepEqual(value, {
    name: "Rice",
    defaultUnit: "kg",
    description: null,
    categoryId: null,
    coverImage: null,
    imageDescription: [],
  });
  const images = ["/a.jpg", "https://example.test/b.jpg", "/c.jpg"];
  assert.deepEqual(
    validateIngredientCreate({
      name: "Rice",
      defaultUnit: "kg",
      coverImage: "/cover.jpg",
      imageDescription: images,
    }).imageDescription,
    images,
  );
});
void test("ingredient PATCH preserves omit/null/empty distinctions", () => {
  assert.deepEqual(validateIngredientUpdate({ name: " New " }), {
    name: "New",
  });
  assert.deepEqual(
    validateIngredientUpdate({ coverImage: null, imageDescription: [] }),
    { coverImage: null, imageDescription: [] },
  );
  for (const value of [
    {},
    { supplierId: "x" },
    { status: "ACTIVE" },
    { category: "old" },
    { imageDescription: null },
    { name: null },
  ])
    assert.throws(
      () => validateIngredientUpdate(value),
      RequestValidationError,
    );
});
void test("ingredient validation aggregates paths and rejects unsafe image references", () => {
  try {
    validateIngredientCreate({
      name: "",
      defaultUnit: "",
      imageDescription: ["/valid.jpg", "data:image/png;base64,x"],
      supplierId: "secret",
    });
    assert.fail("expected validation error");
  } catch (error) {
    assert(error instanceof RequestValidationError);
    assert(error.fields.some((f) => f.field === "imageDescription.1"));
    assert(error.fields.some((f) => f.field === "name"));
    assert(error.fields.some((f) => f.field === "defaultUnit"));
    assert(error.fields.some((f) => f.field === "supplierId"));
    assert(!JSON.stringify(error.fields).includes("secret"));
  }
  for (const coverImage of [
    [],
    "//other.test/x",
    "javascript:x",
    "file:///tmp/a",
    "https://user:password@example.test/a",
    "/a\\b",
    "/a\nb",
    "",
    "x".repeat(2049),
  ])
    assert.throws(
      () =>
        validateIngredientCreate({
          name: "Rice",
          defaultUnit: "kg",
          coverImage,
        }),
      RequestValidationError,
    );
});
void test("management queries and hide bodies are strict and bounded", () => {
  assert.deepEqual(validateIngredientQuery({}), { page: 1, limit: 20 });
  for (const value of [
    { page: "0" },
    { limit: "101" },
    { page: "9999999999999999" },
    { supplierId: "x" },
    { page: ["1"] },
  ])
    assert.throws(() => validateIngredientQuery(value), RequestValidationError);
  assert.deepEqual(validateIngredientHide(undefined), {});
  assert.throws(
    () => validateIngredientHide({ status: "ACTIVE" }),
    RequestValidationError,
  );
});

import express from "express";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import type { AuthPrincipal } from "../src/types/auth";
import { createIngredientService } from "../src/modules/ingredient/ingredient.service";
import { createIngredientRouter } from "../src/modules/ingredient/ingredient.routes";
import {
  ingredientRepository,
  ingredientWriteError,
  createIngredientRepository,
  type IngredientRepository,
  type IngredientRow,
} from "../src/modules/ingredient/ingredient.repository";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import { HttpError } from "../src/utils/http-error";
import { startHttp } from "./helpers/http";
import { testAdmin } from "./helpers/authorization";

const ingredientId = "11111111-1111-4111-8111-111111111111";
const supplierId = "22222222-2222-4222-8222-222222222222";
const categoryId = "33333333-3333-4333-8333-333333333333";
const principal: AuthPrincipal = {
  ...testAdmin,
  role: "INGREDIENT_SUPPLIER_ADMIN",
  orgType: "SUPPLIER",
  supplierId,
  permissions: ["ingredient.manage"],
};
function fixture() {
  const timestamp = new Date("2026-11-08T00:00:00Z");
  let current = principal;
  let status = "ACTIVE";
  const tx = {} as Prisma.TransactionClient;
  const seen: unknown[] = [];
  const rows: IngredientRow[] = [
    {
      id: ingredientId,
      supplierId,
      name: "Rice",
      defaultUnit: "kg",
      status: "ACTIVE",
      createdAt: timestamp,
      updatedAt: timestamp,
      categoryId: null,
      ingredientCategory: null,
      description: null,
      coverImage: null,
      imageDescription: [],
      Supplier: {
        id: supplierId,
        name: "Supplier A",
      },
    },
  ];
  const repo: IngredientRepository = {
    ...ingredientRepository,
    actor: (_id, client) => {
      assert.equal(client, tx);
      return Promise.resolve(current);
    },
    supplierStatus: () =>
      Promise.resolve({ status: status as "ACTIVE" | "INACTIVE" }),
    lockSupplier: (_scope, client) => {
      assert.equal(client, tx);
      return Promise.resolve();
    },
    lockTarget: (_scope, _id, client) => {
      assert.equal(client, tx);
      return Promise.resolve();
    },
    categoryExists: () => Promise.resolve(false),
    listLegacy: () => Promise.resolve(rows),
    list: (scope) => {
      seen.push(scope);
      return Promise.resolve(
        rows.filter((row) => row.supplierId === scope.supplierId),
      );
    },
    categories: () => Promise.resolve([]),
    find: (scope, id) =>
      Promise.resolve(
        rows.find(
          (row) => row.id === id && row.supplierId === scope.supplierId,
        ) ?? null,
      ),
    create: (scope, input, client) => {
      assert.equal(client, tx);
      const row = { ...rows[0], ...input, supplierId: scope.supplierId };
      rows.push(row);
      return Promise.resolve(row);
    },
    update: (scope, id, input, client) => {
      assert.equal(client, tx);
      const row = rows.find(
        (r) => r.id === id && r.supplierId === scope.supplierId,
      );
      if (row) Object.assign(row, input);
      return Promise.resolve(row ?? null);
    },
    hide: (scope, id, client) => {
      assert.equal(client, tx);
      const row = rows.find(
        (r) => r.id === id && r.supplierId === scope.supplierId,
      );
      if (row) row.status = "INACTIVE";
      return Promise.resolve(row ?? null);
    },
  };
  const connect = () =>
    Promise.resolve({
      $transaction: (
        operation: (client: Prisma.TransactionClient) => Promise<unknown>,
      ) => operation(tx),
    } as unknown as PrismaClient);
  return {
    service: createIngredientService(repo, connect),
    repo,
    rows,
    seen,
    setActor: (actor: AuthPrincipal) => {
      current = actor;
    },
    setStatus: (value: string) => {
      status = value;
    },
  };
}
const statusIs = (statusCode: number) => (error: unknown) =>
  error instanceof HttpError && error.statusCode === statusCode;

void test("uploaded HTTPS references survive ingredient create and update in order", async () => {
  const f = fixture();
  const urls = [
    "https://res.cloudinary.com/demo/image/upload/a.jpg",
    "https://res.cloudinary.com/demo/image/upload/b.png",
    "https://res.cloudinary.com/demo/image/upload/c.webp",
  ];
  const created = await f.service.create(
    validateIngredientCreate({
      name: "Uploaded rice",
      defaultUnit: "kg",
      coverImage: urls[0],
      imageDescription: urls,
    }),
    principal,
  );
  assert.equal(created.coverImage, urls[0]);
  assert.deepEqual(created.imageDescription, urls);
  const updated = await f.service.update(
    { ingredientId },
    validateIngredientUpdate({
      coverImage: urls[2],
      imageDescription: urls.slice().reverse(),
    }),
    principal,
  );
  assert.equal(updated.coverImage, urls[2]);
  assert.deepEqual(updated.imageDescription, urls.slice().reverse());
  const retained = await f.service.update(
    { ingredientId },
    validateIngredientUpdate({ name: "Renamed" }),
    principal,
  );
  assert.equal(retained.coverImage, urls[2]);
  assert.deepEqual(retained.imageDescription, urls.slice().reverse());
});

void test("management services enforce supplier scopes, safe serialization and PATCH semantics", async () => {
  const f = fixture();
  const result = await f.service.listManagement(
    { page: 1, limit: 1 },
    principal,
  );
  assert.deepEqual(f.seen, [{ supplierId }]);
  assert.equal(result.items[0].createdAt, "2026-11-08T00:00:00.000Z");
  assert.deepEqual(
    Object.keys(result.items[0]).sort(),
    [
      "id",
      "supplierId",
      "supplier",
      "supplierName",
      "name",
      "defaultUnit",
      "description",
      "categoryId",
      "category",
      "coverImage",
      "imageDescription",
      "status",
      "createdAt",
      "updatedAt",
    ].sort(),
  );
  await f.service.update(
    { ingredientId },
    validateIngredientUpdate({
      description: "New",
      coverImage: null,
      imageDescription: [],
    }),
    principal,
  );
  assert.equal(f.rows[0].name, "Rice");
  assert.equal(f.rows[0].description, "New");
  await assert.rejects(
    () =>
      f.service.update(
        { ingredientId },
        validateIngredientUpdate({ name: "No write", categoryId }),
        principal,
      ),
    statusIs(400),
  );
  assert.equal(f.rows[0].name, "Rice");
  const other = { ...principal, supplierId: categoryId };
  await assert.rejects(
    () => f.service.getDetail({ ingredientId }, other),
    statusIs(404),
  );
});

void test("every management operation rejects staff even with manage and inactive suppliers", async () => {
  const f = fixture();
  const staff = { ...principal, role: "INGREDIENT_SUPPLIER_STAFF" };
  const operations = (actor: AuthPrincipal) => [
    () => f.service.listManagement({ page: 1, limit: 20 }, actor),
    () => f.service.listCategories({ page: 1, limit: 20 }, actor),
    () => f.service.getDetail({ ingredientId }, actor),
    () =>
      f.service.create(
        validateIngredientCreate({ name: "X", defaultUnit: "kg" }),
        actor,
      ),
    () => f.service.update({ ingredientId }, { name: "X" }, actor),
    () => f.service.hide({ ingredientId }, {}, actor),
  ];
  for (const actor of [
    staff,
    testAdmin,
    { ...principal, permissions: [] },
    { ...principal, schoolId: categoryId },
  ])
    for (const operation of operations(actor))
      await assert.rejects(async () => operation(), statusIs(403));
  f.setStatus("INACTIVE");
  for (const operation of operations(principal))
    await assert.rejects(async () => operation(), statusIs(403));
});
void test("write rechecks live role, membership and permissions inside the shared transaction", async () => {
  for (const actor of [
    { ...principal, permissions: [] },
    { ...principal, role: "INGREDIENT_SUPPLIER_STAFF" },
    { ...principal, supplierId: categoryId },
  ]) {
    const f = fixture();
    f.setActor(actor);
    await assert.rejects(
      () => f.service.update({ ingredientId }, { name: "Refused" }, principal),
      statusIs(403),
    );
    assert.equal(f.rows[0].name, "Rice");
  }
});
void test("hide is idempotent, keeps rows and does not reactivate on edit", async () => {
  const f = fixture();
  const before = f.rows[0].updatedAt;
  assert.equal(
    (await f.service.hide({ ingredientId }, {}, principal)).status,
    "INACTIVE",
  );
  await f.service.hide({ ingredientId }, {}, principal);
  assert.equal(f.rows.length, 1);
  assert.equal(f.rows[0].updatedAt, before);
  await f.service.update(
    { ingredientId },
    { description: "Hidden edit" },
    principal,
  );
  assert.equal(f.rows[0].status, "INACTIVE");
});
void test("repository error adapter preserves business statuses before transaction wrapper", () => {
  for (const [code, status] of [
    ["P2002", 409],
    ["P2003", 400],
  ] as const)
    assert.throws(
      () => ingredientWriteError({ code, message: "private SQL" }),
      statusIs(status),
    );
});
void test("HTTP routes guard all management actions and preserve validation error paths", async (context) => {
  const f = fixture();
  let actor = principal;
  const app = express();
  app.use(express.json());
  app.use(
    "/api/ingredients",
    createIngredientRouter(f.service, (req, _res, next) => {
      req.auth = actor;
      next();
    }),
  );
  app.use(globalErrorHandler);
  const http = await startHttp(app);
  context.after(() => http.close());
  const endpoints = [
    ["GET", ""],
    ["GET", "/categories"],
    ["GET", "/" + ingredientId],
    ["POST", ""],
    ["PATCH", "/" + ingredientId],
    ["POST", "/" + ingredientId + "/hide"],
  ];
  actor = { ...principal, role: "INGREDIENT_SUPPLIER_STAFF" };
  for (const [method, suffix] of endpoints)
    assert.equal(
      (await http.request("/api/ingredients/management" + suffix, { method }))
        .status,
      403,
    );
  actor = principal;
  assert.equal(
    (await http.request("/api/ingredients/management/categories")).status,
    200,
  );
  const invalid = await http.request("/api/ingredients/management", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "",
      defaultUnit: "",
      imageDescription: ["data:secret"],
    }),
  });
  assert.equal(invalid.status, 400);
  assert(!JSON.stringify(invalid.body).includes("data:secret"));
  actor = {
    ...principal,
    role: "INGREDIENT_SUPPLIER_STAFF",
    permissions: ["ingredient.view"],
  };
  assert.equal((await http.request("/api/ingredients")).status, 200);
});

void test("repository applies supplier ownership to reads and writes using the supplied tx", async () => {
  const calls: { where?: unknown }[] = [];
  const tx = {
    ingredient: {
      findFirst: (args: { where: unknown }) => {
        calls.push(args);
        return Promise.resolve(null);
      },
      updateMany: (args: { where: unknown }) => {
        calls.push(args);
        return Promise.resolve({ count: 0 });
      },
    },
  } as unknown as Prisma.TransactionClient;
  const repo = createIngredientRepository();
  await repo.find({ supplierId }, ingredientId, tx);
  await repo.update({ supplierId }, ingredientId, { name: "X" }, tx);
  await repo.hide({ supplierId }, ingredientId, tx);
  assert.deepEqual(
    calls.map((c) => c.where),
    [
      { id: ingredientId, supplierId },
      { id: ingredientId, supplierId },
      { id: ingredientId, supplierId, status: "ACTIVE" },
      { id: ingredientId, supplierId },
    ],
  );
});

void test("management pagination bounds results and database errors never leak driver details", async () => {
  const f = fixture();
  f.rows.push({ ...f.rows[0], id: categoryId, name: "Second" });
  const result = await f.service.listManagement(
    { page: 1, limit: 1 },
    principal,
  );
  assert.equal(result.items.length, 1);
  assert.equal(result.pagination.hasNext, true);
  f.repo.list = () => Promise.reject(new Error("private driver details"));
  await assert.rejects(
    () => f.service.listManagement({ page: 1, limit: 20 }, principal),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 503 &&
      !error.message.includes("private driver details"),
  );
});
