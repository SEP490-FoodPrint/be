import type { Prisma } from "../../generated/prisma/client";

export const assignedClassSelect = {
  Class: {
    select: {
      id: true,
      name: true,
      academicYear: true,
      registeredMealPortions: true,
      classAllergies: {
        select: {
          ingredientEntryId: true,
          affectedCount: true,
          IngredientEntry: {
            select: { Ingredient: { select: { name: true } } },
          },
        },
        orderBy: { ingredientEntryId: "asc" },
      },
    },
  },
} as const satisfies Prisma.ClassHomeroomAssignmentSelect;

export function createMealAttendanceRepository() {
  return {
    findAssignedClass(
      tx: Prisma.TransactionClient,
      teacherUserId: string,
      schoolId: string,
      academicYear: string,
    ) {
      return tx.classHomeroomAssignment.findFirst({
        where: {
          teacherUserId,
          endedAt: null,
          Class: { schoolId, academicYear, status: "ACTIVE" },
        },
        select: assignedClassSelect,
      });
    },
    findSubmission(
      tx: Prisma.TransactionClient,
      key: { classId: string; mealDate: Date; mealType: "LUNCH" | "AFTERNOON" },
    ) {
      return tx.dailyMealPortion.findUnique({
        where: { classId_mealDate_mealType: key },
        include: {
          dailyAllergyPortions: {
            select: { ingredientEntryId: true, portionCount: true },
            orderBy: { ingredientEntryId: "asc" },
          },
        },
      });
    },
    findSubmissionState(
      tx: Prisma.TransactionClient,
      key: { classId: string; mealDate: Date; mealType: "LUNCH" | "AFTERNOON" },
    ) {
      return tx.dailyMealPortion.findUnique({
        where: { classId_mealDate_mealType: key },
        select: { id: true, status: true },
      });
    },
    async saveDraft(
      tx: Prisma.TransactionClient,
      existingId: string | null,
      key: { classId: string; mealDate: Date; mealType: "LUNCH" | "AFTERNOON" },
      data: {
        confirmedByUserId: string;
        totalPortions: number;
        allergyNotes: string | null;
      },
    ) {
      return existingId
        ? tx.dailyMealPortion.update({
            where: { id: existingId },
            data,
            select: { id: true },
          })
        : tx.dailyMealPortion.create({
            data: { ...key, ...data, status: "DRAFT" },
            select: { id: true },
          });
    },
    async replaceAllergies(
      tx: Prisma.TransactionClient,
      dailyMealPortionId: string,
      classId: string,
      allergies: Array<{ ingredientEntryId: string; portionCount: number }>,
    ) {
      await tx.dailyAllergyPortion.deleteMany({
        where: { dailyMealPortionId },
      });
      const rows = allergies.filter((item) => item.portionCount > 0);
      if (rows.length)
        await tx.dailyAllergyPortion.createMany({
          data: rows.map((item) => ({ dailyMealPortionId, classId, ...item })),
        });
    },
    getSubmissionById(tx: Prisma.TransactionClient, id: string) {
      return tx.dailyMealPortion.findUniqueOrThrow({
        where: { id },
        include: {
          dailyAllergyPortions: {
            select: { ingredientEntryId: true, portionCount: true },
            orderBy: { ingredientEntryId: "asc" },
          },
        },
      });
    },
    finalizeSubmission(
      tx: Prisma.TransactionClient,
      id: string,
      confirmedByUserId: string,
      finalizedAt: Date,
    ) {
      return tx.dailyMealPortion.update({
        where: { id },
        data: { status: "FINALIZED", finalizedAt, confirmedByUserId },
        include: {
          dailyAllergyPortions: {
            select: { ingredientEntryId: true, portionCount: true },
            orderBy: { ingredientEntryId: "asc" },
          },
        },
      });
    },
  };
}

export const mealAttendanceRepository = createMealAttendanceRepository();
export type MealAttendanceRepository = ReturnType<
  typeof createMealAttendanceRepository
>;
