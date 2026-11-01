// Extend this parser with approved filters when this module gains business rules.
export { parseListQuery as validateMealAllocationListQuery } from "../../utils/list-query";
import { objectBody, uuid } from "../../utils/auth-validation";
export function validateMealAllocationCreate(value: unknown) {
  const body = objectBody(value, ["dailyMealPortionId", "menuDayId"]);
  return {
    dailyMealPortionId: uuid(body.dailyMealPortionId),
    menuDayId: uuid(body.menuDayId),
  };
}
export type MealAllocationInput = ReturnType<
  typeof validateMealAllocationCreate
>;
