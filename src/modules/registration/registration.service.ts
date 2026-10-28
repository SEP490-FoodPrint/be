import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";

const select = {
  id: true,
  applicantUserId: true,
  requestType: true,
  status: true,
  submittedAt: true,
  reviewedAt: true,
  updatedAt: true,
} as const satisfies Prisma.RegistrationRequestSelect;

type ListRow = Prisma.RegistrationRequestGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.RegistrationRequestFindManyArgs,
  "skip" | "take" | "orderBy"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.registrationRequest.findMany(args);
};

export function createRegistrationService(read: ListReader = readFromDatabase) {
  return {
    getAll(query: ListQuery) {
      return readListPage(
        () => read({ ...listWindow(query), select, orderBy: [{ id: "asc" }] }),
        query,
      );
    },
  };
}

export const registrationService = createRegistrationService();
export type RegistrationService = ReturnType<typeof createRegistrationService>;
