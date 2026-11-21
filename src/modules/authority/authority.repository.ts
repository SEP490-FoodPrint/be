import type { Prisma } from "../../generated/prisma/client";

type Tx = Prisma.TransactionClient;

const unitLocationSelect = {
  id: true,
  code: true,
  name: true,
  status: true,
  location: { select: { id: true, code: true, name: true } },
} as const satisfies Prisma.CommuneFoodSafetyUnitSelect;

export type AuthorityLocationRow = Prisma.CommuneFoodSafetyUnitGetPayload<{
  select: typeof unitLocationSelect;
}>;

export function createAuthorityRepository() {
  return {
    /** Khóa dòng đơn vị để các lần gắn địa bàn cùng đơn vị chạy tuần tự. */
    async lockUnit(tx: Tx, id: string): Promise<boolean> {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM foodprint.commune_food_safety_units
        WHERE id = ${id}::uuid
        FOR UPDATE
      `;
      return rows.length === 1;
    },
    findLocation(
      tx: Tx,
      id: string,
    ): Promise<{ id: string; level: number; isActive: boolean } | null> {
      return tx.location.findUnique({
        where: { id },
        select: { id: true, level: true, isActive: true },
      });
    },
    findUnitByLocation(
      tx: Tx,
      locationId: string,
    ): Promise<{ id: string } | null> {
      return tx.communeFoodSafetyUnit.findFirst({
        where: { locationId },
        select: { id: true },
      });
    },
    updateLocation(
      tx: Tx,
      id: string,
      locationId: string,
    ): Promise<AuthorityLocationRow> {
      return tx.communeFoodSafetyUnit.update({
        where: { id },
        data: { locationId },
        select: unitLocationSelect,
      });
    },
  };
}

export type AuthorityRepository = ReturnType<typeof createAuthorityRepository>;
export const authorityRepository = createAuthorityRepository();
