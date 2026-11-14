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

export interface IngredientImageResponse {
  publicId: string;
  url: string;
  format: "jpg" | "png" | "webp";
  bytes: number;
  width: number;
  height: number;
}
export type IngredientImageResult =
  | { index: number; status: "success"; asset: IngredientImageResponse }
  | {
      index: number;
      status: "failed";
      error: { code: string; message: string };
    };
export interface IngredientImagesResponse {
  results: IngredientImageResult[];
}
