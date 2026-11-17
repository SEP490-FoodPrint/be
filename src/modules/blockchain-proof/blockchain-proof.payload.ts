import {
  canonicalizeJson,
  computeCanonicalHash,
} from "../../utils/canonical-hash";

/** Bump when a payload field list changes; old versions keep their own snapshot. */
export const PAYLOAD_VERSION = 1;
export const HASH_ALGORITHM = "KECCAK-256";

type DecimalLike = { toFixed(decimalPlaces: number): string };
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type ProofPayload = { [key: string]: Json };

// canonicalizeJson does not normalize Date or Decimal, so payloads hold primitives only.
export function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}
/** `@db.Date` columns are stored at UTC midnight. */
export function day(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}
export function decimal(value: DecimalLike | null | undefined): string | null {
  return value ? value.toFixed(3) : null;
}
export function integer(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value))
    throw new Error("Payload chỉ nhận số nguyên an toàn");
  return value;
}
const byKey =
  <T>(...keys: ((item: T) => string)[]) =>
  (left: T, right: T) => {
    for (const key of keys) {
      const a = key(left),
        b = key(right);
      if (a !== b) return a < b ? -1 : 1;
    }
    return 0;
  };

export function hashPayload(payload: ProofPayload): string {
  return computeCanonicalHash(payload).toLowerCase();
}

/** Top-level keys whose canonical value differs; used to explain a MISMATCH. */
export function changedFields(
  anchored: ProofPayload,
  current: ProofPayload,
): string[] {
  const keys = new Set([...Object.keys(anchored), ...Object.keys(current)]);
  return [...keys]
    .filter(
      (key) =>
        canonicalizeJson(anchored[key] ?? null) !==
        canonicalizeJson(current[key] ?? null),
    )
    .sort();
}

export type DeliveryInspectedInput = {
  id: string;
  deliveryNo: string;
  schoolId: string;
  supplierId: string;
  supplyRequestId: string | null;
  creationMode: string | null;
  status: string;
  expectedArrivalAt: Date | null;
  arrivedAt: Date | null;
  receivedAt: Date | null;
  receivedByUserId: string | null;
  vehiclePlate: string | null;
  approvals: {
    roleCode: string;
    userId: string;
    decision: string;
    reason: string | null;
    photoHash: string | null;
    decidedAt: Date;
  }[];
  items: {
    id: string;
    ingredientId: string;
    supplyRequestItemId: string | null;
    requestedQuantity: DecimalLike | null;
    requestedUnit: string | null;
    actualQuantity: DecimalLike;
    unit: string;
    lots: {
      id: string;
      lotCode: string;
      manufactureDate: Date | null;
      expiryDate: Date | null;
      receivedQuantity: DecimalLike;
      unit: string;
      sourceFacilityId: string | null;
    }[];
  }[];
};

export function buildDeliveryInspectedPayload(
  input: DeliveryInspectedInput,
): ProofPayload {
  return {
    v: PAYLOAD_VERSION,
    type: "DELIVERY_INSPECTED",
    deliveryId: input.id,
    deliveryNo: input.deliveryNo,
    schoolId: input.schoolId,
    supplierId: input.supplierId,
    supplyRequestId: input.supplyRequestId,
    creationMode: input.creationMode,
    outcome: input.status,
    expectedArrivalAt: iso(input.expectedArrivalAt),
    arrivedAt: iso(input.arrivedAt),
    receivedAt: iso(input.receivedAt),
    receivedByUserId: input.receivedByUserId,
    vehiclePlate: input.vehiclePlate,
    approvals: [...input.approvals].sort(byKey((a) => a.roleCode)).map((a) => ({
      roleCode: a.roleCode,
      userId: a.userId,
      decision: a.decision,
      reason: a.reason,
      photoHash: a.photoHash,
      decidedAt: iso(a.decidedAt),
    })),
    items: [...input.items].sort(byKey((item) => item.id)).map((item) => ({
      deliveryItemId: item.id,
      ingredientId: item.ingredientId,
      supplyRequestItemId: item.supplyRequestItemId,
      requestedQuantity: decimal(item.requestedQuantity),
      requestedUnit: item.requestedUnit,
      actualQuantity: decimal(item.actualQuantity),
      unit: item.unit,
      lots: [...item.lots].sort(byKey((lot) => lot.id)).map((lot) => ({
        id: lot.id,
        lotCode: lot.lotCode,
        manufactureDate: day(lot.manufactureDate),
        expiryDate: day(lot.expiryDate),
        receivedQuantity: decimal(lot.receivedQuantity),
        unit: lot.unit,
        sourceFacilityId: lot.sourceFacilityId,
      })),
    })),
  };
}

export type CookingCompletedInput = {
  id: string;
  batchCode: string;
  batchGroupId: string;
  menuDayId: string;
  mealType: string;
  cookingModeApplied: string;
  plannedPortions: number | null;
  completedAt: Date | null;
  completedByUserId: string | null;
  dishes: { dishId: string; plannedPortions: number | null }[];
  lots: {
    ingredientLotId: string;
    dishId: string;
    quantityUsed: DecimalLike;
    unit: string;
    deliveryInspectionHash: string | null;
  }[];
};

export function buildCookingCompletedPayload(
  input: CookingCompletedInput,
): ProofPayload {
  return {
    v: PAYLOAD_VERSION,
    type: "COOKING_COMPLETED",
    batchId: input.id,
    batchCode: input.batchCode,
    batchGroupId: input.batchGroupId,
    menuDayId: input.menuDayId,
    mealType: input.mealType,
    cookingMode: input.cookingModeApplied,
    plannedPortions: integer(input.plannedPortions),
    completedAt: iso(input.completedAt),
    completedByUserId: input.completedByUserId,
    dishes: [...input.dishes]
      .sort(byKey((dish) => dish.dishId))
      .map((dish) => ({
        dishId: dish.dishId,
        plannedPortions: integer(dish.plannedPortions),
      })),
    lots: [...input.lots]
      .sort(
        byKey(
          (lot) => lot.ingredientLotId,
          (lot) => lot.dishId,
        ),
      )
      .map((lot) => ({
        ingredientLotId: lot.ingredientLotId,
        dishId: lot.dishId,
        quantityUsed: decimal(lot.quantityUsed),
        unit: lot.unit,
        deliveryInspectionHash: lot.deliveryInspectionHash,
      })),
  };
}

export type SampleStoredInput = {
  id: string;
  cookingBatchId: string;
  dishId: string;
  sampledAt: Date;
  recordedByUserId: string;
  quantity: DecimalLike | null;
  unit: string | null;
  storageUnitId: string | null;
  storageLocation: string | null;
  photoHash: string | null;
  cookingCompletedHash: string | null;
};

export function buildSampleStoredPayload(
  input: SampleStoredInput,
): ProofPayload {
  return {
    v: PAYLOAD_VERSION,
    type: "SAMPLE_STORED",
    sampleId: input.id,
    cookingBatchId: input.cookingBatchId,
    dishId: input.dishId,
    sampledAt: iso(input.sampledAt),
    recordedByUserId: input.recordedByUserId,
    quantity: decimal(input.quantity),
    unit: input.unit,
    storageUnitId: input.storageUnitId,
    storageLocation: input.storageLocation,
    photoHash: input.photoHash,
    cookingCompletedHash: input.cookingCompletedHash,
  };
}

export type SampleDisposedInput = {
  id: string;
  disposedAt: Date | null;
  disposalNote: string | null;
  disposedByUserId: string;
  previousHash: string | null;
};

export function buildSampleDisposedPayload(
  input: SampleDisposedInput,
): ProofPayload {
  return {
    v: PAYLOAD_VERSION,
    type: "SAMPLE_DISPOSED",
    sampleId: input.id,
    disposedAt: iso(input.disposedAt),
    disposalNote: input.disposalNote,
    disposedByUserId: input.disposedByUserId,
    previousHash: input.previousHash,
  };
}

export type RegistrationDocumentInput = {
  id: string;
  field: string;
  fileName: string;
  format: string;
  bytes: number;
  sha256?: string;
};

/** Profile as stored (JSON) plus each file's content hash; publicId stays off the proof. */
export function buildRegistrationSubmittedPayload(input: {
  id: string;
  requestType: string;
  applicantUserId: string;
  profileData: unknown;
  documents: RegistrationDocumentInput[];
  submittedAt: Date;
  previousHash: string | null;
}): ProofPayload {
  return {
    v: PAYLOAD_VERSION,
    type: "REGISTRATION_SUBMITTED",
    registrationRequestId: input.id,
    requestType: input.requestType,
    applicantUserId: input.applicantUserId,
    profile: JSON.parse(JSON.stringify(input.profileData ?? null)) as Json,
    documents: [...input.documents]
      .sort(
        byKey(
          (d) => d.field,
          (d) => d.id,
        ),
      )
      .map((d) => ({
        id: d.id,
        field: d.field,
        fileName: d.fileName,
        format: d.format,
        bytes: integer(d.bytes),
        sha256: d.sha256 ?? null,
      })),
    submittedAt: iso(input.submittedAt),
    previousHash: input.previousHash,
  };
}

export function buildRegistrationApprovedPayload(input: {
  id: string;
  requestType: string;
  status: string;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  organizationId: string | null;
  submittedHash: string | null;
}): ProofPayload {
  return {
    v: PAYLOAD_VERSION,
    type: "REGISTRATION_APPROVED",
    registrationRequestId: input.id,
    requestType: input.requestType,
    decision: input.status,
    reviewedByUserId: input.reviewedByUserId,
    reviewedAt: iso(input.reviewedAt),
    organizationId: input.organizationId,
    submittedHash: input.submittedHash,
  };
}
