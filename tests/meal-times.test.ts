import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuthPrincipal } from "../src/types/auth";
import { HttpError } from "../src/utils/http-error";
import { createOrganizationService } from "../src/modules/organization/organization.service";
import { validateMealTimes } from "../src/modules/organization/organization.validation";

const board: AuthPrincipal = {
  id: "10000000-0000-4000-8000-000000000001",
  username: "board",
  fullName: "BGH",
  roleId: "role",
  role: "SCHOOL_MANAGEMENT_BOARD",
  orgType: "SCHOOL",
  schoolId: "10000000-0000-4000-8000-000000000002",
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: ["school_meal_times.manage"],
};

void test("meal times validate HH:mm, nullable values and ordering", () => {
  assert.deepEqual(
    validateMealTimes({ lunchTime: "11:30", afternoonMealTime: "15:00" }),
    { lunchTime: "11:30", afternoonMealTime: "15:00" },
  );
  assert.throws(() =>
    validateMealTimes({ lunchTime: "15:00", afternoonMealTime: "11:00" }),
  );
  assert.throws(() =>
    validateMealTimes({
      lunchTime: "11:30",
      afternoonMealTime: null,
      schoolId: "x",
    }),
  );
});

void test("meal times read only the authenticated school and require BGH", async () => {
  let selectedSchool = "";
  const service = createOrganizationService({
    findMealTimes: (schoolId: string) => {
      selectedSchool = schoolId;
      return Promise.resolve({
        lunchTime: new Date("1970-01-01T11:30:00.000Z"),
        afternoonMealTime: new Date("1970-01-01T15:00:00.000Z"),
      });
    },
  } as never);
  assert.deepEqual(await service.getMealTimes(board), {
    lunchTime: "11:30",
    afternoonMealTime: "15:00",
  });
  assert.equal(selectedSchool, board.schoolId);
  await assert.rejects(
    service.getMealTimes({ ...board, role: "SCHOOL_ADMINISTRATION" }),
    (error: unknown) => error instanceof HttpError && error.statusCode === 403,
  );
});
