import type { Prisma } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import { getPrisma } from "../../utils/database";
import { listWindow, type ListQuery } from "../../utils/list-query";
import { listScopes } from "../../utils/resource-access";
import { registrationListSelect } from "./registration.select";

export type RegistrationListRow = Prisma.RegistrationRequestGetPayload<{
  select: typeof registrationListSelect;
}>;

type ListArguments = Pick<
  Prisma.RegistrationRequestFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof registrationListSelect;
};
type ListReader = (args: ListArguments) => Promise<RegistrationListRow[]>;

export interface RegistrationRepository {
  listForReview(
    query: ListQuery,
    principal: AuthPrincipal,
  ): Promise<RegistrationListRow[]>;
}

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.registrationRequest.findMany(args);
};

export function createRegistrationRepository(
  read: ListReader = readFromDatabase,
): RegistrationRepository {
  return {
    listForReview(query, principal) {
      const where = listScopes.registration(principal);
      return read({
        ...listWindow(query),
        where,
        select: registrationListSelect,
        orderBy: [{ id: "asc" }],
      });
    },
  };
}

export const registrationRepository = createRegistrationRepository();
