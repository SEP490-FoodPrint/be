// Năm học Việt Nam: tháng 9 năm N đến tháng 8 năm N+1, ghi dạng "N-N+1".
const START_MONTH = 9;
const YEAR_PATTERN = /^(\d{4})-(\d{4})$/;

function vietnamYearMonth(now: Date) {
  const [year, month] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
  })
    .format(now)
    .split("-")
    .map(Number);
  return { year, month };
}

export function currentAcademicYear(now: Date = new Date()): string {
  const { year, month } = vietnamYearMonth(now);
  const start = month >= START_MONTH ? year : year - 1;
  return `${start}-${start + 1}`;
}

/** Năm kết thúc của niên khóa "N-N+1"; null nếu chuỗi không đúng định dạng. */
export function academicYearEnd(value: string | null): number | null {
  const match = value ? YEAR_PATTERN.exec(value) : null;
  if (!match || Number(match[2]) !== Number(match[1]) + 1) return null;
  return Number(match[2]);
}

/** Chỉ niên khóa hiện tại hoặc sắp tới mới được gán/đổi GVCN. */
export function isAssignableAcademicYear(
  value: string | null,
  now: Date = new Date(),
): boolean {
  const end = academicYearEnd(value);
  const currentEnd = academicYearEnd(currentAcademicYear(now));
  return end !== null && currentEnd !== null && end >= currentEnd;
}
