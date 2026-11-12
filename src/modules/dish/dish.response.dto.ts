export interface DishRecipeDTO {
  id: string;
  name: string;
  description: string | null;
  lines: {
    ingredientEntryId: string;
    ingredientId: string;
    name: string;
    ingredientRole: string | null;
    requiredQuantity: string;
    unit: string;
  }[];
}
