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
  // Gom theo nhóm dị ứng của lớp: mỗi nhóm một số suất chung, tính một lần.
  const groups = new Map<
    number,
    {
      count: number;
      entries: NonNullable<(typeof allergies)[number]["IngredientEntry"]>[];
    }
  >();
  for (const row of allergies) {
    const count = row.portionCount;
    const groupNo = row.groupNo ?? 1;
    const group = groups.get(groupNo);
    if (
      count == null ||
      !Number.isSafeInteger(count) ||
      count <= 0 ||
      !row.IngredientEntry ||
      (group && group.count !== count)
    )
      throw new HttpError(
        409,
        "Cần kiểm tra lại suất dị ứng của lớp" + demand.Class.name,
      );
    if (group) group.entries.push(row.IngredientEntry);
    else groups.set(groupNo, { count, entries: [row.IngredientEntry] });
  }
  const totalAllergy = [...groups.values()].reduce((n, g) => n + g.count, 0);
  if (totalAllergy > demand.totalPortions)
    throw new HttpError(
      409,
      "Cần kiểm tra lại suất dị ứng của lớp" + demand.Class.name,
    );
  const entries = [...groups.values()].flatMap((group) => group.entries);
  const entryMatches = (
    entry: (typeof entries)[number],
    id: string,
    name: string,
  ) =>
    entry.ingredientId === id || allergenMatches(entry.Ingredient.name, name);
  const matches = (id: string, name: string) =>
    entries.filter((entry) => entryMatches(entry, id, name));
  for (const seasoning of menu.mealSeasonings ?? []) {
    const entry = seasoning.ingredientEntry;
    if (
      seasoning.mealType === demand.mealType &&
      matches(entry.ingredientId, entry.Ingredient.name).length
    )
      throw new HttpError(
        409,
        "Cần kiểm tra lại món dùng gia vị chung" + entry.Ingredient.name,
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
          "Cần kiểm tra lại thành phần món" + (dish?.Dish.name ?? "ăn"),
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
  // Nhóm dị ứng nào gặp nguyên liệu của món thì cả nhóm không ăn món này (trừ một lần theo nhóm)
  const excluded = [...groups.values()]
    .filter((group) =>
      group.entries.some((entry) =>
        ingredients.some((row) => entryMatches(entry, row.id, row.name)),
      ),
    )
    .reduce((n, group) => n + group.count, 0);
  return { required: demand.totalPortions - excluded, allergens };
}
