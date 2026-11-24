/** Một nguyên liệu trong danh mục trường kèm tỷ lệ hao hụt do bếp cấu hình. */
export interface IngredientWasteRateDTO {
  id: string;
  ingredientId: string;
  ingredientName: string;
  unit: string;
  handlingType: "DRY_STOCK" | "DIRECT_USE";
  /** Tỷ lệ thập phân 0 <= r < 1, ví dụ "0.2000" là 20%. */
  wasteRate: string;
}

export interface IngredientWasteRateListResponseDTO {
  items: IngredientWasteRateDTO[];
}
