import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { createIngredientRouter } from "../src/modules/ingredient/ingredient.routes";
import { createIngredientService } from "../src/modules/ingredient/ingredient.service";
import { ingredientRepository } from "../src/modules/ingredient/ingredient.repository";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import type { AuthPrincipal } from "../src/types/auth";
import type { PrismaClient } from "../src/generated/prisma/client";
import { testAdmin } from "./helpers/authorization";
import { startHttp } from "./helpers/http";
import { imageAtFiveMib, imageFixture } from "./helpers/upload-fixtures";

const supplierId = "22222222-2222-4222-8222-222222222222";
const admin: AuthPrincipal = {
  ...testAdmin,
  role: "INGREDIENT_SUPPLIER_ADMIN",
  orgType: "SUPPLIER",
  supplierId,
  permissions: ["ingredient.manage"],
};
const asset = {
  publicId: `foodprint/uploads/ingredients/${supplierId}/00000000-0000-4000-8000-000000000001`,
  url: "https://res.cloudinary.com/test/image/upload/image.png",
  format: "png" as const,
  bytes: 123,
  width: 2,
  height: 2,
};

function setup() {
  let requestActor = admin;
  let currentActor = admin;
  let supplierActive = true;
  const calls: string[] = [];
  const repo = {
    ...ingredientRepository,
    actor: () => Promise.resolve(currentActor),
    supplierStatus: () =>
      Promise.resolve({
        status: supplierActive ? ("ACTIVE" as const) : ("INACTIVE" as const),
      }),
  };
  const uploader = {
    async uploadImage(_file: unknown, scope: unknown) {
      await Promise.resolve();
      calls.push(JSON.stringify(scope));
      return asset;
    },
    async uploadImages(files: unknown[], scope: unknown) {
      await Promise.resolve();
      calls.push(JSON.stringify(scope));
      return files.map((_, index) =>
        index === 1
          ? {
              index,
              status: "failed" as const,
              error: {
                code: "UPLOAD_TIMEOUT" as const,
                message: "Quá thời gian",
              },
            }
          : { index, status: "success" as const, asset },
      );
    },
  };
  const service = createIngredientService(
    repo,
    () => Promise.resolve({} as PrismaClient),
    uploader,
  );
  const app = express();
  app.use(express.json());
  app.use(
    "/api/ingredients",
    createIngredientRouter(service, (req, _res, next) => {
      req.auth = requestActor;
      next();
    }),
  );
  app.use(globalErrorHandler);
  return {
    app,
    calls,
    setRequestActor(value: AuthPrincipal) {
      requestActor = value;
    },
    setCurrentActor(value: AuthPrincipal) {
      currentActor = value;
    },
    setSupplierActive(value: boolean) {
      supplierActive = value;
    },
  };
}

async function form(field: string, count = 1) {
  const data = new FormData();
  const image = await imageFixture();
  for (let i = 0; i < count; i++) {
    data.append(
      field,
      new Blob([new Uint8Array(image.buffer)], { type: image.mimeType }),
      image.originalName,
    );
  }
  return data;
}

void test("single image upload returns allowlisted asset and uses authenticated supplier scope", async (t) => {
  const f = setup();
  const http = await startHttp(f.app);
  t.after(() => http.close());
  const result = await http.request(
    "/api/ingredients/management/upload-image",
    { method: "POST", body: await form("image") },
  );
  assert.equal(result.status, 201);
  const body = result.body as { data: typeof asset };
  assert.equal(body.data.url, asset.url);
  assert.deepEqual(JSON.parse(f.calls[0]), {
    namespace: "ingredients",
    ownerId: supplierId,
  });
});

void test("multiple upload returns ordered success and failures without losing successful assets", async (t) => {
  const f = setup();
  const http = await startHttp(f.app);
  t.after(() => http.close());
  const result = await http.request(
    "/api/ingredients/management/upload-images",
    { method: "POST", body: await form("images", 3) },
  );
  assert.equal(result.status, 200);
  const body = result.body as {
    data: { results: Array<{ index: number; status: string }> };
  };
  assert.deepEqual(
    body.data.results.map(({ index, status }) => [index, status]),
    [
      [0, "success"],
      [1, "failed"],
      [2, "success"],
    ],
  );
});

void test("unauthorized roles, inactive supplier and revoked permission never invoke upload", async (t) => {
  const f = setup();
  const http = await startHttp(f.app);
  t.after(() => http.close());
  for (const actor of [
    { ...admin, role: "INGREDIENT_SUPPLIER_STAFF" },
    testAdmin,
    { ...admin, permissions: [] },
  ]) {
    f.setRequestActor(actor);
    const result = await http.request(
      "/api/ingredients/management/upload-image",
      { method: "POST", body: await form("image") },
    );
    assert.equal(result.status, 403);
  }
  f.setRequestActor(admin);
  f.setSupplierActive(false);
  assert.equal(
    (
      await http.request("/api/ingredients/management/upload-image", {
        method: "POST",
        body: await form("image"),
      })
    ).status,
    403,
  );
  f.setSupplierActive(true);
  f.setCurrentActor({ ...admin, permissions: [] });
  assert.equal(
    (
      await http.request("/api/ingredients/management/upload-image", {
        method: "POST",
        body: await form("image"),
      })
    ).status,
    403,
  );
  assert.equal(f.calls.length, 0);
});

void test("invalid multipart shape is rejected before storage", async (t) => {
  const f = setup();
  const http = await startHttp(f.app);
  t.after(() => http.close());
  for (const body of [
    await form("wrong"),
    await form("image", 2),
    new FormData(),
  ]) {
    const result = await http.request(
      "/api/ingredients/management/upload-image",
      { method: "POST", body },
    );
    assert.equal(result.status, 400);
  }
  const extra = await form("image");
  extra.append("supplierId", supplierId);
  assert.equal(
    (
      await http.request("/api/ingredients/management/upload-image", {
        method: "POST",
        body: extra,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await http.request("/api/ingredients/management/upload-images", {
        method: "POST",
        body: await form("images", 6),
      })
    ).status,
    400,
  );
  assert.equal(f.calls.length, 0);
});

void test("multipart boundaries accept five files and reject files larger than five MiB", async (t) => {
  const f = setup();
  const http = await startHttp(f.app);
  t.after(() => http.close());
  assert.equal(
    (
      await http.request("/api/ingredients/management/upload-images", {
        method: "POST",
        body: await form("images", 5),
      })
    ).status,
    200,
  );
  const before = f.calls.length;
  const oversize = new FormData();
  oversize.append(
    "image",
    new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "image/png" }),
    "too-large.png",
  );
  assert.equal(
    (
      await http.request("/api/ingredients/management/upload-image", {
        method: "POST",
        body: oversize,
      })
    ).status,
    413,
  );
  assert.equal(f.calls.length, before);
});

void test("unexpected query parameters are rejected", async (t) => {
  const f = setup();
  const http = await startHttp(f.app);
  t.after(() => http.close());
  const response = await http.request(
    "/api/ingredients/management/upload-image?supplierId=other",
    { method: "POST", body: await form("image") },
  );
  assert.equal(response.status, 400);
  assert.equal(f.calls.length, 0);
});

void test("supplier scope changed after authentication blocks upload", async (t) => {
  const f = setup();
  const http = await startHttp(f.app);
  t.after(() => http.close());
  f.setCurrentActor({
    ...admin,
    supplierId: "33333333-3333-4333-8333-333333333333",
  });
  const response = await http.request(
    "/api/ingredients/management/upload-image",
    {
      method: "POST",
      body: await form("image"),
    },
  );
  assert.equal(response.status, 403);
  assert.equal(f.calls.length, 0);
});

void test("multipart accepts an image exactly five MiB", async (t) => {
  const f = setup();
  const http = await startHttp(f.app);
  t.after(() => http.close());
  const file = await imageAtFiveMib();
  const body = new FormData();
  body.append(
    "image",
    new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }),
    file.originalName,
  );
  const response = await http.request(
    "/api/ingredients/management/upload-image",
    { method: "POST", body },
  );
  assert.equal(response.status, 201);
  assert.equal(f.calls.length, 1);
});
