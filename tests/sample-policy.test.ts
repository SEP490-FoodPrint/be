import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express, { type RequestHandler } from "express";
import {
  INITIAL_PERMISSIONS,
  INITIAL_ROLE_PERMISSIONS,
} from "../src/constants/permission-catalog";
import { Prisma, type PrismaClient } from "../src/generated/prisma/client";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import { createOrganizationRouter } from "../src/modules/organization/organization.routes";
import {
  createOrganizationService,
  type OrganizationService,
} from "../src/modules/organization/organization.service";
import { validateSamplePolicy } from "../src/modules/organization/organization.validation";
import type { AuthPrincipal } from "../src/types/auth";
import { HttpError } from "../src/utils/http-error";

const isHttp = (status: number) => (error: unknown) =>
  error instanceof HttpError && error.statusCode === status;

const board: AuthPrincipal = {
  id: "00000000-0000-4000-8000-0000000000b1",
  username: "school_bgh",
  fullName: "BGH",
  roleId: "role",
  role: "SCHOOL_MANAGEMENT_BOARD",
  orgType: "SCHOOL",
  schoolId: "10000000-0000-4000-8000-000000000001",
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: ["school_sample_policy.manage"],
};

const serviceWithRow = (row: unknown, seen: unknown[] = []) =>
  createOrganizationService(undefined, () =>
    Promise.resolve({
      schoolSamplePolicy: {
        findUnique: (args: { where: unknown }) => {
          seen.push(args.where);
          return Promise.resolve(row);
        },
      },
    } as unknown as PrismaClient),
  );

void test("sample policy body: strict, positive, at most 3 decimals; below minimum is allowed", () => {
  assert.deepEqual(
    validateSamplePolicy({ sampleGrams: 80, sampleMilliliters: "150.125" }),
    { sampleGrams: "80", sampleMilliliters: "150.125" },
  );
  for (const body of [
    {},
    null,
    { sampleGrams: 100 },
    { sampleGrams: 0, sampleMilliliters: 150 },
    { sampleGrams: -1, sampleMilliliters: 150 },
    { sampleGrams: "1.2345", sampleMilliliters: 150 },
    { sampleGrams: "1e3", sampleMilliliters: 150 },
    { sampleGrams: "", sampleMilliliters: 150 },
    { sampleGrams: null, sampleMilliliters: 150 },
    { sampleGrams: 1000000000, sampleMilliliters: 150 },
    { sampleGrams: 100, sampleMilliliters: 150, schoolId: board.schoolId },
  ])
    assert.throws(() => validateSamplePolicy(body), isHttp(400));
});

void test("sample policy falls back to 100 g / 150 ml and is read from the session school", async () => {
  const seen: unknown[] = [];
  assert.deepEqual(await serviceWithRow(null, seen).getSamplePolicy(board), {
    sampleGrams: "100",
    sampleMilliliters: "150",
    isDefault: true,
    updatedAt: null,
    updatedBy: null,
    warnings: [],
  });
  assert.deepEqual(seen, [{ schoolId: board.schoolId }]);
});

void test("sample policy maps saved values and warns below the minimum", async () => {
  assert.deepEqual(
    await serviceWithRow({
      sampleGrams: new Prisma.Decimal("80.500"),
      sampleMilliliters: new Prisma.Decimal("180"),
      updatedAt: new Date("2026-11-24T01:00:00.000Z"),
      updatedByUser: { fullName: "Người cập nhật" },
    }).getSamplePolicy(board),
    {
      sampleGrams: "80.5",
      sampleMilliliters: "180",
      isDefault: false,
      updatedAt: "2026-11-24T01:00:00.000Z",
      updatedBy: "Người cập nhật",
      warnings: ["Thấp hơn mức tối thiểu 100 g theo QĐ 1246/QĐ-BYT"],
    },
  );
});

void test("sample policy rejects actors without the permission, role or school", async () => {
  const service = serviceWithRow(null);
  const input = { sampleGrams: "100", sampleMilliliters: "150" };
  const actors: AuthPrincipal[] = [
    { ...board, permissions: [] },
    { ...board, orgType: "SYSTEM", schoolId: null },
    { ...board, role: "SCHOOL_ADMINISTRATION" },
  ];
  for (const actor of actors) {
    await assert.rejects(service.getSamplePolicy(actor), isHttp(403));
    await assert.rejects(service.updateSamplePolicy(input, actor), isHttp(403));
  }
});

void test("sample policy routes require the permission and validate the body", async (context) => {
  const calls: unknown[] = [];
  const service = {
    getSamplePolicy: () => Promise.resolve({ isDefault: true }),
    updateSamplePolicy: (input: unknown) => {
      calls.push(input);
      return Promise.resolve(input);
    },
  } as unknown as OrganizationService;
  let current = board;
  const auth: RequestHandler = (req, _res, next) => {
    req.auth = current;
    next();
  };
  const app = express();
  app.use(express.json());
  app.use("/schools", createOrganizationRouter(service, auth));
  app.use(globalErrorHandler);
  const server = app.listen(0);
  context.after(() => server.close());
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/schools/me/sample-policy`;
  const patch = (body: unknown) =>
    fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  assert.equal((await fetch(url)).status, 200);
  assert.equal(
    (await patch({ sampleGrams: 80, sampleMilliliters: 150 })).status,
    200,
  );
  assert.deepEqual(calls, [{ sampleGrams: "80", sampleMilliliters: "150" }]);
  assert.equal((await patch({ sampleGrams: 80 })).status, 400);

  current = { ...board, permissions: ["school_meal_times.manage"] };
  assert.equal((await fetch(url)).status, 403);
  assert.equal(
    (await patch({ sampleGrams: 80, sampleMilliliters: 150 })).status,
    403,
  );
  assert.equal(calls.length, 1);
});

void test("permission catalog grants sample policy to BGH and plan approval to the warehouse only", () => {
  const grants: readonly (readonly [string, string])[] =
    INITIAL_ROLE_PERMISSIONS;
  const granted = (code: string) => {
    assert(
      INITIAL_PERMISSIONS.some((row) => row.code === code),
      code,
    );
    return grants
      .filter((row) => row[1] === code)
      .map((row) => row[0])
      .sort();
  };
  assert.deepEqual(granted("school_sample_policy.manage"), [
    "SCHOOL_MANAGEMENT_BOARD",
  ]);
  assert.deepEqual(granted("cooking_plan.approve"), [
    "INGREDIENT_MANAGEMENT_DEPARTMENT",
  ]);
  assert.deepEqual(granted("cooking_plan.view"), [
    "INGREDIENT_MANAGEMENT_DEPARTMENT",
    "SCHOOL_KITCHEN_STAFF",
    "SCHOOL_MANAGEMENT_BOARD",
  ]);
});
