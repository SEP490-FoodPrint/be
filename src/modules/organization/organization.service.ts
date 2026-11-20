import type { AuthPrincipal } from "../../types/auth";
import { ROLES, ORG_TYPES, ROLE_LABELS } from "../../constants/roles";
import {
  CONFIGURABLE_INSPECTION_ROLES,
  INSPECTION_TIER_LABELS,
  resolveSchoolTiers,
  type DeliveryInspectionRoleCode,
  type DeliveryInspectionTierCode,
} from "../../constants/delivery-inspection";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { convertQuantity } from "../kitchen/kitchen.service";
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
  getSchoolMonday,
  getSchoolWeekSchedule,
  calculateAcademicWeekNumber,
  generateAcademicWeeks,
} from "../../utils/date-time";
import type {
  CookingModeRequestDTO,
  MealTimesRequestDTO,
  DeliveryInspectionRolesRequestDTO,
  OrganizationListRequestDTO,
  OrganizationSummaryRequestDTO,
  OrganizationDetailRequestDTO,
  PublicSchoolListRequestDTO,
  PublicDailyMenuRequestDTO,
  PublicWeeklyMenuRequestDTO,
  PublicSchoolGradesRequestDTO,
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
  DeliveryInspectionRolesResponseDTO,
  DishItemDTO,
  PublicDishIngredientDTO,
  PublicRecipeSource,
  SnackItemDTO,
  WeeklyMenuDayDTO,
  PublicSchoolGradeDTO,
} from "./organization.response.dto";
import {
  createOrganizationRepository,
  type OrganizationRepository,
  type PublicMenuDayDbRow,
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
  const city = school.location?.parent?.name || "Thành phố Hà Nội";
  let fullAddress = school.address || "";
  if (district && !fullAddress.includes(district)) {
    fullAddress = fullAddress ? `${fullAddress}, ${district}` : district;
  }
  if (city && !fullAddress.includes(city)) {
    fullAddress = fullAddress ? `${fullAddress}, ${city}` : city;
  }

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

const DELIVERY_INSPECTION_PERMISSION = "school_delivery_inspection.manage";

function assertDeliveryInspectionManager(
  principal: AuthPrincipal,
): asserts principal is AuthPrincipal & { schoolId: string } {
  assertPermission(principal, DELIVERY_INSPECTION_PERMISSION);
  if (
    principal.role !== ROLES.SCHOOL_MANAGEMENT_BOARD ||
    principal.orgType !== "SCHOOL" ||
    !principal.schoolId
  ) {
    throw new HttpError(
      403,
      "Chỉ Ban Giám hiệu được cấu hình nhóm duyệt nguyên liệu",
    );
  }
}

function mapToDeliveryInspectionRolesResponseDTO(
  rows: Array<{
    tier: DeliveryInspectionTierCode;
    updatedAt: Date;
    Role: { code: string };
  }>,
): DeliveryInspectionRolesResponseDTO {
  const configured = rows.length > 0;
  const tiers = resolveSchoolTiers(rows);

  let maxUpdatedAt: Date | null = null;
  if (configured) {
    for (const row of rows) {
      if (!maxUpdatedAt || row.updatedAt > maxUpdatedAt) {
        maxUpdatedAt = row.updatedAt;
      }
    }
  }

  const order: DeliveryInspectionRoleCode[] = [
    ...CONFIGURABLE_INSPECTION_ROLES,
    ROLES.PARENTS_COMMITTEE,
  ];

  const roles = order.map((code) => {
    const tier = tiers[code];
    return {
      roleCode: code,
      roleName: ROLE_LABELS[code] ?? code,
      tier,
      tierLabel: INSPECTION_TIER_LABELS[tier],
      editable: code !== ROLES.PARENTS_COMMITTEE,
    };
  });

  return {
    configured,
    roles,
    updatedAt: maxUpdatedAt ? maxUpdatedAt.toISOString() : null,
  };
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

    async getDeliveryInspectionRoles(
      principal: AuthPrincipal,
    ): Promise<DeliveryInspectionRolesResponseDTO> {
      assertDeliveryInspectionManager(principal);
      const rows = await data.findDeliveryInspectionRoles(principal.schoolId);
      return mapToDeliveryInspectionRolesResponseDTO(rows);
    },

    // Đợt giao đã xác nhận xe đến giữ snapshot cũ; cấu hình mới áp dụng cho đợt đến sau.
    async updateDeliveryInspectionRoles(
      input: DeliveryInspectionRolesRequestDTO,
      principal: AuthPrincipal,
    ): Promise<DeliveryInspectionRolesResponseDTO> {
      assertDeliveryInspectionManager(principal);
      const rows = await withSchoolTransaction(
        await getClient(),
        principal,
        DELIVERY_INSPECTION_PERMISSION,
        async (tx, actor, schoolId) => {
          assertDeliveryInspectionManager(actor);
          const roleCodes = input.roles.map((r) => r.roleCode);
          const roleRows = await data.findRoleIdsByCodes(tx, roleCodes);
          const roleIdByCode = new Map(roleRows.map((r) => [r.code, r.id]));

          const toInsert = input.roles.map((r) => {
            const roleId = roleIdByCode.get(r.roleCode);
            if (!roleId) {
              throw new HttpError(400, `Không tìm thấy vai trò: ${r.roleCode}`);
            }
            return {
              roleId,
              tier: r.tier,
              updatedByUserId: actor.id,
            };
          });

          return data.replaceDeliveryInspectionRoles(tx, schoolId, toInsert);
        },
      );
      return mapToDeliveryInspectionRolesResponseDTO(rows);
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

    async getPublicSchoolGrades(
      schoolCode: string,
      query: PublicSchoolGradesRequestDTO = {},
    ): Promise<PublicSchoolGradeDTO[]> {
      const school = await data.findSchoolForMenu(schoolCode);
      if (!school) {
        throw new HttpError(
          404,
          `Không tìm thấy trường học với mã: ${schoolCode}`,
        );
      }
      if (!data.findSchoolGrades) return [];
      const grades = await data.findSchoolGrades(school.id);

      // Đánh dấu khối có thực đơn trong tuần: thực đơn toàn trường áp dụng
      // cho mọi khối, thực đơn riêng chỉ áp dụng cho khối được gán.
      const weekMonday = getSchoolMonday(
        query.week ? new Date(`${query.week}T00:00:00.000Z`) : new Date(),
      );
      const coverage = data.findWeekMenuCoverage
        ? await data.findWeekMenuCoverage(school.id, weekMonday)
        : { hasSchoolWideMenu: false, gradeIds: [] };
      const gradeIdsWithMenu = new Set(coverage.gradeIds);

      return grades.map((g) => ({
        id: g.id,
        name: g.name,
        hasMenu: coverage.hasSchoolWideMenu || gradeIdsWithMenu.has(g.id),
      }));
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

      const gradeId =
        query.grade && query.grade !== "all" ? query.grade : undefined;

      let menuDay = await data.findMenuDayForDailyMenu(
        school.id,
        targetDate,
        gradeId,
      );

      if (!menuDay && !query.date) {
        menuDay = await data.findLatestApprovedMenuDay(school.id, gradeId);
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

      // Định lượng và nguyên liệu theo khối đang xem; món thay thế theo nhóm dị ứng
      const lunchDishes = buildPublicMealDishes(menuDay, "LUNCH", gradeId);
      const snackDishes = buildPublicMealDishes(menuDay, "AFTERNOON", gradeId);
      const snackItems: SnackItemDTO[] = snackDishes.map((item) => {
        const lower = item.name.toLowerCase();
        const isDrink =
          lower.includes("sữa") ||
          lower.includes("nước") ||
          lower.includes("chè");
        return {
          id: item.id,
          name: item.name,
          desc: item.portion,
          icon: isDrink ? "coffee" : "cake",
        };
      });

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

      const now = new Date();
      const todayIso = now.toISOString().slice(0, 10);
      let targetWeekMonday: Date;

      if (query.week) {
        const rawDate = new Date(`${query.week}T00:00:00.000Z`);
        targetWeekMonday = getSchoolMonday(rawDate);
      } else {
        targetWeekMonday = getSchoolMonday(now);
      }

      const gradeId =
        query.grade && query.grade !== "all"
          ? query.grade
          : query.group && query.group !== "all"
            ? query.group
            : undefined;

      let weeklyMenu = await data.findWeeklyMenu(
        school.id,
        targetWeekMonday,
        gradeId,
      );

      // Nếu không truyền query.week và tuần hiện tại chưa có thực đơn, thử tìm thực đơn gần nhất được duyệt
      if (!weeklyMenu && !query.week) {
        const latestMenu = await data.findLatestApprovedWeeklyMenu(school.id);
        if (latestMenu) {
          targetWeekMonday = latestMenu.weekStartDate;
          weeklyMenu = await data.findWeeklyMenu(
            school.id,
            targetWeekMonday,
            gradeId,
          );
        }
      }

      // Lấy thông tin năm học tương ứng
      const academicYear = await data.findCurrentAcademicYear(
        school.id,
        targetWeekMonday,
      );

      // Sinh danh sách toàn bộ các tuần của năm học
      let academicWeeks = academicYear
        ? generateAcademicWeeks(
            academicYear.startDate,
            academicYear.endDate,
            now,
          )
        : [];

      // Fallback nếu trường chưa cấu hình năm học: tạo tuần xung quanh targetWeekMonday
      if (academicWeeks.length === 0) {
        const fallbackSchedule = getSchoolWeekSchedule(targetWeekMonday);
        const wNum = getWeekNumber(targetWeekMonday);
        academicWeeks = [
          {
            weekNumber: wNum,
            weekLabel: `Tuần ${wNum}`,
            weekStartDate: fallbackSchedule.weekStartDate,
            weekEndDate: fallbackSchedule.weekEndDate,
            weekRange: `${formatDateDMY(new Date(fallbackSchedule.weekStartDate))} – ${formatDateDMY(new Date(fallbackSchedule.weekEndDate))}`,
            isCurrentWeek:
              fallbackSchedule.weekStartDate ===
              getSchoolMonday(now).toISOString().slice(0, 10),
          },
        ];
      }

      // Lấy danh sách các tuần đã có thực đơn công bố của trường
      const approvedStartDates = await data.findApprovedWeekStartDates(
        school.id,
        academicYear?.startDate,
        academicYear?.endDate,
      );
      const approvedWeekSet = new Set(approvedStartDates);

      // Ánh xạ availableWeeks theo toàn bộ các tuần của năm học
      const availableWeeks: AvailableWeekSummaryDTO[] = academicWeeks.map(
        (w) => {
          const hasMenu = approvedWeekSet.has(w.weekStartDate);
          return {
            title: `Thực đơn ${w.weekLabel}`,
            weekNumber: w.weekNumber,
            weekStartDate: w.weekStartDate,
            weekEndDate: w.weekEndDate,
            weekRange: w.weekRange,
            isCurrentWeek: w.isCurrentWeek,
            hasMenu,
            status: hasMenu ? "APPROVED" : null,
          };
        },
      );

      // Danh sách khối được lấy riêng qua GET /public/:schoolCode/grades,
      // không suy ra từ thực đơn (tránh lẫn nhóm suất ăn Tiêu chuẩn/Dị ứng).
      const weekSchedule = getSchoolWeekSchedule(targetWeekMonday);
      const weekNumber = academicYear
        ? calculateAcademicWeekNumber(targetWeekMonday, academicYear.startDate)
        : getWeekNumber(targetWeekMonday);
      const weekRange = `${formatDateDMY(new Date(weekSchedule.weekStartDate))} – ${formatDateDMY(new Date(weekSchedule.weekEndDate))}`;
      const isCurrentWeek =
        weekSchedule.weekStartDate ===
        getSchoolMonday(now).toISOString().slice(0, 10);

      // Nếu tuần này chưa có thực đơn hoặc chưa có ngày ăn nào
      if (!weeklyMenu || weeklyMenu.menuDays.length === 0) {
        return {
          id: null,
          title: `Thực đơn dinh dưỡng tuần ${weekNumber}`,
          weekNumber,
          weekStartDate: weekSchedule.weekStartDate,
          weekEndDate: weekSchedule.weekEndDate,
          weekRange,
          isCurrentWeek,
          status: null,
          days: [],
          availableWeeks,
        };
      }

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

        // Món thay thế: nhóm suất riêng bỏ đúng 1 món của nhóm mặc định và thêm đúng 1 món mới.
        const substituteFor = new Map<string, string>();
        for (const group of day.portionGroups) {
          if (group.isDefault) continue;
          const regular = day.portionGroups.find(
            (row) => row.isDefault && row.mealType === group.mealType,
          );
          if (!regular) continue;
          const regularIds = new Set(regular.dishes.map((row) => row.dishId));
          const groupIds = new Set(group.dishes.map((row) => row.dishId));
          const removed = [...regularIds].filter((id) => !groupIds.has(id));
          const added = [...groupIds].filter((id) => !regularIds.has(id));
          if (removed.length === 1 && added.length === 1)
            substituteFor.set(`${group.mealType}:${added[0]}`, removed[0]);
        }

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
            substituteForDishId:
              substituteFor.get(`${mdd.mealType}:${mdd.dishId}`) ?? null,
          };

          allDishes.push(dishItem);
          // Món thay thế không tính vào danh sách món chung của bữa
          if (dishItem.substituteForDishId) continue;
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

      return {
        id: weeklyMenu.id,
        title: weeklyMenu.title || `Thực đơn dinh dưỡng tuần ${weekNumber}`,
        weekNumber,
        weekStartDate: weekSchedule.weekStartDate,
        weekEndDate: weekSchedule.weekEndDate,
        weekRange,
        isCurrentWeek,
        status: weeklyMenu.status,
        days,
        availableWeeks,
      };
    },
  };
}

export const organizationService = createOrganizationService();
export type OrganizationService = ReturnType<typeof createOrganizationService>;

// ---------------------------------------------------------------------------
// Thực đơn ngày công khai: định lượng / suất theo khối và nguyên liệu từng món
// ---------------------------------------------------------------------------

type PublicMenuDish = PublicMenuDayDbRow["menuDayDishes"][number];
type PublicIngredientRow = PublicMenuDish["ingredients"][number]["ingredient"];
type PublicRecipeLine = {
  ingredientRole: string | null;
  requiredQuantity: Prisma.Decimal;
  unit: string;
  ingredient: PublicIngredientRow;
};

const DISH_CATEGORY_LABELS: Record<string, string> = {
  RICE_STARCH: "Cơm / Tinh bột",
  MAIN_DISH: "Món mặn",
  VEGETABLE: "Rau",
  SOUP: "Canh",
  DESSERT: "Tráng miệng",
};

function formatPublicQuantity(value: Prisma.Decimal | number): string {
  const num = Number(value.toString());
  return String(Number.isFinite(num) ? Number(num.toFixed(3)) : value);
}

function toPublicIngredient(line: PublicRecipeLine): PublicDishIngredientDTO {
  const role =
    line.ingredientRole === "MAIN" || line.ingredientRole === "SEASONING"
      ? line.ingredientRole
      : null;
  const quantity = formatPublicQuantity(line.requiredQuantity);
  return {
    id: line.ingredient.id,
    name: line.ingredient.name,
    quantity: Number(quantity),
    unit: line.unit,
    portion: `${quantity} ${line.unit}`,
    role,
    note: role === "SEASONING" ? "Gia vị" : null,
    category: line.ingredient.ingredientCategory?.categoryName ?? null,
    supplierName: line.ingredient.Supplier?.name ?? null,
  };
}

/**
 * Chọn nguồn định lượng cho một món ở khối đang xem:
 * 1. Thực đơn riêng của khối: dùng nguyên liệu đã chốt trong thực đơn (MENU).
 * 2. Thực đơn toàn trường: ưu tiên định lượng riêng của khối (GRADE),
 *    sau đó nguyên liệu đã chốt trong thực đơn (MENU), cuối cùng là định lượng chuẩn (STANDARD).
 */
function resolvePublicDishRecipe(
  mdd: PublicMenuDish,
  gradeId: string | undefined,
  isSchoolWide: boolean,
): { source: PublicRecipeSource; lines: PublicRecipeLine[] } {
  const menuLines: PublicRecipeLine[] = mdd.ingredients.map((row) => ({
    ingredientRole: "MAIN",
    requiredQuantity: row.quantityPerPortion,
    unit: row.unit,
    ingredient: row.ingredient,
  }));
  const gradeRecipe = gradeId
    ? mdd.Dish.gradeRecipes.find((recipe) => recipe.gradeId === gradeId)
    : undefined;
  const gradeLines: PublicRecipeLine[] = (gradeRecipe?.lines ?? []).map(
    (line) => ({
      ingredientRole: line.ingredientRole,
      requiredQuantity: line.requiredQuantity,
      unit: line.unit,
      ingredient: line.entry.Ingredient,
    }),
  );
  const standardLines: PublicRecipeLine[] = mdd.Dish.dishIngredientEntries.map(
    (line) => ({
      ingredientRole: line.ingredientRole,
      requiredQuantity: line.requiredQuantity,
      unit: line.unit,
      ingredient: line.IngredientEntry.Ingredient,
    }),
  );

  if (!isSchoolWide && menuLines.length)
    return { source: "MENU", lines: menuLines };
  if (gradeLines.length) return { source: "GRADE", lines: gradeLines };
  if (menuLines.length) return { source: "MENU", lines: menuLines };
  if (standardLines.length) return { source: "STANDARD", lines: standardLines };
  return { source: null, lines: [] };
}

/** Tổng khối lượng nguyên liệu chính (g) khi tất cả quy đổi được sang gam. */
function totalMainWeight(lines: PublicRecipeLine[]): string | null {
  const mains = lines.filter((line) => line.ingredientRole !== "SEASONING");
  if (!mains.length) return null;
  let total = 0;
  for (const line of mains) {
    try {
      total += Number(
        convertQuantity(line.requiredQuantity, line.unit, "g").toString(),
      );
    } catch {
      return null;
    }
  }
  return `${formatPublicQuantity(total)} g`;
}

function toPublicDishItem(
  mdd: PublicMenuDish,
  gradeId: string | undefined,
  isSchoolWide: boolean,
): DishItemDTO {
  const recipe = resolvePublicDishRecipe(mdd, gradeId, isSchoolWide);
  const ingredients = recipe.lines
    .map(toPublicIngredient)
    .sort(
      (a, b) =>
        Number(a.role === "SEASONING") - Number(b.role === "SEASONING") ||
        a.name.localeCompare(b.name, "vi"),
    );
  // portionSize là kích thước suất trình bày đã khai báo; nếu không có,
  // dùng tổng khối lượng nguyên liệu chính của 1 suất.
  const portion = mdd.portionSize
    ? `${formatPublicQuantity(mdd.portionSize)} ${mdd.portionUnit || "suất"}`
    : (totalMainWeight(recipe.lines) ?? "");

  return {
    id: mdd.dishId,
    name: mdd.Dish.name,
    portion,
    portionSize: mdd.portionSize ? Number(mdd.portionSize) : null,
    portionUnit: mdd.portionUnit || null,
    order: mdd.displayOrder,
    mealType: mdd.mealType,
    description: mdd.Dish.description || null,
    category:
      mdd.Dish.schoolCategory?.name ??
      (mdd.Dish.category ? DISH_CATEGORY_LABELS[mdd.Dish.category] : null) ??
      null,
    recipeSource: recipe.source,
    ingredients,
    alternativeDish: null,
  };
}

/**
 * Món của một bữa. Nhóm suất ăn mặc định là món tiêu chuẩn; mỗi nhóm dị ứng
 * thay các món tiêu chuẩn không có trong nhóm bằng các món chỉ nhóm đó có
 * (ghép theo thứ tự hiển thị). Món chỉ dành cho nhóm dị ứng không hiện ở cột chính.
 */
function buildPublicMealDishes(
  menuDay: PublicMenuDayDbRow,
  mealType: "LUNCH" | "AFTERNOON",
  gradeId: string | undefined,
): DishItemDTO[] {
  const isSchoolWide = menuDay.WeeklyMenu.isSchoolWide;
  const rows = menuDay.menuDayDishes.filter((d) => d.mealType === mealType);
  const items = new Map(
    rows.map((row) => [
      row.dishId,
      toPublicDishItem(row, gradeId, isSchoolWide),
    ]),
  );

  const groups = menuDay.portionGroups.filter((g) => g.mealType === mealType);
  const defaultGroup = groups.find((g) => g.isDefault);
  const substituteOnly = new Set<string>();

  if (defaultGroup) {
    const defaultIds = new Set(defaultGroup.dishes.map((d) => d.dishId));
    for (const group of groups.filter((g) => !g.isDefault)) {
      const groupIds = new Set(group.dishes.map((d) => d.dishId));
      const replaced = rows.filter(
        (r) => defaultIds.has(r.dishId) && !groupIds.has(r.dishId),
      );
      const substitutes = rows.filter(
        (r) => groupIds.has(r.dishId) && !defaultIds.has(r.dishId),
      );
      substitutes.forEach((sub) => substituteOnly.add(sub.dishId));
      replaced.forEach((main, index) => {
        const mainItem = items.get(main.dishId);
        const sub = substitutes[index];
        if (!mainItem || !sub || mainItem.alternativeDish) return;
        const subItem = items.get(sub.dishId);
        if (subItem)
          mainItem.alternativeDish = { ...subItem, allergyGroup: group.name };
      });
    }
  }

  return rows
    .filter((row) => !substituteOnly.has(row.dishId))
    .map((row) => items.get(row.dishId)!)
    .filter(Boolean);
}
