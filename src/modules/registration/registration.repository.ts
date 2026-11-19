import type { Prisma } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import { getPrisma } from "../../utils/database";
import { listWindow, type ListQuery } from "../../utils/list-query";
import { listScopes } from "../../utils/resource-access";
import { normalizeSearchCode } from "../../utils/business-code";
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
        // Mã hồ sơ cũ FP-REG-… hoặc mới FP-RG-NNNNN, không phân biệt hoa thường; chuỗi khác tìm theo tên.
        const code = normalizeSearchCode(query.search);
        const searchFilter =
          code === null ? nameFilter : { OR: [{ code }, nameFilter] };
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
