import type { AuthPrincipal } from "../../types/auth";
import { listScopes } from "../../utils/resource-access";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";
import type {
  PublicDailyMenuQuery,
  PublicSchoolListQuery,
  PublicWeeklyMenuQuery,
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
