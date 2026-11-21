import type {
  CookingMode,
  DeliveryInspectionTier,
  Prisma,
  PrismaClient,
} from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import { getPrisma } from "../../utils/database";
import { listWindow, type ListQuery } from "../../utils/list-query";
import { listScopes } from "../../utils/resource-access";

export const schoolListSelect = {
  id: true,
  name: true,
  code: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.SchoolSelect;

export type SchoolListDbRow = Prisma.SchoolGetPayload<{
  select: typeof schoolListSelect;
}>;

const directorySelect = {
  ...schoolListSelect,
  email: true,
  phone: true,
  address: true,
} as const satisfies Prisma.SchoolSelect;
export type SchoolDirectoryRow = Prisma.SchoolGetPayload<{
  select: typeof directorySelect;
}>;
interface DirectoryFilter {
  page: number;
  limit: number;
  search?: string;
  status?: "ACTIVE" | "INACTIVE";
}
export const publicSchoolInclude = {
  location: {
    include: {
      parent: true,
    },
  },
  classes: {
    where: { status: "ACTIVE" },
    select: { registeredMealPortions: true },
  },
} as const satisfies Prisma.SchoolInclude;

export type PublicSchoolDbRow = Prisma.SchoolGetPayload<{
  include: typeof publicSchoolInclude;
}>;

export const publicLocationSelect = {
  id: true,
  code: true,
  name: true,
  type: true,
  level: true,
  parentId: true,
} as const satisfies Prisma.LocationSelect;

export type PublicLocationDbRow = Prisma.LocationGetPayload<{
  select: typeof publicLocationSelect;
}>;

export const schoolForMenuSelect = {
  id: true,
  code: true,
  name: true,
  lunchTime: true,
  afternoonMealTime: true,
  coverImageUrl: true,
} as const satisfies Prisma.SchoolSelect;

export type SchoolForMenuDbRow = Prisma.SchoolGetPayload<{
  select: typeof schoolForMenuSelect;
}>;

// Thông tin nguyên liệu công khai: tên, nhóm, nhà cung cấp, đơn vị mặc định
const publicIngredientSelect = {
  id: true,
  name: true,
  defaultUnit: true,
  ingredientCategory: { select: { categoryName: true } },
  Supplier: { select: { name: true } },
} as const satisfies Prisma.IngredientSelect;

const publicRecipeLineSelect = {
  ingredientEntryId: true,
  ingredientRole: true,
  requiredQuantity: true,
  unit: true,
} as const;

export const publicMenuDayInclude = {
  WeeklyMenu: {
    select: { id: true, title: true, weekStartDate: true, isSchoolWide: true },
  },
  menuDayDishes: {
    include: {
      Dish: {
        select: {
          id: true,
          name: true,
          description: true,
          status: true,
          category: true,
          schoolCategory: { select: { name: true } },
          // Định lượng chuẩn của món (1 suất)
          dishIngredientEntries: {
            select: {
              ...publicRecipeLineSelect,
              IngredientEntry: {
                select: { Ingredient: { select: publicIngredientSelect } },
              },
            },
          },
          // Định lượng riêng theo khối
          gradeRecipes: {
            select: {
              gradeId: true,
              lines: {
                select: {
                  ...publicRecipeLineSelect,
                  entry: {
                    select: { Ingredient: { select: publicIngredientSelect } },
                  },
                },
              },
            },
          },
        },
      },
      // Nguyên liệu chính cố định cho lần xuất hiện này của món trong thực đơn
      ingredients: {
        select: {
          ingredientId: true,
          quantityPerPortion: true,
          unit: true,
          ingredient: { select: publicIngredientSelect },
        },
      },
    },
    orderBy: [
      { mealType: "asc" as const },
      { displayOrder: "asc" as const },
      { dishId: "asc" as const },
    ],
  },
  // Nhóm suất ăn (tiêu chuẩn / dị ứng) để ghép món thay thế
  portionGroups: {
    select: {
      id: true,
      name: true,
      isDefault: true,
      mealType: true,
      dishes: { select: { dishId: true } },
    },
    orderBy: { name: "asc" as const },
  },
} as const satisfies Prisma.MenuDayInclude;

export type PublicMenuDayDbRow = Prisma.MenuDayGetPayload<{
  include: typeof publicMenuDayInclude;
}>;

export const publicWeeklyMenuInclude = {
  menuDays: {
    where: { approvalStatus: "APPROVED" as const },
    include: {
      menuDayDishes: {
        include: {
          Dish: {
            select: {
              id: true,
              name: true,
              description: true,
              status: true,
            },
          },
        },
        orderBy: [
          { mealType: "asc" as const },
          { displayOrder: "asc" as const },
          { dishId: "asc" as const },
        ],
      },
      // Nhóm suất để nhận ra món thay thế dị ứng (nhóm riêng đổi đúng 1 món)
      portionGroups: {
        select: {
          mealType: true,
          isDefault: true,
          dishes: { select: { dishId: true } },
        },
      },
    },
    orderBy: { menuDate: "asc" as const },
  },
} as const satisfies Prisma.WeeklyMenuInclude;

export type PublicWeeklyMenuDbRow = Prisma.WeeklyMenuGetPayload<{
  include: typeof publicWeeklyMenuInclude;
}>;

export const availableWeekSelect = {
  id: true,
  title: true,
  weekStartDate: true,
  status: true,
} as const satisfies Prisma.WeeklyMenuSelect;

export type AvailableWeekDbRow = Prisma.WeeklyMenuGetPayload<{
  select: typeof availableWeekSelect;
}>;

export const publicSchoolSupplierInclude = {
  Supplier: {
    include: {
      supplierCertifications: {
        where: { status: "ACTIVE" as const },
        orderBy: { createdAt: "desc" as const },
      },
      ingredients: {
        where: { status: "ACTIVE" as const },
        include: {
          ingredientCategory: { select: { id: true, categoryName: true } },
          measurementUnit: { select: { id: true, name: true } },
        },
        orderBy: { name: "asc" as const },
      },
    },
  },
  contracts: {
    where: { status: "ACTIVE" },
    include: {
      items: {
        include: {
          ingredient: {
            include: {
              ingredientCategory: { select: { id: true, categoryName: true } },
              measurementUnit: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" as const },
  },
} as const satisfies Prisma.SchoolSupplierRelationshipInclude;

export type PublicSchoolSupplierDbRow =
  Prisma.SchoolSupplierRelationshipGetPayload<{
    include: typeof publicSchoolSupplierInclude;
  }>;

export interface PublicSchoolFilterArgs {
  skip: number;
  take: number;
  search?: string;
  locationId?: string;
  city?: string;
  district?: string;
}

export interface OrganizationRepository {
  listDirectory?(
    tx: Prisma.TransactionClient,
    scope: Prisma.SchoolWhereInput,
    q: DirectoryFilter,
  ): Promise<{ items: SchoolDirectoryRow[]; total: number }>;
  summary?(
    tx: Prisma.TransactionClient,
    scope: Prisma.SchoolWhereInput,
  ): Promise<{ total: number; activeCount: number }>;
  detail?(
    tx: Prisma.TransactionClient,
    scope: Prisma.SchoolWhereInput,
    id: string,
  ): Promise<SchoolDirectoryRow | null>;
  findCookingMode(
    schoolId: string,
  ): Promise<{ cookingMode: CookingMode | null }>;
  updateCookingMode(
    tx: Prisma.TransactionClient,
    schoolId: string,
    cookingMode: CookingMode,
  ): Promise<{ cookingMode: CookingMode | null }>;
  findMealTimes(
    schoolId: string,
  ): Promise<{ lunchTime: Date | null; afternoonMealTime: Date | null }>;
  updateMealTimes(
    tx: Prisma.TransactionClient,
    schoolId: string,
    data: { lunchTime: Date | null; afternoonMealTime: Date | null },
  ): Promise<{ lunchTime: Date | null; afternoonMealTime: Date | null }>;
  findDeliveryInspectionRoles(schoolId: string): Promise<
    Array<{
      tier: DeliveryInspectionTier;
      updatedAt: Date;
      Role: { code: string };
    }>
  >;
  findRoleIdsByCodes(
    tx: Prisma.TransactionClient,
    codes: string[],
  ): Promise<Array<{ id: string; code: string }>>;
  replaceDeliveryInspectionRoles(
    tx: Prisma.TransactionClient,
    schoolId: string,
    rows: Array<{
      roleId: string;
      tier: DeliveryInspectionTier;
      updatedByUserId: string;
    }>,
  ): Promise<
    Array<{
      tier: DeliveryInspectionTier;
      updatedAt: Date;
      Role: { code: string };
    }>
  >;
  listSchools(
    query: ListQuery,
    principal: AuthPrincipal,
  ): Promise<SchoolListDbRow[]>;
  findPublicSchools(
    args: PublicSchoolFilterArgs,
  ): Promise<{ items: PublicSchoolDbRow[]; total: number }>;
  findPublicSchoolByCode(code: string): Promise<PublicSchoolDbRow | null>;
  findPublicSchoolById(id: string): Promise<PublicSchoolDbRow | null>;
  findPublicLocations(): Promise<PublicLocationDbRow[]>;
  findSchoolForMenu(schoolCode: string): Promise<SchoolForMenuDbRow | null>;
  findMenuDayForDailyMenu(
    schoolId: string,
    targetDate: Date,
    gradeId?: string,
  ): Promise<PublicMenuDayDbRow | null>;
  findLatestApprovedMenuDay(
    schoolId: string,
    gradeId?: string,
  ): Promise<PublicMenuDayDbRow | null>;
  findSchoolGrades?(schoolId: string): Promise<{ id: string; name: string }[]>;
  findWeekMenuCoverage?(
    schoolId: string,
    weekMonday: Date,
  ): Promise<{ hasSchoolWideMenu: boolean; gradeIds: string[] }>;
  findWeeklyMenu(
    schoolId: string,
    targetWeekMonday?: Date,
    gradeId?: string,
  ): Promise<PublicWeeklyMenuDbRow | null>;
  findLatestApprovedWeeklyMenu(
    schoolId: string,
  ): Promise<PublicWeeklyMenuDbRow | null>;
  findAvailableWeeklyMenuWeeks(schoolId: string): Promise<AvailableWeekDbRow[]>;
  findCurrentAcademicYear(
    schoolId: string,
    targetDate?: Date,
  ): Promise<{
    id: string;
    academicYear: string;
    startDate: Date;
    endDate: Date;
    holidays: Prisma.JsonValue;
  } | null>;
  findApprovedWeekStartDates(
    schoolId: string,
    startRange?: Date,
    endRange?: Date,
  ): Promise<string[]>;
  findPublicSchoolSuppliers?(
    schoolId: string,
  ): Promise<PublicSchoolSupplierDbRow[]>;
}

export function createOrganizationRepository(
  getClient: () => Promise<PrismaClient> = getPrisma,
): OrganizationRepository {
  return {
    async listDirectory(tx, scope, q) {
      const search = q.search?.replace(/[\\%_]/g, "\\$&");
      const where: Prisma.SchoolWhereInput = {
        AND: [
          scope,
          q.status ? { status: q.status } : {},
          search
            ? {
                OR: [
                  { name: { contains: search, mode: "insensitive" } },
                  { code: { contains: search, mode: "insensitive" } },
                ],
              }
            : {},
        ],
      };
      const total = await tx.school.count({ where });
      const items = await tx.school.findMany({
        where,
        select: directorySelect,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { id: "asc" },
      });
      return { items, total };
    },
    async summary(tx, scope) {
      return {
        total: await tx.school.count({ where: scope }),
        activeCount: await tx.school.count({
          where: { AND: [scope, { status: "ACTIVE" }] },
        }),
      };
    },
    detail(tx, scope, id) {
      return tx.school.findFirst({
        where: { AND: [scope, { id }] },
        select: directorySelect,
      });
    },
    async findCookingMode(schoolId) {
      const prisma = await getClient();
      return prisma.school.findUniqueOrThrow({
        where: { id: schoolId },
        select: { cookingMode: true },
      });
    },

    updateCookingMode(tx, schoolId, cookingMode) {
      return tx.school.update({
        where: { id: schoolId },
        data: { cookingMode },
        select: { cookingMode: true },
      });
    },

    async findMealTimes(schoolId) {
      const prisma = await getClient();
      return prisma.school.findUniqueOrThrow({
        where: { id: schoolId },
        select: { lunchTime: true, afternoonMealTime: true },
      });
    },

    updateMealTimes(tx, schoolId, data) {
      return tx.school.update({
        where: { id: schoolId },
        data,
        select: { lunchTime: true, afternoonMealTime: true },
      });
    },

    async findDeliveryInspectionRoles(schoolId) {
      const prisma = await getClient();
      return prisma.schoolDeliveryInspectionRole.findMany({
        where: { schoolId },
        select: {
          tier: true,
          updatedAt: true,
          Role: { select: { code: true } },
        },
      });
    },

    findRoleIdsByCodes(tx, codes) {
      return tx.role.findMany({
        where: { code: { in: codes } },
        select: { id: true, code: true },
      });
    },

    async replaceDeliveryInspectionRoles(tx, schoolId, rows) {
      await tx.schoolDeliveryInspectionRole.deleteMany({
        where: { schoolId },
      });
      if (rows.length > 0) {
        await tx.schoolDeliveryInspectionRole.createMany({
          data: rows.map((r) => ({
            schoolId,
            roleId: r.roleId,
            tier: r.tier,
            updatedByUserId: r.updatedByUserId,
          })),
        });
      }
      return tx.schoolDeliveryInspectionRole.findMany({
        where: { schoolId },
        select: {
          tier: true,
          updatedAt: true,
          Role: { select: { code: true } },
        },
      });
    },

    async listSchools(query, principal) {
      const prisma = await getClient();
      const where = listScopes.organization(principal);
      return prisma.school.findMany({
        ...listWindow(query),
        where,
        select: schoolListSelect,
        orderBy: [{ id: "asc" }],
      });
    },

    async findPublicSchools({
      skip,
      take,
      search,
      locationId,
      city,
      district,
    }) {
      const prisma = await getClient();
      const where: Prisma.SchoolWhereInput = {
        status: "ACTIVE",
      };

      if (search) {
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { code: { contains: search, mode: "insensitive" } },
          { address: { contains: search, mode: "insensitive" } },
          { location: { name: { contains: search, mode: "insensitive" } } },
        ];
      }

      if (locationId) {
        where.locationId = locationId;
      }

      if (city || district) {
        const locationFilter: Prisma.LocationWhereInput = {};
        if (district) {
          locationFilter.name = {
            contains: district,
            mode: "insensitive",
          };
        }
        if (city) {
          locationFilter.parent = {
            name: { contains: city, mode: "insensitive" },
          };
        }
        where.location = locationFilter;
      }

      const [items, total] = await Promise.all([
        prisma.school.findMany({
          where,
          skip,
          take,
          orderBy: [{ code: "asc" }, { name: "asc" }],
          include: publicSchoolInclude,
        }),
        prisma.school.count({ where }),
      ]);

      return { items, total };
    },

    async findPublicSchoolByCode(code: string) {
      const prisma = await getClient();
      return prisma.school.findFirst({
        where: {
          code: { equals: code.trim(), mode: "insensitive" },
          status: "ACTIVE",
        },
        include: publicSchoolInclude,
      });
    },

    async findPublicSchoolById(id: string) {
      const prisma = await getClient();
      return prisma.school.findFirst({
        where: {
          id: id.trim(),
          status: "ACTIVE",
        },
        include: publicSchoolInclude,
      });
    },

    async findPublicLocations() {
      const prisma = await getClient();
      return prisma.location.findMany({
        where: { isActive: true },
        orderBy: [{ level: "asc" }, { name: "asc" }],
        select: publicLocationSelect,
      });
    },

    async findSchoolForMenu(schoolCode: string) {
      const prisma = await getClient();
      return prisma.school.findFirst({
        where: {
          code: { equals: schoolCode.trim(), mode: "insensitive" },
          status: "ACTIVE",
        },
        select: schoolForMenuSelect,
      });
    },

    async findSchoolGrades(schoolId: string) {
      const prisma = await getClient();
      return prisma.schoolGrade.findMany({
        where: { schoolId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
    },

    async findWeekMenuCoverage(schoolId: string, weekMonday: Date) {
      const prisma = await getClient();
      const menus = await prisma.weeklyMenu.findMany({
        where: {
          schoolId,
          weekStartDate: weekMonday,
          status: { in: ["APPROVED", "PENDING_APPROVAL"] },
          menuDays: { some: { approvalStatus: "APPROVED" } },
        },
        select: { isSchoolWide: true, grades: { select: { gradeId: true } } },
      });
      return {
        hasSchoolWideMenu: menus.some((m) => m.isSchoolWide),
        gradeIds: menus.flatMap((m) => m.grades.map((g) => g.gradeId)),
      };
    },

    async findMenuDayForDailyMenu(
      schoolId: string,
      targetDate: Date,
      gradeId?: string,
    ) {
      const prisma = await getClient();
      return prisma.menuDay.findFirst({
        where: {
          menuDate: targetDate,
          WeeklyMenu: {
            schoolId,
            status: { in: ["APPROVED", "PENDING_APPROVAL"] },
            ...(gradeId && gradeId !== "all"
              ? {
                  OR: [
                    { isSchoolWide: true },
                    { grades: { some: { gradeId } } },
                  ],
                }
              : {}),
          },
          approvalStatus: "APPROVED",
        },
        orderBy: [{ WeeklyMenu: { isSchoolWide: "asc" } }],
        include: publicMenuDayInclude,
      });
    },

    async findLatestApprovedMenuDay(schoolId: string, gradeId?: string) {
      const prisma = await getClient();
      return prisma.menuDay.findFirst({
        where: {
          WeeklyMenu: {
            schoolId,
            status: { in: ["APPROVED", "PENDING_APPROVAL"] },
            ...(gradeId && gradeId !== "all"
              ? {
                  OR: [
                    { isSchoolWide: true },
                    { grades: { some: { gradeId } } },
                  ],
                }
              : {}),
          },
          approvalStatus: "APPROVED",
        },
        orderBy: [
          { menuDate: "desc" },
          { WeeklyMenu: { isSchoolWide: "asc" } },
        ],
        include: publicMenuDayInclude,
      });
    },

    async findWeeklyMenu(
      schoolId: string,
      targetWeekMonday?: Date,
      gradeId?: string,
    ) {
      const prisma = await getClient();
      const where: Prisma.WeeklyMenuWhereInput = {
        schoolId,
        status: { in: ["APPROVED", "PENDING_APPROVAL"] },
        ...(targetWeekMonday ? { weekStartDate: targetWeekMonday } : {}),
        ...(gradeId && gradeId !== "all"
          ? {
              OR: [{ isSchoolWide: true }, { grades: { some: { gradeId } } }],
            }
          : {}),
      };
      return prisma.weeklyMenu.findFirst({
        where,
        orderBy: [
          { isSchoolWide: gradeId && gradeId !== "all" ? "asc" : "desc" },
          { createdAt: "asc" },
        ],
        include: publicWeeklyMenuInclude,
      });
    },

    async findCurrentAcademicYear(schoolId: string, targetDate?: Date) {
      const prisma = await getClient();
      if (targetDate) {
        const year = await prisma.schoolAcademicYear.findFirst({
          where: {
            schoolId,
            startDate: { lte: targetDate },
            endDate: { gte: targetDate },
          },
        });
        if (year) return year;
      }
      const now = new Date();
      const current = await prisma.schoolAcademicYear.findFirst({
        where: {
          schoolId,
          startDate: { lte: now },
          endDate: { gte: now },
        },
      });
      if (current) return current;

      return prisma.schoolAcademicYear.findFirst({
        where: { schoolId },
        orderBy: { startDate: "desc" },
      });
    },

    async findApprovedWeekStartDates(
      schoolId: string,
      startRange?: Date,
      endRange?: Date,
    ) {
      const prisma = await getClient();
      const menus = await prisma.weeklyMenu.findMany({
        where: {
          schoolId,
          status: { in: ["APPROVED", "PENDING_APPROVAL"] },
          ...(startRange && endRange
            ? { weekStartDate: { gte: startRange, lte: endRange } }
            : {}),
        },
        select: { weekStartDate: true },
        distinct: ["weekStartDate"],
      });
      return menus.map((m) => m.weekStartDate.toISOString().slice(0, 10));
    },

    async findLatestApprovedWeeklyMenu(schoolId: string) {
      const prisma = await getClient();
      return prisma.weeklyMenu.findFirst({
        where: {
          schoolId,
          status: "APPROVED",
        },
        orderBy: { weekStartDate: "desc" },
        include: publicWeeklyMenuInclude,
      });
    },

    async findAvailableWeeklyMenuWeeks(schoolId: string) {
      const prisma = await getClient();
      return prisma.weeklyMenu.findMany({
        where: {
          schoolId,
          status: { in: ["APPROVED", "PENDING_APPROVAL"] },
        },
        select: availableWeekSelect,
        orderBy: { weekStartDate: "desc" },
      });
    },

    async findPublicSchoolSuppliers(schoolId: string) {
      const prisma = await getClient();
      return prisma.schoolSupplierRelationship.findMany({
        where: {
          schoolId,
          status: "ACTIVE",
          Supplier: {
            status: "ACTIVE",
          },
        },
        include: publicSchoolSupplierInclude,
        orderBy: { linkedAt: "desc" },
      });
    },
  };
}

export const organizationRepository = createOrganizationRepository();
