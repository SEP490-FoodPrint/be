import assert from "node:assert/strict";
import { test } from "node:test";
import { id as keccakId } from "ethers";
import { Prisma } from "../src/generated/prisma/client";
import {
  buildCookingCompletedPayload,
  buildDeliveryInspectedPayload,
  buildSampleDisposedPayload,
  buildSampleStoredPayload,
  changedFields,
  day,
  decimal,
  hashPayload,
  integer,
  type DeliveryInspectedInput,
} from "../src/modules/blockchain-proof/blockchain-proof.payload";
import {
  createBlockchainProofService,
  linkChecks,
  explorerUrl,
  proofRecordId,
  safeError,
  type ProofChain,
} from "../src/modules/blockchain-proof/blockchain-proof.service";
import {
  mealStatus,
  type VersionRow,
} from "../src/modules/blockchain-proof/blockchain-proof.repository";
import { createRetainedSampleService } from "../src/modules/retained-sample/retained-sample.service";
import { testStaff } from "./helpers/authorization";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const hashOf = (char: string) => `0x${char.repeat(64)}`;
const at = new Date("2026-11-15T01:02:03.000Z");
const DELIVERY_VECTOR =
  "0xc36c09fe9cbb4c23bf441044347a46a7cdbe488385dd11e63eec39f325ee3e1d";

const delivery = (): DeliveryInspectedInput => ({
  id: A,
  deliveryNo: "DL-1",
  schoolId: B,
  supplierId: C,
  supplyRequestId: null,
  creationMode: null,
  status: "RECEIVED",
  expectedArrivalAt: null,
  arrivedAt: at,
  receivedAt: at,
  receivedByUserId: B,
  vehiclePlate: "29A-12345",
  declarationHash: null,
  approvals: [
    {
      roleCode: "SCHOOL_NUTRITION_OFFICER",
      userId: B,
      decision: "APPROVE",
      reason: null,
      photoHash: "f".repeat(64),
      decidedAt: at,
    },
    {
      roleCode: "PARENTS_COMMITTEE",
      userId: C,
      decision: "APPROVE",
      reason: "Đạt",
      photoHash: null,
      decidedAt: at,
    },
  ],
  items: [
    {
      id: B,
      ingredientId: C,
      supplyRequestItemId: null,
      requestedQuantity: null,
      requestedUnit: null,
      actualQuantity: new Prisma.Decimal("6.1"),
      unit: "kg",
      lots: [
        {
          id: C,
          lotCode: "L2",
          manufactureDate: new Date("2026-11-01T00:00:00Z"),
          expiryDate: null,
          receivedQuantity: new Prisma.Decimal("3"),
          unit: "kg",
          sourceFacilityId: null,
        },
        {
          id: A,
          lotCode: "L1",
          manufactureDate: null,
          expiryDate: new Date("2026-12-01T00:00:00Z"),
          receivedQuantity: new Prisma.Decimal("3.1"),
          unit: "kg",
          sourceFacilityId: B,
        },
      ],
    },
  ],
});

void test("payload helpers emit primitives that the shared canonical hash can encode", () => {
  assert.equal(day(new Date("2026-11-01T00:00:00Z")), "2026-11-01");
  assert.equal(decimal(new Prisma.Decimal("6.1")), "6.100");
  assert.equal(decimal(null), null);
  assert.throws(() => integer(1.5), /số nguyên/);
  assert.throws(() => integer(Number.NaN), /số nguyên/);
  assert.equal(integer(null), null);
});

void test("delivery payload sorts arrays, formats Decimal and @db.Date, and has a fixed hash", () => {
  const payload = buildDeliveryInspectedPayload(delivery());
  assert.deepEqual(
    (payload.approvals as { roleCode: string }[]).map((a) => a.roleCode),
    ["PARENTS_COMMITTEE", "SCHOOL_NUTRITION_OFFICER"],
  );
  const lots = (payload.items as { lots: { id: string }[] }[])[0].lots;
  assert.deepEqual(
    lots.map((lot) => lot.id),
    [A, C],
  );
  assert.equal(
    (payload.items as { actualQuantity: string }[])[0].actualQuantity,
    "6.100",
  );
  assert.equal(
    (lots[1] as unknown as { manufactureDate: string }).manufactureDate,
    "2026-11-01",
  );
  assert.equal(payload.v, 2);
  assert.equal(payload.declarationHash, null);
  assert.equal(payload.type, "DELIVERY_INSPECTED");
  assert.match(hashPayload(payload), /^0x[0-9a-f]{64}$/);
  assert.equal(hashPayload(payload), DELIVERY_VECTOR);

  const reordered = delivery();
  reordered.approvals.reverse();
  reordered.items[0].lots.reverse();
  assert.equal(
    hashPayload(buildDeliveryInspectedPayload(reordered)),
    DELIVERY_VECTOR,
  );
  const shuffledKeys = Object.fromEntries(Object.entries(payload).reverse());
  assert.equal(hashPayload(shuffledKeys), DELIVERY_VECTOR);

  const changed = delivery();
  changed.vehiclePlate = "29A-99999";
  const changedPayload = buildDeliveryInspectedPayload(changed);
  assert.notEqual(hashPayload(changedPayload), DELIVERY_VECTOR);
  assert.deepEqual(changedFields(payload, changedPayload), ["vehiclePlate"]);
});

void test("cooking, stored and disposed payloads keep their reference hashes and sort lots", () => {
  const cooking = buildCookingCompletedPayload({
    id: A,
    batchCode: "B-1",
    batchGroupId: B,
    menuDayId: C,
    mealType: "LUNCH",
    cookingModeApplied: "COMBINE_LOTS",
    plannedPortions: 120,
    completedAt: at,
    completedByUserId: B,
    dishes: [
      { dishId: C, plannedPortions: 60 },
      { dishId: B, plannedPortions: 60 },
    ],
    lots: [
      {
        ingredientLotId: C,
        dishId: B,
        quantityUsed: new Prisma.Decimal(2),
        unit: "kg",
        deliveryInspectionHash: hashOf("a"),
      },
      {
        ingredientLotId: A,
        dishId: C,
        quantityUsed: new Prisma.Decimal("0.5"),
        unit: "kg",
        deliveryInspectionHash: null,
      },
    ],
  });
  assert.deepEqual(
    (cooking.lots as { ingredientLotId: string }[]).map(
      (lot) => lot.ingredientLotId,
    ),
    [A, C],
  );
  assert.equal(cooking.cookingMode, "COMBINE_LOTS");
  assert.equal(
    (cooking.lots as { deliveryInspectionHash: string }[])[1]
      .deliveryInspectionHash,
    hashOf("a"),
  );
  const stored = buildSampleStoredPayload({
    id: A,
    cookingBatchId: B,
    dishId: C,
    sampledAt: at,
    recordedByUserId: B,
    quantity: null,
    unit: null,
    storageUnitId: null,
    storageLocation: null,
    photoHash: null,
    cookingCompletedHash: hashOf("b"),
  });
  assert.equal(stored.quantity, null);
  assert.equal(stored.cookingCompletedHash, hashOf("b"));
  const disposed = buildSampleDisposedPayload({
    id: A,
    disposedAt: at,
    disposalNote: "Hết hạn lưu",
    disposedByUserId: C,
    previousHash: hashOf("c"),
  });
  assert.equal(disposed.type, "SAMPLE_DISPOSED");
  assert.equal(disposed.previousHash, hashOf("c"));
});

void test("record id, explorer link and stored errors follow the spec", () => {
  assert.equal(proofRecordId(A), keccakId(`foodprint:blockchain_proofs:${A}`));
  assert.notEqual(proofRecordId(A), proofRecordId(B));
  assert.equal(explorerUrl("localhost", hashOf("a")), null);
  assert.equal(
    explorerUrl("sepolia", hashOf("a")),
    `https://sepolia.etherscan.io/tx/${hashOf("a")}`,
  );
  assert.equal(
    safeError(new Error("connect https://rpc.example/v3/secret-key failed")),
    "connect [url] failed",
  );
  assert.equal(safeError({ shortMessage: "nonce too low" }), "nonce too low");
  assert.equal(safeError(42), "Lỗi không xác định");
});

type Stored = VersionRow & { snapshot: Prisma.JsonValue };

function proofHarness(
  options: {
    enabled?: boolean;
    onChain?: Map<string, string>;
    failRead?: boolean;
    failAnchor?: boolean;
    /** Broadcast the transaction, then time out before it is mined. */
    timeoutAfterSend?: boolean;
  } = {},
) {
  const versions: Stored[] = [];
  const txStates = new Map<
    string,
    { state: "mined"; blockNumber: number } | { state: "pending" }
  >();
  const anchored: string[] = [];
  const onChain = options.onChain ?? new Map<string, string>();
  const deliveryRow = {
    ...delivery(),
    deliveryApprovals: delivery().approvals.map((a) => ({
      ...a,
      Role: { code: a.roleCode },
    })),
    deliveryItems: delivery().items.map((item) => ({
      ...item,
      SupplyRequestItem: null,
      ingredientLots: item.lots,
    })),
  };
  const sampleRow = {
    id: C,
    cookingBatchId: B,
    dishId: A,
    sampledAt: at,
    recordedByUserId: B,
    quantity: new Prisma.Decimal("0.1"),
    unit: "kg",
    storageUnitId: null,
    storageLocation: "Tủ 1",
    photoHash: null,
    disposedAt: at,
    disposalNote: "Hết hạn",
  };
  const batchRow = {
    id: B,
    batchCode: "B-1",
    batchGroupId: A,
    menuDayId: C,
    mealType: "LUNCH",
    cookingModeApplied: "COMBINE_LOTS",
    plannedPortions: 10,
    completedAt: at,
    completedByUserId: B,
    dishes: [{ dishId: A, plannedPortions: 10 }],
    cookingBatchLots: [
      {
        ingredientLotId: C,
        dishId: A,
        quantityUsed: new Prisma.Decimal(1),
        unit: "kg",
        IngredientLot: { DeliveryItem: { deliveryId: A } },
      },
    ],
  };
  const distribution = [
    {
      id: A,
      dailyMealPortionId: C,
      distributedAt: at,
      distributedByUserId: B,
      DailyMealPortion: { classId: A, mealType: "LUNCH", totalPortions: 8 },
      mealAllocationBatches: [
        { cookingBatchId: B, dishId: A, allocatedPortions: 8 },
      ],
    },
  ];
  const saved: string[] = [];
  const chainSubjects = {
    schoolId: C,
    date: "2026-11-15",
    cookingBatchIds: [B],
    sampleIds: [],
    deliveryIds: [A],
    lotDeliveries: new Map([[C, A]]),
    meal: {
      gradeId: A,
      gradeName: "Khối 3",
      mealType: "LUNCH",
      portions: 8,
      status: "DISTRIBUTED",
      distributedAt: null,
      classes: [
        {
          id: A,
          className: "3A",
          portions: 8,
          status: "DISTRIBUTED",
          distributedAt: null,
        },
      ],
    },
    steps: {
      deliveries: [
        {
          id: A,
          deliveryNo: "DL-1",
          supplierName: "NCC A",
          status: "RECEIVED",
          vehiclePlate: "51C-123.45",
          expectedArrivalAt: null,
          receivedAt: null,
        },
      ],
      cookingBatches: [
        {
          id: B,
          batchCode: "B-1",
          status: "COMPLETED",
          dishes: ["Canh"],
          plannedPortions: 10,
          allocatedPortions: 8,
          completedAt: null,
        },
      ],
      retainedSamples: [],
      distribution: { recordId: `${C}:2026-11-15`, date: "2026-11-15" },
    },
  };
  let nextId = 0;
  const events: Record<string, VersionRow["eventType"]> = {
    INSPECTED: "DELIVERY_INSPECTED",
    DECLARED: "DELIVERY_DECLARED",
    COMPLETED: "COOKING_COMPLETED",
    STORED: "SAMPLE_STORED",
    DISPOSED: "SAMPLE_DISPOSED",
    DISTRIBUTED: "MEAL_DISTRIBUTED",
  };
  const createVersion = (
    _db: unknown,
    subject: Record<string, string> & { kind: VersionRow["kind"] },
    data: Stored & { eventType: string },
  ) => {
    const { kind, ...link } = subject;
    const id =
      data.id ??
      `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`;
    const subjectOf =
      kind === "meal-distributions"
        ? { subject: { schoolId: link.schoolId, date: link.date } }
        : {};
    {
      versions.push({
        ...data,
        id,
        kind,
        recordId:
          kind === "meal-distributions"
            ? `${link.schoolId}:${link.date}`
            : Object.values(link)[0],
        ...subjectOf,
        eventType: events[data.eventType],
        transactionHash: null,
        blockNumber: null,
        transactionStatus: "PREPARED",
        attemptCount: 0,
        lastError: null,
        recordedAt: null,
        verificationStatus: "NOT_VERIFIED",
        verificationResult: null,
        verifiedAt: null,
        createdAt: at,
      });
      return Promise.resolve(id);
    }
  };
  const find = (id: string) => versions.find((v) => v.id === id) ?? null;
  const repository = {
    readDelivery: () => Promise.resolve(deliveryRow),
    readCookingBatch: () => Promise.resolve(batchRow),
    readSample: () => Promise.resolve(sampleRow),
    latestDeliveryHashes: () =>
      Promise.resolve(
        new Map(
          versions
            .filter((v) => v.kind === "deliveries")
            .map((v) => [v.recordId, v.dataHash]),
        ),
      ),
    latestCookingBatchHash: () =>
      Promise.resolve(
        versions.find((v) => v.kind === "cooking-batches")?.dataHash ?? null,
      ),
    declarationHash: (_db: unknown, id: string) =>
      Promise.resolve(
        versions.find(
          (v) => v.kind === "delivery-declarations" && v.recordId === id,
        )?.dataHash ?? null,
      ),
    hasDeclarationVersion: (_db: unknown, id: string) =>
      Promise.resolve(
        versions.some(
          (v) => v.kind === "delivery-declarations" && v.recordId === id,
        ),
      ),
    hasDistributionVersion: (_db: unknown, school: string, date: string) =>
      Promise.resolve(
        versions.some(
          (v) =>
            v.kind === "meal-distributions" &&
            v.recordId === `${school}:${date}`,
        ),
      ),
    readDistribution: () => Promise.resolve(distribution),
    cookingBatchHashes: () =>
      Promise.resolve(
        new Map(
          versions
            .filter((v) => v.kind === "cooking-batches")
            .map((v) => [v.recordId, v.dataHash]),
        ),
      ),
    plannedPortions: () => Promise.resolve(new Map([[B, 10]])),
    hasDeliveryVersion: (_db: unknown, id: string) =>
      Promise.resolve(
        versions.some((v) => v.kind === "deliveries" && v.recordId === id),
      ),
    hasCookingBatchVersion: (_db: unknown, id: string) =>
      Promise.resolve(
        versions.some((v) => v.kind === "cooking-batches" && v.recordId === id),
      ),
    findSampleVersion: (_db: unknown, id: string, event: string) =>
      Promise.resolve(
        versions.find(
          (v) =>
            v.kind === "retained-samples" &&
            v.recordId === id &&
            v.eventType === `SAMPLE_${event}`,
        ) ?? null,
      ),
    createVersion,
    findVersion: (
      _db: unknown,
      _kind: string,
      id: string,
      scope: { schoolId?: string } | null,
    ) => Promise.resolve(scope?.schoolId === "foreign" ? null : find(id)),
    listVersions: (_db: unknown, kind: string, recordId: string) =>
      Promise.resolve(
        versions.filter((v) => v.kind === kind && v.recordId === recordId),
      ),
    markSubmitted: (
      _db: unknown,
      _kind: string,
      id: string,
      data: Partial<Stored>,
    ) => {
      Object.assign(find(id)!, data, { transactionStatus: "SUBMITTED" });
      return Promise.resolve(true);
    },
    markConfirmed: (
      _db: unknown,
      _kind: string,
      id: string,
      data: Partial<Stored>,
    ) => {
      Object.assign(find(id)!, data, { transactionStatus: "CONFIRMED" });
      return Promise.resolve(true);
    },
    markFailed: (
      _db: unknown,
      _kind: string,
      id: string,
      lastError: string,
    ) => {
      const row = find(id)!;
      Object.assign(row, {
        transactionStatus: "FAILED",
        lastError,
        attemptCount: row.attemptCount + 1,
      });
      return Promise.resolve(true);
    },
    setVerification: (
      _db: unknown,
      _kind: string,
      id: string,
      data: object,
    ) => {
      saved.push(id);
      Object.assign(find(id)!, data);
      return Promise.resolve();
    },
    findPublicSchool: (_db: unknown, code: string) =>
      Promise.resolve(
        code.toLowerCase() === "th-demo" ? { id: C, name: "TH Demo" } : null,
      ),
    chainSubjects: (_db: unknown, id: string, school: string | null) =>
      Promise.resolve(id === A && school === C ? chainSubjects : null),
    gradeChainSubjects: (
      _db: unknown,
      query: { schoolId: string | null; gradeId: string | null },
    ) =>
      Promise.resolve(
        query.schoolId === C && query.gradeId === A ? chainSubjects : null,
      ),
    listChain: () => Promise.resolve(versions),
  };
  const chain: ProofChain = {
    contractAddress: () => "0xRegistry",
    read: (recordId) =>
      options.failRead
        ? Promise.reject(new Error("RPC down at https://rpc.example/key"))
        : Promise.resolve({
            onChainHash: onChain.get(recordId) ?? null,
            contractAddress: "0xRegistry",
          }),
    anchor: async (recordId, dataHash, onSubmitted) => {
      if (options.failAnchor) throw new Error("execution reverted: NotWriter");
      anchored.push(recordId);
      const txHash = hashOf(String(anchored.length));
      await onSubmitted(txHash, "0xRegistry");
      if (options.timeoutAfterSend) {
        txStates.set(txHash, { state: "pending" });
        throw new Error("wait for transaction timeout");
      }
      onChain.set(recordId, dataHash);
      txStates.set(txHash, { state: "mined", blockNumber: 7 });
      return { txHash, blockNumber: 7, contractAddress: "0xRegistry" };
    },
    lookup: (txHash) =>
      Promise.resolve(txStates.get(txHash) ?? { state: "missing" }),
  };
  const service = createBlockchainProofService({
    connect: () => Promise.resolve({} as never),
    repository: repository as never,
    chain,
    enabled: () => options.enabled ?? true,
    network: () => "sepolia",
    now: () => at,
    warn: () => undefined,
  });
  return {
    service,
    versions,
    saved,
    anchored,
    onChain,
    txStates,
    sampleRow,
    deliveryRow,
    distribution,
  };
}

const verifier = {
  ...testStaff,
  role: "SCHOOL_NUTRITION_OFFICER",
  permissions: ["traceability.view", "traceability.verify"],
};
const tx = {} as never;

void test("disabled blockchain never touches the version repository", async () => {
  const h = proofHarness({ enabled: false });
  assert.equal(await h.service.prepareDeliveryInspected(tx, A, B), null);
  assert.equal(await h.service.prepareCookingCompleted(tx, B, B), null);
  assert.equal(await h.service.prepareSampleStored(tx, C, B), null);
  assert.equal(await h.service.prepareSampleDisposed(tx, C, B), null);
  assert.equal(h.versions.length, 0);
  await assert.rejects(
    () => h.service.verify({ kind: "deliveries", versionId: A }, verifier),
    { statusCode: 409, message: "Chức năng blockchain đang tắt" },
  );
});

void test("prepare chains delivery → cooking → stored → disposed hashes and is idempotent", async () => {
  const h = proofHarness();
  const inspected = await h.service.prepareDeliveryInspected(tx, A, B);
  assert.equal(inspected?.kind, "deliveries");
  assert.equal(await h.service.prepareDeliveryInspected(tx, A, B), null);
  const deliveryVersion = h.versions[0];
  assert.equal(deliveryVersion.version, 1);
  assert.equal(deliveryVersion.networkName, "sepolia");
  assert.equal(deliveryVersion.contractAddress, "0xRegistry");
  assert.equal(
    deliveryVersion.dataHash,
    hashPayload(deliveryVersion.snapshot as never),
  );

  await h.service.prepareCookingCompleted(tx, B, B);
  assert.equal(await h.service.prepareCookingCompleted(tx, B, B), null);
  const cooking = h.versions[1].snapshot as {
    lots: { deliveryInspectionHash: string }[];
  };
  assert.equal(
    cooking.lots[0].deliveryInspectionHash,
    deliveryVersion.dataHash,
  );

  await h.service.prepareSampleStored(tx, C, B);
  assert.equal(await h.service.prepareSampleStored(tx, C, B), null);
  const stored = h.versions[2];
  assert.equal(
    (stored.snapshot as { cookingCompletedHash: string }).cookingCompletedHash,
    h.versions[1].dataHash,
  );

  await h.service.prepareSampleDisposed(tx, C, A);
  assert.equal(await h.service.prepareSampleDisposed(tx, C, A), null);
  const disposed = h.versions[3];
  assert.equal(disposed.version, 2);
  assert.equal(disposed.previousVersionId, stored.id);
  assert.equal(disposed.changeReason, "Tiêu huỷ mẫu");
  assert.equal(disposed.createdByUserId, A);
  assert.equal(
    (disposed.snapshot as { previousHash: string }).previousHash,
    stored.dataHash,
  );
  assert.equal(
    (disposed.snapshot as { disposedByUserId: string }).disposedByUserId,
    A,
  );
});

void test("disposal of a sample stored before anchoring was enabled creates no version", async () => {
  const h = proofHarness();
  assert.equal(await h.service.prepareSampleDisposed(tx, C, A), null);
  assert.equal(h.versions.length, 0);
});

void test("anchorVersion confirms once, reuses a matching on-chain hash and fails safely", async () => {
  const h = proofHarness();
  const ref = (await h.service.prepareDeliveryInspected(tx, A, B))!;
  const confirmed = await h.service.anchorVersion(ref);
  assert.equal(confirmed?.transactionStatus, "CONFIRMED");
  assert.equal(confirmed?.blockNumber, 7n);
  assert.equal(confirmed?.recordedAt, at);
  assert.equal(h.anchored.length, 1);
  await h.service.anchorVersion(ref);
  assert.equal(h.anchored.length, 1, "confirmed versions are never resent");

  // Crash after the chain write: the hash is found on chain and not sent again.
  const crashed = proofHarness();
  const lost = (await crashed.service.prepareDeliveryInspected(tx, A, B))!;
  crashed.onChain.set(proofRecordId(lost.id), crashed.versions[0].dataHash);
  const recovered = await crashed.service.anchorVersion(lost);
  assert.equal(recovered?.transactionStatus, "CONFIRMED");
  assert.equal(recovered?.transactionHash, null);
  assert.equal(crashed.anchored.length, 0);

  const mismatch = proofHarness();
  const other = (await mismatch.service.prepareDeliveryInspected(tx, A, B))!;
  mismatch.onChain.set(proofRecordId(other.id), hashOf("d"));
  assert.equal(
    (await mismatch.service.anchorVersion(other))?.transactionStatus,
    "FAILED",
  );

  const rpc = proofHarness({ failRead: true });
  const down = (await rpc.service.prepareDeliveryInspected(tx, A, B))!;
  const failed = await rpc.service.anchorVersion(down);
  assert.equal(failed?.transactionStatus, "FAILED");
  assert.equal(failed?.attemptCount, 1);
  assert.doesNotMatch(failed?.lastError ?? "", /rpc\.example/);
});

void test("a receipt timeout keeps the sent tx hash and is reconciled without resending", async () => {
  const h = proofHarness({ timeoutAfterSend: true });
  const ref = (await h.service.prepareDeliveryInspected(tx, A, B))!;
  const timedOut = await h.service.anchorVersion(ref);
  assert.equal(timedOut?.transactionStatus, "FAILED");
  assert.equal(timedOut?.lastError, "wait for transaction timeout");
  const sent = timedOut?.transactionHash;
  assert.ok(sent, "the broadcast hash is stored before waiting");

  // Still pending: a retry must not broadcast a second transaction.
  const waiting = await h.service.anchorVersion(ref);
  assert.equal(h.anchored.length, 1);
  assert.equal(waiting?.transactionStatus, "FAILED");
  assert.match(waiting?.lastError ?? "", /đang chờ xác nhận/);

  // Mined later: the retry confirms with the original tx and block.
  h.onChain.set(proofRecordId(ref.id), h.versions[0].dataHash);
  h.txStates.set(sent, { state: "mined", blockNumber: 9 });
  const confirmed = await h.service.anchorVersion(ref);
  assert.equal(h.anchored.length, 1);
  assert.equal(confirmed?.transactionStatus, "CONFIRMED");
  assert.equal(confirmed?.transactionHash, sent);
  assert.equal(confirmed?.blockNumber, 9n);
  assert.equal(confirmed?.lastError, null);
});

void test("scheduleAnchor runs sends one at a time and swallows failures", async () => {
  const h = proofHarness({ failAnchor: true });
  const first = (await h.service.prepareDeliveryInspected(tx, A, B))!;
  h.service.scheduleAnchor(first);
  h.service.scheduleAnchor(null);
  const settled = await h.service.anchorVersion(first);
  assert.equal(settled?.transactionStatus, "FAILED");
  assert.match(settled?.lastError ?? "", /NotWriter/);
});

void test("anchor API resends failed versions and refuses confirmed ones", async () => {
  const h = proofHarness({ failAnchor: true });
  const ref = (await h.service.prepareDeliveryInspected(tx, A, B))!;
  await h.service.anchorVersion(ref);
  const params = { kind: "deliveries" as const, versionId: ref.id };
  const retry = proofHarness();
  // Same version id in a healthy harness to show the retry path.
  const healthy = (await retry.service.prepareDeliveryInspected(tx, A, B))!;
  const result = await retry.service.anchor(
    { kind: "deliveries", versionId: healthy.id },
    verifier,
  );
  assert.equal(result.transactionStatus, "CONFIRMED");
  assert.equal(
    result.explorerUrl,
    `https://sepolia.etherscan.io/tx/${hashOf("1")}`,
  );
  await assert.rejects(
    () =>
      retry.service.anchor(
        { kind: "deliveries", versionId: healthy.id },
        verifier,
      ),
    { statusCode: 409 },
  );
  await assert.rejects(
    () =>
      h.service.anchor(params, {
        ...verifier,
        permissions: ["traceability.view"],
      }),
    { statusCode: 403 },
  );
});

void test("verify reports VERIFIED, each MISMATCH cause, FAILED and scope errors", async () => {
  const h = proofHarness();
  const ref = (await h.service.prepareDeliveryInspected(tx, A, B))!;
  const params = { kind: "deliveries" as const, versionId: ref.id };
  await assert.rejects(() => h.service.verify(params, verifier), {
    statusCode: 409,
    message: "Bằng chứng chưa được xác nhận trên blockchain",
  });
  await h.service.anchorVersion(ref);

  const ok = await h.service.verify(params, verifier);
  assert.equal(ok.verificationStatus, "VERIFIED");
  assert.equal(ok.verifiedAt, at.toISOString());
  assert.equal(ok.blockNumber, "7");

  h.deliveryRow.vehiclePlate = "30A-00000";
  const edited = await h.service.verify(params, verifier);
  assert.equal(edited.verificationStatus, "MISMATCH");
  assert.equal(
    edited.verificationResult,
    "Dữ liệu hiện tại khác dữ liệu đã neo: vehiclePlate",
  );
  h.deliveryRow.vehiclePlate = delivery().vehiclePlate;

  const recordId = proofRecordId(ref.id);
  h.onChain.set(recordId, hashOf("e"));
  assert.equal(
    (await h.service.verify(params, verifier)).verificationResult,
    "Hash trên blockchain khác hash đã lưu trong hệ thống",
  );
  h.onChain.delete(recordId);
  assert.equal(
    (await h.service.verify(params, verifier)).verificationResult,
    "Không tìm thấy bản ghi trên blockchain",
  );

  await assert.rejects(
    () =>
      h.service.verify(params, { ...verifier, orgType: "SUPPLIER" } as never),
    { statusCode: 403 },
  );
});

void test("verify returns FAILED when the chain is unreachable", async () => {
  const h = proofHarness();
  const ref = (await h.service.prepareDeliveryInspected(tx, A, B))!;
  await h.service.anchorVersion(ref);
  const down = createBlockchainProofService({
    connect: () => Promise.resolve({} as never),
    repository: {
      findVersion: () => Promise.resolve(h.versions[0]),
      readDelivery: () => Promise.resolve(h.deliveryRow),
      setVerification: () => Promise.resolve(),
    } as never,
    chain: {
      contractAddress: () => "0xRegistry",
      read: () => Promise.reject(new Error("timeout")),
      anchor: () => Promise.reject(new Error("unused")),
      lookup: () => Promise.reject(new Error("unused")),
    },
    enabled: () => true,
    network: () => "sepolia",
    now: () => at,
  });
  const result = await down.verify(
    { kind: "deliveries", versionId: ref.id },
    verifier,
  );
  assert.equal(result.verificationStatus, "FAILED");
  assert.equal(result.verificationResult, "Không kết nối được blockchain");
});

void test("verify hides versions outside the school scope", async () => {
  const service = createBlockchainProofService({
    connect: () => Promise.resolve({} as never),
    repository: {
      findVersion: (_db: unknown, _k: string, _id: string, scope: unknown) => {
        assert.deepEqual(scope, { schoolId: verifier.schoolId });
        return Promise.resolve(null);
      },
    } as never,
    enabled: () => true,
  });
  await assert.rejects(
    () => service.verify({ kind: "deliveries", versionId: A }, verifier),
    { statusCode: 404, message: "Không tìm thấy bằng chứng blockchain" },
  );
});

function sampleTx(existing: boolean, disposed: boolean) {
  const principal = {
    ...testStaff,
    role: "SCHOOL_KITCHEN_STAFF",
    permissions: ["retained_sample.create", "retained_sample.dispose"],
  };
  const sample = {
    id: C,
    cookingBatchId: B,
    dishId: A,
    recordedByUserId: B,
    sampledAt: new Date(Date.now() - 48 * 3600000),
    quantity: new Prisma.Decimal("0.1"),
    unit: "kg",
    storageLocation: "Tủ 1",
    photoPublicId: null,
    photoHash: null,
    storageUnitId: C,
    storageUnit: { name: "Tủ 1" },
    status: disposed ? "DISPOSED" : "STORED",
    disposedAt: disposed ? new Date(Date.now() - 3600000) : null,
    disposalNote: disposed ? "Hết hạn" : null,
    createdAt: at,
    updatedAt: at,
    CookingBatch: {
      batchCode: "B-1",
      mealType: "LUNCH",
      BatchGroup: { id: A, batchCode: "G-1" },
    },
    CookingBatchDish: { plannedPortions: 10, Dish: { name: "Cơm" } },
  };
  const client = {
    $queryRaw: () => Promise.resolve([]),
    user: {
      findUnique: () =>
        Promise.resolve({
          ...principal,
          status: "ACTIVE",
          Role: {
            code: principal.role,
            type: "SCHOOL",
            rolePermissions: principal.permissions.map((code) => ({
              permission: { code, isActive: true },
            })),
          },
          permissionDenials: [],
        }),
    },
    school: { findUnique: () => Promise.resolve({ status: "ACTIVE" }) },
    cookingBatch: {
      findFirst: () =>
        Promise.resolve({
          id: B,
          status: "COMPLETED",
          completedAt: new Date(Date.now() - 72 * 3600000),
          dishes: [{ dishId: A }],
        }),
    },
    retainedFoodSample: {
      findUnique: () => Promise.resolve(existing ? sample : null),
      findFirst: () => Promise.resolve(sample),
      create: () => Promise.resolve(sample),
      update: () => Promise.resolve({ ...sample, status: "DISPOSED" }),
      count: () => Promise.resolve(0),
    },
    sampleStorageUnit: {
      findFirst: () =>
        Promise.resolve({
          id: C,
          name: "Tủ 1",
          status: "ACTIVE",
          capacity: 40,
          currentUsage: 0,
        }),
    },
    foodSafetyIncident: { findFirst: () => Promise.resolve(null) },
  };
  const db = {
    $transaction: <T>(operation: (c: typeof client) => Promise<T>) =>
      operation(client),
  };
  const calls: string[] = [];
  const scheduled: unknown[] = [];
  const service = createRetainedSampleService(
    undefined,
    () => Promise.resolve(db as never),
    {
      prepareSampleStored: (_tx, id, actorId) => {
        calls.push(`stored:${id}:${actorId}`);
        return Promise.resolve({ kind: "retained-samples", id: "v1" });
      },
      prepareSampleDisposed: (_tx, id, actorId) => {
        calls.push(`disposed:${id}:${actorId}`);
        return Promise.resolve({ kind: "retained-samples", id: "v2" });
      },
      scheduleAnchor: (ref) => {
        scheduled.push(ref);
      },
    },
  );
  return { service, principal, sample, calls, scheduled };
}

void test("sample create and dispose prepare a version once and schedule it after commit", async () => {
  const fresh = sampleTx(false, false);
  const input = {
    quantity: "0.1",
    unit: "kg",
    storageUnitId: C,
    sampledAt: new Date(Date.now() - 3600000),
  };
  const created = await fresh.service.create(B, input, fresh.principal);
  assert.equal(created.created, true);
  assert.deepEqual(fresh.calls, [`stored:${C}:${fresh.principal.id}`]);
  assert.deepEqual(fresh.scheduled, [{ kind: "retained-samples", id: "v1" }]);

  const replay = sampleTx(true, false);
  await replay.service.create(
    B,
    { ...input, sampledAt: replay.sample.sampledAt },
    replay.principal,
  );
  assert.deepEqual(replay.calls, []);
  assert.deepEqual(replay.scheduled, [null]);

  const dispose = sampleTx(false, false);
  const disposal = {
    disposedAt: new Date(Date.now() - 60000),
    disposalNote: "Hết hạn",
  };
  await dispose.service.dispose(C, disposal, dispose.principal);
  assert.deepEqual(dispose.calls, [`disposed:${C}:${dispose.principal.id}`]);
  assert.deepEqual(dispose.scheduled, [{ kind: "retained-samples", id: "v2" }]);

  const again = sampleTx(false, true);
  await again.service.dispose(
    C,
    {
      disposedAt: again.sample.disposedAt!,
      disposalNote: again.sample.disposalNote!,
    },
    again.principal,
  );
  assert.deepEqual(again.calls, []);
});

void test("dispatch declaration is anchored once and linked from the inspection", async () => {
  const h = proofHarness();
  const declared = await h.service.prepareDeliveryDeclared(tx, A, C);
  assert.equal(declared?.kind, "delivery-declarations");
  assert.equal(await h.service.prepareDeliveryDeclared(tx, A, C), null);
  const declaration = h.versions[0];
  const payload = declaration.snapshot as {
    type: string;
    declaredByUserId: string;
    declaredAt: string;
    vehiclePlate: string;
    items: { quantity: string; lots: { quantity: string }[] }[];
  };
  assert.equal(payload.type, "DELIVERY_DECLARED");
  assert.equal(payload.declaredByUserId, C);
  assert.equal(payload.declaredAt, at.toISOString());
  assert.equal(payload.vehiclePlate, "29A-12345");
  assert.equal(payload.items[0].quantity, "6.100");
  assert.equal(declaration.payloadVersion, 1);

  await h.service.prepareDeliveryInspected(tx, A, B);
  const inspection = h.versions[1];
  assert.equal(inspection.payloadVersion, 2);
  assert.equal(
    (inspection.snapshot as { declarationHash: string }).declarationHash,
    declaration.dataHash,
  );

  // Both verify; the inspection also reports the business cross-check.
  await h.service.anchorVersion(declared);
  const declarationCheck = await h.service.verify(
    { kind: "delivery-declarations", versionId: declared.id },
    verifier,
  );
  assert.equal(declarationCheck.verificationStatus, "VERIFIED");
  await h.service.anchorVersion({ kind: "deliveries", id: inspection.id });
  const inspectionCheck = await h.service.verify(
    { kind: "deliveries", versionId: inspection.id },
    verifier,
  );
  assert.equal(inspectionCheck.verificationStatus, "VERIFIED");
  assert.match(
    inspectionCheck.verificationResult ?? "",
    /Khớp khai báo giao hàng của NCC/,
  );

  // Changing the vehicle plate breaks the declaration, whose hash it fixed.
  h.deliveryRow.vehiclePlate = "30A-00000";
  const edited = await h.service.verify(
    { kind: "delivery-declarations", versionId: declared.id },
    verifier,
  );
  assert.equal(edited.verificationStatus, "MISMATCH");
  assert.match(edited.verificationResult ?? "", /vehiclePlate/);
});

void test("meal distribution is one proof per school-day, linked to its cooking batches", async () => {
  const h = proofHarness();
  await h.service.prepareCookingCompleted(tx, B, B);
  const cookingHash = h.versions[0].dataHash;
  const ref = await h.service.prepareMealDistributed(tx, C, "2026-11-15", B);
  assert.equal(ref?.kind, "meal-distributions");
  assert.equal(
    await h.service.prepareMealDistributed(tx, C, "2026-11-15", B),
    null,
  );
  const proof = h.versions[1];
  assert.equal(proof.recordId, `${C}:2026-11-15`);
  const payload = proof.snapshot as {
    type: string;
    totalPortions: number;
    distributedAt: string;
    batches: { cookingBatchId: string; cookingCompletedHash: string }[];
  };
  assert.equal(payload.type, "MEAL_DISTRIBUTED");
  assert.equal(payload.totalPortions, 8);
  assert.equal(payload.distributedAt, at.toISOString());
  assert.equal(payload.batches[0].cookingCompletedHash, cookingHash);

  await h.service.anchorVersion(ref);
  const ok = await h.service.verify(
    { kind: "meal-distributions", versionId: ref.id },
    verifier,
  );
  assert.equal(ok.verificationStatus, "VERIFIED");
  assert.equal(
    ok.verificationResult,
    "Dữ liệu khớp với bản ghi trên blockchain",
  );

  // Serving more portions than the batch planned is reported, not hidden.
  const busy = proofHarness();
  busy.distribution[0].mealAllocationBatches[0].allocatedPortions = 12;
  const busyRef = await busy.service.prepareMealDistributed(
    tx,
    C,
    "2026-11-15",
    B,
  );
  await busy.service.anchorVersion(busyRef!);
  const over = await busy.service.verify(
    { kind: "meal-distributions", versionId: busyRef!.id },
    verifier,
  );
  assert.equal(over.verificationStatus, "VERIFIED");
  assert.match(over.verificationResult ?? "", /vượt số suất của mẻ: .*12\/10/);

  const disabled = proofHarness({ enabled: false });
  assert.equal(
    await disabled.service.prepareMealDistributed(tx, C, "2026-11-15", B),
    null,
  );
  assert.equal(await disabled.service.prepareDeliveryDeclared(tx, A, C), null);
});

void test("chain links match, break on a tampered reference and skip unanchored ones", async () => {
  const h = proofHarness();
  await h.service.prepareDeliveryDeclared(tx, A, C);
  await h.service.prepareDeliveryInspected(tx, A, B);
  await h.service.prepareCookingCompleted(tx, B, B);
  await h.service.prepareSampleStored(tx, C, B);
  await h.service.prepareMealDistributed(tx, C, "2026-11-15", B);
  const lots = new Map([[C, A]]);
  const statuses = () =>
    [...linkChecks(h.versions, lots).values()].flat().map((l) => l.status);
  assert.deepEqual(statuses(), ["MATCH", "MATCH", "MATCH", "MATCH"]);

  const cooking = h.versions[2].snapshot as {
    lots: { deliveryInspectionHash: string | null }[];
  };
  cooking.lots[0].deliveryInspectionHash = hashOf("f");
  assert.deepEqual(statuses(), ["MATCH", "MISMATCH", "MATCH", "MATCH"]);
  cooking.lots[0].deliveryInspectionHash = null;
  assert.deepEqual(statuses(), ["MATCH", "NOT_LINKED", "MATCH", "MATCH"]);
});

void test("suppliers see only their own declarations and no other proof kind", async () => {
  const scopes: unknown[] = [];
  const service = createBlockchainProofService({
    connect: () => Promise.resolve({} as never),
    repository: {
      listVersions: (_db: unknown, _k: string, _r: string, scope: unknown) => {
        scopes.push(scope);
        return Promise.resolve([]);
      },
    } as never,
    enabled: () => true,
  });
  const supplier = {
    ...testStaff,
    role: "INGREDIENT_SUPPLIER_STAFF",
    orgType: "SUPPLIER" as const,
    schoolId: null,
    supplierId: C,
    permissions: ["delivery.manage"],
  };
  await service.listVersions(
    { kind: "delivery-declarations", recordId: A },
    supplier,
  );
  assert.deepEqual(scopes, [{ supplierId: C }]);
  await assert.rejects(
    () => service.listVersions({ kind: "deliveries", recordId: A }, supplier),
    { statusCode: 403 },
  );
  await assert.rejects(
    () =>
      service.listVersions(
        { kind: "delivery-declarations", recordId: A },
        { ...supplier, permissions: ["delivery.view"] },
      ),
    { statusCode: 403 },
  );
  await service.listVersions(
    { kind: "delivery-declarations", recordId: A },
    verifier,
  );
  assert.deepEqual(scopes.at(-1), { schoolId: verifier.schoolId });
});

void test("chain API lists a meal's proofs in scope and flags a broken link", async () => {
  const h = proofHarness();
  await h.service.prepareDeliveryInspected(tx, A, B);
  await h.service.prepareCookingCompleted(tx, B, B);
  const subjects = {
    schoolId: C,
    date: "2026-11-15",
    cookingBatchIds: [B],
    sampleIds: [],
    deliveryIds: [A],
    lotDeliveries: new Map([[C, A]]),
    meal: {
      gradeId: A,
      gradeName: "Khối 3",
      mealType: "LUNCH",
      portions: 30,
      status: "DISTRIBUTED",
      distributedAt: null,
      classes: [
        {
          id: A,
          className: "3A",
          portions: 30,
          status: "DISTRIBUTED",
          distributedAt: null,
        },
      ],
    },
    steps: {
      deliveries: [],
      cookingBatches: [],
      retainedSamples: [],
      distribution: { recordId: `${C}:2026-11-15`, date: "2026-11-15" },
    },
  };
  const seen: unknown[] = [];
  const service = createBlockchainProofService({
    connect: () => Promise.resolve({} as never),
    repository: {
      chainSubjects: (_db: unknown, id: string, school: unknown) => {
        seen.push(school);
        return Promise.resolve(id === A ? subjects : null);
      },
      listChain: () => Promise.resolve(h.versions),
    } as never,
    enabled: () => false,
  });
  const chain = await service.chain(
    { mealAllocationId: A },
    { verify: false },
    verifier,
  );
  assert.deepEqual(seen, [verifier.schoolId]);
  assert.equal(chain.intact, true);
  // Steps and the meal header come back even for steps without a proof.
  assert.equal(chain.meal.classes[0].className, "3A");
  assert.equal(chain.mealAllocationId, A);
  assert.equal(chain.steps.distribution.recordId, `${C}:2026-11-15`);
  assert.deepEqual(
    chain.nodes.map((node) => [node.kind, node.links.map((l) => l.status)]),
    [
      ["deliveries", ["NOT_LINKED"]],
      ["cooking-batches", ["MATCH"]],
    ],
  );
  (
    h.versions[1].snapshot as { lots: { deliveryInspectionHash: string }[] }
  ).lots[0].deliveryInspectionHash = hashOf("f");
  assert.equal(
    (await service.chain({ mealAllocationId: A }, { verify: false }, verifier))
      .intact,
    false,
  );
  await assert.rejects(
    () => service.chain({ mealAllocationId: B }, { verify: false }, verifier),
    { statusCode: 404 },
  );
  // Verifying needs the chain switched on and the verify permission.
  await assert.rejects(
    () => service.chain({ mealAllocationId: A }, { verify: true }, verifier),
    { statusCode: 409 },
  );
  await assert.rejects(
    () =>
      service.chain(
        { mealAllocationId: A },
        { verify: true },
        { ...verifier, permissions: ["traceability.view"] },
      ),
    { statusCode: 403 },
  );
});

void test("grade meals keep a school to its own grades", async () => {
  const queries: unknown[] = [];
  const service = createBlockchainProofService({
    connect: () => Promise.resolve({} as never),
    repository: {
      listGradeMeals: (_db: unknown, query: unknown) => {
        queries.push(query);
        return Promise.resolve([]);
      },
      gradeChainSubjects: (_db: unknown, query: unknown) => {
        queries.push(query);
        return Promise.resolve(null);
      },
    } as never,
    enabled: () => false,
  });
  // A school cannot widen its scope with another schoolId.
  await service.gradeMeals({ date: "2026-11-16", schoolId: A }, verifier);
  const system = {
    ...verifier,
    orgType: "SYSTEM",
    schoolId: null,
  } as typeof verifier;
  await service.gradeMeals({ date: "2026-11-16", schoolId: A }, system);
  await service.gradeMeals({ date: "2026-11-16" }, system);
  await assert.rejects(
    () =>
      service.gradeChain(
        { gradeId: null },
        { date: "2026-11-16", mealType: "LUNCH", verify: false, schoolId: A },
        verifier,
      ),
    { statusCode: 404 },
  );
  assert.deepEqual(queries, [
    { date: "2026-11-16", schoolId: verifier.schoolId },
    { date: "2026-11-16", schoolId: A },
    { date: "2026-11-16", schoolId: null },
    {
      schoolId: verifier.schoolId,
      gradeId: null,
      date: "2026-11-16",
      mealType: "LUNCH",
    },
  ]);
  // Ungraded classes exist in every school, so the system must pick one.
  await assert.rejects(
    () =>
      service.gradeChain(
        { gradeId: null },
        { date: "2026-11-16", mealType: "LUNCH", verify: false },
        system,
      ),
    { statusCode: 400 },
  );
  await assert.rejects(
    () =>
      service.gradeMeals(
        { date: "2026-11-16" },
        { ...verifier, permissions: [] },
      ),
    { statusCode: 403 },
  );
});

void test("meal status sums up the classes of a grade", () => {
  assert.equal(mealStatus(["FINALIZED", "FINALIZED"]), "FINALIZED");
  assert.equal(mealStatus(["FINALIZED", "DISTRIBUTED"]), "DISTRIBUTED");
  assert.equal(mealStatus(["DISTRIBUTED", "ALLOCATED"]), "PARTIAL");
  assert.equal(mealStatus(["ALLOCATED", "CANCELLED"]), "ALLOCATED");
  assert.equal(mealStatus(["CANCELLED"]), "CANCELLED");
});

void test("public journey hides operational details and never saves a check", async () => {
  const h = proofHarness();
  const ref = await h.service.prepareCookingCompleted(tx, B, B);
  await h.service.anchorVersion(ref!);
  h.versions[0].lastError = "RPC down at https://rpc.example/key";
  const lunch = { date: "2026-11-15", mealType: "LUNCH" as const };

  const chain = await h.service.publicGradeChain(
    { schoolCode: "TH-DEMO", gradeId: A },
    { ...lunch, verify: true },
  );
  assert.equal(chain.nodes[0].verificationStatus, "VERIFIED");
  assert.deepEqual(h.saved, []);
  assert.equal(h.versions[0].verificationStatus, "NOT_VERIFIED");
  assert.equal(chain.nodes[0].lastError, null);
  assert.equal(chain.mealAllocationId, null);
  assert.equal(chain.meal.gradeName, "Khối 3");
  assert.equal(chain.steps.deliveries[0].vehiclePlate, null);
  assert.equal(chain.steps.deliveries[0].deliveryNo, null);
  assert.equal(chain.steps.deliveries[0].supplierName, "NCC A");
  assert.equal(chain.steps.cookingBatches[0].batchCode, null);

  // Staff checks are still saved.
  await h.service.gradeChain(
    { gradeId: A },
    { ...lunch, verify: true },
    { ...verifier, schoolId: C },
  );
  assert.equal(h.saved.length, 1);

  await assert.rejects(
    () =>
      h.service.publicGradeChain(
        { schoolCode: "khac", gradeId: A },
        { ...lunch, verify: false },
      ),
    { statusCode: 404 },
  );
  await assert.rejects(
    () =>
      h.service.publicGradeChain(
        { schoolCode: "TH-DEMO", gradeId: B },
        { ...lunch, verify: false },
      ),
    { statusCode: 404 },
  );
  const disabled = proofHarness({ enabled: false });
  await assert.rejects(
    () =>
      disabled.service.publicGradeChain(
        { schoolCode: "TH-DEMO", gradeId: A },
        { ...lunch, verify: true },
      ),
    { statusCode: 409 },
  );
});
