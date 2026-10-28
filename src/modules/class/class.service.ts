import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";

const select = {
  id: true,
  schoolId: true,
  name: true,
  academicYear: true,
  registeredMealPortions: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.ClassSelect;

type ListRow = Prisma.ClassGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.ClassFindManyArgs,
  "skip" | "take" | "orderBy"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.class.findMany(args);
};

export function createClassService(read: ListReader = readFromDatabase) {
  return {
    getAll(query: ListQuery) {
      return readListPage(
        () => read({ ...listWindow(query), select, orderBy: [{ id: "asc" }] }),
        query,
      );
    },
  };
}

export const classService = createClassService();
export type ClassService = ReturnType<typeof createClassService>;
