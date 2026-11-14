export interface IngredientCategoryResponse {
  id: string;
  categoryName: string;
  categoryDescription: string | null;
}
export interface IngredientSupplierResponse {
  id: string;
  name: string;
}
export interface IngredientResponse {
  id: string;
  supplierId: string;
  supplierName?: string | null;
  supplier?: IngredientSupplierResponse | null;
  name: string;
  defaultUnit: string;
  description: string | null;
  categoryId: string | null;
  category: IngredientCategoryResponse | null;
  coverImage: string | null;
  imageDescription: string[];
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
  updatedAt: string;
}
export interface LegacyIngredientResponse {
  id: string;
  supplierId: string;
  supplierName?: string | null;
  supplier?: IngredientSupplierResponse | null;
  name: string;
  description: string | null;
  category: string | null;
  defaultUnit: string;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
  updatedAt: string;
}
export interface IngredientPageResponse<T> {
  items: T[];
  pagination: { page: number; limit: number; hasNext: boolean };
}
