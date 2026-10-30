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
  id: true,
  incidentId: true,
  targetSchoolId: true,
  message: true,
  status: true,
  attemptedAt: true,
  sentAt: true,
  createdAt: true,
} as const satisfies Prisma.IncidentSchoolAlertSelect;

type ListRow = Prisma.IncidentSchoolAlertGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.IncidentSchoolAlertFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.incidentSchoolAlert.findMany(args);
};

export function createSchoolAlertService(read: ListReader = readFromDatabase) {
  return {
    getAll(query: ListQuery, principal: AuthPrincipal) {
      const where = listScopes["school-alert"](principal);
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

export const schoolAlertService = createSchoolAlertService();
export type SchoolAlertService = ReturnType<typeof createSchoolAlertService>;
