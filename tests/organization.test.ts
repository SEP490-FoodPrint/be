import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuthPrincipal } from "../src/types/auth";
import {
  validateOrganizationListQuery,
  validatePublicDailyMenuQuery,
  validatePublicSchoolQuery,
  validatePublicWeeklyMenuQuery,
  validateSchoolCode,
  validateSchoolId,
  OrganizationValidationError,
} from "../src/modules/organization/organization.validation";
import { createOrganizationService } from "../src/modules/organization/organization.service";
import type {
  OrganizationRepository,
  PublicSchoolDbRow,
} from "../src/modules/organization/organization.repository";

const testAdmin: AuthPrincipal = {
  id: "admin-id",
  username: "admin",
  fullName: "System Admin",
  roleId: "role-id",
  role: "SYSTEM_ADMIN",
  orgType: "SYSTEM",
  schoolId: null,
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: ["school.manage"],
};

void test("organization validation validates admin list query with strict schema", () => {
  assert.deepEqual(validateOrganizationListQuery({}), {
    page: 1,
    limit: 20,
  });
  assert.deepEqual(validateOrganizationListQuery({ page: "2", limit: "50" }), {
    page: 2,
    limit: 50,
  });

  for (const invalid of [
    { limit: "101" },
    { page: "0" },
    { page: "-1" },
    { unknownKey: "val" },
  ]) {
    assert.throws(
      () => validateOrganizationListQuery(invalid),
      (err: unknown) =>
        err instanceof OrganizationValidationError && err.statusCode === 400,
    );
  }
});

void test("organization validation validates public school list query", () => {
  const parsed = validatePublicSchoolQuery({
    page: "1",
    limit: "10",
    search: "  Tiểu học  ",
    city: "Hà Nội",
  });
  assert.equal(parsed.page, 1);
  assert.equal(parsed.limit, 10);
  assert.equal(parsed.search, "Tiểu học");
  assert.equal(parsed.city, "Hà Nội");

  // Rejects unrecognized keys
  assert.throws(
    () => validatePublicSchoolQuery({ hack: "attempt" }),
    (err: unknown) =>
      err instanceof OrganizationValidationError && err.statusCode === 400,
  );

  // Rejects invalid UUID locationId
  assert.throws(
    () => validatePublicSchoolQuery({ locationId: "invalid-uuid" }),
    (err: unknown) =>
      err instanceof OrganizationValidationError && err.statusCode === 400,
  );
});

void test("organization validation checks school code and school id", () => {
  assert.equal(validateSchoolCode("  TH-DICHVONG  "), "TH-DICHVONG");
  assert.throws(() => validateSchoolCode(""), { statusCode: 400 });
  assert.throws(() => validateSchoolCode("   "), { statusCode: 400 });

  const validUuid = "123e4567-e89b-12d3-a456-426614174000";
  assert.equal(validateSchoolId(validUuid), validUuid);
  assert.throws(() => validateSchoolId("not-uuid"), { statusCode: 400 });
});

void test("organization validation checks daily and weekly menu queries", () => {
  assert.deepEqual(validatePublicDailyMenuQuery({ date: "2026-11-05" }), {
    date: "2026-11-05",
  });
  assert.deepEqual(validatePublicDailyMenuQuery({}), {});
  assert.throws(() => validatePublicDailyMenuQuery({ date: "bad-date" }), {
    statusCode: 400,
  });
  assert.throws(() => validatePublicDailyMenuQuery({ extra: "field" }), {
    statusCode: 400,
  });

  assert.deepEqual(
    validatePublicWeeklyMenuQuery({
      week: "2026-11-02",
      grade: "1",
      group: "all",
    }),
    {
      week: "2026-11-02",
      grade: "1",
      group: "all",
    },
  );
  assert.throws(() => validatePublicWeeklyMenuQuery({ week: "not-a-date" }), {
    statusCode: 400,
  });
});

void test("organization service maps school rows correctly and respects pagination", async () => {
  const dummyDate = new Date("2026-11-01T08:00:00.000Z");
  const dummySchool: PublicSchoolDbRow = {
    id: "school-1",
    code: "TH-DV",
    name: "Tiểu học Dịch Vọng",
    email: "dv@edu.vn",
    phone: "0243123456",
    locationId: "loc-1",
    address: "123 Cầu Giấy",
    websiteUrl: "https://dv.edu.vn",
    description: "Trường chuẩn quốc gia",
    logoUrl: null,
    coverImageUrl: null,
    cookingMode: "SEPARATE_BY_LOT",
    lunchTime: new Date("1970-01-01T10:45:00.000Z"),
    afternoonMealTime: new Date("1970-01-01T14:30:00.000Z"),
    boardingScale: "1000",
    status: "ACTIVE",
    createdAt: dummyDate,
    updatedAt: dummyDate,
    location: {
      id: "loc-1",
      code: "CG",
      name: "Cầu Giấy",
      type: "DISTRICT",
      level: 2,
      parentId: "city-1",
      parent: {
        id: "city-1",
        code: "HN",
        name: "Hà Nội",
        type: "CITY",
        level: 1,
        parentId: null,
        createdAt: dummyDate,
        updatedAt: dummyDate,
        isActive: true,
      },
      createdAt: dummyDate,
      updatedAt: dummyDate,
      isActive: true,
    },
    classes: [{ registeredMealPortions: 300 }, { registeredMealPortions: 250 }],
  };

  const mockRepo: OrganizationRepository = {
    findCookingMode: () => Promise.resolve({ cookingMode: "SEPARATE_BY_LOT" }),
    updateCookingMode: (_tx, _schoolId, cookingMode) =>
      Promise.resolve({ cookingMode }),
    findMealTimes: () =>
      Promise.resolve({ lunchTime: dummyDate, afternoonMealTime: dummyDate }),
    updateMealTimes: (_tx, _schoolId, data) => Promise.resolve(data),
    listSchools: () =>
      Promise.resolve([
        {
          id: dummySchool.id,
          name: dummySchool.name,
          code: dummySchool.code,
          status: dummySchool.status,
          createdAt: dummyDate,
          updatedAt: dummyDate,
        },
      ]),
    findPublicSchools: () =>
      Promise.resolve({ items: [dummySchool], total: 1 }),
    findPublicSchoolByCode: (code) =>
      Promise.resolve(code === "TH-DV" ? dummySchool : null),
    findPublicSchoolById: (id) =>
      Promise.resolve(id === "school-1" ? dummySchool : null),
    findPublicLocations: () =>
      Promise.resolve([
        {
          id: "loc-1",
          code: "CG",
          name: "Cầu Giấy",
          type: "DISTRICT",
          level: 2,
          parentId: "city-1",
        },
      ]),
    findSchoolForMenu: () => Promise.resolve(null),
    findMenuDayForDailyMenu: () => Promise.resolve(null),
    findLatestApprovedMenuDay: () => Promise.resolve(null),
    findWeeklyMenu: () => Promise.resolve(null),
    findLatestApprovedWeeklyMenu: () => Promise.resolve(null),
    findAvailableWeeklyMenuWeeks: () => Promise.resolve([]),
    findPortionGroupsRaw: () => Promise.resolve([]),
  };

  const service = createOrganizationService(mockRepo);

  // 1. getAll admin
  const adminList = await service.getAll({ page: 1, limit: 10 }, testAdmin);
  assert.equal(adminList.items.length, 1);
  assert.equal(adminList.items[0].id, "school-1");
  assert.equal(adminList.items[0].createdAt, dummyDate.toISOString());

  // 2. getPublicSchools
  const publicList = await service.getPublicSchools({ page: 1, limit: 10 });
  assert.equal(publicList.items.length, 1);
  assert.equal(publicList.items[0].boardingScale, "550 học sinh bán trú");
  assert.equal(publicList.items[0].address, "123 Cầu Giấy, Cầu Giấy, Hà Nội");
  assert.equal(publicList.pagination.total, 1);

  // 3. getPublicSchoolByCode
  const schoolByCode = await service.getPublicSchoolByCode("TH-DV");
  assert.equal(schoolByCode?.name, "Tiểu học Dịch Vọng");

  const notFound = await service.getPublicSchoolByCode("NOT-EXIST");
  assert.equal(notFound, null);
});
