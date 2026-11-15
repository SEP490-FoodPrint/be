import { getPrisma } from "../../utils/database";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";

export type DeliveryTraceDb = PrismaClient | Prisma.TransactionClient;

export const publicDeliveryTraceSelect = {
  ingredientNameSnapshot: true,
  actualQuantity: true,
  unit: true,
  sourceFacilityNameSnapshot: true,
  sourceFacilityCodeSnapshot: true,
  Delivery: {
    select: {
      deliveryNo: true,
      status: true,
      traceabilityVersion: true,
      Supplier: {
        select: {
          name: true,
        },
      },
    },
  },
} satisfies Prisma.DeliveryItemSelect;

export type PublicDeliveryTraceRecord = Prisma.DeliveryItemGetPayload<{
  select: typeof publicDeliveryTraceSelect;
}>;

export interface DeliveryTraceRepository {
  connect(): Promise<DeliveryTraceDb>;
  findByQrToken(
    db: DeliveryTraceDb,
    qrToken: string,
  ): Promise<PublicDeliveryTraceRecord | null>;
}

export const deliveryTraceRepository: DeliveryTraceRepository = {
  connect() {
    return getPrisma();
  },

  async findByQrToken(db, qrToken) {
    const row = await db.deliveryItem.findUnique({
      where: { qrToken },
      select: publicDeliveryTraceSelect,
    });
    if (
      !row ||
      row.Delivery.traceabilityVersion !== 1 ||
      !row.sourceFacilityNameSnapshot ||
      !row.ingredientNameSnapshot
    ) {
      return null;
    }
    return row;
  },
};
