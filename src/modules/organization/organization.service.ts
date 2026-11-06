import type { AuthPrincipal } from "../../types/auth";
import { HttpError } from "../../utils/http-error";
import { readListPage } from "../../utils/list-query";
import {
  formatDateDMY,
  formatTimeString,
  getDayOfWeekName,
  getWeekNumber,
} from "../../utils/date-time";
import type {
  OrganizationListRequestDTO,
  PublicSchoolListRequestDTO,
  PublicDailyMenuRequestDTO,
  PublicWeeklyMenuRequestDTO,
} from "./organization.request.dto";
import type {
  OrganizationListResponseDTO,
  PublicSchoolDTO,
  PublicSchoolListResult,
  PublicLocationDTO,
  PublicDailyMenuDTO,
  PublicWeeklyMenuDTO,
  AvailableWeekSummaryDTO,
  DishItemDTO,
  SnackItemDTO,
  PortionGroupDTO,
  WeeklyMenuDayDTO,
  IngredientDetailDTO,
  PortionGroupDetailDTO,
  DayNavDTO,
} from "./organization.response.dto";
import {
  organizationRepository,
  type OrganizationRepository,
  type PublicSchoolDbRow,
} from "./organization.repository";

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

export function createOrganizationService(
  repository: OrganizationRepository = organizationRepository,
) {
  return {
    async getAll(
      query: OrganizationListRequestDTO,
      principal: AuthPrincipal,
    ): Promise<OrganizationListResponseDTO> {
      const page = await readListPage(
        () => repository.listSchools(query, principal),
        query,
      );

      return {
        items: page.items.map((row) => ({
          id: row.id,
          name: row.name,
          code: row.code,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
        pagination: {
          page: page.pagination.page,
          limit: page.pagination.limit,
          hasNext: page.pagination.hasNext,
        },
      };
    },

    async getPublicSchools(
      query: PublicSchoolListRequestDTO,
    ): Promise<PublicSchoolListResult> {
      const page = query.page;
      const limit = query.limit;
      const skip = (page - 1) * limit;

      const { items: schools, total } = await repository.findPublicSchools({
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
      const school = await repository.findPublicSchoolByCode(code);
      if (!school) return null;
      return mapSchoolToDTO(school);
    },

    async getPublicSchoolById(id: string): Promise<PublicSchoolDTO | null> {
      const school = await repository.findPublicSchoolById(id);
      if (!school) return null;
      return mapSchoolToDTO(school);
    },

    async getPublicLocations(): Promise<PublicLocationDTO[]> {
      return repository.findPublicLocations();
    },

    async getPublicDailyMenu(
      schoolCode: string,
      query: PublicDailyMenuRequestDTO,
    ): Promise<PublicDailyMenuDTO | null> {
      const school = await repository.findSchoolForMenu(schoolCode);
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

      let menuDay = await repository.findMenuDayForDailyMenu(
        school.id,
        targetDate,
      );

      if (!menuDay && !query.date) {
        menuDay = await repository.findLatestApprovedMenuDay(school.id);
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

        const ingredients: IngredientDetailDTO[] = [];
        if (mdd.ingredients && mdd.ingredients.length > 0) {
          for (const ing of mdd.ingredients) {
            if (ing.ingredient) {
              ingredients.push({
                id: ing.ingredient.id,
                name: ing.ingredient.name,
                category: ing.ingredient.category || "Nguyên liệu chế biến",
                portion: `${Number(ing.quantityPerPortion)} ${ing.unit}`,
                quantity: Number(ing.quantityPerPortion),
                unit: ing.unit,
                traceable: true,
              });
            }
          }
        } else if (
          mdd.Dish?.dishIngredientEntries &&
          mdd.Dish.dishIngredientEntries.length > 0
        ) {
          for (const entry of mdd.Dish.dishIngredientEntries) {
            const ing = entry.IngredientEntry?.Ingredient;
            if (ing) {
              ingredients.push({
                id: ing.id,
                name: ing.name,
                category: ing.category || "Nguyên liệu chế biến",
                portion: `${Number(entry.requiredQuantity)} ${entry.unit}`,
                quantity: Number(entry.requiredQuantity),
                unit: entry.unit,
                traceable: true,
              });
            }
          }
        }

        const item: DishItemDTO = {
          id: mdd.dishId,
          name: mdd.Dish?.name || "Món ăn",
          portion: portionStr,
          portionSize: mdd.portionSize ? Number(mdd.portionSize) : null,
          portionUnit: mdd.portionUnit || null,
          order: mdd.displayOrder,
          mealType: mdd.mealType,
          description: mdd.Dish?.description || null,
          ingredients,
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

      // Build 7-day week navigation strip
      const weekStartDate = menuDay.WeeklyMenu?.weekStartDate
        ? new Date(menuDay.WeeklyMenu.weekStartDate)
        : new Date(menuDay.menuDate);

      const startMonday = new Date(weekStartDate);
      const dayOfWeekIndex = startMonday.getUTCDay();
      const diffToMonday = (dayOfWeekIndex === 0 ? -6 : 1) - dayOfWeekIndex;
      startMonday.setUTCDate(startMonday.getUTCDate() + diffToMonday);

      const availableDatesMap = new Set<string>();
      if (menuDay.WeeklyMenu?.menuDays) {
        for (const md of menuDay.WeeklyMenu.menuDays) {
          availableDatesMap.add(md.menuDate.toISOString().slice(0, 10));
        }
      }

      const dayNames = [
        "Thứ Hai",
        "Thứ Ba",
        "Thứ Tư",
        "Thứ Năm",
        "Thứ Sáu",
        "Thứ Bảy",
        "Chủ Nhật",
      ];

      const weekNav: DayNavDTO[] = [];
      for (let i = 0; i < 7; i++) {
        const currentDay = new Date(startMonday);
        currentDay.setUTCDate(startMonday.getUTCDate() + i);
        const currentIso = currentDay.toISOString().slice(0, 10);
        const dd = String(currentDay.getUTCDate()).padStart(2, "0");
        const mm = String(currentDay.getUTCMonth() + 1).padStart(2, "0");
        const dayOfMonth = `${dd}/${mm}`;
        const isWeekend = i >= 5;
        const hasMenu = availableDatesMap.has(currentIso);

        let status: "SELECTED" | "AVAILABLE" | "OFF_DUTY";
        let statusLabel: "Đang xem" | "Có thực đơn" | "Nghỉ bán trú";

        if (isWeekend) {
          status = "OFF_DUTY";
          statusLabel = "Nghỉ bán trú";
        } else if (currentIso === dateStr) {
          status = "SELECTED";
          statusLabel = "Đang xem";
        } else if (hasMenu) {
          status = "AVAILABLE";
          statusLabel = "Có thực đơn";
        } else {
          status = "OFF_DUTY";
          statusLabel = "Nghỉ bán trú";
        }

        weekNav.push({
          date: currentIso,
          dayOfWeek: dayNames[i],
          dayOfMonth,
          status,
          statusLabel,
          isWeekend,
          hasMenu,
        });
      }

      // Fetch special portion groups (allergy groups)
      const portionGroupRows = await repository.findPortionGroupsForMenuDay(
        menuDay.id,
      );
      const specialPortionGroups: PortionGroupDetailDTO[] = [];

      for (const pg of portionGroupRows) {
        if (pg.isDefault) continue;

        const dishes = pg.dishes.map((d) => {
          const dish = d.menuDayDish?.Dish;
          const portionStr =
            d.menuDayDish?.portionSize && d.menuDayDish?.portionUnit
              ? `${d.menuDayDish.portionSize.toString()} ${d.menuDayDish.portionUnit}`
              : "1 suất";
          return {
            id: d.dishId,
            name: dish?.name || "Món ăn thay thế",
            portion: portionStr,
            tag: "Thay món",
          };
        });

        const avoidances = pg.avoidances.map((a) => ({
          id: a.ingredientEntry?.Ingredient?.id || a.ingredientEntryId,
          name: a.ingredientEntry?.Ingredient?.name || "Dị nguyên",
        }));

        const keyIngredients: IngredientDetailDTO[] = [];
        for (const d of pg.dishes) {
          const dish = d.menuDayDish?.Dish;
          if (dish?.dishIngredientEntries) {
            for (const entry of dish.dishIngredientEntries) {
              const ing = entry.IngredientEntry?.Ingredient;
              if (ing && !keyIngredients.some((k) => k.id === ing.id)) {
                keyIngredients.push({
                  id: ing.id,
                  name: ing.name,
                  category: ing.category || "Nguyên liệu chính",
                  portion: `${Number(entry.requiredQuantity)} ${entry.unit}`,
                  quantity: Number(entry.requiredQuantity),
                  unit: entry.unit,
                  traceable: true,
                });
              }
            }
          }
        }

        specialPortionGroups.push({
          id: pg.id,
          name: pg.name,
          mealType: pg.mealType,
          isDefault: pg.isDefault,
          dishes,
          avoidances,
          keyIngredients,
        });
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
        weekStartDate: menuDay.WeeklyMenu?.weekStartDate
          ? menuDay.WeeklyMenu.weekStartDate.toISOString().slice(0, 10)
          : dateStr,
        weekNav,
        specialPortionGroups,
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
      const school = await repository.findSchoolForMenu(schoolCode);
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

      let weeklyMenu = await repository.findWeeklyMenu(
        school.id,
        targetWeekMonday,
      );

      if (!weeklyMenu && !query.week) {
        weeklyMenu = await repository.findLatestApprovedWeeklyMenu(school.id);
      }

      if (!weeklyMenu || weeklyMenu.menuDays.length === 0) {
        return null;
      }

      const dayIds = weeklyMenu.menuDays.map((d) => d.id);
      const rawGroups = await repository.findPortionGroupsRaw(dayIds);
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

      const rawAvailableWeeks = await repository.findAvailableWeeklyMenuWeeks(
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
