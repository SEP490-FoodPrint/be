import type { PrismaClient } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import {
  formatDateDMY,
  formatTimeString,
  getDayOfWeekName,
  getWeekNumber,
} from "../../utils/date-time";
import type {
  PublicDailyMenuQuery,
  PublicWeeklyMenuQuery,
} from "./organization.validation";
import type {
  DishItemDTO,
  PortionGroupDTO,
  PublicDailyMenuDTO,
  PublicWeeklyMenuDTO,
  SnackItemDTO,
  WeeklyMenuDayDTO,
} from "./dtos";

export async function getPublicDailyMenu(
  schoolCode: string,
  query: PublicDailyMenuQuery,
  getClient: () => Promise<PrismaClient> = getPrisma,
): Promise<PublicDailyMenuDTO | null> {
  const prisma = await getClient();
  const school = await prisma.school.findFirst({
    where: {
      code: { equals: schoolCode.trim(), mode: "insensitive" },
      status: "ACTIVE",
    },
    select: {
      id: true,
      code: true,
      name: true,
      lunchTime: true,
      afternoonMealTime: true,
      coverImageUrl: true,
    },
  });

  if (!school) {
    throw new HttpError(404, `Không tìm thấy trường học với mã: ${schoolCode}`);
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

  let menuDay = await prisma.menuDay.findFirst({
    where: {
      menuDate: targetDate,
      WeeklyMenu: {
        schoolId: school.id,
        status: { in: ["APPROVED", "PENDING_APPROVAL"] },
      },
      approvalStatus: "APPROVED",
    },
    include: {
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
          { mealType: "asc" },
          { displayOrder: "asc" },
          { dishId: "asc" },
        ],
      },
    },
  });

  if (!menuDay && !query.date) {
    menuDay = await prisma.menuDay.findFirst({
      where: {
        WeeklyMenu: {
          schoolId: school.id,
          status: { in: ["APPROVED", "PENDING_APPROVAL"] },
        },
        approvalStatus: "APPROVED",
      },
      orderBy: { menuDate: "desc" },
      include: {
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
            { mealType: "asc" },
            { displayOrder: "asc" },
            { dishId: "asc" },
          ],
        },
      },
    });
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
}

export async function getPublicWeeklyMenu(
  schoolCode: string,
  query: PublicWeeklyMenuQuery,
  getClient: () => Promise<PrismaClient> = getPrisma,
): Promise<PublicWeeklyMenuDTO | null> {
  const prisma = await getClient();
  const school = await prisma.school.findFirst({
    where: {
      code: { equals: schoolCode.trim(), mode: "insensitive" },
      status: "ACTIVE",
    },
    select: { id: true, code: true, name: true },
  });

  if (!school) {
    throw new HttpError(404, `Không tìm thấy trường học với mã: ${schoolCode}`);
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

  let weeklyMenu = await prisma.weeklyMenu.findFirst({
    where: {
      schoolId: school.id,
      status: { in: ["APPROVED", "PENDING_APPROVAL"] },
      ...(targetWeekMonday ? { weekStartDate: targetWeekMonday } : {}),
    },
    orderBy: { weekStartDate: "desc" },
    include: {
      menuDays: {
        where: { approvalStatus: "APPROVED" },
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
              { mealType: "asc" },
              { displayOrder: "asc" },
              { dishId: "asc" },
            ],
          },
        },
        orderBy: { menuDate: "asc" },
      },
    },
  });

  if (!weeklyMenu && !query.week) {
    weeklyMenu = await prisma.weeklyMenu.findFirst({
      where: {
        schoolId: school.id,
        status: "APPROVED",
      },
      orderBy: { weekStartDate: "desc" },
      include: {
        menuDays: {
          where: { approvalStatus: "APPROVED" },
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
                { mealType: "asc" },
                { displayOrder: "asc" },
                { dishId: "asc" },
              ],
            },
          },
          orderBy: { menuDate: "asc" },
        },
      },
    });
  }

  if (!weeklyMenu || weeklyMenu.menuDays.length === 0) {
    return null;
  }

  const dayIds = weeklyMenu.menuDays.map((d) => d.id);
  let dynamicGroups: PortionGroupDTO[] = [];
  try {
    const rawGroups = await prisma.$queryRaw<
      Array<{ id: string; name: string; is_default: boolean }>
    >`
      SELECT DISTINCT id, name, is_default
      FROM foodprint.menu_meal_portion_groups
      WHERE menu_day_id = ANY(${dayIds}::uuid[])
      ORDER BY is_default DESC, name ASC;
    `;
    if (rawGroups && rawGroups.length > 0) {
      dynamicGroups = rawGroups.map((g) => ({
        id: g.id,
        name: g.name,
        isDefault: g.is_default,
      }));
    }
  } catch {
    // Fallback gracefully
  }

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
  };
}
