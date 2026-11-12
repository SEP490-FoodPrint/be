import type { Prisma } from "../../generated/prisma/client";
type Tx = Prisma.TransactionClient;
const recipeInclude = {
  dishIngredientEntries: {
    include: { IngredientEntry: { include: { Ingredient: true } } },
  },
} as const;
export const dishRecipeRepository = {
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
      dishIngredientEntries: { create: lines },
    };
    return id
      ? tx.dish.update({ where: { id }, data, include: recipeInclude })
      : tx.dish.create({ data: { schoolId, ...data }, include: recipeInclude });
  },
};
