import type { Prisma } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import { getPrisma } from "../../utils/database";
import { listWindow, type ListQuery } from "../../utils/list-query";
import { listScopes } from "../../utils/resource-access";
import { parseRegistrationID } from "../../utils/registration-id";
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

interface RegistrationListFilters extends ListQuery {
  search?: string;
}

export interface RegistrationRepository {
  listForReview(
    query: RegistrationListFilters,
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
      let where = listScopes.registration(principal);
      if (query.search) {
        const nameFilter: Prisma.RegistrationRequestWhereInput = {
          applicantUser: {
            fullName: {
              contains: query.search.replace(/[\\%_]/g, "\\$&"),
              mode: "insensitive",
            },
          },
        };
        const number = parseRegistrationID(query.search);
        const searchFilter =
          number === undefined
            ? nameFilter
            : { OR: [{ registrationNumber: number }, nameFilter] };
        where = { AND: [where, searchFilter] };
      }
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
