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
  classId: true,
  ingredientEntryId: true,
  affectedCount: true,
  updatedByUserId: true,
  updatedAt: true,
} as const satisfies Prisma.ClassAllergySelect;

type ListRow = Prisma.ClassAllergyGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.ClassAllergyFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.classAllergy.findMany(args);
};

export function createAllergyService(read: ListReader = readFromDatabase) {
  return {
    getAll(query: ListQuery, principal: AuthPrincipal) {
      const where = listScopes["allergy"](principal);
      return readListPage(
        () =>
          read({
            ...listWindow(query),
            where,
            select,
            orderBy: [{ classId: "asc" }, { ingredientEntryId: "asc" }],
          }),
        query,
      );
    },
  };
}

export const allergyService = createAllergyService();
export type AllergyService = ReturnType<typeof createAllergyService>;
