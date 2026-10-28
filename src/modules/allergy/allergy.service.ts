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
  "skip" | "take" | "orderBy"
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
    getAll(query: ListQuery) {
      return readListPage(
        () =>
          read({
            ...listWindow(query),
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
