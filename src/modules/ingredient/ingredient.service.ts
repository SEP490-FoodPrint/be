import type { AuthPrincipal } from "../../types/auth";
import { listScopes } from "../../utils/resource-access";
import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";

const select = {
  id: true,
  supplierId: true,
  name: true,
  category: true,
  defaultUnit: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.IngredientSelect;

type ListRow = Prisma.IngredientGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.IngredientFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.ingredient.findMany(args);
};

export function createIngredientService(read: ListReader = readFromDatabase) {
  return {
    getAll(query: ListQuery, principal: AuthPrincipal) {
      const where = listScopes["ingredient"](principal);
      return readListPage(
        () =>
          read({
            ...listWindow(query),
            where,
            select,
            orderBy: [{ id: "asc" }],
          }),
        query,
      );
    },
  };
}

export const ingredientService = createIngredientService();
export type IngredientService = ReturnType<typeof createIngredientService>;
