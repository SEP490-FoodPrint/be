// Extend this parser with approved filters when this module gains business rules.
export { parseListQuery as validateMealAttendanceListQuery } from "../../utils/list-query";
import { calendarDate, objectBody, uuid } from "../../utils/auth-validation";
import { HttpError } from "../../utils/http-error";
export function validateMealSummaryQuery(query: Record<string, unknown>) {
  if (Object.keys(query).some((k) => !["date", "mealType"].includes(k)))
    throw new HttpError(400, "Chỉ hỗ trợ date và mealType");
  if (query.mealType !== "LUNCH" && query.mealType !== "AFTERNOON")
    throw new HttpError(400, "Ca ăn không hợp lệ");
  return { date: calendarDate(query.date), mealType: query.mealType } as const;
}
export type MealSummaryQuery = ReturnType<typeof validateMealSummaryQuery>;
export const validateMyClassMealQuery = validateMealSummaryQuery;

export function validateDailyMealPortion(value: unknown) {
  const body = objectBody(value, [
    "date",
    "mealType",
    "totalPortions",
    "allergyNotes",
    "allergies",
  ]);
  if (body.mealType !== "LUNCH" && body.mealType !== "AFTERNOON")
    throw new HttpError(400, "Ca ăn không hợp lệ");
  if (
    typeof body.totalPortions !== "number" ||
    !Number.isSafeInteger(body.totalPortions) ||
    body.totalPortions < 0
  )
    throw new HttpError(400, "Tổng số suất phải là số nguyên không âm");
  if (!Array.isArray(body.allergies) || body.allergies.length > 100)
    throw new HttpError(400, "Danh sách dị ứng không hợp lệ");
  const totalPortions = body.totalPortions;
  const allergies = body.allergies.map((value: unknown) => {
    const row = objectBody(value, ["ingredientEntryId", "portionCount"]);
    if (
      typeof row.portionCount !== "number" ||
      !Number.isSafeInteger(row.portionCount) ||
      row.portionCount < 0 ||
      row.portionCount > totalPortions
    )
      throw new HttpError(400, "Số suất dị ứng phải nằm trong tổng số suất");
    return {
      ingredientEntryId: uuid(row.ingredientEntryId),
      portionCount: row.portionCount,
    };
  });
  if (
    new Set(allergies.map((row) => row.ingredientEntryId)).size !==
    allergies.length
  )
    throw new HttpError(400, "Trùng nguyên liệu dị ứng");
  let allergyNotes: string | null = null;
  if (body.allergyNotes !== undefined && body.allergyNotes !== null) {
    if (
      typeof body.allergyNotes !== "string" ||
      body.allergyNotes.trim().length > 1000
    )
      throw new HttpError(400, "Ghi chú dị ứng không hợp lệ");
    allergyNotes = body.allergyNotes.trim() || null;
  }
  return {
    date: calendarDate(body.date),
    mealType: body.mealType,
    totalPortions,
    allergyNotes,
    allergies,
  } as const;
}
export type DailyMealPortionInput = ReturnType<typeof validateDailyMealPortion>;

export function validateDailyPortionGroups(value: unknown) {
  const body = objectBody(value, ["menuDayId", "groups"]);
  if (
    !Array.isArray(body.groups) ||
    body.groups.length === 0 ||
    body.groups.length > 30
  )
    throw new HttpError(400, "Cần khai báo đầy đủ các nhóm suất");
  const groups = body.groups.map((value: unknown) => {
    const row = objectBody(value, ["portionGroupId", "portionCount"]);
    if (
      typeof row.portionCount !== "number" ||
      !Number.isSafeInteger(row.portionCount) ||
      row.portionCount < 0 ||
      row.portionCount > 2147483647
    )
      throw new HttpError(400, "Số suất nhóm phải là số nguyên không âm");
    return {
      portionGroupId: uuid(row.portionGroupId),
      portionCount: row.portionCount,
    };
  });
  if (new Set(groups.map((g) => g.portionGroupId)).size !== groups.length)
    throw new HttpError(400, "Trùng nhóm suất");
  return { menuDayId: uuid(body.menuDayId), groups };
}
export type DailyPortionGroupsInput = ReturnType<
  typeof validateDailyPortionGroups
>;
