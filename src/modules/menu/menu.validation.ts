import { Prisma } from "../../generated/prisma/client";
import {
  objectBody,
  uuid,
  text,
  calendarDate,
} from "../../utils/auth-validation";
import { parseListQuery } from "../../utils/list-query";
import { HttpError } from "../../utils/http-error";

// Extend this parser with approved filters when this module gains business rules.
export { parseListQuery as validateMenuListQuery } from "../../utils/list-query";

export function validateMenuMeal(menuDayId: unknown, mealType: unknown) {
  if (mealType !== "LUNCH" && mealType !== "AFTERNOON")
    throw new HttpError(400, "Bữa ăn không hợp lệ");
  return { menuDayId: uuid(menuDayId), mealType } as const;
}

function amount(body: Record<string, unknown>) {
  if (
    typeof body.quantityPerPortion !== "string" &&
    typeof body.quantityPerPortion !== "number"
  )
    throw new HttpError(400, "Định mức phải là số hoặc chuỗi số thập phân");
  const quantity = String(body.quantityPerPortion);
  if (
    !/^(?:0|[1-9]\d{0,10})(?:\.\d{1,3})?$/.test(quantity) ||
    !new Prisma.Decimal(quantity).gt(0)
  )
    throw new HttpError(
      400,
      "Định mức phải dương, tối đa 11 chữ số nguyên và 3 chữ số thập phân",
    );
  if (
    typeof body.unit !== "string" ||
    !body.unit.trim() ||
    body.unit.trim().length > 30
  )
    throw new HttpError(400, "Đơn vị không hợp lệ");
  return { quantityPerPortion: quantity, unit: body.unit.trim().toLowerCase() };
}

function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new HttpError(400, "Danh sách định mức không hợp lệ");
  return value as unknown[];
}
function unique(values: readonly string[]) {
  if (new Set(values).size !== values.length)
    throw new HttpError(400, "Định mức bị trùng");
}

export function validateMenuStandards(value: unknown) {
  const body = objectBody(value, ["dishes", "seasonings"]);
  const dishes = array(body.dishes, 50).map((value) => {
    const dish = objectBody(value, ["dishId", "ingredients"]);
    const ingredients = array(dish.ingredients, 100).map((value) => {
      const line = objectBody(value, [
        "ingredientId",
        "quantityPerPortion",
        "unit",
      ]);
      return { ingredientId: uuid(line.ingredientId), ...amount(line) };
    });
    if (!ingredients.length)
      throw new HttpError(400, "Mỗi món cần ít nhất một nguyên liệu chính");
    unique(ingredients.map((i) => i.ingredientId));
    return { dishId: uuid(dish.dishId), ingredients };
  });
  if (
    !dishes.length ||
    dishes.reduce((n, d) => n + d.ingredients.length, 0) > 1000
  )
    throw new HttpError(400, "Số dòng định mức không hợp lệ");
  unique(dishes.map((dish) => dish.dishId));
  const seasonings = array(body.seasonings, 100).map((value) => {
    const line = objectBody(value, [
      "ingredientEntryId",
      "quantityPerPortion",
      "unit",
    ]);
    return { ingredientEntryId: uuid(line.ingredientEntryId), ...amount(line) };
  });
  unique(seasonings.map((s) => s.ingredientEntryId));
  return { dishes, seasonings };
}
export type MenuStandardsInput = ReturnType<typeof validateMenuStandards>;
export type MenuMeal = ReturnType<typeof validateMenuMeal>;

export function validateMenuPortionGroups(value: unknown) {
  const body = objectBody(value, ["groups"]);
  const groups = array(body.groups, 30).map((value) => {
    const group = objectBody(value, [
      "id",
      "name",
      "isDefault",
      "dishIds",
      "avoidedIngredientEntryIds",
    ]);
    if (typeof group.isDefault !== "boolean")
      throw new HttpError(400, "isDefault phải là boolean");
    const dishIds = array(group.dishIds, 50).map(uuid),
      avoidedIngredientEntryIds = array(
        group.avoidedIngredientEntryIds,
        100,
      ).map(uuid);
    unique(dishIds);
    unique(avoidedIngredientEntryIds);
    if (
      !dishIds.length ||
      (group.isDefault
        ? avoidedIngredientEntryIds.length > 0
        : avoidedIngredientEntryIds.length === 0)
    )
      throw new HttpError(
        400,
        "Nhóm phải có món; nhóm riêng cần khai báo nguyên liệu cần tránh",
      );
    return {
      id: group.id === undefined ? undefined : uuid(group.id),
      name: text(group.name, 120),
      isDefault: group.isDefault,
      dishIds,
      avoidedIngredientEntryIds,
    };
  });
  unique(groups.flatMap((g) => (g.id ? [g.id] : [])));
  unique(groups.map((g) => g.name));
  if (groups.length && groups.filter((g) => g.isDefault).length !== 1)
    throw new HttpError(400, "Cần đúng một nhóm suất thường");
  return { groups };
}
export type MenuPortionGroupsInput = ReturnType<
  typeof validateMenuPortionGroups
>;

export function validateMenuIngredientKind(
  value: unknown,
): "main" | "seasoning" {
  if (value !== "main" && value !== "seasoning")
    throw new HttpError(400, "Loại nguyên liệu không hợp lệ");
  return value;
}

export function validateMenuWrite(value: unknown) {
  const body = objectBody(value, ["weekStartDate", "title", "days"]);
  const weekStartDate = calendarDate(body.weekStartDate);
  const days = array(body.days, 7).map((value) => {
    const day = objectBody(value, ["menuDate", "note", "meals"]);
    const menuDate = calendarDate(day.menuDate);
    const dayOfWeek = menuDate.getUTCDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      throw new HttpError(
        400,
        `Ngày ${menuDate.toISOString().slice(0, 10)} là cuối tuần (${dayOfWeek === 6 ? "Thứ Bảy" : "Chủ Nhật"}). Thực đơn bán trú chỉ áp dụng từ Thứ Hai đến Thứ Sáu (T2 - T6).`,
      );
    }
    if (
      menuDate < weekStartDate ||
      menuDate.getTime() >= weekStartDate.getTime() + 7 * 86400000
    )
      throw new HttpError(400, "Ngày thực đơn phải thuộc tuần đã chọn");
    const meals = array(day.meals, 2).map((value) => {
      const meal = objectBody(value, ["mealType", "dishes", "seasonings"]);
      if (meal.mealType !== "LUNCH" && meal.mealType !== "AFTERNOON")
        throw new HttpError(400, "Ca ăn không hợp lệ");
      const dishes = array(meal.dishes, 50).map((value) => {
        const dish = objectBody(value, ["dishId", "name", "ingredients"]);
        if ((dish.dishId === undefined) === (dish.name === undefined))
          throw new HttpError(400, "Chọn dishId hoặc nhập tên món mới");
        const ingredients = array(dish.ingredients ?? [], 100).map((value) => {
          const line = objectBody(value, [
            "ingredientId",
            "quantityPerPortion",
            "unit",
          ]);
          return { ingredientId: uuid(line.ingredientId), ...amount(line) };
        });
        unique(ingredients.map((i) => i.ingredientId));
        return {
          dishId: dish.dishId === undefined ? undefined : uuid(dish.dishId),
          name: dish.name === undefined ? undefined : text(dish.name, 255),
          ingredients,
        };
      });
      if (!dishes.length)
        throw new HttpError(400, "Bữa ăn cần ít nhất một món");
      unique(dishes.map((d) => d.dishId ?? `name:${d.name}`));
      const seasonings = array(meal.seasonings ?? [], 100).map((value) => {
        const line = objectBody(value, [
          "ingredientEntryId",
          "quantityPerPortion",
          "unit",
        ]);
        return {
          ingredientEntryId: uuid(line.ingredientEntryId),
          ...amount(line),
        };
      });
      unique(seasonings.map((s) => s.ingredientEntryId));
      return { mealType: meal.mealType, dishes, seasonings } as const;
    });
    if (!meals.length)
      throw new HttpError(400, "Ngày thực đơn cần ít nhất một bữa");
    unique(meals.map((m) => m.mealType));
    return {
      menuDate,
      note: day.note == null ? null : text(day.note, 2000),
      meals,
    };
  });
  if (
    !days.length ||
    days
      .flatMap((d) => d.meals)
      .reduce(
        (n, m) =>
          n +
          m.seasonings.length +
          m.dishes.reduce((s, d) => s + d.ingredients.length, 0),
        0,
      ) > 2000
  )
    throw new HttpError(400, "Số dòng thực đơn không hợp lệ");
  unique(days.map((d) => d.menuDate.toISOString()));
  return {
    weekStartDate,
    title: body.title == null ? null : text(body.title, 255),
    days,
  };
}
export type MenuWrite = ReturnType<typeof validateMenuWrite>;

export function validateMenuReview(value: unknown) {
  const body = objectBody(value, ["menuDayId", "decision", "feedback"]);
  if (body.decision !== "APPROVED" && body.decision !== "REVISION_REQUESTED")
    throw new HttpError(400, "Quyết định duyệt không hợp lệ");
  const feedback =
    body.feedback === undefined || body.feedback === ""
      ? null
      : text(body.feedback, 2000);
  if (body.decision === "REVISION_REQUESTED" && !feedback)
    throw new HttpError(400, "Cần nêu lý do yêu cầu chỉnh sửa");
  return {
    menuDayId: body.menuDayId == null ? null : uuid(body.menuDayId),
    decision: body.decision,
    feedback,
  } as const;
}
export type MenuReviewInput = ReturnType<typeof validateMenuReview>;

export function validateMenuFilters(query: Record<string, unknown>) {
  if (
    Object.keys(query).some(
      (k) => !["page", "limit", "date", "weekStartDate", "status"].includes(k),
    )
  )
    throw new HttpError(400, "Bộ lọc thực đơn không hợp lệ");
  if (
    query.status !== undefined &&
    (typeof query.status !== "string" ||
      !["DRAFT", "PENDING_APPROVAL", "REVISION_REQUIRED", "APPROVED"].includes(
        query.status,
      ))
  )
    throw new HttpError(400, "Trạng thái thực đơn không hợp lệ");
  return {
    ...parseListQuery({
      ...(query.page === undefined ? {} : { page: query.page }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    }),
    date: query.date === undefined ? undefined : calendarDate(query.date),
    weekStartDate:
      query.weekStartDate === undefined
        ? undefined
        : calendarDate(query.weekStartDate),
    status: query.status as
      | "DRAFT"
      | "PENDING_APPROVAL"
      | "REVISION_REQUIRED"
      | "APPROVED"
      | undefined,
  };
}
export type MenuFilters = ReturnType<typeof validateMenuFilters>;

export function validateAllergyCheck(value: unknown) {
  const body = objectBody(value, ["ingredientIds"]);
  const ids = array(body.ingredientIds, 100).map(uuid);
  if (!ids.length) throw new HttpError(400, "Cần chọn ít nhất một nguyên liệu");
  unique(ids);
  return ids;
}
