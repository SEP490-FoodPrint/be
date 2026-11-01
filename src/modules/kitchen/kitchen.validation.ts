import {
  objectBody,
  uuid,
  text,
  isoTimestamp,
  calendarDate,
} from "../../utils/auth-validation";
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
  const body = objectBody(value ?? {}, ["inspectionData"]);
  if (body.inspectionData === undefined) return undefined; // Only an already-completed retry may omit it.
  const data = objectBody(body.inspectionData, [
    "step2_Cooking",
    "step3_Serving",
  ]);
  const cooking = objectBody(data.step2_Cooking, [
    "startTime",
    "endTime",
    "method",
    "cookStaff",
  ]);
  const serving = objectBody(data.step3_Serving, [
    "servingTime",
    "servingTemperature",
    "tempPass",
    "sensoryEvaluation",
    "sensoryPass",
    "hygieneStaff",
    "hygieneUtensils",
    "inspectedBy",
    "inspectedAt",
    "notes",
  ]);
  const clock = (value: unknown) => {
    if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))
      throw new HttpError(400, "Giờ kiểm thực phải có định dạng HH:mm");
    return value;
  };
  if (
    typeof serving.servingTemperature !== "number" ||
    !Number.isFinite(serving.servingTemperature) ||
    serving.servingTemperature < -50 ||
    serving.servingTemperature > 300
  )
    throw new HttpError(400, "Nhiệt độ kiểm thực không hợp lệ");
  for (const key of [
    "tempPass",
    "sensoryPass",
    "hygieneStaff",
    "hygieneUtensils",
  ])
    if (typeof serving[key] !== "boolean")
      throw new HttpError(400, "Kết quả kiểm thực phải là boolean");
  // Application threshold explicitly required by API FINAL; never trust a client-supplied pass flag.
  if (
    serving.servingTemperature < 65 ||
    !serving.tempPass ||
    !serving.sensoryPass ||
    !serving.hygieneStaff ||
    !serving.hygieneUtensils
  )
    throw new HttpError(
      422,
      "Kiểm thực chưa đạt điều kiện nghiệm thu; chưa được hoàn thành mẻ",
    );
  return {
    step2_Cooking: {
      startTime: clock(cooking.startTime),
      endTime: clock(cooking.endTime),
      method: text(cooking.method, 1000),
      cookStaff: text(cooking.cookStaff, 255),
    },
    step3_Serving: {
      servingTime: clock(serving.servingTime),
      servingTemperature: serving.servingTemperature,
      tempPass: true,
      sensoryEvaluation: text(serving.sensoryEvaluation, 2000),
      sensoryPass: true,
      hygieneStaff: true,
      hygieneUtensils: true,
      inspectedBy: text(serving.inspectedBy, 255),
      inspectedAt: isoTimestamp(serving.inspectedAt).toISOString(),
      notes:
        serving.notes === undefined
          ? ""
          : typeof serving.notes === "string" && serving.notes.length <= 2000
            ? serving.notes.trim()
            : text(serving.notes, 2000),
    },
  };
}
export type KitchenInspection = NonNullable<
  ReturnType<typeof validateKitchenComplete>
>;

export function validateKitchenFilters(query: Record<string, unknown>) {
  if (
    Object.keys(query).some(
      (key) =>
        ![
          "page",
          "limit",
          "date",
          "mealType",
          "status",
          "menuDayId",
          "dishId",
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
  return {
    ...page,
    date: query.date === undefined ? undefined : calendarDate(query.date),
    mealType: query.mealType,
    status: query.status as
      "UNCONFIRMED" | "CONFIRMED" | "COMPLETED" | undefined,
    menuDayId:
      query.menuDayId === undefined ? undefined : uuid(query.menuDayId),
    dishId: query.dishId === undefined ? undefined : uuid(query.dishId),
  } as const;
}
export type KitchenFilters = ReturnType<typeof validateKitchenFilters>;
