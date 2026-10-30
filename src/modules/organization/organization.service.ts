import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";

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
  "skip" | "take" | "orderBy"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

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

export interface PublicSchoolQuery {
  search?: string;
  locationId?: string;
  page?: number;
  limit?: number;
}

export interface PublicSchoolDTO {
  id: string;
  code: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  location_id: string | null;
  address_line: string | null;
  address: string;
  district: string | null;
  city: string;
  website_url: string | null;
  description: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  cooking_mode: string | null;
  lunch_time: string | null;
  afternoon_meal_time: string | null;
  boarding_scale: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

function mapSchoolToDTO(school: {
  id: string;
  code: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  locationId: string | null;
  addressLine: string | null;
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
}): PublicSchoolDTO {
  const district = school.location?.name || null;
  const city = school.location?.parent?.name || "Hà Nội";
  const addressParts = [school.addressLine, district, city].filter(Boolean);
  const fullAddress = addressParts.join(", ");

  // Hybrid boarding scale: ưu tiên tính tổng học sinh từ bảng classes nếu có
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

  return {
    id: school.id,
    code: school.code,
    name: school.name,
    email: school.email,
    phone: school.phone,
    location_id: school.locationId,
    address_line: school.addressLine,
    address: fullAddress,
    district,
    city,
    website_url: school.websiteUrl,
    description: school.description,
    logo_url: school.logoUrl,
    cover_image_url: school.coverImageUrl,
    cooking_mode: school.cookingMode,
    lunch_time: formatTimeString(school.lunchTime),
    afternoon_meal_time: formatTimeString(school.afternoonMealTime),
    boarding_scale: boardingScale,
    status: school.status,
    created_at: school.createdAt,
    updated_at: school.updatedAt,
  };
}

export function createOrganizationService(read: ListReader = readFromDatabase) {
  return {
    getAll(query: ListQuery) {
      return readListPage(
        () => read({ ...listWindow(query), select, orderBy: [{ id: "asc" }] }),
        query,
      );
    },

    async getPublicSchools(query: PublicSchoolQuery = {}) {
      const prisma = await getPrisma();
      const page = Math.max(1, Number(query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
      const skip = (page - 1) * limit;

      const where: Prisma.SchoolWhereInput = {
        status: "ACTIVE",
      };

      if (query.search?.trim()) {
        const s = query.search.trim();
        where.OR = [
          { name: { contains: s, mode: "insensitive" } },
          { code: { contains: s, mode: "insensitive" } },
          { addressLine: { contains: s, mode: "insensitive" } },
          { location: { name: { contains: s, mode: "insensitive" } } },
        ];
      }

      if (query.locationId?.trim()) {
        where.locationId = query.locationId.trim();
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

      const data = schools.map(mapSchoolToDTO);
      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    },

    async getPublicSchoolByCode(code: string) {
      const prisma = await getPrisma();
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

    async getPublicSchoolById(id: string) {
      const prisma = await getPrisma();
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
