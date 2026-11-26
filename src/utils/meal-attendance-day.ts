export type AttendanceMealType = "LUNCH" | "AFTERNOON";

export const ATTENDANCE_MEALS: readonly AttendanceMealType[] = [
  "LUNCH",
  "AFTERNOON",
];

export interface AttendanceClassRow {
  name: string;
  gradeId: string | null;
  dailyMealPortions: { mealType: string; totalPortions: number }[];
}

export interface AttendanceMenuRow {
  isSchoolWide: boolean;
  grades: { gradeId: string }[];
  menuDays: { menuDayDishes: { mealType: string }[] }[];
}

export interface AttendanceSummary {
  /** Tên lớp còn thiếu bản chốt của ít nhất một bữa có thực đơn cho khối của lớp. */
  pending: string[];
  /** Suất đã chốt theo bữa → khối. */
  actualByMeal: Map<AttendanceMealType, Map<string, number>>;
  /** Các bữa có thực đơn đã duyệt cho khối (khóa `""` = lớp chưa xếp khối, chỉ thực đơn toàn trường). */
  mealsFor: (gradeId: string | null) => Set<AttendanceMealType>;
}

/**
 * Điểm danh theo từng bữa (UC 22, BR-IMD-06): lớp phải chốt mọi bữa (trưa, xế)
 * có thực đơn đã duyệt cho khối của lớp; sĩ số thực tế tính riêng từng bữa.
 */
export function summarizeAttendance(
  classes: AttendanceClassRow[],
  menus: AttendanceMenuRow[],
): AttendanceSummary {
  const cache = new Map<string, Set<AttendanceMealType>>();
  const mealsFor = (gradeId: string | null) => {
    const key = gradeId ?? "";
    let meals = cache.get(key);
    if (!meals) {
      meals = new Set<AttendanceMealType>();
      for (const menu of menus) {
        if (
          !menu.isSchoolWide &&
          !(gradeId && menu.grades.some((row) => row.gradeId === gradeId))
        )
          continue;
        for (const day of menu.menuDays)
          for (const dish of day.menuDayDishes)
            if (dish.mealType === "LUNCH" || dish.mealType === "AFTERNOON")
              meals.add(dish.mealType);
      }
      cache.set(key, meals);
    }
    return meals;
  };
  const pending: string[] = [];
  const actualByMeal = new Map<AttendanceMealType, Map<string, number>>(
    ATTENDANCE_MEALS.map((meal) => [meal, new Map<string, number>()]),
  );
  for (const row of classes) {
    const meals = mealsFor(row.gradeId);
    const finalized = new Map<string, number>();
    for (const portion of row.dailyMealPortions)
      finalized.set(
        portion.mealType,
        (finalized.get(portion.mealType) ?? 0) + portion.totalPortions,
      );
    if ([...meals].some((meal) => !finalized.has(meal))) pending.push(row.name);
    if (!row.gradeId) continue;
    for (const meal of meals) {
      const byGrade = actualByMeal.get(meal)!;
      byGrade.set(
        row.gradeId,
        (byGrade.get(row.gradeId) ?? 0) + (finalized.get(meal) ?? 0),
      );
    }
  }
  return { pending, actualByMeal, mealsFor };
}
