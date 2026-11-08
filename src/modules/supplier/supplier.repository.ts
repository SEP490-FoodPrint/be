import type { Prisma } from "../../generated/prisma/client";
const select = {
  id: true,
  name: true,
  taxCode: true,
  email: true,
  phone: true,
  address: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.SupplierSelect;
export type SupplierRow = Prisma.SupplierGetPayload<{ select: typeof select }>;
interface Filter {
  page: number;
  limit: number;
  search?: string;
  status?: "ACTIVE" | "INACTIVE";
}
function escapeSearch(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}
export function createSupplierRepository() {
  return {
    async list(
      tx: Prisma.TransactionClient,
      scope: Prisma.SupplierWhereInput,
      q: Filter,
    ) {
      const search = q.search ? escapeSearch(q.search) : undefined;
      const where: Prisma.SupplierWhereInput = {
        AND: [
          scope,
          q.status ? { status: q.status } : {},
          search
            ? {
                OR: [
                  { name: { contains: search, mode: "insensitive" } },
                  { taxCode: { contains: search, mode: "insensitive" } },
                ],
              }
            : {},
        ],
      };
      const total = await tx.supplier.count({ where });
      const items = await tx.supplier.findMany({
        where,
        select,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { id: "asc" },
      });
      return { items, total };
    },
    async summary(
      tx: Prisma.TransactionClient,
      scope: Prisma.SupplierWhereInput,
    ) {
      return {
        total: await tx.supplier.count({ where: scope }),
        activeCount: await tx.supplier.count({
          where: { AND: [scope, { status: "ACTIVE" }] },
        }),
      };
    },
    detail(
      tx: Prisma.TransactionClient,
      scope: Prisma.SupplierWhereInput,
      id: string,
    ) {
      return tx.supplier.findFirst({ where: { AND: [scope, { id }] }, select });
    },
  };
}
export type SupplierRepository = ReturnType<typeof createSupplierRepository>;
