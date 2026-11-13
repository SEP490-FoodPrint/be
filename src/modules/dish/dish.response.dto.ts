import type { DishCategory } from "../../generated/prisma/enums";

export interface DishCategoryOptionDTO {
  key: DishCategory;
  label: string;
}

export interface DishRecipeDTO {
  id: string;
  name: string;
  category: string | null;
  categoryLabel: string | null;
  description: string | null;
  lines: {
    ingredientEntryId: string;
    ingredientId: string;
    name: string;
    supplierId: string;
    supplierName: string;
    ingredientRole: string | null;
    requiredQuantity: string;
    unit: string;
  }[];
}
