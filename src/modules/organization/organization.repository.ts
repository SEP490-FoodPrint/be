import type { Prisma, PrismaClient } from "../../generated/prisma/client";
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
  ): Promise<PublicWeeklyMenuDbRow | null>;
  findLatestApprovedWeeklyMenu(
    schoolId: string,
  ): Promise<PublicWeeklyMenuDbRow | null>;
  findAvailableWeeklyMenuWeeks(schoolId: string): Promise<AvailableWeekDbRow[]>;
  findPortionGroupsRaw(dayIds: string[]): Promise<RawPortionGroup[]>;
}

export function createOrganizationRepository(
  getClient: () => Promise<PrismaClient> = getPrisma,
): OrganizationRepository {
  return {
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

    async findWeeklyMenu(schoolId: string, targetWeekMonday?: Date) {
      const prisma = await getClient();
      return prisma.weeklyMenu.findFirst({
        where: {
          schoolId,
          status: { in: ["APPROVED", "PENDING_APPROVAL"] },
          ...(targetWeekMonday ? { weekStartDate: targetWeekMonday } : {}),
        },
        orderBy: { weekStartDate: "desc" },
        include: publicWeeklyMenuInclude,
      });
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
