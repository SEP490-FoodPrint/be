import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express, { type RequestHandler } from "express";
import type { PrismaClient } from "../src/generated/prisma/client";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import { createOrganizationRouter } from "../src/modules/organization/organization.routes";
import {
  createOrganizationService,
  type OrganizationService,
} from "../src/modules/organization/organization.service";
import { validateMealTimes } from "../src/modules/organization/organization.validation";
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
  permissions: ["school_meal_times.manage"],
};

void test("meal times validation accepts HH:mm/null and enforces ordering", () => {
  assert.deepEqual(
    validateMealTimes({ lunchTime: "11:30", afternoonMealTime: "15:00" }),
    { lunchTime: "11:30", afternoonMealTime: "15:00" },
  );
  assert.deepEqual(
    validateMealTimes({ lunchTime: null, afternoonMealTime: null }),
    { lunchTime: null, afternoonMealTime: null },
  );
  for (const body of [
    {},
    { lunchTime: "25:00", afternoonMealTime: null },
    { lunchTime: "15:00", afternoonMealTime: "11:00" },
    { lunchTime: "11:00", afternoonMealTime: "11:00" },
    { lunchTime: "11:00", afternoonMealTime: null, schoolId: board.schoolId },
  ])
    assert.throws(() => validateMealTimes(body), isHttp(400));
});

void test("meal times are read from the session school and normalized", async () => {
  let where: unknown;
  const service = createOrganizationService(undefined, () =>
    Promise.resolve({
      school: {
        findUniqueOrThrow: (args: { where: unknown }) => {
          where = args.where;
          return Promise.resolve({
            lunchTime: new Date("1970-01-01T11:30:00.000Z"),
            afternoonMealTime: null,
          });
        },
      },
    } as unknown as PrismaClient),
  );
  assert.deepEqual(await service.getMealTimes(board), {
    lunchTime: "11:30",
    afternoonMealTime: null,
  });
  assert.deepEqual(where, { id: board.schoolId });
  await assert.rejects(
    service.getMealTimes({ ...board, permissions: [] }),
    isHttp(403),
  );
  await assert.rejects(
    service.getMealTimes({ ...board, role: "SCHOOL_ADMINISTRATION" }),
    isHttp(403),
  );
});

void test("meal times routes require permission and validate body", async (context) => {
  const calls: unknown[] = [];
  const service = {
    getMealTimes: () =>
      Promise.resolve({ lunchTime: null, afternoonMealTime: null }),
    updateMealTimes: (input: unknown) => {
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
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/schools/me/meal-times`;
  assert.equal((await fetch(url)).status, 200);
  const patch = (body: unknown) =>
    fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await patch({ lunchTime: "11:30", afternoonMealTime: "15:00" })).status,
    200,
  );
  assert.equal(calls.length, 1);
  assert.equal(
    (await patch({ lunchTime: "15:00", afternoonMealTime: "11:00" })).status,
    400,
  );
  current = { ...board, permissions: [] };
  assert.equal((await fetch(url)).status, 403);
});
