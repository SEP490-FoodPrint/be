import { randomUUID } from "node:crypto";
/** Active catalogue fixture used by existing business tests unrelated to unit governance. */
export const measurementUnitMock = {
  findUnique: ({ where }: { where: { alias: string } }) =>
    Promise.resolve({
      unit: { id: randomUUID(), symbol: where.alias, status: "ACTIVE" },
    }),
};
