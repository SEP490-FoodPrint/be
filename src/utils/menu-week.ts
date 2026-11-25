import { shortList } from "./short-list";
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

/** Rejects menu days that fall on a configured school holiday (BE guard; the UI already hides them). */
export function assertNoHolidayMenuDays(
  days: { menuDate: Date }[],
  years: MenuCalendarYear[],
): void {
  if (!days.length) return;
  const dates = days.map((day) => day.menuDate.toISOString().slice(0, 10));
  const first = dates.reduce((a, b) => (a < b ? a : b));
  const last = dates.reduce((a, b) => (a > b ? a : b));
  const holidays = new Map<string, string | null>();
  for (const year of years) {
    const start = year.startDate.toISOString().slice(0, 10);
    const end = year.endDate.toISOString().slice(0, 10);
    const from = start > first ? start : first;
    const to = end < last ? end : last;
    if (from > to) continue;
    for (const day of expandMenuHolidays(year.holidays, from, to))
      holidays.set(day.date, day.reason);
  }
  const blocked = [...new Set(dates)]
    .filter((date) => holidays.has(date))
    .sort();
  if (!blocked.length) return;
  const label = (date: string) => {
    const [y, m, d] = date.split("-");
    const reason = holidays.get(date);
    return `${d}/${m}/${y}${reason ? ` (${reason})` : ""}`;
  };
  throw new HttpError(
    422,
    `Không lập thực đơn vào ngày nghỉ: ${shortList(blocked.map(label))}`,
  );
}

const dmy = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Days must lie inside a configured academic year. Past days (before `today`,
 * Vietnam date) may only be resent unchanged: no new past day, no dish change.
 */
/**
 * Weekly menu deadline: a week must be created and submitted by the end of the
 * Sunday before it (Vietnam date). From Monday on, the week is locked unless the
 * management board has requested a revision of this menu.
 */
export function menuWeekLock(
  weekStartDate: Date,
  today: string,
  revisionRequested: boolean,
): { deadline: string; locked: boolean; reason: string | null } {
  const shift = (days: number) =>
    new Date(weekStartDate.getTime() + days * 86400000)
      .toISOString()
      .slice(0, 10);
  const monday = shift(0);
  const deadline = shift(-1);
  const locked = today >= monday && !revisionRequested;
  return {
    deadline,
    locked,
    reason: locked
      ? `Đã quá hạn lập và gửi duyệt thực đơn tuần ${dmy(monday)}–${dmy(shift(4))} (hạn chót hết Chủ nhật ${dmy(deadline)})`
      : null,
  };
}

export function assertMenuWeekOpen(
  weekStartDate: Date,
  today: string,
  revisionRequested: boolean,
): void {
  const lock = menuWeekLock(weekStartDate, today, revisionRequested);
  if (lock.reason) throw new HttpError(422, lock.reason);
}

export function assertMenuDaysEditable(
  days: {
    menuDate: Date;
    meals: { mealType: string; dishes: { dishId?: string | null }[] }[];
  }[],
  stored: {
    menuDate: Date;
    menuDayDishes: { mealType: string; dishId: string }[];
  }[],
  years: MenuCalendarYear[],
  today: string,
): void {
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  const outside = days
    .map((day) => iso(day.menuDate))
    .filter(
      (date) =>
        !years.some(
          (year) => iso(year.startDate) <= date && date <= iso(year.endDate),
        ),
    );
  if (outside.length)
    throw new HttpError(
      422,
      `Ngày ngoài năm học: ${shortList([...new Set(outside)].sort().map(dmy))}`,
    );
  const added: string[] = [];
  const changed: string[] = [];
  for (const day of days) {
    const date = iso(day.menuDate);
    if (date >= today) continue;
    const before = stored.find((row) => iso(row.menuDate) === date);
    if (!before) {
      added.push(date);
      continue;
    }
    const key = (rows: string[]) => [...rows].sort().join("|");
    const incoming = day.meals.flatMap((meal) =>
      meal.dishes.map((dish) => `${meal.mealType}:${dish.dishId ?? "new"}`),
    );
    const existing = before.menuDayDishes.map(
      (dish) => `${dish.mealType}:${dish.dishId}`,
    );
    if (key(incoming) !== key(existing)) changed.push(date);
  }
  if (added.length)
    throw new HttpError(
      422,
      `Không lập thực đơn cho ngày đã qua: ${shortList(added.sort().map(dmy))}`,
    );
  if (changed.length)
    throw new HttpError(
      422,
      `Không sửa thực đơn của ngày đã qua: ${shortList(changed.sort().map(dmy))}`,
    );
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
      `Thực đơn còn ${missing.length} ngày thiếu bữa: ${shortList(missing, "; ")}`,
    );
}
