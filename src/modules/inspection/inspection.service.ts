import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";

const select = {
  id: true,
  schoolId: true,
  reportedByUserId: true,
  title: true,
  description: true,
  status: true,
  occurredAt: true,
  resolvedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.FoodSafetyIncidentSelect;

type ListRow = Prisma.FoodSafetyIncidentGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.FoodSafetyIncidentFindManyArgs,
  "skip" | "take" | "orderBy"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.foodSafetyIncident.findMany(args);
};

export function createInspectionService(read: ListReader = readFromDatabase) {
  return {
    getAll(query: ListQuery) {
      return readListPage(
        () => read({ ...listWindow(query), select, orderBy: [{ id: "asc" }] }),
        query,
      );
    },
  };
}

export const inspectionService = createInspectionService();
export type InspectionService = ReturnType<typeof createInspectionService>;
