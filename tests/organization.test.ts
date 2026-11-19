import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma, PrismaClient } from "../src/generated/prisma/client";
import type { AuthPrincipal } from "../src/types/auth";
import {
  validateOrganizationListQuery,
  validatePublicDailyMenuQuery,
  validatePublicSchoolGradesQuery,
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
    intakeState: "ACTIVE",
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
    listDirectory: () =>
      Promise.resolve({
        items: [
          {
            id: dummySchool.id,
            name: dummySchool.name,
            code: dummySchool.code,
            email: dummySchool.email,
            phone: dummySchool.phone,
            address: dummySchool.address,
            status: dummySchool.status,
            createdAt: dummyDate,
            updatedAt: dummyDate,
          },
        ],
        total: 1,
      }),
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
    findCurrentAcademicYear: () => Promise.resolve(null),
    findApprovedWeekStartDates: () => Promise.resolve([]),
    findDeliveryInspectionRoles: () => Promise.resolve([]),
    findRoleIdsByCodes: () => Promise.resolve([]),
    replaceDeliveryInspectionRoles: () => Promise.resolve([]),
  };

  const mockClient = {
    $transaction: <T>(op: (tx: unknown) => Promise<T>) => op({}),
  } as unknown as PrismaClient;

  const service = createOrganizationService(mockRepo, () =>
    Promise.resolve(mockClient),
  );

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

void test("public school grades flag hasMenu from school-wide and grade menus", async () => {
  const grades = [
    { id: "g1", name: "Khối 1" },
    { id: "g2", name: "Khối 2" },
  ];
  const makeService = (coverage: {
    hasSchoolWideMenu: boolean;
    gradeIds: string[];
  }) => {
    let requestedMonday: Date | undefined;
    const repo = {
      findSchoolForMenu: () => Promise.resolve({ id: "school-1" }),
      findSchoolGrades: () => Promise.resolve(grades),
      findWeekMenuCoverage: (_schoolId: string, weekMonday: Date) => {
        requestedMonday = weekMonday;
        return Promise.resolve(coverage);
      },
    } as unknown as OrganizationRepository;
    return {
      service: createOrganizationService(repo),
      monday: () => requestedMonday?.toISOString().slice(0, 10),
    };
  };

  const schoolWide = makeService({ hasSchoolWideMenu: true, gradeIds: [] });
  const all = await schoolWide.service.getPublicSchoolGrades("SCH", {
    week: "2026-11-19",
  });
  assert.deepEqual(
    all.map((g) => g.hasMenu),
    [true, true],
  );
  assert.equal(schoolWide.monday(), "2026-11-16");

  const gradeOnly = makeService({ hasSchoolWideMenu: false, gradeIds: ["g2"] });
  const partial = await gradeOnly.service.getPublicSchoolGrades("SCH", {});
  assert.deepEqual(
    partial.map((g) => [g.id, g.hasMenu]),
    [
      ["g1", false],
      ["g2", true],
    ],
  );
});

void test("public school grades query validates week format", () => {
  assert.deepEqual(validatePublicSchoolGradesQuery({ week: "2026-11-16" }), {
    week: "2026-11-16",
  });
  assert.throws(
    () => validatePublicSchoolGradesQuery({ week: "16/11/2026" }),
    OrganizationValidationError,
  );
  assert.throws(
    () => validatePublicSchoolGradesQuery({ grade: "x" }),
    OrganizationValidationError,
  );
});

void test("public daily menu resolves per-grade portions, ingredients and allergy substitutes", async () => {
  const dec = (v: string) => new Prisma.Decimal(v);
  const ing = (id: string, name: string) => ({
    id,
    name,
    defaultUnit: "g",
    ingredientCategory: { categoryName: "Thịt" },
    Supplier: { name: "NCC A" },
  });
  const dish = (
    id: string,
    name: string,
    opts: {
      standard?: [string, string, string, string][];
      grade?: Record<string, [string, string, string, string][]>;
      menu?: [string, string, string][];
    } = {},
  ) => ({
    menuDayId: "day-1",
    dishId: id,
    mealType: "LUNCH",
    portionSize: null,
    portionUnit: null,
    displayOrder: Number(id.slice(-1)),
    Dish: {
      id,
      name,
      description: null,
      status: "ACTIVE",
      category: "MAIN_DISH",
      schoolCategory: null,
      dishIngredientEntries: (opts.standard ?? []).map(([iid, n, q, role]) => ({
        ingredientEntryId: `e-${iid}`,
        ingredientRole: role,
        requiredQuantity: dec(q),
        unit: "g",
        IngredientEntry: { Ingredient: ing(iid, n) },
      })),
      gradeRecipes: Object.entries(opts.grade ?? {}).map(
        ([gradeId, lines]) => ({
          gradeId,
          lines: lines.map(([iid, n, q, role]) => ({
            ingredientEntryId: `e-${iid}`,
            ingredientRole: role,
            requiredQuantity: dec(q),
            unit: "g",
            entry: { Ingredient: ing(iid, n) },
          })),
        }),
      ),
    },
    ingredients: (opts.menu ?? []).map(([iid, n, q]) => ({
      ingredientId: iid,
      quantityPerPortion: dec(q),
      unit: "kg",
      ingredient: ing(iid, n),
    })),
  });

  const menuDay = {
    id: "day-1",
    menuDate: new Date("2026-11-16T00:00:00.000Z"),
    note: null,
    WeeklyMenu: {
      id: "wm",
      title: "T",
      weekStartDate: new Date(),
      isSchoolWide: true,
    },
    menuDayDishes: [
      dish("d1", "Thịt kho", {
        standard: [
          ["i1", "Thịt heo", "60", "MAIN"],
          ["i9", "Muối", "1", "SEASONING"],
        ],
        grade: { g2: [["i1", "Thịt heo", "80", "MAIN"]] },
        menu: [["i1", "Thịt heo", "0.07"]],
      }),
      dish("d2", "Canh rau", { standard: [["i2", "Rau ngót", "40", "MAIN"]] }),
      dish("d3", "Đậu sốt cà", { standard: [["i3", "Đậu phụ", "70", "MAIN"]] }),
    ],
    portionGroups: [
      {
        id: "pg-std",
        name: "Tiêu chuẩn",
        isDefault: true,
        mealType: "LUNCH",
        dishes: [{ dishId: "d1" }, { dishId: "d2" }],
      },
      {
        id: "pg-alg",
        name: "Dị ứng thịt",
        isDefault: false,
        mealType: "LUNCH",
        dishes: [{ dishId: "d2" }, { dishId: "d3" }],
      },
    ],
  };

  const repo = {
    findSchoolForMenu: () =>
      Promise.resolve({
        id: "school-1",
        lunchTime: null,
        afternoonMealTime: null,
        coverImageUrl: null,
      }),
    findMenuDayForDailyMenu: () => Promise.resolve(menuDay),
    findLatestApprovedMenuDay: () => Promise.resolve(null),
  } as unknown as OrganizationRepository;
  const service = createOrganizationService(repo);

  // Khối có định lượng riêng -> dùng định lượng khối
  const g2 = await service.getPublicDailyMenu("SCH", {
    date: "2026-11-16",
    grade: "g2",
  });
  const mainG2 = g2!.lunch.dishes.find((d) => d.id === "d1")!;
  assert.equal(mainG2.recipeSource, "GRADE");
  assert.equal(mainG2.portion, "80 g");
  assert.equal(mainG2.ingredients![0].portion, "80 g");
  assert.equal(mainG2.ingredients![0].supplierName, "NCC A");

  // Khối không có định lượng riêng -> dùng nguyên liệu đã chốt trong thực đơn
  const g1 = await service.getPublicDailyMenu("SCH", {
    date: "2026-11-16",
    grade: "g1",
  });
  const mainG1 = g1!.lunch.dishes.find((d) => d.id === "d1")!;
  assert.equal(mainG1.recipeSource, "MENU");
  assert.equal(mainG1.portion, "70 g");

  // Món chỉ thuộc nhóm dị ứng là món thay thế, không nằm ở cột chính
  assert.deepEqual(
    g1!.lunch.dishes.map((d) => d.id),
    ["d1", "d2"],
  );
  assert.equal(mainG1.alternativeDish?.id, "d3");
  assert.equal(mainG1.alternativeDish?.allergyGroup, "Dị ứng thịt");
  assert.equal(mainG1.alternativeDish?.portion, "70 g");
  assert.equal(g1!.lunch.dishes[1].alternativeDish, null);
  assert.equal(g1!.lunch.dishes[1].recipeSource, "STANDARD");
});
