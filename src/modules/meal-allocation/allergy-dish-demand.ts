import { allergenMatches } from "../../utils/allergy-match";
import { HttpError } from "../../utils/http-error";
import type { AllocationDay } from "./meal-allocation.repository";

export function allergyDishDemand(
  data: AllocationDay,
  menu: AllocationDay["menus"][number],
  demand: AllocationDay["demands"][number],
  dishId: string,
) {
  const allergies = demand.dailyAllergyPortions.filter(
    (row) => row.portionCount !== 0,
  );
  if (!allergies.length)
    return { required: demand.totalPortions, allergens: [] as string[] };
  const count = allergies[0].portionCount;
  if (
    count == null ||
    !Number.isSafeInteger(count) ||
    count <= 0 ||
    count > demand.totalPortions ||
    allergies.some((row) => row.portionCount !== count || !row.ClassAllergy)
  )
    throw new HttpError(
      409,
      "Cần đối soát số suất dị ứng của lớp " + demand.Class.name,
    );
  const entries = allergies.map((row) => row.ClassAllergy!.IngredientEntry);
  const matches = (id: string, name: string) =>
    entries.filter(
      (entry) =>
        entry.ingredientId === id ||
        allergenMatches(entry.Ingredient.name, name),
    );
  for (const seasoning of menu.mealSeasonings ?? []) {
    const entry = seasoning.ingredientEntry;
    if (
      seasoning.mealType === demand.mealType &&
      matches(entry.ingredientId, entry.Ingredient.name).length
    )
      throw new HttpError(
        409,
        "Cần đối soát món dùng gia vị chung " + entry.Ingredient.name,
      );
  }
  const dish = menu.menuDayDishes.find(
    (row) => row.dishId === dishId && row.mealType === demand.mealType,
  );
  const planned =
    dish?.ingredients?.map((row) => ({
      id: row.ingredientId,
      name: row.ingredient.name,
    })) ?? [];
  const batches = data.batches.filter(
    (batch) =>
      batch.menuDayId === menu.id &&
      batch.mealType === demand.mealType &&
      batch.dishes.some((row) => row.dishId === dishId),
  );
  const ingredients = (batches.length ? batches : [undefined]).flatMap(
    (batch) => {
      const actual = (batch?.cookingBatchLots ?? []).flatMap((lot) => {
        const item = lot.IngredientLot?.DeliveryItem;
        return lot.dishId === dishId && item
          ? [{ id: item.ingredientId, name: item.Ingredient.name }]
          : [];
      });
      const lines = [...actual, ...planned];
      if (!lines.length)
        throw new HttpError(
          409,
          "Cần đối soát thành phần món " + (dish?.Dish.name ?? dishId),
        );
      return lines;
    },
  );
  const allergens = [
    ...new Set(
      ingredients.flatMap((row) =>
        matches(row.id, row.name).map((entry) => entry.Ingredient.name),
      ),
    ),
  ];
  return {
    required: demand.totalPortions - (allergens.length ? count : 0),
    allergens,
  };
}
