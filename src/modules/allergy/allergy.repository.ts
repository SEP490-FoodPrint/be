import { getPrisma } from "../../utils/database";

export async function readAllergyCatalog(
  schoolId: string,
  window: { skip: number; take: number },
) {
  const db = await getPrisma();
  return db.classAllergy.findMany({
    where: {
      Class: { schoolId },
      IngredientEntry: { schoolId },
      affectedCount: { gt: 0 },
    },
    select: {
      classId: true,
      groupNo: true,
      ingredientEntryId: true,
      affectedCount: true,
      updatedAt: true,
      Class: { select: { name: true, academicYear: true } },
      IngredientEntry: {
        select: {
          ingredientId: true,
          Ingredient: {
            select: {
              name: true,
              ingredientCategory: { select: { categoryName: true } },
              Supplier: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: [
      { classId: "asc" },
      { groupNo: "asc" },
      { ingredientEntryId: "asc" },
    ],
    ...window,
  });
}
