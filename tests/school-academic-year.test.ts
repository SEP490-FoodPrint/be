import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express, { type RequestHandler } from "express";
import type { AuthPrincipal } from "../src/types/auth";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import { createSchoolAcademicYearRouter } from "../src/modules/school-academic-year/school-academic-year.routes";
import type { SchoolAcademicYearService } from "../src/modules/school-academic-year/school-academic-year.service";
import { createSchoolAcademicYearService } from "../src/modules/school-academic-year/school-academic-year.service";
import type { SchoolAcademicYearRepository } from "../src/modules/school-academic-year/school-academic-year.repository";
import {
  validateCreateAcademicYear,
  validateUpdateAcademicYear,
} from "../src/modules/school-academic-year/school-academic-year.validation";
import { HttpError } from "../src/utils/http-error";

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
  permissions: ["school_academic_year.view", "school_academic_year.manage"],
};

const isBadRequest = (error: unknown) =>
  error instanceof HttpError && error.statusCode === 400;

void test("academic-year validation accepts a valid calendar", () => {
  assert.deepEqual(
    validateCreateAcademicYear({
      academicYear: " 2026-2027 ",
      startDate: "2026-09-05",
      endDate: "2027-05-31",
      holidays: [{ date: "2027-01-01", reason: " Nghỉ Tết dương lịch " }],
    }),
    {
      academicYear: "2026-2027",
      startDate: "2026-09-05",
      endDate: "2027-05-31",
      holidays: [{ date: "2027-01-01", reason: "Nghỉ Tết dương lịch" }],
    },
  );
});

void test("academic-year validation rejects invalid ranges and holidays", () => {
  const base = {
    academicYear: "2026-2027",
    startDate: "2026-09-05",
    endDate: "2027-05-31",
  };
  for (const input of [
    { ...base, startDate: "2027-06-01", holidays: [] },
    { ...base, holidays: [{ date: "2027-06-01", reason: "Ngoài khoảng" }] },
    {
      ...base,
      holidays: [
        { date: "2027-01-01", reason: "Lần một" },
        { date: "2027-01-01", reason: "Lần hai" },
      ],
    },
    { ...base, holidays: [{ date: "2027-02-30", reason: "Ngày sai" }] },
    { ...base, holidays: [{ date: "2027-01-01", reason: "  " }] },
    { ...base, holidays: [], schoolId: board.schoolId },
  ])
    assert.throws(() => validateCreateAcademicYear(input), isBadRequest);

  assert.throws(
    () =>
      validateUpdateAcademicYear({
        academicYear: "changed",
        startDate: base.startDate,
        endDate: base.endDate,
        holidays: [],
      }),
    isBadRequest,
  );
});

void test("academic-year reads are scoped to the authenticated school", async () => {
  const seen: string[] = [];
  const row = {
    id: "20000000-0000-4000-8000-000000000001",
    schoolId: board.schoolId!,
    academicYear: "2026-2027",
    startDate: new Date("2026-09-05T00:00:00.000Z"),
    endDate: new Date("2027-05-31T00:00:00.000Z"),
    holidays: [],
    createdAt: new Date("2026-11-07T00:00:00.000Z"),
    updatedAt: new Date("2026-11-07T00:00:00.000Z"),
  };
  const repository = {
    list: (schoolId: string) => {
      seen.push(schoolId);
      return Promise.resolve([row]);
    },
    findById: (schoolId: string) => {
      seen.push(schoolId);
      return Promise.resolve(null);
    },
  } as unknown as SchoolAcademicYearRepository;
  const service = createSchoolAcademicYearService(repository);
  const result = await service.list(board);
  assert.equal(result[0]?.startDate, "2026-09-05");
  await assert.rejects(
    service.get("30000000-0000-4000-8000-000000000001", board),
    (error: unknown) => error instanceof HttpError && error.statusCode === 404,
  );
  assert.deepEqual(seen, [board.schoolId, board.schoolId]);
  await assert.rejects(
    service.list({ ...board, role: "SCHOOL_ADMINISTRATION" }),
    (error: unknown) => error instanceof HttpError && error.statusCode === 403,
  );
});

void test("academic-year routes enforce permissions and expose no delete", async (context) => {
  const calls: string[] = [];
  const record = {
    id: "20000000-0000-4000-8000-000000000001",
    academicYear: "2026-2027",
    startDate: "2026-09-05",
    endDate: "2027-05-31",
    holidays: [],
    createdAt: "2026-11-07T00:00:00.000Z",
    updatedAt: "2026-11-07T00:00:00.000Z",
  };
  const service = {
    list: () => Promise.resolve([record]),
    get: () => Promise.resolve(record),
    create: () => {
      calls.push("create");
      return Promise.resolve(record);
    },
    update: () => {
      calls.push("update");
      return Promise.resolve(record);
    },
  } as unknown as SchoolAcademicYearService;
  let principal = board;
  const auth: RequestHandler = (req, _res, next) => {
    req.auth = principal;
    next();
  };
  const app = express();
  app.use(express.json());
  app.use(
    "/schools/me/academic-years",
    createSchoolAcademicYearRouter(service, auth),
  );
  app.use(globalErrorHandler);
  const server = app.listen(0);
  context.after(() => server.close());
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/schools/me/academic-years`;

  assert.equal((await fetch(baseUrl)).status, 200);
  assert.equal(
    (
      await fetch(baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          academicYear: "2026-2027",
          startDate: "2026-09-05",
          endDate: "2027-05-31",
          holidays: [],
        }),
      })
    ).status,
    201,
  );
  assert.deepEqual(calls, ["create"]);
  assert.equal((await fetch(baseUrl, { method: "DELETE" })).status, 404);

  principal = { ...board, permissions: ["school_academic_year.view"] };
  assert.equal((await fetch(baseUrl)).status, 200);
  assert.equal(
    (
      await fetch(baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.deepEqual(calls, ["create"]);
});
