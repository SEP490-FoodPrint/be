import type { AuthPrincipal } from "../../types/auth";
import { listScopes } from "../../utils/resource-access";
import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import { registrationApplicantSelect } from "./registration.select";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";

const select = {
  id: true,
  applicantUserId: true,
  applicantUser: { select: registrationApplicantSelect },
  requestType: true,
  status: true,
  submittedAt: true,
  reviewedAt: true,
  updatedAt: true,
} as const satisfies Prisma.RegistrationRequestSelect;

type ListRow = Prisma.RegistrationRequestGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.RegistrationRequestFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
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
    getAll(query: ListQuery, principal: AuthPrincipal) {
      const where = listScopes["registration"](principal);
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

export const registrationService = createRegistrationService();
export type RegistrationService = ReturnType<typeof createRegistrationService>;
