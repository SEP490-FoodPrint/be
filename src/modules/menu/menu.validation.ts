import { Prisma } from "../../generated/prisma/client";
import { objectBody, uuid } from "../../utils/auth-validation";
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

export function validateMenuIngredientKind(
  value: unknown,
): "main" | "seasoning" {
  if (value !== "main" && value !== "seasoning")
    throw new HttpError(400, "Loại nguyên liệu không hợp lệ");
  return value;
}
