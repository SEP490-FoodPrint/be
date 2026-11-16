import type { Prisma } from "../../generated/prisma/client";

type Db = Prisma.TransactionClient;
export type ProofKind = "deliveries" | "cooking-batches" | "retained-samples";
export type ProofEventType =
  | "DELIVERY_INSPECTED"
  | "COOKING_COMPLETED"
  | "SAMPLE_STORED"
  | "SAMPLE_DISPOSED";

const versionSelect = {
  id: true,
  version: true,
  dataHash: true,
  hashAlgorithm: true,
  payloadVersion: true,
  snapshot: true,
  previousVersionId: true,
  changeReason: true,
  networkName: true,
  contractAddress: true,
  transactionHash: true,
  blockNumber: true,
  transactionStatus: true,
  attemptCount: true,
  lastError: true,
  recordedAt: true,
  verificationStatus: true,
  verificationResult: true,
  verifiedAt: true,
  createdByUserId: true,
  createdAt: true,
} as const;

type BaseRow = Prisma.DeliveryInspectionVersionGetPayload<{
  select: typeof versionSelect;
}>;
export type VersionRow = BaseRow & {
  kind: ProofKind;
  recordId: string;
  eventType: ProofEventType;
};

export type NewVersion = {
  version: number;
  dataHash: string;
  hashAlgorithm: string;
  payloadVersion: number;
  snapshot: Prisma.InputJsonObject;
  previousVersionId: string | null;
  changeReason: string | null;
  networkName: string;
  contractAddress: string | null;
  createdByUserId: string;
};

type VersionUpdate = Prisma.DeliveryInspectionVersionUpdateManyMutationInput;
type OpenWhere = {
  id: string;
  transactionStatus: { in: ("PREPARED" | "SUBMITTED" | "FAILED")[] };
};
// The three version tables share every column except the business link,
// so status writes go through one structural interface.
type VersionWriter = {
  updateMany(args: {
    where: OpenWhere | { id: string };
    data: VersionUpdate;
  }): Promise<{ count: number }>;
};
function writer(db: Db, kind: ProofKind): VersionWriter {
  if (kind === "deliveries") return db.deliveryInspectionVersion;
  if (kind === "cooking-batches") return db.cookingBatchVersion;
  return db.retainedSampleVersion;
}

const schoolMenu = (schoolId: string) => ({
  MenuDay: { WeeklyMenu: { schoolId } },
});

export function createBlockchainProofRepository() {
  return {
    readDelivery(db: Db, id: string) {
      return db.delivery.findUnique({
        where: { id },
        select: {
          id: true,
          deliveryNo: true,
          schoolId: true,
          supplierId: true,
          supplyRequestId: true,
          creationMode: true,
          status: true,
          expectedArrivalAt: true,
          arrivedAt: true,
          receivedAt: true,
          receivedByUserId: true,
          vehiclePlate: true,
          deliveryApprovals: {
            select: {
              userId: true,
              decision: true,
              reason: true,
              photoHash: true,
              decidedAt: true,
              Role: { select: { code: true } },
            },
          },
          deliveryItems: {
            select: {
              id: true,
              ingredientId: true,
              supplyRequestItemId: true,
              actualQuantity: true,
              unit: true,
              SupplyRequestItem: {
                select: { requestedQuantity: true, unit: true },
              },
              ingredientLots: {
                select: {
                  id: true,
                  lotCode: true,
                  manufactureDate: true,
                  expiryDate: true,
                  receivedQuantity: true,
                  unit: true,
                  sourceFacilityId: true,
                },
              },
            },
          },
        },
      });
    },
    readCookingBatch(db: Db, id: string) {
      return db.cookingBatch.findUnique({
        where: { id },
        select: {
          id: true,
          batchCode: true,
          batchGroupId: true,
          menuDayId: true,
          mealType: true,
          cookingModeApplied: true,
          plannedPortions: true,
          completedAt: true,
          completedByUserId: true,
          dishes: { select: { dishId: true, plannedPortions: true } },
          cookingBatchLots: {
            select: {
              ingredientLotId: true,
              dishId: true,
              quantityUsed: true,
              unit: true,
              IngredientLot: {
                select: { DeliveryItem: { select: { deliveryId: true } } },
              },
            },
          },
        },
      });
    },
    readSample(db: Db, id: string) {
      return db.retainedFoodSample.findUnique({
        where: { id },
        select: {
          id: true,
          cookingBatchId: true,
          dishId: true,
          sampledAt: true,
          recordedByUserId: true,
          quantity: true,
          unit: true,
          storageUnitId: true,
          storageLocation: true,
          photoHash: true,
          disposedAt: true,
          disposalNote: true,
        },
      });
    },
    async latestDeliveryHashes(db: Db, deliveryIds: string[]) {
      const rows = await db.deliveryInspectionVersion.findMany({
        where: { deliveryId: { in: [...new Set(deliveryIds)] } },
        select: { deliveryId: true, dataHash: true },
        orderBy: [{ deliveryId: "asc" }, { version: "desc" }],
      });
      const hashes = new Map<string, string>();
      for (const row of rows)
        if (!hashes.has(row.deliveryId))
          hashes.set(row.deliveryId, row.dataHash);
      return hashes;
    },
    async latestCookingBatchHash(db: Db, cookingBatchId: string) {
      const row = await db.cookingBatchVersion.findFirst({
        where: { cookingBatchId },
        select: { dataHash: true },
        orderBy: { version: "desc" },
      });
      return row?.dataHash ?? null;
    },
    hasDeliveryVersion(db: Db, deliveryId: string) {
      return db.deliveryInspectionVersion
        .count({ where: { deliveryId } })
        .then((count) => count > 0);
    },
    hasCookingBatchVersion(db: Db, cookingBatchId: string) {
      return db.cookingBatchVersion
        .count({ where: { cookingBatchId } })
        .then((count) => count > 0);
    },
    findSampleVersion(
      db: Db,
      retainedFoodSampleId: string,
      eventType: "STORED" | "DISPOSED",
    ) {
      return db.retainedSampleVersion.findUnique({
        where: {
          retainedFoodSampleId_eventType: { retainedFoodSampleId, eventType },
        },
        select: { id: true, dataHash: true },
      });
    },
    async createDeliveryVersion(db: Db, deliveryId: string, data: NewVersion) {
      return (
        await db.deliveryInspectionVersion.create({
          data: { ...data, deliveryId },
          select: { id: true },
        })
      ).id;
    },
    async createCookingBatchVersion(
      db: Db,
      cookingBatchId: string,
      data: NewVersion,
    ) {
      return (
        await db.cookingBatchVersion.create({
          data: { ...data, cookingBatchId },
          select: { id: true },
        })
      ).id;
    },
    async createSampleVersion(
      db: Db,
      retainedFoodSampleId: string,
      eventType: "STORED" | "DISPOSED",
      data: NewVersion,
    ) {
      return (
        await db.retainedSampleVersion.create({
          data: { ...data, retainedFoodSampleId, eventType },
          select: { id: true },
        })
      ).id;
    },
    /** `schoolId` null means unrestricted (SYSTEM principal or internal sender). */
    async findVersion(
      db: Db,
      kind: ProofKind,
      id: string,
      schoolId: string | null,
    ): Promise<VersionRow | null> {
      if (kind === "deliveries") {
        const row = await db.deliveryInspectionVersion.findFirst({
          where: { id, ...(schoolId ? { Delivery: { schoolId } } : {}) },
          select: { ...versionSelect, deliveryId: true },
        });
        return row
          ? {
              ...row,
              kind,
              recordId: row.deliveryId,
              eventType: "DELIVERY_INSPECTED",
            }
          : null;
      }
      if (kind === "cooking-batches") {
        const row = await db.cookingBatchVersion.findFirst({
          where: {
            id,
            ...(schoolId ? { CookingBatch: schoolMenu(schoolId) } : {}),
          },
          select: { ...versionSelect, cookingBatchId: true },
        });
        return row
          ? {
              ...row,
              kind,
              recordId: row.cookingBatchId,
              eventType: "COOKING_COMPLETED",
            }
          : null;
      }
      const row = await db.retainedSampleVersion.findFirst({
        where: {
          id,
          ...(schoolId
            ? { RetainedFoodSample: { CookingBatch: schoolMenu(schoolId) } }
            : {}),
        },
        select: {
          ...versionSelect,
          retainedFoodSampleId: true,
          eventType: true,
        },
      });
      return row
        ? {
            ...row,
            kind,
            recordId: row.retainedFoodSampleId,
            eventType:
              row.eventType === "STORED" ? "SAMPLE_STORED" : "SAMPLE_DISPOSED",
          }
        : null;
    },
    async listVersions(
      db: Db,
      kind: ProofKind,
      recordId: string,
      schoolId: string | null,
    ): Promise<VersionRow[]> {
      const orderBy = { version: "asc" } as const;
      if (kind === "deliveries") {
        const rows = await db.deliveryInspectionVersion.findMany({
          where: {
            deliveryId: recordId,
            ...(schoolId ? { Delivery: { schoolId } } : {}),
          },
          select: versionSelect,
          orderBy,
        });
        return rows.map((row) => ({
          ...row,
          kind,
          recordId,
          eventType: "DELIVERY_INSPECTED" as const,
        }));
      }
      if (kind === "cooking-batches") {
        const rows = await db.cookingBatchVersion.findMany({
          where: {
            cookingBatchId: recordId,
            ...(schoolId ? { CookingBatch: schoolMenu(schoolId) } : {}),
          },
          select: versionSelect,
          orderBy,
        });
        return rows.map((row) => ({
          ...row,
          kind,
          recordId,
          eventType: "COOKING_COMPLETED" as const,
        }));
      }
      const rows = await db.retainedSampleVersion.findMany({
        where: {
          retainedFoodSampleId: recordId,
          ...(schoolId
            ? { RetainedFoodSample: { CookingBatch: schoolMenu(schoolId) } }
            : {}),
        },
        select: { ...versionSelect, eventType: true },
        orderBy,
      });
      return rows.map((row) => ({
        ...row,
        kind,
        recordId,
        eventType:
          row.eventType === "STORED"
            ? ("SAMPLE_STORED" as const)
            : ("SAMPLE_DISPOSED" as const),
      }));
    },
    /** Only open versions move, so a confirmed proof is never overwritten. */
    /** Record the sent transaction before waiting, so a timeout keeps its hash. */
    async markSubmitted(
      db: Db,
      kind: ProofKind,
      id: string,
      data: { transactionHash: string; contractAddress: string },
    ) {
      const result = await writer(db, kind).updateMany({
        where: { id, transactionStatus: { in: ["PREPARED", "FAILED"] } },
        data: { ...data, transactionStatus: "SUBMITTED" },
      });
      return result.count === 1;
    },
    async markConfirmed(
      db: Db,
      kind: ProofKind,
      id: string,
      data: {
        transactionHash: string | null;
        blockNumber: bigint | null;
        contractAddress: string;
        recordedAt: Date;
        lastError: string | null;
      },
    ) {
      const result = await writer(db, kind).updateMany({
        where: {
          id,
          transactionStatus: { in: ["PREPARED", "SUBMITTED", "FAILED"] },
        },
        data: { ...data, transactionStatus: "CONFIRMED" },
      });
      return result.count === 1;
    },
    async markFailed(db: Db, kind: ProofKind, id: string, lastError: string) {
      const result = await writer(db, kind).updateMany({
        where: {
          id,
          transactionStatus: { in: ["PREPARED", "SUBMITTED", "FAILED"] },
        },
        data: {
          transactionStatus: "FAILED",
          lastError,
          attemptCount: { increment: 1 },
        },
      });
      return result.count === 1;
    },
    async setVerification(
      db: Db,
      kind: ProofKind,
      id: string,
      data: {
        verificationStatus: "VERIFIED" | "MISMATCH" | "FAILED";
        verificationResult: string;
        verifiedAt: Date;
      },
    ) {
      await writer(db, kind).updateMany({ where: { id }, data });
    },
  };
}

export type BlockchainProofRepository = ReturnType<
  typeof createBlockchainProofRepository
>;
