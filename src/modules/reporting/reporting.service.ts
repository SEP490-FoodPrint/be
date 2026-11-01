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
  recipientCommuneFoodSafetyUnitId: true,
  recipientOrganization: true,
  referenceNumber: true,
  status: true,
  attemptedAt: true,
  forwardedAt: true,
  createdAt: true,
} as const satisfies Prisma.FoodSafetyReportForwardingSelect;

type ListRow = Prisma.FoodSafetyReportForwardingGetPayload<{
  select: typeof select;
}>;
type ListArguments = Pick<
  Prisma.FoodSafetyReportForwardingFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.foodSafetyReportForwarding.findMany(args);
};

export function createReportingService(read: ListReader = readFromDatabase) {
  return {
    getAll(query: ListQuery, principal: AuthPrincipal) {
      const where = listScopes["reporting"](principal);
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

export const reportingService = createReportingService();
export type ReportingService = ReturnType<typeof createReportingService>;
