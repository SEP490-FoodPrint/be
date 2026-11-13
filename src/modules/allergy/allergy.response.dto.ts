export interface AllergyCatalogRowDTO {
  classId: string;
  className: string;
  academicYear: string | null;
  ingredientEntryId: string;
  ingredientId: string;
  ingredientName: string;
  category: string | null;
  affectedCount: number;
  updatedAt: string;
}
