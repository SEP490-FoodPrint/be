import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import { formatTimeString } from "../../utils/date-time";
import type { PublicSchoolListQuery } from "./organization.validation";
import type {
  PublicSchoolDTO,
  PublicSchoolListResult,
  SchoolQueryResult,
} from "./dtos";

export function mapSchoolToDTO(school: SchoolQueryResult): PublicSchoolDTO {
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
  };
}

export async function getPublicSchools(
  query: PublicSchoolListQuery,
  getClient: () => Promise<PrismaClient> = getPrisma,
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

  if (query.city || query.district) {
    const locationFilter: Prisma.LocationWhereInput = {};
    if (query.district) {
      locationFilter.name = {
        contains: query.district,
        mode: "insensitive",
      };
    }
    if (query.city) {
      locationFilter.parent = {
        name: { contains: query.city, mode: "insensitive" },
      };
    }
    where.location = locationFilter;
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
}

export async function getPublicSchoolByCode(
  code: string,
  getClient: () => Promise<PrismaClient> = getPrisma,
): Promise<PublicSchoolDTO | null> {
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
}

export async function getPublicSchoolById(
  id: string,
  getClient: () => Promise<PrismaClient> = getPrisma,
): Promise<PublicSchoolDTO | null> {
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
}

export async function getPublicLocations(
  getClient: () => Promise<PrismaClient> = getPrisma,
) {
  const prisma = await getClient();
  return prisma.location.findMany({
    where: { isActive: true },
    orderBy: [{ level: "asc" }, { name: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      level: true,
      parentId: true,
    },
  });
}
