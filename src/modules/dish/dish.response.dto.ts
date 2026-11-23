import type { DishCategory, DishMealType } from "../../generated/prisma/enums";

export interface DishCategoryOptionDTO {
  key: DishCategory;
  label: string;
}

export interface DishRecipeDTO {
  id: string;
  name: string;
  mealType: DishMealType | null;
  category: string | null;
  categoryLabel: string | null;
  description: string | null;
  /** Mốc chuẩn của món. */
  standardQuantity: string;
  standardUnit: string;
  gradeRecipes?: {
    gradeId: string;
    gradeName: string;
    /** Khẩu phần 1 suất của khối, đơn vị = standardUnit. */
    portionQuantity: string;
    /** Định lượng 1 suất của khối, tính sẵn từ mốc chuẩn × khẩu phần. */
    lines: {
      ingredientEntryId: string;
      ingredientId: string;
      name: string;
      supplierId: string;
      supplierName: string;
      ingredientRole: string;
      requiredQuantity: string;
      unit: string;
    }[];
  }[];
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
