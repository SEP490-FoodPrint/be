import { objectBody, uuid } from "../../utils/auth-validation";
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
