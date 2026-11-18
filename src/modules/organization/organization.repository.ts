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

export const publicMenuDayInclude = {
  WeeklyMenu: {
    select: { id: true, title: true, weekStartDate: true },
  },
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

export interface PublicSchoolFilterArgs {
  skip: number;
  take: number;
  search?: string;
  locationId?: string;
  city?: string;
  district?: string;
}

export interface RawPortionGroup {
  id: string;
  name: string;
  is_default: boolean;
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
  findDeliveryInspectionRoles(
    schoolId: string,
  ): Promise<
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
  ): Promise<PublicMenuDayDbRow | null>;
  findLatestApprovedMenuDay(
    schoolId: string,
  ): Promise<PublicMenuDayDbRow | null>;
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
  findWeekGrades(
    schoolId: string,
    targetWeekMonday: Date,
  ): Promise<{ id: string; name: string }[]>;
  findPortionGroupsRaw(dayIds: string[]): Promise<RawPortionGroup[]>;
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

    async findMenuDayForDailyMenu(schoolId: string, targetDate: Date) {
      const prisma = await getClient();
      return prisma.menuDay.findFirst({
        where: {
          menuDate: targetDate,
          WeeklyMenu: {
            schoolId,
            status: { in: ["APPROVED", "PENDING_APPROVAL"] },
          },
          approvalStatus: "APPROVED",
        },
        include: publicMenuDayInclude,
      });
    },

    async findLatestApprovedMenuDay(schoolId: string) {
      const prisma = await getClient();
      return prisma.menuDay.findFirst({
        where: {
          WeeklyMenu: {
            schoolId,
            status: { in: ["APPROVED", "PENDING_APPROVAL"] },
          },
          approvalStatus: "APPROVED",
        },
        orderBy: { menuDate: "desc" },
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
        orderBy: [{ isSchoolWide: "desc" }, { createdAt: "asc" }],
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

    async findWeekGrades(schoolId: string, targetWeekMonday: Date) {
      const prisma = await getClient();
      const menuGrades = await prisma.weeklyMenuGrade.findMany({
        where: {
          schoolId,
          weekStartDate: targetWeekMonday,
          weeklyMenu: { status: { in: ["APPROVED", "PENDING_APPROVAL"] } },
        },
        select: {
          gradeId: true,
          grade: { select: { id: true, name: true } },
        },
      });
      const seen = new Set<string>();
      const result: { id: string; name: string }[] = [];
      for (const mg of menuGrades) {
        if (mg.grade && !seen.has(mg.grade.id)) {
          seen.add(mg.grade.id);
          result.push({ id: mg.grade.id, name: mg.grade.name });
        }
      }
      return result;
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

    async findPortionGroupsRaw(dayIds: string[]) {
      if (dayIds.length === 0) return [];
      const prisma = await getClient();
      try {
        const rawGroups = await prisma.$queryRaw<RawPortionGroup[]>`
          SELECT DISTINCT id, name, is_default
          FROM foodprint.menu_meal_portion_groups
          WHERE menu_day_id = ANY(${dayIds}::uuid[])
          ORDER BY is_default DESC, name ASC;
        `;
        return rawGroups ?? [];
      } catch {
        return [];
      }
    },
  };
}

export const organizationRepository = createOrganizationRepository();
