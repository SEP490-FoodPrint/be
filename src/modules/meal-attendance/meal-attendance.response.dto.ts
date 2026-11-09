export interface AssignedClassResponseDTO {
  id: string;
  name: string;
  academicYear: string | null;
  registeredMealPortions: number;
  classAllergies: Array<{
    ingredientEntryId: string;
    affectedCount: number;
    IngredientEntry: { Ingredient: { name: string } };
  }>;
}

export interface MyClassMealResponseDTO {
  class: AssignedClassResponseDTO;
  submission: unknown;
}
