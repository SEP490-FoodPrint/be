import type { Prisma } from "../../generated/prisma/client";
import type { DishMealType } from "../../generated/prisma/enums";
import { HttpError } from "../../utils/http-error";
type Tx = Prisma.TransactionClient;
const recipeInclude = {
  gradeRecipes: {
    orderBy: { gradeId: "asc" },
    select: {
      gradeId: true,
      portionQuantity: true,
      grade: { select: { id: true, name: true } },
    },
  },
  schoolCategory: true,
  dishIngredientEntries: {
    include: {
      IngredientEntry: {
        include: {
          Ingredient: {
            include: {
              Supplier: { select: { name: true } },
              ingredientCategory: { select: { id: true, categoryName: true } },
            },
          },
        },
      },
    },
  },
} as const;
export const DUPLICATE_DISH_NAME = "Tên món đã có. Đặt tên khác.";

/** Hai lần lưu cùng lúc vẫn vướng ràng buộc tên món duy nhất: báo trùng tên thay vì lỗi hệ thống. */
export function dishWriteError(error: unknown): never {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "P2002"
  )
    throw new HttpError(409, DUPLICATE_DISH_NAME);
  throw error;
}

export const dishRecipeRepository = {
  dishByName(tx: Tx, schoolId: string, name: string) {
    return tx.dish.findFirst({
      where: { schoolId, name: { equals: name, mode: "insensitive" } },
      select: { id: true, status: true },
    });
  },
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
    profiles: { gradeId: string; portionQuantity: string }[],
  ) {
    // Khối chỉ lưu khẩu phần; định lượng từng nguyên liệu tính từ công thức mốc chuẩn.
    for (const profile of profiles)
      await tx.dishGradeRecipe.upsert({
        where: { dishId_gradeId: { dishId, gradeId: profile.gradeId } },
        create: {
          dishId,
          gradeId: profile.gradeId,
          schoolId,
          portionQuantity: profile.portionQuantity,
        },
        update: { portionQuantity: profile.portionQuantity },
      });
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
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
            ingredientCategory: { select: { id: true, categoryName: true } },
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
    standard: { quantity: string; unit: string },
    categoryId: string | null | undefined,
    lines: {
      ingredientEntryId: string;
      ingredientRole: string;
      requiredQuantity: string;
      unit: string;
    }[],
    mealType?: DishMealType | null,
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
      standardQuantity: standard.quantity,
      standardUnit: standard.unit,
      ...(mealType !== undefined ? { mealType } : {}),
      ...(categoryId !== undefined ? { categoryId, category: null } : {}),
      dishIngredientEntries: { create: lines },
    };
    try {
      return await (id
        ? tx.dish.update({ where: { id }, data, include: recipeInclude })
        : tx.dish.create({
            data: { schoolId, ...data },
            include: recipeInclude,
          }));
    } catch (error) {
      dishWriteError(error);
    }
  },
};
