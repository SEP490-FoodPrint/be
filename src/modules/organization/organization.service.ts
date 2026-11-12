import type { AuthPrincipal } from "../../types/auth";
import { ROLES, ORG_TYPES } from "../../constants/roles";
import type { PrismaClient } from "../../generated/prisma/client";
import {
  assertPermission,
  withSchoolTransaction,
} from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import { withReadTransaction } from "../../utils/read-transaction";
import { listScopes } from "../../utils/resource-access";
import {
  formatDateDMY,
  formatTimeString,
  getDayOfWeekName,
  getWeekNumber,
} from "../../utils/date-time";
import type {
  CookingModeRequestDTO,
  MealTimesRequestDTO,
  OrganizationListRequestDTO,
  OrganizationSummaryRequestDTO,
  OrganizationDetailRequestDTO,
  PublicSchoolListRequestDTO,
  PublicDailyMenuRequestDTO,
  PublicWeeklyMenuRequestDTO,
} from "./organization.request.dto";
import type {
  OrganizationListResponseDTO,
  OrganizationListItemResponseDTO,
  OrganizationSummaryResponseDTO,
  PublicSchoolDTO,
  PublicSchoolListResult,
  PublicLocationDTO,
  PublicDailyMenuDTO,
  PublicWeeklyMenuDTO,
  AvailableWeekSummaryDTO,
  CookingModeResponseDTO,
  MealTimesResponseDTO,
  DishItemDTO,
  SnackItemDTO,
  PortionGroupDTO,
  WeeklyMenuDayDTO,
} from "./organization.response.dto";
import {
  createOrganizationRepository,
  type OrganizationRepository,
  type PublicSchoolDbRow,
  type SchoolDirectoryRow,
} from "./organization.repository";

function mapDirectory(
  row: SchoolDirectoryRow,
): OrganizationListItemResponseDTO {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    email: row.email,
    phone: row.phone,
    address: row.address,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
function mapSchoolToDTO(school: PublicSchoolDbRow): PublicSchoolDTO {
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

const COOKING_MODE_PERMISSION = "school_cooking_mode.manage";

function assertCookingModeManager(
  principal: AuthPrincipal,
): asserts principal is AuthPrincipal & { schoolId: string } {
  assertPermission(principal, COOKING_MODE_PERMISSION);
  if (
    principal.role !== ROLES.SCHOOL_MANAGEMENT_BOARD ||
    principal.orgType !== "SCHOOL" ||
    !principal.schoolId
  )
    throw new HttpError(403, "Chỉ Ban Giám hiệu được cấu hình chế độ nấu");
}

const MEAL_TIMES_PERMISSION = "school_meal_times.manage";

function assertMealTimesManager(
  principal: AuthPrincipal,
): asserts principal is AuthPrincipal & { schoolId: string } {
  assertPermission(principal, MEAL_TIMES_PERMISSION);
  if (
    principal.role !== ROLES.SCHOOL_MANAGEMENT_BOARD ||
    principal.orgType !== "SCHOOL" ||
    !principal.schoolId
  ) {
    throw new HttpError(403, "Chỉ Ban Giám hiệu được cấu hình giờ phục vụ");
  }
}

function formatMealTime(value: Date | null): string | null {
  return value ? value.toISOString().slice(11, 16) : null;
}

function parseMealTime(value: string | null): Date | null {
  return value ? new Date(`1970-01-01T${value}:00.000Z`) : null;
}

export function createOrganizationService(
  repository?: OrganizationRepository,
  getClient: () => Promise<PrismaClient> = getPrisma,
) {
  const data = repository ?? createOrganizationRepository(getClient);
  return {
    async getAll(
      q: OrganizationListRequestDTO,
      p: AuthPrincipal,
    ): Promise<OrganizationListResponseDTO> {
      const scope = listScopes.organization(p);
      return withReadTransaction(async (tx) => {
        if (!data.listDirectory)
          throw new HttpError(503, "Không thể tải danh sách");
        const result = await data.listDirectory(tx, scope, q);
        return {
          items: result.items.map(mapDirectory),
          pagination: {
            page: q.page,
            limit: q.limit,
            total: result.total,
            hasNext:
              (q.page - 1) * q.limit + result.items.length < result.total,
          },
        };
      }, getClient);
    },
    async getSummary(
      _q: OrganizationSummaryRequestDTO,
      p: AuthPrincipal,
    ): Promise<OrganizationSummaryResponseDTO> {
      const scope = listScopes.organization(p);
      if (p.role !== ROLES.SYSTEM_ADMIN || p.orgType !== ORG_TYPES.SYSTEM)
        throw new HttpError(403, "Chỉ System Admin được xem tổng quan");
      return withReadTransaction(async (tx) => {
        if (!data.summary) throw new HttpError(503, "Không thể tải tổng quan");
        const counts = await data.summary(tx, scope);
        return { total: counts.total, activeCount: counts.activeCount };
      }, getClient);
    },
    async getById(
      q: OrganizationDetailRequestDTO,
      p: AuthPrincipal,
    ): Promise<OrganizationListItemResponseDTO> {
      const scope = listScopes.organization(p);
      return withReadTransaction(async (tx) => {
        if (!data.detail) throw new HttpError(503, "Không thể tải chi tiết");
        const row = await data.detail(tx, scope, q.id);
        if (!row) throw new HttpError(404, "Không tìm thấy trường học");
        return mapDirectory(row);
      }, getClient);
    },

    async getCookingMode(
      principal: AuthPrincipal,
    ): Promise<CookingModeResponseDTO> {
      assertCookingModeManager(principal);
      return data.findCookingMode(principal.schoolId);
    },

    // Mẻ đã lập giữ chế độ cũ; giá trị mới chỉ áp dụng cho kế hoạch nấu sau đó.
    async updateCookingMode(
      input: CookingModeRequestDTO,
      principal: AuthPrincipal,
    ): Promise<CookingModeResponseDTO> {
      assertCookingModeManager(principal);
      return withSchoolTransaction(
        await getClient(),
        principal,
        COOKING_MODE_PERMISSION,
        (tx, actor, schoolId) => {
          assertCookingModeManager(actor);
          return data.updateCookingMode(tx, schoolId, input.cookingMode);
        },
      );
    },

    async getMealTimes(
      principal: AuthPrincipal,
    ): Promise<MealTimesResponseDTO> {
      assertMealTimesManager(principal);
      const value = await data.findMealTimes(principal.schoolId);
      return {
        lunchTime: formatMealTime(value.lunchTime),
        afternoonMealTime: formatMealTime(value.afternoonMealTime),
      };
    },

    async updateMealTimes(
      input: MealTimesRequestDTO,
      principal: AuthPrincipal,
    ): Promise<MealTimesResponseDTO> {
      assertMealTimesManager(principal);
      const value = await withSchoolTransaction(
        await getClient(),
        principal,
        MEAL_TIMES_PERMISSION,
        (tx, actor, schoolId) => {
          assertMealTimesManager(actor);
          return data.updateMealTimes(tx, schoolId, {
            lunchTime: parseMealTime(input.lunchTime),
            afternoonMealTime: parseMealTime(input.afternoonMealTime),
          });
        },
      );
      return {
        lunchTime: formatMealTime(value.lunchTime),
        afternoonMealTime: formatMealTime(value.afternoonMealTime),
      };
    },

    async getPublicSchools(
      query: PublicSchoolListRequestDTO,
    ): Promise<PublicSchoolListResult> {
      const page = query.page;
      const limit = query.limit;
      const skip = (page - 1) * limit;

      const { items: schools, total } = await data.findPublicSchools({
        skip,
        take: limit,
        search: query.search,
        locationId: query.locationId,
        city: query.city,
        district: query.district,
      });

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
      const school = await data.findPublicSchoolByCode(code);
      if (!school) return null;
      return mapSchoolToDTO(school);
    },

    async getPublicSchoolById(id: string): Promise<PublicSchoolDTO | null> {
      const school = await data.findPublicSchoolById(id);
      if (!school) return null;
      return mapSchoolToDTO(school);
    },

    async getPublicLocations(): Promise<PublicLocationDTO[]> {
      return data.findPublicLocations();
    },

    async getPublicDailyMenu(
      schoolCode: string,
      query: PublicDailyMenuRequestDTO,
    ): Promise<PublicDailyMenuDTO | null> {
      const school = await data.findSchoolForMenu(schoolCode);
      if (!school) {
        throw new HttpError(
          404,
          `Không tìm thấy trường học với mã: ${schoolCode}`,
        );
      }

      let targetDate: Date;
      if (query.date) {
        targetDate = new Date(`${query.date}T00:00:00.000Z`);
      } else {
        const now = new Date();
        const utc = now.getTime() + now.getTimezoneOffset() * 60000;
        const vnDate = new Date(utc + 3600000 * 7);
        const yyyy = vnDate.getFullYear();
        const mm = String(vnDate.getMonth() + 1).padStart(2, "0");
        const dd = String(vnDate.getDate()).padStart(2, "0");
        targetDate = new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`);
      }

      let menuDay = await data.findMenuDayForDailyMenu(school.id, targetDate);

      if (!menuDay && !query.date) {
        menuDay = await data.findLatestApprovedMenuDay(school.id);
      }

      if (!menuDay || menuDay.menuDayDishes.length === 0) {
        return null;
      }

      const dateStr = menuDay.menuDate.toISOString().slice(0, 10);
      const dmy = formatDateDMY(menuDay.menuDate);
      const dayName = getDayOfWeekName(menuDay.menuDate);

      const lunchServingTime = school.lunchTime
        ? formatTimeString(school.lunchTime)?.slice(0, 5)
        : "10:45";
      const snackServingTime = school.afternoonMealTime
        ? formatTimeString(school.afternoonMealTime)?.slice(0, 5)
        : "14:30";

      const lunchDishes: DishItemDTO[] = [];
      const snackDishes: DishItemDTO[] = [];
      const snackItems: SnackItemDTO[] = [];

      for (const mdd of menuDay.menuDayDishes) {
        const portionStr =
          mdd.portionSize && mdd.portionUnit
            ? `${mdd.portionSize.toString()} ${mdd.portionUnit}`
            : mdd.portionSize
              ? `${mdd.portionSize.toString()} suất`
              : "1 suất";

        const item: DishItemDTO = {
          id: mdd.dishId,
          name: mdd.Dish?.name || "Món ăn",
          portion: portionStr,
          portionSize: mdd.portionSize ? Number(mdd.portionSize) : null,
          portionUnit: mdd.portionUnit || null,
          order: mdd.displayOrder,
          mealType: mdd.mealType,
          description: mdd.Dish?.description || null,
        };

        if (mdd.mealType === "LUNCH") {
          lunchDishes.push(item);
        } else {
          snackDishes.push(item);
          const isDrink =
            item.name.toLowerCase().includes("sữa") ||
            item.name.toLowerCase().includes("nước") ||
            item.name.toLowerCase().includes("chè");
          snackItems.push({
            id: mdd.dishId,
            name: item.name,
            desc: item.portion,
            icon: isDrink ? "coffee" : "cake",
          });
        }
      }

      const defaultLunchImage =
        school.coverImageUrl ||
        "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800&auto=format&fit=crop&q=80";
      const defaultSnackImage =
        "https://images.unsplash.com/photo-1550547660-d9450f859349?w=800&auto=format&fit=crop&q=80";

      return {
        date: dateStr,
        dateLabel: `${dayName}, ${dmy}`,
        updatedAt: "07:15 sáng nay",
        lunch: {
          title: "Bữa trưa chính",
          servingWindow: `${lunchServingTime} – 11:30`,
          trayImageUrl: defaultLunchImage,
          trayType: "Khay chia 5 ngăn inox chuẩn y tế",
          standardsNote: menuDay.note || "Đạt chuẩn 4 nhóm chất dinh dưỡng",
          allergyWarning: "Đã kiểm thực 3 bước — An toàn dinh dưỡng học đường",
          dishes: lunchDishes,
        },
        snack: {
          title: "Bữa phụ chiều",
          servingWindow: `${snackServingTime} – 15:00`,
          imageUrl: defaultSnackImage,
          items: snackItems,
          dishes: snackDishes,
        },
      };
    },

    async getPublicWeeklyMenu(
      schoolCode: string,
      query: PublicWeeklyMenuRequestDTO,
    ): Promise<PublicWeeklyMenuDTO | null> {
      const school = await data.findSchoolForMenu(schoolCode);
      if (!school) {
        throw new HttpError(
          404,
          `Không tìm thấy trường học với mã: ${schoolCode}`,
        );
      }

      let targetWeekMonday: Date | undefined;
      if (query.week) {
        const rawDate = new Date(`${query.week}T00:00:00.000Z`);
        const day = rawDate.getUTCDay();
        const diff = (day === 0 ? -6 : 1) - day;
        const monday = new Date(rawDate);
        monday.setUTCDate(rawDate.getUTCDate() + diff);
        targetWeekMonday = monday;
      }

      let weeklyMenu = await data.findWeeklyMenu(school.id, targetWeekMonday);

      if (!weeklyMenu && !query.week) {
        weeklyMenu = await data.findLatestApprovedWeeklyMenu(school.id);
      }

      if (!weeklyMenu || weeklyMenu.menuDays.length === 0) {
        return null;
      }

      const dayIds = weeklyMenu.menuDays.map((d) => d.id);
      const rawGroups = await data.findPortionGroupsRaw(dayIds);
      let dynamicGroups: PortionGroupDTO[] = rawGroups.map((g) => ({
        id: g.id,
        name: g.name,
        isDefault: g.is_default,
      }));

      if (dynamicGroups.length === 0) {
        dynamicGroups = [
          {
            id: "all",
            name: "Toàn trường",
            isDefault: true,
          },
        ];
      }

      const weekNumber = getWeekNumber(weeklyMenu.weekStartDate);
      const weekStartDmy = formatDateDMY(weeklyMenu.weekStartDate);
      const fridayDate = new Date(weeklyMenu.weekStartDate);
      fridayDate.setUTCDate(fridayDate.getUTCDate() + 4);
      const weekEndDmy = formatDateDMY(fridayDate);
      const weekRange = `${weekStartDmy} – ${weekEndDmy}`;

      const now = new Date();
      const todayIso = now.toISOString().slice(0, 10);

      const days: WeeklyMenuDayDTO[] = weeklyMenu.menuDays.map((day) => {
        const dateIso = day.menuDate.toISOString().slice(0, 10);
        const dayOfWeek = getDayOfWeekName(day.menuDate);
        const dateFormatted = formatDateDMY(day.menuDate);

        const isToday = dateIso === todayIso;
        const isPast = dateIso < todayIso;
        const status: "SERVED" | "TODAY" | "UPCOMING" = isPast
          ? "SERVED"
          : isToday
            ? "TODAY"
            : "UPCOMING";
        const statusLabel = isPast
          ? "Đã phục vụ"
          : isToday
            ? "Đang phục vụ"
            : "Sắp phục vụ";

        const lunchDishes: string[] = [];
        const snackDishes: string[] = [];
        const allDishes: DishItemDTO[] = [];

        for (const mdd of day.menuDayDishes) {
          const portionStr =
            mdd.portionSize && mdd.portionUnit
              ? `${mdd.portionSize.toString()} ${mdd.portionUnit}`
              : mdd.portionSize
                ? `${mdd.portionSize.toString()} suất`
                : "1 suất";

          const dishItem: DishItemDTO = {
            id: mdd.dishId,
            name: mdd.Dish?.name || "Món ăn",
            portion: portionStr,
            portionSize: mdd.portionSize ? Number(mdd.portionSize) : null,
            portionUnit: mdd.portionUnit || null,
            order: mdd.displayOrder,
            mealType: mdd.mealType,
            description: mdd.Dish?.description || null,
          };

          allDishes.push(dishItem);
          if (mdd.mealType === "LUNCH") {
            lunchDishes.push(dishItem.name);
          } else {
            snackDishes.push(dishItem.name);
          }
        }

        const snackSummary =
          snackDishes.length > 0
            ? snackDishes.join(" & ")
            : "Bữa phụ dinh dưỡng học đường";

        return {
          id: day.id,
          dayOfWeek,
          date: dateFormatted,
          dateIso,
          status,
          statusLabel,
          isToday,
          lunchDishes,
          snackSummary,
          dishes: allDishes,
        };
      });

      const rawAvailableWeeks = await data.findAvailableWeeklyMenuWeeks(
        school.id,
      );
      const availableWeeks: AvailableWeekSummaryDTO[] = rawAvailableWeeks.map(
        (w) => {
          const wNum = getWeekNumber(w.weekStartDate);
          const startStr = formatDateDMY(w.weekStartDate);
          const fri = new Date(w.weekStartDate);
          fri.setUTCDate(fri.getUTCDate() + 4);
          const endStr = formatDateDMY(fri);
          return {
            id: w.id,
            title: w.title || `Thực đơn tuần ${wNum}`,
            weekNumber: wNum,
            weekStartDate: w.weekStartDate.toISOString().slice(0, 10),
            weekRange: `${startStr} – ${endStr}`,
            status: w.status,
          };
        },
      );

      return {
        id: weeklyMenu.id,
        title: weeklyMenu.title || `Thực đơn tuần ${weekNumber}`,
        weekNumber,
        weekStartDate: weeklyMenu.weekStartDate.toISOString().slice(0, 10),
        weekRange,
        status: weeklyMenu.status,
        portionGroups: dynamicGroups,
        gradeGroups: dynamicGroups.map((g) => ({ key: g.id, label: g.name })),
        days,
        availableWeeks,
      };
    },
  };
}

export const organizationService = createOrganizationService();
export type OrganizationService = ReturnType<typeof createOrganizationService>;
