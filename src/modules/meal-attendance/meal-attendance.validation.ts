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
  // Mỗi nhóm dị ứng của lớp một số suất hôm nay (0 nếu các em trong nhóm nghỉ)
  const allergies = body.allergies.map((value: unknown) => {
    const row = objectBody(value, ["groupNo", "portionCount"]);
    if (
      typeof row.groupNo !== "number" ||
      !Number.isSafeInteger(row.groupNo) ||
      row.groupNo < 1 ||
      row.groupNo > 50
    )
      throw new HttpError(400, "Nhóm dị ứng không hợp lệ");
    if (
      typeof row.portionCount !== "number" ||
      !Number.isSafeInteger(row.portionCount) ||
      row.portionCount < 0 ||
      row.portionCount > totalPortions
    )
      throw new HttpError(400, "Số suất dị ứng phải nằm trong tổng số suất");
    return { groupNo: row.groupNo, portionCount: row.portionCount };
  });
  if (new Set(allergies.map((row) => row.groupNo)).size !== allergies.length)
    throw new HttpError(400, "Trùng nhóm dị ứng");
  if (allergies.reduce((sum, row) => sum + row.portionCount, 0) > totalPortions)
    throw new HttpError(400, "Tổng suất dị ứng vượt tổng số suất");
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

/**
 * Hồ sơ dị ứng của lớp do GVCN khai theo NHÓM: mỗi nhóm là một tập nguyên liệu (kho trường) mà một
 * nhóm học sinh cùng phải tránh + số học sinh của nhóm. Ví dụ A: 1, B: 1, (A, B): 1 -> 3 học sinh.
 * Vẫn nhận dạng cũ { ingredientEntryIds, affectedCount } như một nhóm duy nhất.
 */
export function validateClassAllergyProfile(value: unknown) {
  const raw = objectBody(value, [
    "groups",
    "ingredientEntryIds",
    "affectedCount",
  ]);
  const rawGroups: unknown[] =
    raw.groups !== undefined
      ? Array.isArray(raw.groups)
        ? raw.groups
        : (() => {
            throw new HttpError(400, "Danh sách nhóm dị ứng không hợp lệ");
          })()
      : Array.isArray(raw.ingredientEntryIds) && raw.ingredientEntryIds.length
        ? [
            {
              ingredientEntryIds: raw.ingredientEntryIds,
              affectedCount: raw.affectedCount,
            },
          ]
        : [];
  if (rawGroups.length > 50)
    throw new HttpError(400, "Tối đa 50 nhóm dị ứng mỗi lớp");
  const groups = rawGroups.map((value, index) => {
    const row = objectBody(value, ["ingredientEntryIds", "affectedCount"]);
    const label = `Nhóm dị ứng ${index + 1}`;
    if (
      !Array.isArray(row.ingredientEntryIds) ||
      row.ingredientEntryIds.length === 0 ||
      row.ingredientEntryIds.length > 100
    )
      throw new HttpError(400, `${label}: chọn ít nhất một nguyên liệu dị ứng`);
    const ingredientEntryIds = row.ingredientEntryIds.map((id: unknown) =>
      uuid(id),
    );
    if (new Set(ingredientEntryIds).size !== ingredientEntryIds.length)
      throw new HttpError(400, `${label}: trùng nguyên liệu dị ứng`);
    const count = row.affectedCount;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 1)
      throw new HttpError(
        400,
        `${label}: số học sinh dị ứng phải là số nguyên từ 1`,
      );
    return { ingredientEntryIds, affectedCount: count };
  });
  const keys = groups.map((g) => [...g.ingredientEntryIds].sort().join("|"));
  if (new Set(keys).size !== keys.length)
    throw new HttpError(
      400,
      "Hai nhóm dị ứng trùng đúng một tập nguyên liệu; hãy gộp số học sinh vào một nhóm",
    );
  return { groups };
}
export type ClassAllergyProfileInput = ReturnType<
  typeof validateClassAllergyProfile
>;
