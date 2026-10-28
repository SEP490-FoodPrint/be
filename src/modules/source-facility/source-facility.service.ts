import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";

const select = {
  id: true,
  supplierId: true,
  facilityCode: true,
  name: true,
  status: true,
  isVisible: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.SourceFacilitySelect;

type ListRow = Prisma.SourceFacilityGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.SourceFacilityFindManyArgs,
  "skip" | "take" | "orderBy"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.sourceFacility.findMany(args);
};

export function createSourceFacilityService(
  read: ListReader = readFromDatabase,
) {
  return {
    getAll(query: ListQuery) {
      return readListPage(
        () => read({ ...listWindow(query), select, orderBy: [{ id: "asc" }] }),
        query,
      );
    },
  };
}

export const sourceFacilityService = createSourceFacilityService();
export type SourceFacilityService = ReturnType<
  typeof createSourceFacilityService
>;
