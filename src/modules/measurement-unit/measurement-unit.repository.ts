import type { Prisma } from "../../generated/prisma/client";
import { loadPrincipal } from "../../utils/authorization";
const select = {
  id: true,
  code: true,
  name: true,
  symbol: true,
  group: true,
  recommendedStep: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  aliases: { orderBy: { alias: "asc" as const }, select: { alias: true } },
} as const;
export type MeasurementUnitRow = Prisma.MeasurementUnitGetPayload<{
  select: typeof select;
}>;
type Tx = Prisma.TransactionClient;
export const measurementUnitRepository = {
  async list(
    tx: Tx,
    input: {
      page: number;
      limit: number;
      search?: string;
      group?: string;
      status: string;
    },
  ) {
    const where: Prisma.MeasurementUnitWhereInput = {
      ...(input.group ? { group: input.group } : {}),
      ...(input.status === "ALL"
        ? {}
        : { status: input.status as "ACTIVE" | "INACTIVE" }),
      ...(input.search
        ? {
            OR: [
              { name: { contains: input.search, mode: "insensitive" } },
              { symbol: { contains: input.search, mode: "insensitive" } },
              { code: { contains: input.search, mode: "insensitive" } },
              {
                aliases: {
                  some: {
                    alias: { contains: input.search, mode: "insensitive" },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      tx.measurementUnit.findMany({
        where,
        select,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      tx.measurementUnit.count({ where }),
    ]);
    return { items, total };
  },
  find(tx: Tx, id: string) {
    return tx.measurementUnit.findUnique({ where: { id }, select });
  },
  async actor(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM foodprint.users WHERE id=${id}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM foodprint.roles WHERE id=(SELECT role_id FROM foodprint.users WHERE id=${id}::uuid) FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM foodprint.permissions WHERE code='measurement_unit.manage' FOR SHARE`;
    return loadPrincipal(id, tx);
  },
  create(
    tx: Tx,
    input: {
      code: string;
      name: string;
      symbol: string;
      group: string;
      recommendedStep: string;
      aliases: string[];
    },
  ) {
    const { aliases, ...data } = input;
    return tx.measurementUnit.create({
      data: {
        ...data,
        aliases: { create: aliases.map((alias) => ({ alias })) },
      },
      select,
    });
  },
  update(
    tx: Tx,
    id: string,
    data: {
      name?: string;
      recommendedStep?: string;
      status?: "ACTIVE" | "INACTIVE";
    },
  ) {
    return tx.measurementUnit.update({ where: { id }, data, select });
  },
  async resolve(tx: Tx, alias: string) {
    const row = await tx.measurementUnitAlias.findUnique({
      where: { alias },
      select: { unit: { select } },
    });
    if (row)
      await tx.$queryRaw`SELECT id FROM foodprint.measurement_units WHERE id=${row.unit.id}::uuid FOR SHARE`;
    return row?.unit ?? null;
  },
};
