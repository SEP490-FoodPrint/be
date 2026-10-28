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
  "skip" | "take" | "orderBy"
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
    getAll(query: ListQuery) {
      return readListPage(
        () => read({ ...listWindow(query), select, orderBy: [{ id: "asc" }] }),
        query,
      );
    },
  };
}

export const reportingService = createReportingService();
export type ReportingService = ReturnType<typeof createReportingService>;
