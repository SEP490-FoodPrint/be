import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";

const select = {
  id: true,
  code: true,
  name: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.CommuneFoodSafetyUnitSelect;

type ListRow = Prisma.CommuneFoodSafetyUnitGetPayload<{
  select: typeof select;
}>;
type ListArguments = Pick<
  Prisma.CommuneFoodSafetyUnitFindManyArgs,
  "skip" | "take" | "orderBy"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.communeFoodSafetyUnit.findMany(args);
};

export function createAuthorityService(read: ListReader = readFromDatabase) {
  return {
    getAll(query: ListQuery) {
      return readListPage(
        () => read({ ...listWindow(query), select, orderBy: [{ id: "asc" }] }),
        query,
      );
    },
  };
}

export const authorityService = createAuthorityService();
export type AuthorityService = ReturnType<typeof createAuthorityService>;
