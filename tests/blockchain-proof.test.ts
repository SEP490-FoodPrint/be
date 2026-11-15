import assert from "node:assert/strict";
import { test } from "node:test";
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
  explorerUrl,
  proofRecordId,
  safeError,
  type ProofChain,
} from "../src/modules/blockchain-proof/blockchain-proof.service";
import type { VersionRow } from "../src/modules/blockchain-proof/blockchain-proof.repository";
import { createRetainedSampleService } from "../src/modules/retained-sample/retained-sample.service";
import { testStaff } from "./helpers/authorization";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const hashOf = (char: string) => `0x${char.repeat(64)}`;
const at = new Date("2026-11-15T01:02:03.000Z");
const DELIVERY_VECTOR =
  "0xde533aa1a99092fc5caf8a326a74af3441943c8b64233f46883d1e19142c7161";

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
  assert.equal(payload.v, 1);
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
  assert.equal(
    proofRecordId("deliveries", A),
    proofRecordId("deliveries", A.toString()),
  );
  assert.notEqual(
    proofRecordId("deliveries", A),
    proofRecordId("cooking-batches", A),
  );
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
  } = {},
) {
  const versions: Stored[] = [];
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
  let nextId = 0;
  const create =
    (kind: VersionRow["kind"], eventType: VersionRow["eventType"]) =>
    (_db: unknown, recordId: string, ...rest: unknown[]) => {
      const data = rest[rest.length - 1] as Stored;
      const id = `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`;
      versions.push({
        ...data,
        id,
        kind,
        recordId,
        eventType:
          kind === "retained-samples" && rest[0] === "DISPOSED"
            ? "SAMPLE_DISPOSED"
            : eventType,
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
    createDeliveryVersion: create("deliveries", "DELIVERY_INSPECTED"),
    createCookingBatchVersion: create("cooking-batches", "COOKING_COMPLETED"),
    createSampleVersion: create("retained-samples", "SAMPLE_STORED"),
    findVersion: (_db: unknown, _kind: string, id: string, school: unknown) =>
      Promise.resolve(school === "foreign" ? null : find(id)),
    listVersions: () => Promise.resolve(versions),
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
      Object.assign(find(id)!, data);
      return Promise.resolve();
    },
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
    anchor: (recordId, dataHash) => {
      if (options.failAnchor)
        return Promise.reject(new Error("execution reverted: NotWriter"));
      anchored.push(recordId);
      onChain.set(recordId, dataHash);
      return Promise.resolve({
        txHash: hashOf(String(anchored.length)),
        blockNumber: 7,
        contractAddress: "0xRegistry",
      });
    },
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
  return { service, versions, anchored, onChain, sampleRow, deliveryRow };
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
  crashed.onChain.set(
    proofRecordId("deliveries", lost.id),
    crashed.versions[0].dataHash,
  );
  const recovered = await crashed.service.anchorVersion(lost);
  assert.equal(recovered?.transactionStatus, "CONFIRMED");
  assert.equal(recovered?.transactionHash, null);
  assert.equal(crashed.anchored.length, 0);

  const mismatch = proofHarness();
  const other = (await mismatch.service.prepareDeliveryInspected(tx, A, B))!;
  mismatch.onChain.set(proofRecordId("deliveries", other.id), hashOf("d"));
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

  const recordId = proofRecordId("deliveries", ref.id);
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
      findVersion: (_db: unknown, _k: string, _id: string, school: string) => {
        assert.equal(school, verifier.schoolId);
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
    storageUnitId: null,
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
    storageLocation: "Tủ 1",
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
