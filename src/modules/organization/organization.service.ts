import type { AuthPrincipal } from "../../types/auth";
import { listScopes } from "../../utils/resource-access";
import type {
  CookingMode,
  Prisma,
  PrismaClient,
} from "../../generated/prisma/client";
import { ROLES } from "../../constants/roles";
import {
  assertPermission,
  withSchoolTransaction,
} from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";
import type {
  PublicDailyMenuQuery,
  PublicSchoolListQuery,
  PublicWeeklyMenuQuery,
  MealTimesInput,
} from "./organization.validation";
import {
  getPublicSchools,
  getPublicSchoolByCode,
  getPublicSchoolById,
  getPublicLocations,
} from "./public-school.service";
import { getPublicDailyMenu, getPublicWeeklyMenu } from "./public-menu.service";
import type {
  PublicSchoolDTO,
  PublicSchoolListResult,
  PublicDailyMenuDTO,
  PublicWeeklyMenuDTO,
  DishItemDTO,
  SnackItemDTO,
  PortionGroupDTO,
  WeeklyMenuDayDTO,
} from "./dtos";

const select = {
  id: true,
  name: true,
  code: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.SchoolSelect;

type ListRow = Prisma.SchoolGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.SchoolFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof select;
};
export type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.school.findMany(args);
};

const COOKING_MODE_PERMISSION = "school_cooking_mode.manage";
const MEAL_TIME_PERMISSION = "school_meal_time.manage";

function assertCookingModeManager(principal: AuthPrincipal) {
  assertPermission(principal, COOKING_MODE_PERMISSION);
  if (
    principal.role !== ROLES.SCHOOL_MANAGEMENT_BOARD ||
    principal.orgType !== "SCHOOL" ||
    !principal.schoolId
  )
    throw new HttpError(403, "Chỉ Ban Giám hiệu được cấu hình chế độ nấu");
}

function assertMealTimeManager(principal: AuthPrincipal) {
  assertPermission(principal, MEAL_TIME_PERMISSION);
  if (
    principal.role !== ROLES.SCHOOL_MANAGEMENT_BOARD ||
    principal.orgType !== "SCHOOL" ||
    !principal.schoolId
  )
    throw new HttpError(403, "Chỉ Ban Giám hiệu được cấu hình giờ phục vụ");
}

function formatTime(value: Date | null) {
  return value ? value.toISOString().slice(11, 16) : null;
}

function timeValue(value: string | null) {
  return value ? new Date(`1970-01-01T${value}:00.000Z`) : null;
}

export function createOrganizationService(
  read: ListReader = readFromDatabase,
  getClient: () => Promise<PrismaClient> = getPrisma,
) {
  return {
    getAll(query: ListQuery, principal: AuthPrincipal) {
      const where = listScopes["organization"](principal);
      return readListPage(
        () =>
          read({
            ...listWindow(query),
            where,
            select,
            orderBy: [{ id: "asc" }],
          }),
        query,
      );
    },

    async getCookingMode(principal: AuthPrincipal) {
      assertCookingModeManager(principal);
      const prisma = await getClient();
      return prisma.school.findUniqueOrThrow({
        where: { id: principal.schoolId! },
        select: { cookingMode: true },
      });
    },

    // Mẻ đã lập giữ chế độ cũ; giá trị mới chỉ áp dụng cho kế hoạch nấu sau đó.
    async updateCookingMode(
      cookingMode: CookingMode,
      principal: AuthPrincipal,
    ) {
      assertCookingModeManager(principal);
      return withSchoolTransaction(
        await getClient(),
        principal,
        COOKING_MODE_PERMISSION,
        (tx, actor, schoolId) => {
          assertCookingModeManager(actor);
          return tx.school.update({
            where: { id: schoolId },
            data: { cookingMode },
            select: { cookingMode: true },
          });
        },
      );
    },

    async getMealTimes(principal: AuthPrincipal) {
      assertMealTimeManager(principal);
      const prisma = await getClient();
      const school = await prisma.school.findUniqueOrThrow({
        where: { id: principal.schoolId! },
        select: { lunchTime: true, afternoonMealTime: true },
      });
      return {
        lunchTime: formatTime(school.lunchTime),
        afternoonMealTime: formatTime(school.afternoonMealTime),
      };
    },

    async updateMealTimes(input: MealTimesInput, principal: AuthPrincipal) {
      assertMealTimeManager(principal);
      const school = await withSchoolTransaction(
        await getClient(),
        principal,
        MEAL_TIME_PERMISSION,
        (tx, actor, schoolId) => {
          assertMealTimeManager(actor);
          return tx.school.update({
            where: { id: schoolId },
            data: {
              lunchTime: timeValue(input.lunchTime),
              afternoonMealTime: timeValue(input.afternoonMealTime),
            },
            select: { lunchTime: true, afternoonMealTime: true },
          });
        },
      );
      return {
        lunchTime: formatTime(school.lunchTime),
        afternoonMealTime: formatTime(school.afternoonMealTime),
      };
    },

    getPublicSchools(query: PublicSchoolListQuery) {
      return getPublicSchools(query, getClient);
    },

    getPublicSchoolByCode(code: string) {
      return getPublicSchoolByCode(code, getClient);
    },

    getPublicSchoolById(id: string) {
      return getPublicSchoolById(id, getClient);
    },

    getPublicLocations() {
      return getPublicLocations(getClient);
    },

    getPublicDailyMenu(schoolCode: string, query: PublicDailyMenuQuery) {
      return getPublicDailyMenu(schoolCode, query, getClient);
    },

    getPublicWeeklyMenu(schoolCode: string, query: PublicWeeklyMenuQuery) {
      return getPublicWeeklyMenu(schoolCode, query, getClient);
    },
  };
}

export const organizationService = createOrganizationService();
export type OrganizationService = ReturnType<typeof createOrganizationService>;

export {
  type PublicSchoolDTO,
  type PublicSchoolListResult,
  type PublicDailyMenuDTO,
  type PublicWeeklyMenuDTO,
  type DishItemDTO,
  type SnackItemDTO,
  type PortionGroupDTO,
  type WeeklyMenuDayDTO,
};
