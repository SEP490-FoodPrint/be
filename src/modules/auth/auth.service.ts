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
  type: true,
  description: true,
  createdAt: true,
} as const satisfies Prisma.RoleSelect;

type ListRow = Prisma.RoleGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.RoleFindManyArgs,
  "skip" | "take" | "orderBy"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.role.findMany(args);
};

export function createAuthService(read: ListReader = readFromDatabase) {
  return {
    getAll(query: ListQuery) {
      return readListPage(
        () => read({ ...listWindow(query), select, orderBy: [{ id: "asc" }] }),
        query,
      );
    },
  };
}

export const authService = createAuthService();
export type AuthService = ReturnType<typeof createAuthService>;
