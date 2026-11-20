import type {
  BlockchainProofEntityType,
  BlockchainProofEventType,
  Prisma,
} from "../../generated/prisma/client";
import { Prisma as RuntimePrisma } from "../../generated/prisma/client";

type Db = Prisma.TransactionClient;
export type ProofKind =
  | "deliveries"
  | "delivery-declarations"
  | "cooking-batches"
  | "retained-samples"
  | "registrations"
  | "meal-distributions";
export type ProofEventType =
  | "DELIVERY_DECLARED"
  | "DELIVERY_INSPECTED"
  | "COOKING_COMPLETED"
  | "SAMPLE_STORED"
  | "SAMPLE_DISPOSED"
  | "REGISTRATION_SUBMITTED"
  | "REGISTRATION_APPROVED"
  | "MEAL_DISTRIBUTED";

/** Who may see a proof: null is unrestricted (SYSTEM or an internal sender). */
export type ProofScope = null | { schoolId: string } | { supplierId: string };

export const ENTITY_TYPES: Record<ProofKind, BlockchainProofEntityType> = {
  deliveries: "DELIVERY_INSPECTION",
  "delivery-declarations": "DELIVERY_DECLARATION",
  "cooking-batches": "COOKING_BATCH",
  "retained-samples": "RETAINED_SAMPLE",
  registrations: "REGISTRATION",
  "meal-distributions": "MEAL_DISTRIBUTION",
};
const KINDS = Object.fromEntries(
  Object.entries(ENTITY_TYPES).map(([kind, type]) => [type, kind]),
) as Record<BlockchainProofEntityType, ProofKind>;

function apiEvent(
  entityType: BlockchainProofEntityType,
  eventType: BlockchainProofEventType,
): ProofEventType {
  switch (entityType) {
    case "REGISTRATION":
      return eventType === "APPROVED"
        ? "REGISTRATION_APPROVED"
        : "REGISTRATION_SUBMITTED";
    case "DELIVERY_DECLARATION":
      return "DELIVERY_DECLARED";
    case "DELIVERY_INSPECTION":
      return "DELIVERY_INSPECTED";
    case "COOKING_BATCH":
      return "COOKING_COMPLETED";
    case "RETAINED_SAMPLE":
      return eventType === "DISPOSED" ? "SAMPLE_DISPOSED" : "SAMPLE_STORED";
    case "MEAL_DISTRIBUTION":
      return "MEAL_DISTRIBUTED";
  }
}

const proofSelect = {
  id: true,
  entityType: true,
  eventType: true,
  version: true,
  previousProofId: true,
  registrationRequestId: true,
  deliveryId: true,
  cookingBatchId: true,
  retainedFoodSampleId: true,
  schoolId: true,
  subjectDate: true,
  dataHash: true,
  hashAlgorithm: true,
  payloadVersion: true,
  snapshot: true,
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

type ProofRow = Prisma.BlockchainProofGetPayload<{
  select: typeof proofSelect;
}>;
export type VersionRow = Omit<
  ProofRow,
  | "entityType"
  | "eventType"
  | "previousProofId"
  | "registrationRequestId"
  | "deliveryId"
  | "cookingBatchId"
  | "retainedFoodSampleId"
  | "schoolId"
  | "subjectDate"
> & {
  kind: ProofKind;
  /** Business record id; for meal distributions `<schoolId>:<YYYY-MM-DD>`. */
  recordId: string;
  eventType: ProofEventType;
  previousVersionId: string | null;
  /** Meal distributions only: the school-day the proof covers. */
  subject?: { schoolId: string; date: string };
};

const day = (value: Date) => value.toISOString().slice(0, 10);
const iso = (value: Date | null) => (value ? value.toISOString() : null);

function toVersion(row: ProofRow): VersionRow {
  const {
    entityType,
    eventType,
    previousProofId,
    registrationRequestId,
    deliveryId,
    cookingBatchId,
    retainedFoodSampleId,
    schoolId,
    subjectDate,
    ...rest
  } = row;
  const subject =
    schoolId && subjectDate ? { schoolId, date: day(subjectDate) } : undefined;
  return {
    ...rest,
    kind: KINDS[entityType],
    eventType: apiEvent(entityType, eventType),
    previousVersionId: previousProofId,
    recordId:
      registrationRequestId ??
      deliveryId ??
      cookingBatchId ??
      retainedFoodSampleId ??
      (subject ? `${subject.schoolId}:${subject.date}` : ""),
    ...(subject ? { subject } : {}),
  };
}

/** Readable facts of each step of a meal, shown even when a step has no proof. */
export type ChainDeliveryStep = {
  id: string;
  deliveryNo: string;
  supplierName: string;
  status: string;
  vehiclePlate: string | null;
  expectedArrivalAt: string | null;
  receivedAt: string | null;
};
export type ChainCookingBatchStep = {
  id: string;
  batchCode: string;
  status: string;
  dishes: string[];
  plannedPortions: number | null;
  allocatedPortions: number | string;
  completedAt: string | null;
};
export type ChainSampleStep = {
  id: string;
  cookingBatchId: string;
  dishName: string;
  status: string;
  sampledAt: string | null;
  disposedAt: string | null;
};
export type ChainGradeMealSummary = {
  /** `<gradeId|none>:<mealType>`, unique within one school and day. */
  key: string;
  schoolId: string;
  schoolName: string;
  gradeId: string | null;
  gradeName: string | null;
  mealType: string;
  classCount: number;
  portions: number;
  status: string;
  distributedAt: string | null;
};

/**
 * One status for the classes of a meal: FINALIZED or DISTRIBUTED when every
 * class is, PARTIAL when only some are, CANCELLED when all are, else ALLOCATED.
 */
export function mealStatus(statuses: string[]): string {
  const open = statuses.filter((status) => status !== "CANCELLED");
  if (!open.length) return "CANCELLED";
  if (open.every((status) => status === "FINALIZED")) return "FINALIZED";
  const served = open.filter(
    (status) => status === "DISTRIBUTED" || status === "FINALIZED",
  ).length;
  if (served === open.length) return "DISTRIBUTED";
  return served ? "PARTIAL" : "ALLOCATED";
}

const earliest = (times: Date[]) =>
  times.length
    ? times.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b))
    : null;

/**
 * Steps of the meals matched by `where`, which must stay within one school and
 * day: deliveries, batches and samples behind them, merged across classes.
 */
async function mealSubjects(db: Db, where: Prisma.MealAllocationWhereInput) {
  const allocations = await db.mealAllocation.findMany({
    where,
    select: {
      id: true,
      status: true,
      distributedAt: true,
      DailyMealPortion: {
        select: {
          mealDate: true,
          mealType: true,
          totalPortions: true,
          Class: {
            select: {
              schoolId: true,
              name: true,
              gradeId: true,
              grade: { select: { name: true } },
            },
          },
        },
      },
      mealAllocationBatches: {
        select: {
          allocatedPortions: true,
          allocationVersion: true,
          dishId: true,
          CookingBatchDish: { select: { Dish: { select: { name: true } } } },
          CookingBatch: {
            select: {
              id: true,
              batchCode: true,
              status: true,
              plannedPortions: true,
              completedAt: true,
              RetainedFoodSample: {
                select: {
                  id: true,
                  status: true,
                  sampledAt: true,
                  disposedAt: true,
                  CookingBatchDish: {
                    select: { Dish: { select: { name: true } } },
                  },
                },
              },
              cookingBatchLots: {
                select: {
                  ingredientLotId: true,
                  IngredientLot: {
                    select: {
                      DeliveryItem: {
                        select: {
                          Delivery: {
                            select: {
                              id: true,
                              deliveryNo: true,
                              status: true,
                              vehiclePlate: true,
                              expectedArrivalAt: true,
                              receivedAt: true,
                              Supplier: { select: { name: true } },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!allocations.length) return null;
  const first = allocations[0].DailyMealPortion;
  const lotDeliveries = new Map<string, string>();
  const deliveries = new Map<string, ChainDeliveryStep>();
  const batches = new Map<string, ChainCookingBatchStep>();
  const portionsByDish = new Map<string, Map<string, RuntimePrisma.Decimal>>();
  const samples = new Map<string, ChainSampleStep>();
  for (const allocation of allocations)
    for (const row of allocation.mealAllocationBatches) {
      const batch = row.CookingBatch;
      const step = batches.get(batch.id) ?? {
        id: batch.id,
        batchCode: batch.batchCode,
        status: batch.status,
        dishes: [],
        plannedPortions: batch.plannedPortions,
        allocatedPortions: 0,
        completedAt: iso(batch.completedAt),
      };
      const dishCounts =
        portionsByDish.get(batch.id) ??
        new Map<string, RuntimePrisma.Decimal>();
      dishCounts.set(
        row.dishId,
        (dishCounts.get(row.dishId) ?? new RuntimePrisma.Decimal(0)).add(
          row.allocatedPortions,
        ),
      );
      portionsByDish.set(batch.id, dishCounts);
      const allocated = RuntimePrisma.Decimal.max(...dishCounts.values());
      step.allocatedPortions =
        row.allocationVersion === 2 ||
        typeof step.allocatedPortions === "string"
          ? allocated.toFixed(2)
          : allocated.toNumber();
      const dish = row.CookingBatchDish.Dish.name;
      if (!step.dishes.includes(dish)) step.dishes.push(dish);
      batches.set(batch.id, step);
      for (const sample of batch.RetainedFoodSample)
        samples.set(sample.id, {
          id: sample.id,
          cookingBatchId: batch.id,
          dishName: sample.CookingBatchDish.Dish.name,
          status: sample.status,
          sampledAt: iso(sample.sampledAt),
          disposedAt: iso(sample.disposedAt),
        });
      for (const lot of batch.cookingBatchLots) {
        const delivery = lot.IngredientLot.DeliveryItem.Delivery;
        lotDeliveries.set(lot.ingredientLotId, delivery.id);
        deliveries.set(delivery.id, {
          id: delivery.id,
          deliveryNo: delivery.deliveryNo,
          supplierName: delivery.Supplier.name,
          status: delivery.status,
          vehiclePlate: delivery.vehiclePlate,
          expectedArrivalAt: iso(delivery.expectedArrivalAt),
          receivedAt: iso(delivery.receivedAt),
        });
      }
    }
  const schoolId = first.Class.schoolId;
  const date = day(first.mealDate);
  const classes = allocations
    .map((allocation) => ({
      id: allocation.id,
      className: allocation.DailyMealPortion.Class.name,
      portions: allocation.DailyMealPortion.totalPortions,
      status: allocation.status,
      distributedAt: iso(allocation.distributedAt),
    }))
    .sort((a, b) =>
      a.className.localeCompare(b.className, "vi", { numeric: true }),
    );
  return {
    schoolId,
    date,
    cookingBatchIds: [...batches.keys()],
    sampleIds: [...samples.keys()],
    deliveryIds: [...deliveries.keys()],
    lotDeliveries,
    meal: {
      gradeId: first.Class.gradeId,
      gradeName: first.Class.grade?.name ?? null,
      mealType: first.mealType,
      portions: classes.reduce((sum, item) => sum + item.portions, 0),
      status: mealStatus(classes.map((item) => item.status)),
      distributedAt: iso(
        earliest(
          allocations
            .map((allocation) => allocation.distributedAt)
            .filter((value): value is Date => value !== null),
        ),
      ),
      classes,
    },
    steps: {
      deliveries: [...deliveries.values()],
      cookingBatches: [...batches.values()],
      retainedSamples: [...samples.values()],
      distribution: { recordId: `${schoolId}:${date}`, date },
    },
  };
}

export type ChainSubjects = NonNullable<
  Awaited<ReturnType<typeof mealSubjects>>
>;

/** Business link of a new proof; exactly one per entity type (CHECK in SQL). */
export type ProofSubject =
  | { kind: "registrations"; registrationRequestId: string }
  | { kind: "deliveries" | "delivery-declarations"; deliveryId: string }
  | { kind: "cooking-batches"; cookingBatchId: string }
  | { kind: "retained-samples"; retainedFoodSampleId: string }
  | { kind: "meal-distributions"; schoolId: string; date: string };

export type NewVersion = {
  id: string;
  recordId: string;
  eventType: BlockchainProofEventType;
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

function subjectData(subject: ProofSubject) {
  switch (subject.kind) {
    case "registrations":
      return { registrationRequestId: subject.registrationRequestId };
    case "deliveries":
    case "delivery-declarations":
      return { deliveryId: subject.deliveryId };
    case "cooking-batches":
      return { cookingBatchId: subject.cookingBatchId };
    case "retained-samples":
      return { retainedFoodSampleId: subject.retainedFoodSampleId };
    case "meal-distributions":
      return {
        schoolId: subject.schoolId,
        subjectDate: new Date(`${subject.date}T00:00:00.000Z`),
      };
  }
}

const schoolMenu = (schoolId: string) => ({
  MenuDay: { WeeklyMenu: { schoolId } },
});

/** Ownership filter; null when the scope can never see this kind. */
function scopeWhere(
  kind: ProofKind,
  scope: ProofScope,
): Prisma.BlockchainProofWhereInput | null {
  if (!scope) return {};
  if ("supplierId" in scope)
    return kind === "delivery-declarations"
      ? { Delivery: { supplierId: scope.supplierId } }
      : null;
  const { schoolId } = scope;
  switch (kind) {
    case "registrations":
      return null;
    case "deliveries":
    case "delivery-declarations":
      return { Delivery: { schoolId } };
    case "cooking-batches":
      return { CookingBatch: schoolMenu(schoolId) };
    case "retained-samples":
      return { RetainedFoodSample: { CookingBatch: schoolMenu(schoolId) } };
    case "meal-distributions":
      return { schoolId };
  }
}

const orderBy = { version: "asc" } as const;

export function createBlockchainProofRepository() {
  async function distributionSubject(
    db: Db,
    mealAllocationId: string,
  ): Promise<{ schoolId: string; date: string } | null> {
    const row = await db.mealAllocation.findUnique({
      where: { id: mealAllocationId },
      select: {
        DailyMealPortion: {
          select: { mealDate: true, Class: { select: { schoolId: true } } },
        },
      },
    });
    return row
      ? {
          schoolId: row.DailyMealPortion.Class.schoolId,
          date: day(row.DailyMealPortion.mealDate),
        }
      : null;
  }

  async function hashesBy(
    db: Db,
    where: Prisma.BlockchainProofWhereInput,
    key: (row: {
      deliveryId: string | null;
      cookingBatchId: string | null;
    }) => string | null,
  ) {
    const rows = await db.blockchainProof.findMany({
      where,
      select: { deliveryId: true, cookingBatchId: true, dataHash: true },
      orderBy: { version: "desc" },
    });
    const hashes = new Map<string, string>();
    for (const row of rows) {
      const id = key(row);
      if (id && !hashes.has(id)) hashes.set(id, row.dataHash);
    }
    return hashes;
  }

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
              sourceFacilityId: true,
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
    readRegistration(db: Db, id: string) {
      return db.registrationRequest.findUnique({
        where: { id },
        select: {
          id: true,
          requestType: true,
          status: true,
          applicantUserId: true,
          profileData: true,
          supportingDocuments: true,
          submittedAt: true,
          reviewedAt: true,
          reviewedByUserId: true,
          applicantUser: { select: { schoolId: true, supplierId: true } },
        },
      });
    },
    /** Allocations of one school-day that were confirmed as distributed. */
    readDistribution(db: Db, schoolId: string, date: string) {
      return db.mealAllocation.findMany({
        where: {
          status: "DISTRIBUTED",
          DailyMealPortion: {
            mealDate: new Date(`${date}T00:00:00.000Z`),
            Class: { schoolId },
          },
        },
        select: {
          id: true,
          dailyMealPortionId: true,
          distributedAt: true,
          distributedByUserId: true,
          DailyMealPortion: {
            select: { classId: true, mealType: true, totalPortions: true },
          },
          mealAllocationBatches: {
            select: {
              cookingBatchId: true,
              dishId: true,
              allocatedPortions: true,
              allocationVersion: true,
              theoreticalPortions: true,
              materials: true,
            },
          },
        },
        orderBy: { id: "asc" },
      });
    },
    /** Planned portions per cooking batch, for the distribution cross-check. */
    async plannedPortions(db: Db, cookingBatchIds: string[]) {
      const rows = await db.cookingBatch.findMany({
        where: { id: { in: [...new Set(cookingBatchIds)] } },
        select: { id: true, plannedPortions: true },
      });
      return new Map(rows.map((row) => [row.id, row.plannedPortions]));
    },
    distributionSubject,
    latestRegistrationVersion(db: Db, registrationRequestId: string) {
      return db.blockchainProof.findFirst({
        where: { registrationRequestId },
        select: {
          id: true,
          version: true,
          dataHash: true,
          eventType: true,
          snapshot: true,
        },
        orderBy: { version: "desc" },
      });
    },
    /** Latest inspection hash of each delivery. */
    latestDeliveryHashes(db: Db, deliveryIds: string[]) {
      return hashesBy(
        db,
        {
          entityType: "DELIVERY_INSPECTION",
          deliveryId: { in: [...new Set(deliveryIds)] },
        },
        (row) => row.deliveryId,
      );
    },
    /** Latest completion hash of each cooking batch. */
    cookingBatchHashes(db: Db, cookingBatchIds: string[]) {
      return hashesBy(
        db,
        {
          entityType: "COOKING_BATCH",
          cookingBatchId: { in: [...new Set(cookingBatchIds)] },
        },
        (row) => row.cookingBatchId,
      );
    },
    async latestCookingBatchHash(db: Db, cookingBatchId: string) {
      const row = await db.blockchainProof.findFirst({
        where: { entityType: "COOKING_BATCH", cookingBatchId },
        select: { dataHash: true },
        orderBy: { version: "desc" },
      });
      return row?.dataHash ?? null;
    },
    async declarationHash(db: Db, deliveryId: string) {
      const row = await db.blockchainProof.findFirst({
        where: { entityType: "DELIVERY_DECLARATION", deliveryId },
        select: { dataHash: true },
        orderBy: { version: "desc" },
      });
      return row?.dataHash ?? null;
    },
    hasDeliveryVersion(db: Db, deliveryId: string) {
      return db.blockchainProof
        .count({ where: { entityType: "DELIVERY_INSPECTION", deliveryId } })
        .then((count) => count > 0);
    },
    hasDeclarationVersion(db: Db, deliveryId: string) {
      return db.blockchainProof
        .count({ where: { entityType: "DELIVERY_DECLARATION", deliveryId } })
        .then((count) => count > 0);
    },
    hasCookingBatchVersion(db: Db, cookingBatchId: string) {
      return db.blockchainProof
        .count({ where: { entityType: "COOKING_BATCH", cookingBatchId } })
        .then((count) => count > 0);
    },
    hasDistributionVersion(db: Db, schoolId: string, date: string) {
      return db.blockchainProof
        .count({
          where: {
            entityType: "MEAL_DISTRIBUTION",
            schoolId,
            subjectDate: new Date(`${date}T00:00:00.000Z`),
          },
        })
        .then((count) => count > 0);
    },
    findSampleVersion(
      db: Db,
      retainedFoodSampleId: string,
      eventType: "STORED" | "DISPOSED",
    ) {
      return db.blockchainProof.findUnique({
        where: {
          retainedFoodSampleId_eventType: {
            retainedFoodSampleId,
            eventType,
          },
        },
        select: { id: true, dataHash: true },
      });
    },
    async createVersion(db: Db, subject: ProofSubject, data: NewVersion) {
      const { previousVersionId, ...rest } = data;
      return (
        await db.blockchainProof.create({
          data: {
            ...rest,
            ...subjectData(subject),
            entityType: ENTITY_TYPES[subject.kind],
            previousProofId: previousVersionId,
          },
          select: { id: true },
        })
      ).id;
    },
    async findVersion(
      db: Db,
      kind: ProofKind,
      id: string,
      scope: ProofScope,
    ): Promise<VersionRow | null> {
      const where = scopeWhere(kind, scope);
      if (!where) return null;
      const row = await db.blockchainProof.findFirst({
        where: { id, entityType: ENTITY_TYPES[kind], ...where },
        select: proofSelect,
      });
      return row ? toVersion(row) : null;
    },
    /** For meal distributions `recordId` is any allocation of that school-day. */
    async listVersions(
      db: Db,
      kind: ProofKind,
      recordId: string,
      scope: ProofScope,
    ): Promise<VersionRow[]> {
      const where = scopeWhere(kind, scope);
      if (!where) return [];
      let link: Prisma.BlockchainProofWhereInput;
      switch (kind) {
        case "registrations":
          link = { registrationRequestId: recordId };
          break;
        case "deliveries":
        case "delivery-declarations":
          link = { deliveryId: recordId };
          break;
        case "cooking-batches":
          link = { cookingBatchId: recordId };
          break;
        case "retained-samples":
          link = { retainedFoodSampleId: recordId };
          break;
        case "meal-distributions": {
          const subject = await distributionSubject(db, recordId);
          if (!subject) return [];
          link = {
            schoolId: subject.schoolId,
            subjectDate: new Date(`${subject.date}T00:00:00.000Z`),
          };
          break;
        }
      }
      const rows = await db.blockchainProof.findMany({
        where: { AND: [{ entityType: ENTITY_TYPES[kind] }, link, where] },
        select: proofSelect,
        orderBy,
      });
      return rows.map(toVersion);
    },
    /**
     * Business records behind one served meal: its distribution day, the cooking
     * batches it came from, their samples, and the deliveries of their lots.
     */
    /** Steps of one class meal (kept for the per-allocation chain API). */
    async chainSubjects(
      db: Db,
      mealAllocationId: string,
      schoolId: string | null,
    ) {
      return mealSubjects(db, {
        id: mealAllocationId,
        ...(schoolId ? { DailyMealPortion: { Class: { schoolId } } } : {}),
      });
    },
    /** Steps of one grade's meal on a day: every class of the grade together. */
    async gradeChainSubjects(
      db: Db,
      query: {
        schoolId: string | null;
        gradeId: string | null;
        date: string;
        mealType: "LUNCH" | "AFTERNOON";
      },
    ) {
      return mealSubjects(db, {
        DailyMealPortion: {
          mealDate: new Date(`${query.date}T00:00:00.000Z`),
          mealType: query.mealType,
          Class: {
            gradeId: query.gradeId,
            ...(query.schoolId ? { schoolId: query.schoolId } : {}),
          },
        },
      });
    },
    /** An active school by its public code, as the public school pages find it. */
    async findPublicSchool(db: Db, code: string) {
      return db.school.findFirst({
        where: {
          code: { equals: code.trim(), mode: "insensitive" },
          status: "ACTIVE",
        },
        select: { id: true, name: true },
      });
    },
    /** Grade meals of one day that can be traced, by school, grade and meal. */
    async listGradeMeals(
      db: Db,
      query: { date: string; schoolId: string | null },
    ): Promise<ChainGradeMealSummary[]> {
      const rows = await db.mealAllocation.findMany({
        where: {
          DailyMealPortion: {
            mealDate: new Date(`${query.date}T00:00:00.000Z`),
            ...(query.schoolId
              ? { Class: { schoolId: query.schoolId } }
              : undefined),
          },
        },
        select: {
          status: true,
          distributedAt: true,
          DailyMealPortion: {
            select: {
              mealType: true,
              totalPortions: true,
              Class: {
                select: {
                  schoolId: true,
                  gradeId: true,
                  grade: { select: { name: true } },
                  School: { select: { name: true } },
                },
              },
            },
          },
        },
      });
      const groups = new Map<
        string,
        Omit<ChainGradeMealSummary, "status" | "distributedAt"> & {
          statuses: string[];
          times: Date[];
        }
      >();
      for (const row of rows) {
        const portion = row.DailyMealPortion;
        const klass = portion.Class;
        const id = `${klass.schoolId}|${klass.gradeId ?? "none"}|${portion.mealType}`;
        const group = groups.get(id) ?? {
          key: `${klass.gradeId ?? "none"}:${portion.mealType}`,
          schoolId: klass.schoolId,
          schoolName: klass.School.name,
          gradeId: klass.gradeId,
          gradeName: klass.grade?.name ?? null,
          mealType: portion.mealType,
          classCount: 0,
          portions: 0,
          statuses: [],
          times: [],
        };
        group.classCount += 1;
        group.portions += portion.totalPortions;
        group.statuses.push(row.status);
        if (row.distributedAt) group.times.push(row.distributedAt);
        groups.set(id, group);
      }
      return [...groups.values()]
        .map(({ statuses, times, ...group }) => ({
          ...group,
          status: mealStatus(statuses),
          distributedAt: iso(earliest(times)),
        }))
        .sort(
          (a, b) =>
            a.schoolName.localeCompare(b.schoolName, "vi") ||
            Number(a.gradeId === null) - Number(b.gradeId === null) ||
            (a.gradeName ?? "").localeCompare(b.gradeName ?? "", "vi", {
              numeric: true,
            }) ||
            a.mealType.localeCompare(b.mealType),
        );
    },
    async listChain(
      db: Db,
      subjects: {
        schoolId: string;
        date: string;
        cookingBatchIds: string[];
        sampleIds: string[];
        deliveryIds: string[];
      },
    ): Promise<VersionRow[]> {
      const rows = await db.blockchainProof.findMany({
        where: {
          OR: [
            {
              entityType: "MEAL_DISTRIBUTION",
              schoolId: subjects.schoolId,
              subjectDate: new Date(`${subjects.date}T00:00:00.000Z`),
            },
            { cookingBatchId: { in: subjects.cookingBatchIds } },
            { retainedFoodSampleId: { in: subjects.sampleIds } },
            { deliveryId: { in: subjects.deliveryIds } },
          ],
        },
        select: proofSelect,
        orderBy: [{ createdAt: "asc" }, { version: "asc" }],
      });
      return rows.map(toVersion);
    },
    /** Record the sent transaction before waiting, so a timeout keeps its hash. */
    async markSubmitted(
      db: Db,
      _kind: ProofKind,
      id: string,
      data: { transactionHash: string; contractAddress: string },
    ) {
      const result = await db.blockchainProof.updateMany({
        where: { id, transactionStatus: { in: ["PREPARED", "FAILED"] } },
        data: { ...data, transactionStatus: "SUBMITTED" },
      });
      return result.count === 1;
    },
    /** Only open versions move, so a confirmed proof is never overwritten. */
    async markConfirmed(
      db: Db,
      _kind: ProofKind,
      id: string,
      data: {
        transactionHash: string | null;
        blockNumber: bigint | null;
        contractAddress: string;
        recordedAt: Date;
        lastError: string | null;
      },
    ) {
      const result = await db.blockchainProof.updateMany({
        where: {
          id,
          transactionStatus: { in: ["PREPARED", "SUBMITTED", "FAILED"] },
        },
        data: { ...data, transactionStatus: "CONFIRMED" },
      });
      return result.count === 1;
    },
    async markFailed(db: Db, _kind: ProofKind, id: string, lastError: string) {
      const result = await db.blockchainProof.updateMany({
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
      _kind: ProofKind,
      id: string,
      data: {
        verificationStatus: "VERIFIED" | "MISMATCH" | "FAILED";
        verificationResult: string;
        verifiedAt: Date;
      },
    ) {
      await db.blockchainProof.updateMany({ where: { id }, data });
    },
  };
}

export type BlockchainProofRepository = ReturnType<
  typeof createBlockchainProofRepository
>;
