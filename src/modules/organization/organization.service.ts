import type { AuthPrincipal } from "../../types/auth";
import { listScopes } from "../../utils/resource-access";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";
import type { PublicSchoolListQuery } from "./organization.validation";

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

function formatTimeString(d: Date | null | undefined): string | null {
  if (!d) return null;
  const hours = d.getHours().toString().padStart(2, "0");
  const minutes = d.getMinutes().toString().padStart(2, "0");
  const seconds = d.getSeconds().toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

export interface PublicSchoolDTO {
  id: string;
  code: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  locationId: string | null;
  addressLine: string | null;
  address: string;
  district: string | null;
  city: string;
  websiteUrl: string | null;
  description: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  cookingMode: string | null;
  lunchTime: string | null;
  afternoonMealTime: string | null;
  boardingScale: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  // Aliases for backward-compatibility with frontend bindings
  location_id: string | null;
  address_line: string | null;
  website_url: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  cooking_mode: string | null;
  lunch_time: string | null;
  afternoon_meal_time: string | null;
  boarding_scale: string;
  created_at: string;
  updated_at: string;
}

export interface PublicSchoolListResult {
  items: PublicSchoolDTO[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
  };
}

type SchoolQueryResult = {
  id: string;
  code: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  locationId: string | null;
  address: string | null;
  websiteUrl: string | null;
  description: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  cookingMode: string | null;
  lunchTime: Date | null;
  afternoonMealTime: Date | null;
  boardingScale: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  location?: {
    id: string;
    code: string;
    name: string;
    type: string;
    level: number;
    parent?: {
      id: string;
      code: string;
      name: string;
      type: string;
    } | null;
  } | null;
  classes?: Array<{ registeredMealPortions: number }>;
};

function mapSchoolToDTO(school: SchoolQueryResult): PublicSchoolDTO {
  const district = school.location?.name || null;
  const city = school.location?.parent?.name || "Hà Nội";
  const addressParts = [school.address, district, city].filter(Boolean);
  const fullAddress = addressParts.join(", ");

  let boardingScale = school.boardingScale || "Đang cập nhật";
  if (school.classes && school.classes.length > 0) {
    const totalPortions = school.classes.reduce(
      (sum, c) => sum + (c.registeredMealPortions || 0),
      0,
    );
    if (totalPortions > 0) {
      boardingScale = `${totalPortions.toLocaleString("vi-VN")} học sinh bán trú`;
    }
  }

  const lunchTime = formatTimeString(school.lunchTime);
  const afternoonMealTime = formatTimeString(school.afternoonMealTime);
  const createdAtIso = school.createdAt.toISOString();
  const updatedAtIso = school.updatedAt.toISOString();

  return {
    id: school.id,
    code: school.code,
    name: school.name,
    email: school.email,
    phone: school.phone,
    locationId: school.locationId,
    addressLine: school.address,
    address: fullAddress,
    district,
    city,
    websiteUrl: school.websiteUrl,
    description: school.description,
    logoUrl: school.logoUrl,
    coverImageUrl: school.coverImageUrl,
    cookingMode: school.cookingMode,
    lunchTime,
    afternoonMealTime,
    boardingScale,
    status: school.status,
    createdAt: createdAtIso,
    updatedAt: updatedAtIso,
    // Aliases
    location_id: school.locationId,
    address_line: school.address,
    website_url: school.websiteUrl,
    logo_url: school.logoUrl,
    cover_image_url: school.coverImageUrl,
    cooking_mode: school.cookingMode,
    lunch_time: lunchTime,
    afternoon_meal_time: afternoonMealTime,
    boarding_scale: boardingScale,
    created_at: createdAtIso,
    updated_at: updatedAtIso,
  };
}

export type PrismaProvider = () => Promise<PrismaClient>;

export interface OrganizationServiceDeps {
  readList?: ListReader;
  prismaProvider?: PrismaProvider;
}

export function createOrganizationService(
  deps: ListReader | OrganizationServiceDeps = readFromDatabase,
) {
  const read =
    typeof deps === "function" ? deps : deps.readList || readFromDatabase;
  const getClient: PrismaProvider =
    typeof deps === "object" && deps.prismaProvider
      ? deps.prismaProvider
      : getPrisma;

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

    async getPublicSchools(
      query: PublicSchoolListQuery,
    ): Promise<PublicSchoolListResult> {
      const prisma = await getClient();
      const page = query.page;
      const limit = query.limit;
      const skip = (page - 1) * limit;

      const where: Prisma.SchoolWhereInput = {
        status: "ACTIVE",
      };

      if (query.search) {
        const s = query.search;
        where.OR = [
          { name: { contains: s, mode: "insensitive" } },
          { code: { contains: s, mode: "insensitive" } },
          { address: { contains: s, mode: "insensitive" } },
          { location: { name: { contains: s, mode: "insensitive" } } },
        ];
      }

      if (query.locationId) {
        where.locationId = query.locationId;
      }

      const [schools, total] = await Promise.all([
        prisma.school.findMany({
          where,
          skip,
          take: limit,
          orderBy: [{ code: "asc" }, { name: "asc" }],
          include: {
            location: {
              include: {
                parent: true,
              },
            },
            classes: {
              where: { status: "ACTIVE" },
              select: { registeredMealPortions: true },
            },
          },
        }),
        prisma.school.count({ where }),
      ]);

      const items = schools.map(mapSchoolToDTO);
      const totalPages = Math.ceil(total / limit);
      const hasNext = page < totalPages;

      return {
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext,
        },
      };
    },

    async getPublicSchoolByCode(code: string): Promise<PublicSchoolDTO | null> {
      const prisma = await getClient();
      const school = await prisma.school.findFirst({
        where: {
          code: { equals: code.trim(), mode: "insensitive" },
          status: "ACTIVE",
        },
        include: {
          location: {
            include: {
              parent: true,
            },
          },
          classes: {
            where: { status: "ACTIVE" },
            select: { registeredMealPortions: true },
          },
        },
      });

      if (!school) return null;
      return mapSchoolToDTO(school);
    },

    async getPublicSchoolById(id: string): Promise<PublicSchoolDTO | null> {
      const prisma = await getClient();
      const school = await prisma.school.findFirst({
        where: {
          id: id.trim(),
          status: "ACTIVE",
        },
        include: {
          location: {
            include: {
              parent: true,
            },
          },
          classes: {
            where: { status: "ACTIVE" },
            select: { registeredMealPortions: true },
          },
        },
      });

      if (!school) return null;
      return mapSchoolToDTO(school);
    },
  };
}

export const organizationService = createOrganizationService();
export type OrganizationService = ReturnType<typeof createOrganizationService>;
