import { objectBody, uuid, calendarDate } from "../../utils/auth-validation";
import { parseListQuery } from "../../utils/list-query";
import { HttpError } from "../../utils/http-error";
export { parseListQuery as validateKitchenListQuery } from "../../utils/list-query";

export function validateKitchenPlan(value: unknown) {
  const body = objectBody(value, ["menuDayId", "dishId", "mealType"]);
  const mealType = body.mealType;
  if (mealType !== "LUNCH" && mealType !== "AFTERNOON")
    throw new HttpError(400, "Ca ăn không hợp lệ");
  return {
    menuDayId: uuid(body.menuDayId),
    dishId: uuid(body.dishId),
    mealType,
  } as const;
}

export function validateKitchenAction(value: unknown) {
  objectBody(value ?? {}, []);
}

export function validateKitchenUpdate(value: unknown) {
  const body = objectBody(value, ["note"]);
  if (
    !Object.hasOwn(body, "note") ||
    (body.note !== null &&
      (typeof body.note !== "string" || body.note.length > 2000))
  )
    throw new HttpError(400, "Chỉ được sửa ghi chú, tối đa 2000 ký tự");
  return {
    note: body.note === null ? null : body.note.trim() || null,
  };
}

export function validateKitchenComplete(value: unknown) {
  if (value === undefined || value === null) return undefined;
  const body = objectBody(value, ["note", "inspectionData"]);
  if (
    body.note !== undefined &&
    body.note !== null &&
    (typeof body.note !== "string" || body.note.length > 2000)
  )
    throw new HttpError(400, "Ghi chú tối đa 2000 ký tự");
  return {
    note:
      body.note === null || body.note === undefined
        ? undefined
        : body.note.trim() || undefined,
  };
}
export type KitchenCompleteInput = ReturnType<typeof validateKitchenComplete>;
export type KitchenInspection = KitchenCompleteInput;

export function validateKitchenFilters(query: Record<string, unknown>) {
  if (
    Object.keys(query).some(
      (key) =>
        ![
          "page",
          "limit",
          "date",
          "startDate",
          "endDate",
          "mealType",
          "status",
          "menuDayId",
          "dishId",
          "cookingModeApplied",
          "search",
        ].includes(key),
    )
  )
    throw new HttpError(400, "Bộ lọc mẻ nấu không hợp lệ");
  const page = parseListQuery({
    ...(query.page === undefined ? {} : { page: query.page }),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
  });
  if (
    query.mealType !== undefined &&
    query.mealType !== "LUNCH" &&
    query.mealType !== "AFTERNOON"
  )
    throw new HttpError(400, "Ca ăn không hợp lệ");
  if (
    query.status !== undefined &&
    (typeof query.status !== "string" ||
      !["UNCONFIRMED", "CONFIRMED", "COMPLETED"].includes(query.status))
  )
    throw new HttpError(400, "Trạng thái mẻ không hợp lệ");
  if (
    query.cookingModeApplied !== undefined &&
    query.cookingModeApplied !== "COMBINE_LOTS" &&
    query.cookingModeApplied !== "SEPARATE_BY_LOT"
  )
    throw new HttpError(400, "Phương thức chế biến không hợp lệ");
  if (
    query.search !== undefined &&
    (typeof query.search !== "string" || query.search.trim().length > 100)
  )
    throw new HttpError(400, "Từ khóa tìm kiếm tối đa 100 ký tự");
  return {
    ...page,
    date: query.date === undefined ? undefined : calendarDate(query.date),
    startDate:
      query.startDate === undefined ? undefined : calendarDate(query.startDate),
    endDate:
      query.endDate === undefined ? undefined : calendarDate(query.endDate),
    mealType: query.mealType,
    status: query.status as
      "UNCONFIRMED" | "CONFIRMED" | "COMPLETED" | undefined,
    cookingModeApplied: query.cookingModeApplied,
    search:
      typeof query.search === "string"
        ? query.search.trim() || undefined
        : undefined,
    menuDayId:
      query.menuDayId === undefined ? undefined : uuid(query.menuDayId),
    dishId: query.dishId === undefined ? undefined : uuid(query.dishId),
  } as const;
}
export type KitchenFilters = ReturnType<typeof validateKitchenFilters>;
