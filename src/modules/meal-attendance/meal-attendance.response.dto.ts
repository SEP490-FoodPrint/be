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

export interface MealAttendanceClassDetailDTO {
  classId: string;
  className: string;
  gradeId?: string | null;
  gradeName?: string | null;
  registeredPortions: number;
  actualPortions: number;
  status: "FINALIZED" | "DRAFT" | "NOT_REPORTED";
  teacherName: string | null;
  finalizedAt: string | null;
  allergyNotes: string | null;
}

export interface MealAttendanceSummaryDTO {
  date: string;
  mealType: string;
  totalPortions: number;
  finalizedClasses: number;
  pendingClasses: number;
  classes: MealAttendanceClassDetailDTO[];
}
