/**
 * Date and time helper utilities
 */

export function formatTimeString(d: Date | null | undefined): string | null {
  if (!d) return null;
  const hours = d.getHours().toString().padStart(2, "0");
  const minutes = d.getMinutes().toString().padStart(2, "0");
  const seconds = d.getSeconds().toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

export function getDayOfWeekName(d: Date): string {
  const days = [
    "Chủ Nhật",
    "Thứ Hai",
    "Thứ Ba",
    "Thứ Tư",
    "Thứ Năm",
    "Thứ Sáu",
    "Thứ Bảy",
  ];
  return days[d.getUTCDay()];
}

export function formatDateDMY(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function getWeekNumber(d: Date): number {
  const target = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
  }
  return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
}

export const SCHOOL_DAY_LABELS = [
  "Chủ Nhật",
  "Thứ Hai",
  "Thứ Ba",
  "Thứ Tư",
  "Thứ Năm",
  "Thứ Sáu",
  "Thứ Bảy",
] as const;

/**
 * Lấy ngày Thứ Hai của tuần chứa ngày d (00:00:00.000 UTC)
 */
export function getSchoolMonday(d: Date): Date {
  const date = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date;
}

/**
 * Trả về thông tin tuần học từ Thứ Hai đến Thứ Sáu cho ngày mục tiêu
 */
export function getSchoolWeekSchedule(targetDate: Date) {
  const monday = getSchoolMonday(targetDate);

  const schoolDays: {
    date: string;
    dayOfWeek: number;
    dayLabel: string;
    isSchoolDay: boolean;
  }[] = [];

  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    const dateStr = d.toISOString().slice(0, 10);

    schoolDays.push({
      date: dateStr,
      dayOfWeek: i + 1, // 1: T2, 2: T3, 3: T4, 4: T5, 5: T6
      dayLabel: SCHOOL_DAY_LABELS[i + 1],
      isSchoolDay: true,
    });
  }

  const friday = new Date(monday);
  friday.setUTCDate(monday.getUTCDate() + 4);

  return {
    weekStartDate: monday.toISOString().slice(0, 10),
    weekEndDate: friday.toISOString().slice(0, 10),
    schoolDays,
  };
}

/**
 * Tính số thứ tự tuần học trong năm học:
 * Dựa trên ngày bắt đầu năm học và ngày cần tra (quy về Thứ Hai đầu tuần).
 */
export function calculateAcademicWeekNumber(
  targetDate: Date,
  academicYearStartDate: Date,
): number {
  const mondayTarget = getSchoolMonday(targetDate);
  const mondayStart = getSchoolMonday(academicYearStartDate);
  const diffWeeks = Math.floor(
    (mondayTarget.getTime() - mondayStart.getTime()) / (7 * 86400000),
  );
  return diffWeeks + 1;
}

export interface AcademicWeekInfo {
  weekNumber: number;
  weekLabel: string;
  weekStartDate: string; // YYYY-MM-DD
  weekEndDate: string; // YYYY-MM-DD
  weekRange: string; // dd/mm/yyyy – dd/mm/yyyy
  isCurrentWeek: boolean;
}

/**
 * Sinh danh sách toàn bộ các tuần học trong năm học từ startDate đến endDate
 */
export function generateAcademicWeeks(
  startDate: Date,
  endDate: Date,
  today: Date = new Date(),
): AcademicWeekInfo[] {
  const monday = getSchoolMonday(startDate);
  const todayMonday = getSchoolMonday(today).toISOString().slice(0, 10);
  const weeks: AcademicWeekInfo[] = [];

  const dayLabel = (dateStr: string) =>
    `${dateStr.slice(8, 10)}/${dateStr.slice(5, 7)}/${dateStr.slice(0, 4)}`;

  while (monday <= endDate) {
    const schedule = getSchoolWeekSchedule(monday);
    const weekNumber = weeks.length + 1;
    const weekLabel = `Tuần ${weekNumber}`;
    const startDmy = dayLabel(schedule.weekStartDate);
    const endDmy = dayLabel(schedule.weekEndDate);

    weeks.push({
      weekNumber,
      weekLabel,
      weekStartDate: schedule.weekStartDate,
      weekEndDate: schedule.weekEndDate,
      weekRange: `${startDmy} – ${endDmy}`,
      isCurrentWeek: schedule.weekStartDate === todayMonday,
    });

    monday.setUTCDate(monday.getUTCDate() + 7);
  }

  return weeks;
}
