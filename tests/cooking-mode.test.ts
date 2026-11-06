import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express, { type RequestHandler } from "express";
import type { AuthPrincipal } from "../src/types/auth";
import type { PrismaClient } from "../src/generated/prisma/client";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import { createOrganizationRouter } from "../src/modules/organization/organization.routes";
import {
  createOrganizationService,
  type OrganizationService,
} from "../src/modules/organization/organization.service";
import { validateCookingMode } from "../src/modules/organization/organization.validation";
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
  permissions: ["school_cooking_mode.manage"],
};

void test("cooking mode payload only accepts the enum value", () => {
  assert.equal(
    validateCookingMode({ cookingMode: "COMBINE_LOTS" }),
    "COMBINE_LOTS",
  );
  assert.equal(
    validateCookingMode({ cookingMode: "SEPARATE_BY_LOT" }),
    "SEPARATE_BY_LOT",
  );
  for (const body of [
    {},
    null,
    { cookingMode: "ALLERGY" },
    { cookingMode: null },
    { cookingMode: "COMBINE_LOTS", schoolId: board.schoolId },
  ])
    assert.throws(() => validateCookingMode(body), isHttp(400));
});

void test("cooking mode is read from the session school only", async () => {
  let where: unknown;
  const service = createOrganizationService(undefined, () =>
    Promise.resolve({
      school: {
        findUniqueOrThrow: (args: { where: unknown }) => {
          where = args.where;
          return Promise.resolve({ cookingMode: "COMBINE_LOTS" });
        },
      },
    } as unknown as PrismaClient),
  );
  assert.deepEqual(await service.getCookingMode(board), {
    cookingMode: "COMBINE_LOTS",
  });
  assert.deepEqual(where, { id: board.schoolId });
  await assert.rejects(
    service.getCookingMode({ ...board, permissions: [] }),
    isHttp(403),
  );
  await assert.rejects(
    service.getCookingMode({ ...board, orgType: "SYSTEM", schoolId: null }),
    isHttp(403),
  );
  await assert.rejects(
    service.getCookingMode({ ...board, role: "SCHOOL_ADMINISTRATION" }),
    isHttp(403),
  );
  await assert.rejects(
    service.updateCookingMode("COMBINE_LOTS", { ...board, permissions: [] }),
    isHttp(403),
  );
});

void test("cooking mode routes require the permission and validate the body", async (context) => {
  const calls: unknown[] = [];
  const service = {
    getCookingMode: () => Promise.resolve({ cookingMode: null }),
    updateCookingMode: (cookingMode: string) => {
      calls.push(cookingMode);
      return Promise.resolve({ cookingMode });
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
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/schools/me/cooking-mode`;
  const patch = (cookingMode: string) =>
    fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cookingMode }),
    });

  const read = await fetch(url);
  assert.equal(read.status, 200);
  assert.equal(
    ((await read.json()) as { data: { cookingMode: null } }).data.cookingMode,
    null,
  );
  assert.equal((await patch("SEPARATE_BY_LOT")).status, 200);
  assert.deepEqual(calls, ["SEPARATE_BY_LOT"]);
  assert.equal((await patch("COMMON")).status, 400);

  current = { ...board, permissions: ["menu.view"] };
  assert.equal((await fetch(url)).status, 403);
  assert.equal((await patch("COMBINE_LOTS")).status, 403);
  assert.equal(calls.length, 1);
});
