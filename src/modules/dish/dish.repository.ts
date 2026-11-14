import type { Prisma } from "../../generated/prisma/client";
type Tx = Prisma.TransactionClient;
const recipeInclude = {
  gradeRecipes: {
    include: {
      grade: { select: { id: true, name: true } },
      lines: {
        include: {
          entry: {
            include: {
              Ingredient: { include: { Supplier: { select: { name: true } } } },
            },
          },
        },
      },
    },
  },
  schoolCategory: true,
  dishIngredientEntries: {
    include: {
      IngredientEntry: {
        include: {
          Ingredient: { include: { Supplier: { select: { name: true } } } },
        },
      },
    },
  },
} as const;
export const dishRecipeRepository = {
  grades(tx: Tx, schoolId: string, ids: string[]) {
    return tx.schoolGrade.findMany({
      where: { schoolId, id: { in: ids } },
      select: { id: true, name: true },
    });
  },
  async saveGradeRecipes(
    tx: Tx,
    schoolId: string,
    dishId: string,
    profiles: {
      gradeId: string;
      lines: {
        ingredientEntryId: string;
        ingredientRole: string;
        requiredQuantity: string;
        unit: string;
      }[];
    }[],
  ) {
    for (const profile of profiles) {
      await tx.dishGradeRecipe.upsert({
        where: { dishId_gradeId: { dishId, gradeId: profile.gradeId } },
        create: { dishId, gradeId: profile.gradeId, schoolId },
        update: { updatedAt: new Date() },
      });
      await tx.dishGradeRecipeLine.deleteMany({
        where: { dishId, gradeId: profile.gradeId },
      });
      await tx.dishGradeRecipeLine.createMany({
        data: profile.lines.map((line) => ({
          ...line,
          dishId,
          gradeId: profile.gradeId,
        })),
      });
    }
  },

  categories(tx: Tx, schoolId: string) {
    return tx.schoolDishCategory.findMany({
      where: { schoolId },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
  },
  category(tx: Tx, schoolId: string, id: string) {
    return tx.schoolDishCategory.findFirst({
      where: { id, schoolId },
      include: { _count: { select: { dishes: true } } },
    });
  },
  categoryByName(tx: Tx, schoolId: string, name: string) {
    return tx.schoolDishCategory.findFirst({
      where: { schoolId, name: { equals: name, mode: "insensitive" } },
    });
  },
  createCategory(tx: Tx, schoolId: string, name: string) {
    return tx.schoolDishCategory.create({ data: { schoolId, name } });
  },
  updateCategory(tx: Tx, id: string, name: string) {
    return tx.schoolDishCategory.update({ where: { id }, data: { name } });
  },
  deleteCategory(tx: Tx, id: string) {
    return tx.schoolDishCategory.delete({ where: { id } });
  },
  removable(tx: Tx, schoolId: string, id: string) {
    return tx.dish.findFirst({
      where: { id, schoolId },
      select: {
        id: true,
        _count: {
          select: {
            menuDayDishes: true,
            cookingBatches: true,
            cookingBatchDishes: true,
          },
        },
      },
    });
  },
  remove(tx: Tx, id: string) {
    return tx.dish.delete({ where: { id }, select: { id: true } });
  },
  catalog(tx: Tx, schoolId: string, skip: number, take: number) {
    return tx.dish.findMany({
      where: { schoolId, status: "ACTIVE" },
      include: recipeInclude,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip,
      take,
    });
  },
  recipes(tx: Tx, schoolId: string, ids: string[]) {
    return tx.dish.findMany({
      where: { schoolId, status: "ACTIVE", id: { in: ids } },
      include: recipeInclude,
    });
  },
  entries(tx: Tx, schoolId: string, ids?: string[]) {
    return tx.ingredientEntry.findMany({
      where: {
        schoolId,
        ...(ids ? { id: { in: ids } } : {}),
        status: "ACTIVE",
        Ingredient: { status: "ACTIVE" },
      },
      include: {
        Ingredient: {
          include: {
            Supplier: {
              include: {
                schoolSupplierRelationships: {
                  where: { schoolId, status: "ACTIVE" },
                },
              },
            },
          },
        },
      },
      orderBy: { id: "asc" },
    });
  },
  async save(
    tx: Tx,
    schoolId: string,
    id: string | undefined,
    name: string,
    description: string | null,
    categoryId: string | null | undefined,
    lines: {
      ingredientEntryId: string;
      ingredientRole: string;
      requiredQuantity: string;
      unit: string;
    }[],
  ) {
    if (id) {
      const found = await tx.dish.findFirst({
        where: { id, schoolId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!found) return null;
      await tx.dishIngredientEntry.deleteMany({ where: { dishId: id } });
    }
    const data = {
      name,
      description,
      ...(categoryId !== undefined ? { categoryId, category: null } : {}),
      dishIngredientEntries: { create: lines },
    };
    return id
      ? tx.dish.update({ where: { id }, data, include: recipeInclude })
      : tx.dish.create({ data: { schoolId, ...data }, include: recipeInclude });
  },
};
