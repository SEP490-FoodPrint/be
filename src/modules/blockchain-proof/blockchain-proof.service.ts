import { randomUUID } from "node:crypto";
import { id as keccakId, type ContractTransactionResponse } from "ethers";
import type { PrismaClient, Prisma } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import {
  assertPermission,
  assertSystemManager,
} from "../../utils/authorization";
import {
  createBlockchainProvider,
  getContractInstance,
  loadDeployment,
  readHashFromChain,
} from "../../utils/blockchain";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import {
  documentSha256,
  documentStorage,
  readDocuments,
  type OnboardingDocument,
} from "../../utils/onboarding-documents";
import {
  blockchainProofScope,
  supplierOrderManagementScope,
} from "../../utils/resource-access";
import {
  buildCookingCompletedPayload,
  buildDeliveryDeclaredPayload,
  buildDeliveryInspectedPayload,
  buildMealDistributedPayload,
  buildRegistrationApprovedPayload,
  buildRegistrationSubmittedPayload,
  buildSampleDisposedPayload,
  buildSampleStoredPayload,
  changedFields,
  hashPayload,
  HASH_ALGORITHM,
  iso,
  type ProofPayload,
} from "./blockchain-proof.payload";
import {
  createBlockchainProofRepository,
  type BlockchainProofRepository,
  type ChainSubjects,
  type NewVersion,
  type ProofKind,
  type ProofScope,
  type VersionRow,
} from "./blockchain-proof.repository";
import type {
  BlockchainProofChainParamsDTO,
  BlockchainProofChainQueryDTO,
  BlockchainProofGradeChainQueryDTO,
  BlockchainProofGradeMealsQueryDTO,
  BlockchainProofGradeParamsDTO,
  BlockchainProofPublicGradeChainQueryDTO,
  BlockchainProofPublicGradeMealsQueryDTO,
  BlockchainProofPublicGradeParamsDTO,
  BlockchainProofPublicSchoolParamsDTO,
  BlockchainProofRecordParamsDTO,
  BlockchainProofVersionParamsDTO,
} from "./blockchain-proof.request.dto";
import type {
  BlockchainProofGradeMealDTO,
  BlockchainProofChainResponseDTO,
  BlockchainProofVersionResponseDTO,
  ProofLinkCheckDTO,
  RegistrationDocumentCheckDTO,
} from "./blockchain-proof.response.dto";

type Tx = Prisma.TransactionClient;

/** A version created inside a business transaction, sent after commit. */
export type ProofRef = { kind: ProofKind; id: string };

/** Chain access; the default wraps the shared `utils/blockchain.ts`. */
export type ProofChain = {
  contractAddress(): string | null;
  read(recordId: string): Promise<{
    onChainHash: string | null;
    contractAddress: string;
  }>;
  /** Sends the hash; `onSubmitted` runs once the transaction is broadcast. */
  anchor(
    recordId: string,
    dataHash: string,
    onSubmitted: (txHash: string, contractAddress: string) => Promise<unknown>,
  ): Promise<{
    txHash: string;
    blockNumber: number;
    contractAddress: string;
  }>;
  /** State of an earlier transaction; a reverted one counts as missing. */
  lookup(
    txHash: string,
  ): Promise<
    | { state: "mined"; blockNumber: number }
    | { state: "pending" }
    | { state: "missing" }
  >;
};

/** Sepolia blocks are ~12s apart; the shared helper's 15s wait is too short. */
function receiptTimeoutMs(): number {
  const value = Number(process.env.BLOCKCHAIN_RECEIPT_TIMEOUT_MS);
  return Number.isInteger(value) && value > 0 ? value : 120_000;
}

/** Downloads a stored registration file; null when the storage no longer has it. */
export type DocumentReader = (
  document: OnboardingDocument,
) => Promise<Buffer | null>;

const fetchDocument: DocumentReader = async (document) => {
  const response = await fetch(documentStorage.download(document), {
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Tải tài liệu lỗi HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
};

const defaultChain: ProofChain = {
  contractAddress() {
    try {
      return loadDeployment().address;
    } catch {
      return null;
    }
  },
  async read(recordId) {
    const { onChainHash, deployment } = await readHashFromChain(recordId);
    return { onChainHash, contractAddress: deployment.address };
  },
  async anchor(recordId, dataHash, onSubmitted) {
    const provider = createBlockchainProvider();
    try {
      const { contract, deployment } = await getContractInstance(
        provider,
        true,
      );
      const confirmHash: (id: string, hash: string) => Promise<unknown> =
        contract.getFunction("confirmHash");
      const tx = (await confirmHash(
        recordId,
        dataHash,
      )) as ContractTransactionResponse;
      await onSubmitted(tx.hash, deployment.address);
      const receipt = await tx.wait(1, receiptTimeoutMs());
      if (!receipt) throw new Error("Không nhận được biên nhận giao dịch");
      return {
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
        contractAddress: deployment.address,
      };
    } finally {
      provider.destroy();
    }
  },
  async lookup(txHash) {
    const provider = createBlockchainProvider();
    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (receipt)
        return receipt.status === 1
          ? { state: "mined", blockNumber: receipt.blockNumber }
          : { state: "missing" };
      return (await provider.getTransaction(txHash))
        ? { state: "pending" }
        : { state: "missing" };
    } finally {
      provider.destroy();
    }
  },
};

/** On-chain key of a proof; every kind lives in `blockchain_proofs`. */
export function proofRecordId(proofId: string): string {
  return keccakId(`foodprint:blockchain_proofs:${proofId}`);
}

export function explorerUrl(
  networkName: string,
  transactionHash: string | null,
): string | null {
  return networkName === "sepolia" && transactionHash
    ? `https://sepolia.etherscan.io/tx/${transactionHash}`
    : null;
}

/** Keep RPC URLs (which may carry API keys) out of stored errors. */
export function safeError(error: unknown): string {
  const short = (error as { shortMessage?: unknown } | null)?.shortMessage;
  const raw =
    typeof short === "string"
      ? short
      : error instanceof Error
        ? error.message
        : "Lỗi không xác định";
  return raw.replace(/(?:https?|wss?):\/\/\S+/g, "[url]").slice(0, 500);
}

const same = (a: string | null, b: string | null) =>
  a !== null && b !== null && a.toLowerCase() === b.toLowerCase();

function asPayload(value: Prisma.JsonValue): ProofPayload {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ProofPayload)
    : {};
}

function toDTO(row: VersionRow): BlockchainProofVersionResponseDTO {
  return {
    id: row.id,
    kind: row.kind,
    recordId: row.recordId,
    version: row.version,
    eventType: row.eventType,
    dataHash: row.dataHash,
    hashAlgorithm: row.hashAlgorithm,
    previousVersionId: row.previousVersionId,
    changeReason: row.changeReason,
    transactionStatus: row.transactionStatus,
    transactionHash: row.transactionHash,
    blockNumber: row.blockNumber === null ? null : row.blockNumber.toString(),
    networkName: row.networkName,
    contractAddress: row.contractAddress,
    explorerUrl: explorerUrl(row.networkName, row.transactionHash),
    recordedAt: row.recordedAt?.toISOString() ?? null,
    lastError: row.lastError,
    verificationStatus: row.verificationStatus,
    verificationResult: row.verificationResult,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export type BlockchainProofOptions = {
  connect?: () => Promise<PrismaClient>;
  repository?: BlockchainProofRepository;
  chain?: ProofChain;
  enabled?: () => boolean;
  network?: () => string;
  now?: () => Date;
  warn?: (message: string) => void;
  readDocument?: DocumentReader;
};

export function createBlockchainProofService(
  options: BlockchainProofOptions = {},
) {
  const connect = options.connect ?? getPrisma;
  const repo = options.repository ?? createBlockchainProofRepository();
  const chain = options.chain ?? defaultChain;
  const enabled =
    options.enabled ?? (() => process.env.BLOCKCHAIN_ENABLED === "true");
  const network =
    options.network ??
    (() => process.env.BLOCKCHAIN_NETWORK?.trim() || "localhost");
  const now = options.now ?? (() => new Date());
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const readDocument = options.readDocument ?? fetchDocument;

  // One sender per process, so consecutive transactions never share a nonce.
  let tail: Promise<unknown> = Promise.resolve();
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  }

  function newVersion(
    eventType: NewVersion["eventType"],
    payload: ProofPayload,
    actorId: string,
    version = 1,
    previousVersionId: string | null = null,
    changeReason: string | null = null,
  ): NewVersion {
    const id = randomUUID();
    return {
      id,
      recordId: proofRecordId(id),
      eventType,
      version,
      dataHash: hashPayload(payload),
      hashAlgorithm: HASH_ALGORITHM,
      payloadVersion: typeof payload.v === "number" ? payload.v : 1,
      snapshot: payload,
      previousVersionId,
      changeReason,
      networkName: network(),
      contractAddress: chain.contractAddress(),
      createdByUserId: actorId,
    };
  }

  type Delivery = NonNullable<
    Awaited<ReturnType<BlockchainProofRepository["readDelivery"]>>
  >;
  type Batch = NonNullable<
    Awaited<ReturnType<BlockchainProofRepository["readCookingBatch"]>>
  >;
  type Sample = NonNullable<
    Awaited<ReturnType<BlockchainProofRepository["readSample"]>>
  >;

  const deliveryPayload = (row: Delivery, declarationHash: string | null) =>
    buildDeliveryInspectedPayload({
      ...row,
      declarationHash,
      approvals: row.deliveryApprovals.map((a) => ({
        ...a,
        roleCode: a.Role.code,
      })),
      items: row.deliveryItems.map((item) => ({
        ...item,
        requestedQuantity: item.SupplyRequestItem?.requestedQuantity ?? null,
        requestedUnit: item.SupplyRequestItem?.unit ?? null,
        lots: item.ingredientLots,
      })),
    });
  const batchPayload = (
    row: Batch,
    hashFor: (lot: Batch["cookingBatchLots"][number]) => string | null,
  ) =>
    buildCookingCompletedPayload({
      ...row,
      lots: row.cookingBatchLots.map((lot) => ({
        ...lot,
        deliveryInspectionHash: hashFor(lot),
      })),
    });
  const declaredPayload = (
    row: Delivery,
    declaredByUserId: string,
    declaredAt: string | null,
  ) =>
    buildDeliveryDeclaredPayload({
      ...row,
      declaredAt,
      declaredByUserId,
      items: row.deliveryItems.map((item) => ({
        ...item,
        requestedQuantity: item.SupplyRequestItem?.requestedQuantity ?? null,
        requestedUnit: item.SupplyRequestItem?.unit ?? null,
        lots: item.ingredientLots,
      })),
    });
  const distributedPayload = async (
    db: Tx,
    schoolId: string,
    date: string,
    hashFor: ((cookingBatchId: string) => string | null) | null,
  ) => {
    const allocations = await repo.readDistribution(db, schoolId, date);
    if (!allocations.length) return null;
    const hashes = hashFor
      ? null
      : await repo.cookingBatchHashes(
          db,
          allocations.flatMap((a) =>
            a.mealAllocationBatches.map((batch) => batch.cookingBatchId),
          ),
        );
    return buildMealDistributedPayload({
      schoolId,
      date,
      allocations,
      cookingCompletedHash: (id) =>
        hashFor ? hashFor(id) : (hashes?.get(id) ?? null),
    });
  };
  const storedPayload = (row: Sample, cookingCompletedHash: string | null) =>
    buildSampleStoredPayload({ ...row, cookingCompletedHash });
  const disposedPayload = (
    row: Sample,
    disposedByUserId: string,
    previousHash: string | null,
  ) => buildSampleDisposedPayload({ ...row, disposedByUserId, previousHash });

  type Registration = NonNullable<
    Awaited<ReturnType<BlockchainProofRepository["readRegistration"]>>
  >;
  const storedDocuments = (row: Registration) => {
    try {
      return readDocuments(row.supportingDocuments, row.applicantUserId);
    } catch {
      return null;
    }
  };
  const submittedPayload = (
    row: Registration,
    previousHash: string | null,
  ): ProofPayload | null => {
    const documents = storedDocuments(row);
    return documents
      ? buildRegistrationSubmittedPayload({
          ...row,
          documents,
          previousHash,
        })
      : null;
  };
  const approvedPayload = (row: Registration, submittedHash: string | null) =>
    buildRegistrationApprovedPayload({
      ...row,
      organizationId:
        row.applicantUser.schoolId ?? row.applicantUser.supplierId ?? null,
      submittedHash,
    });
  const text = (payload: ProofPayload, key: string) => {
    const value = payload[key];
    return typeof value === "string" ? value : null;
  };

  /** The SUBMITTED version the current registration data belongs to. */
  async function currentSubmission(db: Tx, registrationRequestId: string) {
    const rows = await repo.listVersions(
      db,
      "registrations",
      registrationRequestId,
      null,
    );
    return (
      rows.filter((row) => row.eventType === "REGISTRATION_SUBMITTED").at(-1) ??
      null
    );
  }

  async function anchorVersion(ref: ProofRef): Promise<VersionRow | null> {
    const db = await connect();
    const row = await repo.findVersion(db, ref.kind, ref.id, null);
    if (!row || row.transactionStatus === "CONFIRMED") return row;
    const recordId = proofRecordId(ref.id);
    try {
      const existing = await chain.read(recordId);
      // A previous send that timed out keeps its hash: reuse it, never double-send.
      const prior = row.transactionHash
        ? await chain.lookup(row.transactionHash)
        : null;
      if (existing.onChainHash !== null) {
        const mined = prior?.state === "mined" ? prior : null;
        if (same(existing.onChainHash, row.dataHash))
          await repo.markConfirmed(db, ref.kind, ref.id, {
            transactionHash: mined ? row.transactionHash : null,
            blockNumber: mined ? BigInt(mined.blockNumber) : null,
            contractAddress: existing.contractAddress,
            recordedAt: now(),
            lastError: mined ? null : "Đã có trên chain, không rõ giao dịch",
          });
        else
          await repo.markFailed(
            db,
            ref.kind,
            ref.id,
            "Hash trên chain khác hash đã lưu",
          );
      } else if (prior?.state === "pending") {
        await repo.markFailed(
          db,
          ref.kind,
          ref.id,
          "Giao dịch trước vẫn đang chờ xác nhận, thử lại sau",
        );
      } else {
        const result = await chain.anchor(
          recordId,
          row.dataHash,
          (transactionHash, contractAddress) =>
            repo.markSubmitted(db, ref.kind, ref.id, {
              transactionHash,
              contractAddress,
            }),
        );
        await repo.markConfirmed(db, ref.kind, ref.id, {
          transactionHash: result.txHash,
          blockNumber: BigInt(result.blockNumber),
          contractAddress: result.contractAddress,
          recordedAt: now(),
          lastError: null,
        });
      }
    } catch (error) {
      await repo.markFailed(db, ref.kind, ref.id, safeError(error));
    }
    return repo.findVersion(db, ref.kind, ref.id, null);
  }

  async function rebuild(db: Tx, row: VersionRow): Promise<ProofPayload> {
    const snapshot = asPayload(row.snapshot);
    if (row.kind === "registrations") {
      const registration = await repo.readRegistration(db, row.recordId);
      if (!registration) return {};
      if (row.eventType === "REGISTRATION_APPROVED")
        return approvedPayload(registration, text(snapshot, "submittedHash"));
      // A resubmission replaces the data; older versions can only be checked as stored.
      if ((await currentSubmission(db, row.recordId))?.id !== row.id)
        return snapshot;
      return (
        submittedPayload(registration, text(snapshot, "previousHash")) ?? {}
      );
    }
    if (row.kind === "deliveries") {
      const delivery = await repo.readDelivery(db, row.recordId);
      return delivery
        ? deliveryPayload(delivery, text(snapshot, "declarationHash"))
        : {};
    }
    if (row.kind === "delivery-declarations") {
      const delivery = await repo.readDelivery(db, row.recordId);
      return delivery
        ? declaredPayload(
            delivery,
            row.createdByUserId,
            text(snapshot, "declaredAt"),
          )
        : {};
    }
    if (row.kind === "meal-distributions") {
      if (!row.subject) return {};
      // Batch hashes are fixed at anchoring time and read back from the snapshot.
      const anchored = new Map<string, string | null>();
      for (const batch of objects(snapshot.batches))
        if (typeof batch.cookingBatchId === "string")
          anchored.set(
            batch.cookingBatchId,
            typeof batch.cookingCompletedHash === "string"
              ? batch.cookingCompletedHash
              : null,
          );
      return (
        (await distributedPayload(
          db,
          row.subject.schoolId,
          row.subject.date,
          (id) => anchored.get(id) ?? null,
        )) ?? {}
      );
    }
    if (row.kind === "cooking-batches") {
      const batch = await repo.readCookingBatch(db, row.recordId);
      if (!batch) return {};
      // Reference hashes are fixed at anchoring time and read back from the snapshot.
      const anchored = new Map<string, string | null>();
      for (const lot of Array.isArray(snapshot.lots) ? snapshot.lots : [])
        if (
          lot &&
          typeof lot === "object" &&
          !Array.isArray(lot) &&
          typeof lot.ingredientLotId === "string" &&
          typeof lot.dishId === "string"
        )
          anchored.set(
            `${lot.ingredientLotId}|${lot.dishId}`,
            typeof lot.deliveryInspectionHash === "string"
              ? lot.deliveryInspectionHash
              : null,
          );
      return batchPayload(
        batch,
        (lot) => anchored.get(`${lot.ingredientLotId}|${lot.dishId}`) ?? null,
      );
    }
    const sample = await repo.readSample(db, row.recordId);
    if (!sample) return {};
    const reference = (key: string) => {
      const value = snapshot[key];
      return typeof value === "string" ? value : null;
    };
    return row.eventType === "SAMPLE_STORED"
      ? storedPayload(sample, reference("cookingCompletedHash"))
      : disposedPayload(sample, row.createdByUserId, reference("previousHash"));
  }

  /** Registrations belong to no school: only System Admin reviews them. */
  function proofScope(
    kind: ProofKind,
    principal: AuthPrincipal,
    action: "view" | "verify" | "anchor",
  ): ProofScope {
    if (kind === "registrations") {
      assertSystemManager(
        principal,
        action === "anchor" ? "registration.approve" : "registration.view",
      );
      return null;
    }
    // Suppliers see the declarations of their own deliveries.
    if (kind === "delivery-declarations" && principal.orgType === "SUPPLIER")
      return { supplierId: supplierOrderManagementScope(principal).supplierId };
    assertPermission(
      principal,
      action === "view" ? "traceability.view" : "traceability.verify",
    );
    const schoolId = blockchainProofScope(principal);
    return schoolId ? { schoolId } : null;
  }

  /** Each file listed in the anchored submission, re-hashed from storage. */
  async function checkDocuments(
    db: Tx,
    row: VersionRow,
  ): Promise<RegistrationDocumentCheckDTO[] | null> {
    const submission =
      row.eventType === "REGISTRATION_APPROVED"
        ? row.previousVersionId
          ? await repo.findVersion(db, row.kind, row.previousVersionId, null)
          : null
        : row;
    if (!submission) return null;
    const current = await currentSubmission(db, row.recordId);
    // Files replaced by a later submission are deleted from storage.
    if (current?.id !== submission.id) return null;
    const registration = await repo.readRegistration(db, row.recordId);
    const stored = registration ? (storedDocuments(registration) ?? []) : [];
    const anchored = asPayload(submission.snapshot).documents;
    const results: RegistrationDocumentCheckDTO[] = [];
    for (const item of Array.isArray(anchored) ? anchored : []) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const id = typeof item.id === "string" ? item.id : "";
      const base = {
        id,
        field: typeof item.field === "string" ? item.field : "",
        fileName: typeof item.fileName === "string" ? item.fileName : "",
      };
      const document = stored.find((candidate) => candidate.id === id);
      if (!document) {
        results.push({ ...base, status: "MISSING" });
        continue;
      }
      if (typeof item.sha256 !== "string") {
        results.push({ ...base, status: "NO_HASH" });
        continue;
      }
      const data = await readDocument(document);
      results.push({
        ...base,
        status:
          data === null
            ? "MISSING"
            : documentSha256(data) === item.sha256
              ? "MATCH"
              : "MISMATCH",
      });
    }
    return results;
  }

  async function scopedVersion(
    params: BlockchainProofVersionParamsDTO,
    principal: AuthPrincipal,
    action: "verify" | "anchor",
  ) {
    const scope = proofScope(params.kind, principal, action);
    const db = await connect();
    const row = await repo.findVersion(
      db,
      params.kind,
      params.versionId,
      scope,
    );
    if (!row) throw new HttpError(404, "Không tìm thấy bằng chứng blockchain");
    return { db, row };
  }

  function requireEnabled() {
    if (!enabled()) throw new HttpError(409, "Chức năng blockchain đang tắt");
  }

  const service = {
    async prepareDeliveryInspected(
      tx: Tx,
      deliveryId: string,
      actorId: string,
    ): Promise<ProofRef | null> {
      if (!enabled() || (await repo.hasDeliveryVersion(tx, deliveryId)))
        return null;
      const delivery = await repo.readDelivery(tx, deliveryId);
      if (!delivery) return null;
      const declarationHash = await repo.declarationHash(tx, deliveryId);
      const id = await repo.createVersion(
        tx,
        { kind: "deliveries", deliveryId },
        newVersion(
          "INSPECTED",
          deliveryPayload(delivery, declarationHash),
          actorId,
        ),
      );
      return { kind: "deliveries", id };
    },
    /** Supplier dispatch (PREPARING → IN_TRANSIT) fixes what was promised. */
    async prepareDeliveryDeclared(
      tx: Tx,
      deliveryId: string,
      actorId: string,
    ): Promise<ProofRef | null> {
      if (!enabled() || (await repo.hasDeclarationVersion(tx, deliveryId)))
        return null;
      const delivery = await repo.readDelivery(tx, deliveryId);
      if (!delivery) return null;
      const id = await repo.createVersion(
        tx,
        { kind: "delivery-declarations", deliveryId },
        newVersion(
          "DECLARED",
          declaredPayload(delivery, actorId, iso(now())),
          actorId,
        ),
      );
      return { kind: "delivery-declarations", id };
    },
    /** One proof per school-day once its distribution is confirmed. */
    async prepareMealDistributed(
      tx: Tx,
      schoolId: string,
      date: string,
      actorId: string,
    ): Promise<ProofRef | null> {
      if (!enabled() || (await repo.hasDistributionVersion(tx, schoolId, date)))
        return null;
      const payload = await distributedPayload(tx, schoolId, date, null);
      if (!payload) return null;
      const id = await repo.createVersion(
        tx,
        { kind: "meal-distributions", schoolId, date },
        newVersion("DISTRIBUTED", payload, actorId),
      );
      return { kind: "meal-distributions", id };
    },
    async prepareCookingCompleted(
      tx: Tx,
      cookingBatchId: string,
      actorId: string,
    ): Promise<ProofRef | null> {
      if (!enabled() || (await repo.hasCookingBatchVersion(tx, cookingBatchId)))
        return null;
      const batch = await repo.readCookingBatch(tx, cookingBatchId);
      if (!batch) return null;
      const hashes = await repo.latestDeliveryHashes(
        tx,
        batch.cookingBatchLots.map(
          (lot) => lot.IngredientLot.DeliveryItem.deliveryId,
        ),
      );
      const id = await repo.createVersion(
        tx,
        { kind: "cooking-batches", cookingBatchId },
        newVersion(
          "COMPLETED",
          batchPayload(
            batch,
            (lot) =>
              hashes.get(lot.IngredientLot.DeliveryItem.deliveryId) ?? null,
          ),
          actorId,
        ),
      );
      return { kind: "cooking-batches", id };
    },
    async prepareSampleStored(
      tx: Tx,
      sampleId: string,
      actorId: string,
    ): Promise<ProofRef | null> {
      if (!enabled() || (await repo.findSampleVersion(tx, sampleId, "STORED")))
        return null;
      const sample = await repo.readSample(tx, sampleId);
      if (!sample) return null;
      const cookingHash = await repo.latestCookingBatchHash(
        tx,
        sample.cookingBatchId,
      );
      const id = await repo.createVersion(
        tx,
        { kind: "retained-samples", retainedFoodSampleId: sampleId },
        newVersion("STORED", storedPayload(sample, cookingHash), actorId),
      );
      return { kind: "retained-samples", id };
    },
    /** Skipped when the sample was stored before anchoring was enabled (no version 1). */
    async prepareSampleDisposed(
      tx: Tx,
      sampleId: string,
      actorId: string,
    ): Promise<ProofRef | null> {
      if (
        !enabled() ||
        (await repo.findSampleVersion(tx, sampleId, "DISPOSED"))
      )
        return null;
      const stored = await repo.findSampleVersion(tx, sampleId, "STORED");
      const sample = stored ? await repo.readSample(tx, sampleId) : null;
      if (!stored || !sample) return null;
      const id = await repo.createVersion(
        tx,
        { kind: "retained-samples", retainedFoodSampleId: sampleId },
        newVersion(
          "DISPOSED",
          disposedPayload(sample, actorId, stored.dataHash),
          actorId,
          2,
          stored.id,
          "Tiêu huỷ mẫu",
        ),
      );
      return { kind: "retained-samples", id };
    },
    /** Each submission or resubmission adds a version linked to the previous one. */
    async prepareRegistrationSubmitted(
      tx: Tx,
      registrationRequestId: string,
      actorId: string,
    ): Promise<ProofRef | null> {
      if (!enabled()) return null;
      const registration = await repo.readRegistration(
        tx,
        registrationRequestId,
      );
      if (!registration || registration.status !== "PENDING") return null;
      const latest = await repo.latestRegistrationVersion(
        tx,
        registrationRequestId,
      );
      if (latest?.eventType === "APPROVED") return null;
      const payload = submittedPayload(registration, latest?.dataHash ?? null);
      if (!payload) return null;
      const id = await repo.createVersion(
        tx,
        { kind: "registrations", registrationRequestId },
        newVersion(
          "SUBMITTED",
          payload,
          actorId,
          (latest?.version ?? 0) + 1,
          latest?.id ?? null,
          latest ? "Nộp lại hồ sơ" : null,
        ),
      );
      return { kind: "registrations", id };
    },
    /** Skipped when the approved data was never anchored (submitted before proofs, or while disabled). */
    async prepareRegistrationApproved(
      tx: Tx,
      registrationRequestId: string,
      actorId: string,
    ): Promise<ProofRef | null> {
      if (!enabled()) return null;
      const latest = await repo.latestRegistrationVersion(
        tx,
        registrationRequestId,
      );
      if (latest?.eventType !== "SUBMITTED") return null;
      const registration = await repo.readRegistration(
        tx,
        registrationRequestId,
      );
      if (
        !registration ||
        registration.status !== "APPROVED" ||
        text(asPayload(latest.snapshot), "submittedAt") !==
          iso(registration.submittedAt)
      )
        return null;
      const id = await repo.createVersion(
        tx,
        { kind: "registrations", registrationRequestId },
        newVersion(
          "APPROVED",
          approvedPayload(registration, latest.dataHash),
          actorId,
          latest.version + 1,
          latest.id,
          "Duyệt hồ sơ",
        ),
      );
      return { kind: "registrations", id };
    },
    /** Fire-and-forget after commit; blockchain failures never reach the business response. */
    scheduleAnchor(ref: ProofRef | null) {
      if (!ref) return;
      void enqueue(() => anchorVersion(ref)).catch((error: unknown) =>
        warn(
          `[BlockchainProof] Không ghi được bằng chứng ${ref.kind}/${ref.id}: ${safeError(error)}`,
        ),
      );
    },
    anchorVersion: (ref: ProofRef) => enqueue(() => anchorVersion(ref)),

    async listVersions(
      params: BlockchainProofRecordParamsDTO,
      principal: AuthPrincipal,
    ): Promise<BlockchainProofVersionResponseDTO[]> {
      const scope = proofScope(params.kind, principal, "view");
      const rows = await repo.listVersions(
        await connect(),
        params.kind,
        params.recordId,
        scope,
      );
      return rows.map(toDTO);
    },
    async anchor(
      params: BlockchainProofVersionParamsDTO,
      principal: AuthPrincipal,
    ): Promise<BlockchainProofVersionResponseDTO> {
      requireEnabled();
      const { row } = await scopedVersion(params, principal, "anchor");
      if (row.transactionStatus === "CONFIRMED")
        throw new HttpError(409, "Bằng chứng đã được xác nhận trên blockchain");
      const result = await enqueue(() =>
        anchorVersion({ kind: params.kind, id: row.id }),
      );
      return toDTO(result ?? row);
    },
    async verify(
      params: BlockchainProofVersionParamsDTO,
      principal: AuthPrincipal,
    ): Promise<BlockchainProofVersionResponseDTO> {
      requireEnabled();
      const { db, row } = await scopedVersion(params, principal, "verify");
      return verifyRow(db, row);
    },
    /** Grade meals of a day to pick from; a school only sees its own. */
    async gradeMeals(
      query: BlockchainProofGradeMealsQueryDTO,
      principal: AuthPrincipal,
    ): Promise<BlockchainProofGradeMealDTO[]> {
      assertPermission(principal, "traceability.view");
      const scope = blockchainProofScope(principal);
      const db = await connect();
      return repo.listGradeMeals(db, {
        date: query.date,
        schoolId: scope ?? query.schoolId ?? null,
      });
    },
    /** Journey of one grade's meal on a day, every class of the grade together. */
    async gradeChain(
      params: BlockchainProofGradeParamsDTO,
      query: BlockchainProofGradeChainQueryDTO,
      principal: AuthPrincipal,
    ): Promise<BlockchainProofChainResponseDTO> {
      assertPermission(
        principal,
        query.verify ? "traceability.verify" : "traceability.view",
      );
      const scope = blockchainProofScope(principal);
      const schoolId = scope ?? query.schoolId ?? null;
      // Classes without a grade exist in every school; pick one first.
      if (params.gradeId === null && schoolId === null)
        throw new HttpError(400, "Cần chọn trường để xem lớp chưa xếp khối");
      if (query.verify) requireEnabled();
      const db = await connect();
      const subjects = await repo.gradeChainSubjects(db, {
        schoolId,
        gradeId: params.gradeId,
        date: query.date,
        mealType: query.mealType,
      });
      return buildChain(db, subjects, null, {
        verify: query.verify,
        persist: true,
      });
    },
    /** Grade meals of a day for the public page of one school; no login needed. */
    async publicGradeMeals(
      params: BlockchainProofPublicSchoolParamsDTO,
      query: BlockchainProofPublicGradeMealsQueryDTO,
    ): Promise<BlockchainProofGradeMealDTO[]> {
      const db = await connect();
      const school = await publicSchool(db, params.schoolCode);
      return repo.listGradeMeals(db, {
        date: query.date,
        schoolId: school.id,
      });
    },
    /**
     * Public journey of one grade's meal. Operational details are left out, and
     * a check reads the chain without saving its result, so visitors cannot
     * change what staff see.
     */
    async publicGradeChain(
      params: BlockchainProofPublicGradeParamsDTO,
      query: BlockchainProofPublicGradeChainQueryDTO,
    ): Promise<BlockchainProofChainResponseDTO> {
      if (query.verify) requireEnabled();
      const db = await connect();
      const school = await publicSchool(db, params.schoolCode);
      const subjects = await repo.gradeChainSubjects(db, {
        schoolId: school.id,
        gradeId: params.gradeId,
        date: query.date,
        mealType: query.mealType,
      });
      const chain = await buildChain(db, subjects, null, {
        verify: query.verify,
        persist: false,
      });
      return publicView(chain);
    },
    async publicMealAllocationChain(
      mealAllocationId: string,
      verify = false,
    ): Promise<BlockchainProofChainResponseDTO> {
      if (verify) requireEnabled();
      const db = await connect();
      const subjects = await repo.chainSubjects(db, mealAllocationId, null);
      const chain = await buildChain(db, subjects, mealAllocationId, {
        verify,
        persist: false,
      });
      return publicView(chain);
    },
    async chain(
      params: BlockchainProofChainParamsDTO,
      query: BlockchainProofChainQueryDTO,
      principal: AuthPrincipal,
    ): Promise<BlockchainProofChainResponseDTO> {
      assertPermission(
        principal,
        query.verify ? "traceability.verify" : "traceability.view",
      );
      const schoolId = blockchainProofScope(principal);
      if (query.verify) requireEnabled();
      const db = await connect();
      const subjects = await repo.chainSubjects(
        db,
        params.mealAllocationId,
        schoolId,
      );
      return buildChain(db, subjects, params.mealAllocationId, {
        verify: query.verify,
        persist: true,
      });
    },
  };

  async function publicSchool(db: Tx, code: string) {
    const school = await repo.findPublicSchool(db, code);
    if (!school) throw new HttpError(404, "Không tìm thấy trường");
    return school;
  }

  /** One meal's steps and proofs; `persist: false` keeps checks out of the database. */
  async function buildChain(
    db: Tx,
    subjects: ChainSubjects | null,
    mealAllocationId: string | null,
    options: { verify: boolean; persist: boolean },
  ): Promise<BlockchainProofChainResponseDTO> {
    if (!subjects)
      throw new HttpError(404, "Không tìm thấy bữa ăn trong phạm vi");
    const rows = await repo.listChain(db, subjects);
    const links = linkChecks(rows, subjects.lotDeliveries);
    const nodes: BlockchainProofChainResponseDTO["nodes"] = [];
    for (const row of rows) {
      let checked = toDTO(row);
      if (options.verify && row.transactionStatus === "CONFIRMED")
        try {
          checked = await verifyRow(db, row, options.persist);
        } catch (error) {
          // One proof on another network or contract must not hide the rest.
          if (!(error instanceof HttpError)) throw error;
          checked = {
            ...checked,
            verificationStatus: "FAILED",
            verificationResult: error.message,
          };
        }
      nodes.push({ ...checked, links: links.get(row.id) ?? [] });
    }
    return {
      mealAllocationId,
      schoolId: subjects.schoolId,
      date: subjects.date,
      meal: subjects.meal,
      steps: subjects.steps,
      intact: nodes.every(
        (node) =>
          node.links.every((link) => link.status !== "MISMATCH") &&
          (!options.verify ||
            node.transactionStatus !== "CONFIRMED" ||
            node.verificationStatus === "VERIFIED"),
      ),
      nodes,
    };
  }

  async function verifyRow(
    db: Tx,
    row: VersionRow,
    persist = true,
  ): Promise<BlockchainProofVersionResponseDTO> {
    if (row.transactionStatus !== "CONFIRMED")
      throw new HttpError(409, "Bằng chứng chưa được xác nhận trên blockchain");
    if (row.networkName !== network())
      throw new HttpError(
        409,
        "Bằng chứng thuộc mạng khác mạng blockchain đang cấu hình",
      );
    const configured = chain.contractAddress();
    if (
      row.contractAddress &&
      configured &&
      !same(row.contractAddress, configured)
    )
      throw new HttpError(
        409,
        "Bằng chứng thuộc contract khác contract đang cấu hình",
      );

    const current = await rebuild(db, row);
    const recomputed = hashPayload(current);
    let outcome: {
      verificationStatus: "VERIFIED" | "MISMATCH" | "FAILED";
      verificationResult: string;
    };
    try {
      const { onChainHash } = await chain.read(proofRecordId(row.id));
      if (onChainHash === null)
        outcome = {
          verificationStatus: "MISMATCH",
          verificationResult: "Không tìm thấy bản ghi trên blockchain",
        };
      else if (!same(onChainHash, row.dataHash))
        outcome = {
          verificationStatus: "MISMATCH",
          verificationResult:
            "Hash trên blockchain khác hash đã lưu trong hệ thống",
        };
      else if (!same(recomputed, onChainHash))
        outcome = {
          verificationStatus: "MISMATCH",
          verificationResult:
            `Dữ liệu hiện tại khác dữ liệu đã neo: ${changedFields(asPayload(row.snapshot), current).join(", ")}`.slice(
              0,
              500,
            ),
        };
      else
        outcome = {
          verificationStatus: "VERIFIED",
          verificationResult: "Dữ liệu khớp với bản ghi trên blockchain",
        };
    } catch {
      outcome = {
        verificationStatus: "FAILED",
        verificationResult: "Không kết nối được blockchain",
      };
    }
    let documents: RegistrationDocumentCheckDTO[] | null = null;
    if (row.kind === "registrations") {
      try {
        documents = await checkDocuments(db, row);
      } catch {
        if (outcome.verificationStatus === "VERIFIED")
          outcome = {
            verificationStatus: "FAILED",
            verificationResult: "Không tải được tài liệu để đối chiếu",
          };
      }
      outcome = withDocuments(outcome, documents);
    }
    if (outcome.verificationStatus !== "FAILED")
      outcome = withNotes(outcome, await reconcile(db, row));
    const verifiedAt = now();
    if (persist)
      await repo.setVerification(db, row.kind, row.id, {
        ...outcome,
        verifiedAt,
      });
    return {
      ...toDTO({ ...row, ...outcome, verifiedAt }),
      ...(documents ? { documents } : {}),
    };
  }

  /** Business cross-checks against the previous step; notes only, never a status. */
  async function reconcile(db: Tx, row: VersionRow): Promise<string[]> {
    const snapshot = asPayload(row.snapshot);
    if (row.kind === "deliveries") {
      const declared = (
        await repo.listVersions(db, "delivery-declarations", row.recordId, null)
      ).at(-1);
      if (!declared) return [];
      const promised = new Map<string, string | null>();
      const lots = new Set<string>();
      for (const item of objects(asPayload(declared.snapshot).items)) {
        if (typeof item.deliveryItemId === "string")
          promised.set(
            item.deliveryItemId,
            typeof item.quantity === "string" ? item.quantity : null,
          );
        for (const lot of objects(item.lots))
          if (typeof lot.id === "string") lots.add(lot.id);
      }
      const notes: string[] = [];
      for (const item of objects(snapshot.items)) {
        const id =
          typeof item.deliveryItemId === "string" ? item.deliveryItemId : "";
        if (!promised.has(id))
          notes.push(`mặt hàng ${id} không có trong khai báo`);
        else if (promised.get(id) !== item.actualQuantity)
          notes.push(
            `mặt hàng ${id} nhận ${show(item.actualQuantity)}, khai ${show(promised.get(id))}`,
          );
        for (const lot of objects(item.lots))
          if (typeof lot.id === "string" && !lots.has(lot.id))
            notes.push(`lô ${lot.id} không có trong khai báo`);
      }
      return notes.length
        ? [`Khác khai báo giao hàng: ${notes.join("; ")}`]
        : ["Khớp khai báo giao hàng của NCC"];
    }
    if (row.kind === "meal-distributions") {
      const served = new Map<string, number>();
      for (const batch of objects(snapshot.batches))
        if (
          typeof batch.cookingBatchId === "string" &&
          typeof batch.portions === "number"
        )
          served.set(
            batch.cookingBatchId,
            (served.get(batch.cookingBatchId) ?? 0) + batch.portions,
          );
      const planned = await repo.plannedPortions(db, [...served.keys()]);
      const over = [...served].filter(([id, portions]) => {
        const limit = planned.get(id);
        return typeof limit === "number" && portions > limit;
      });
      return over.length
        ? [
            `Phân phối vượt số suất của mẻ: ${over
              .map(([id, portions]) => `${id} (${portions}/${planned.get(id)})`)
              .join(", ")}`,
          ]
        : [];
    }
    return [];
  }

  return service;
}

/** Readable form of a JSON value in a message. */
const show = (value: unknown): string =>
  typeof value === "string" ? value : (JSON.stringify(value) ?? "null");

const objects = (value: unknown): ProofPayload[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is ProofPayload =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];

/**
 * Each reference hash a proof carries must equal the data hash of the proof it
 * points to; a null reference (record older than anchoring) is not linked.
 */
export function linkChecks(
  rows: VersionRow[],
  lotDeliveries: Map<string, string>,
): Map<string, ProofLinkCheckDTO[]> {
  const latest = (kind: ProofKind, recordId: string) =>
    rows.filter((row) => row.kind === kind && row.recordId === recordId).at(-1)
      ?.dataHash ?? null;
  const check = (
    field: string,
    expected: string | null,
    actual: unknown,
  ): ProofLinkCheckDTO => ({
    field,
    status:
      typeof actual !== "string"
        ? "NOT_LINKED"
        : expected !== null && expected.toLowerCase() === actual.toLowerCase()
          ? "MATCH"
          : "MISMATCH",
  });
  const result = new Map<string, ProofLinkCheckDTO[]>();
  for (const row of rows) {
    const snapshot = asPayload(row.snapshot);
    const links: ProofLinkCheckDTO[] = [];
    if (row.kind === "deliveries")
      links.push(
        check(
          "declarationHash",
          latest("delivery-declarations", row.recordId),
          snapshot.declarationHash,
        ),
      );
    if (row.kind === "cooking-batches")
      for (const lot of objects(snapshot.lots)) {
        const delivery =
          typeof lot.ingredientLotId === "string"
            ? lotDeliveries.get(lot.ingredientLotId)
            : undefined;
        links.push(
          check(
            `lots.${show(lot.ingredientLotId)}.deliveryInspectionHash`,
            delivery ? latest("deliveries", delivery) : null,
            lot.deliveryInspectionHash,
          ),
        );
      }
    if (row.kind === "retained-samples") {
      if (row.eventType === "SAMPLE_STORED")
        links.push(
          check(
            "cookingCompletedHash",
            typeof snapshot.cookingBatchId === "string"
              ? latest("cooking-batches", snapshot.cookingBatchId)
              : null,
            snapshot.cookingCompletedHash,
          ),
        );
      else
        links.push(
          check(
            "previousHash",
            rows.find(
              (other) =>
                other.kind === "retained-samples" &&
                other.recordId === row.recordId &&
                other.eventType === "SAMPLE_STORED",
            )?.dataHash ?? null,
            snapshot.previousHash,
          ),
        );
    }
    if (row.kind === "meal-distributions")
      for (const batch of objects(snapshot.batches))
        links.push(
          check(
            `batches.${show(batch.cookingBatchId)}.cookingCompletedHash`,
            typeof batch.cookingBatchId === "string"
              ? latest("cooking-batches", batch.cookingBatchId)
              : null,
            batch.cookingCompletedHash,
          ),
        );
    result.set(row.id, links);
  }
  return result;
}

/** Appends cross-check notes without changing the integrity status. */
function withNotes(outcome: Outcome, notes: string[]): Outcome {
  if (!notes.length || outcome.verificationStatus === "FAILED") return outcome;
  return {
    ...outcome,
    verificationResult: [outcome.verificationResult, ...notes]
      .join(". ")
      .slice(0, 500),
  };
}

type Outcome = {
  verificationStatus: "VERIFIED" | "MISMATCH" | "FAILED";
  verificationResult: string;
};

/** Folds the per-file comparison into the record-level result. */
export function withDocuments(
  outcome: Outcome,
  documents: RegistrationDocumentCheckDTO[] | null,
): Outcome {
  if (!documents || outcome.verificationStatus === "FAILED") return outcome;
  const broken = documents.filter(
    (document) =>
      document.status === "MISMATCH" || document.status === "MISSING",
  );
  const unhashed = documents.filter(
    (document) => document.status === "NO_HASH",
  ).length;
  const notes: string[] = [];
  if (broken.length)
    notes.push(
      `Tài liệu khác bản đã ghi nhận: ${broken
        .map(
          (document) =>
            `${document.fileName} (${document.status === "MISSING" ? "không còn" : "đã thay đổi"})`,
        )
        .join(", ")}`,
    );
  if (unhashed)
    notes.push(`${unhashed} tài liệu nộp trước khi có mã băm, chưa đối chiếu`);
  if (!notes.length) return outcome;
  // The record hash matched, so say so without implying the files did too.
  const lead =
    outcome.verificationStatus === "VERIFIED" && broken.length
      ? "Thông tin hồ sơ khớp blockchain"
      : outcome.verificationResult;
  return {
    verificationStatus: broken.length ? "MISMATCH" : outcome.verificationStatus,
    verificationResult: [lead, ...notes].join(". ").slice(0, 500),
  };
}

export const blockchainProofService = createBlockchainProofService();
export type BlockchainProofService = ReturnType<
  typeof createBlockchainProofService
>;

/**
 * What the public page may show of a meal's journey: vehicle plates, slip and
 * batch codes and send errors are operational details for staff only.
 */
export function publicView(
  chain: BlockchainProofChainResponseDTO,
): BlockchainProofChainResponseDTO {
  return {
    ...chain,
    steps: {
      ...chain.steps,
      deliveries: chain.steps.deliveries.map((delivery) => ({
        ...delivery,
        deliveryNo: null,
        vehiclePlate: null,
      })),
      cookingBatches: chain.steps.cookingBatches.map((batch) => ({
        ...batch,
        batchCode: null,
      })),
    },
    nodes: chain.nodes.map((node) => ({ ...node, lastError: null })),
  };
}
