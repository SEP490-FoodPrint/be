import type { Prisma } from "../generated/prisma/client";
import { getSchoolWeekSchedule } from "./date-time";
import { HttpError } from "./http-error";

export interface MenuCalendarYear {
  startDate: Date;
  endDate: Date;
  holidays: Prisma.JsonValue;
}

export function expandMenuHolidays(
  value: Prisma.JsonValue,
  firstDate: string,
  lastDate: string,
): { date: string; reason: string | null }[] {
  if (!Array.isArray(value))
    throw new HttpError(409, "Cấu hình ngày nghỉ không hợp lệ");
  const days = new Map<string, string | null>();
  const valid = (date: unknown): date is string => {
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      return false;
    const parsed = new Date(`${date}T00:00:00Z`);
    return (
      Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === date
    );
  };
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new HttpError(409, "Cấu hình ngày nghỉ không hợp lệ");
    const start = item.date ?? item.startDate;
    const end = item.date ?? item.endDate;
    if (!valid(start) || !valid(end) || start > end)
      throw new HttpError(409, "Khoảng ngày nghỉ không hợp lệ");
    const from = start < firstDate ? firstDate : start;
    const to = end > lastDate ? lastDate : end;
    for (
      const day = new Date(`${from}T00:00:00Z`);
      day.toISOString().slice(0, 10) <= to;
      day.setUTCDate(day.getUTCDate() + 1)
    ) {
      days.set(
        day.toISOString().slice(0, 10),
        typeof item.reason === "string" ? item.reason : null,
      );
    }
  }
  return [...days]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, reason]) => ({ date, reason }));
}

export function assertCompleteMenuWeek(
  menu: {
    weekStartDate: Date;
    menuDays: {
      menuDate: Date;
      menuDayDishes: { mealType: string }[];
    }[];
  },
  years: MenuCalendarYear[],
): void {
  const week = getSchoolWeekSchedule(menu.weekStartDate);
  const holidays = new Set(
    years.flatMap((year) =>
      expandMenuHolidays(
        year.holidays,
        year.startDate.toISOString().slice(0, 10) > week.weekStartDate
          ? year.startDate.toISOString().slice(0, 10)
          : week.weekStartDate,
        year.endDate.toISOString().slice(0, 10) < week.weekEndDate
          ? year.endDate.toISOString().slice(0, 10)
          : week.weekEndDate,
      ).map((day) => day.date),
    ),
  );
  const missing = week.schoolDays.flatMap((day) => {
    if (holidays.has(day.date)) return [];
    const stored = menu.menuDays.find(
      (row) => row.menuDate.toISOString().slice(0, 10) === day.date,
    );
    const meals = new Set(stored?.menuDayDishes.map((row) => row.mealType));
    const labels = [
      ...(!meals.has("LUNCH") ? ["trưa"] : []),
      ...(!meals.has("AFTERNOON") ? ["xế"] : []),
    ];
    return labels.length
      ? [
          `${day.dayLabel} (${day.date.slice(8, 10)}/${day.date.slice(5, 7)}): ${labels.join(", ")}`,
        ]
      : [];
  });
  if (missing.length)
    throw new HttpError(
      422,
      `Thực đơn từ ${week.weekStartDate} đến ${week.weekEndDate} chưa đầy đủ các ngày/bữa phục vụ ăn. Còn thiếu: ${missing.join("; ")}. Vui lòng bổ sung trước khi gửi hoặc phê duyệt.`,
    );
}
