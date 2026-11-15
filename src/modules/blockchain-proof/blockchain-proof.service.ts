import { id as keccakId } from "ethers";
import type { PrismaClient, Prisma } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import { assertPermission } from "../../utils/authorization";
import {
  anchorHashOnChain,
  loadDeployment,
  readHashFromChain,
} from "../../utils/blockchain";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import { blockchainProofScope } from "../../utils/resource-access";
import {
  buildCookingCompletedPayload,
  buildDeliveryInspectedPayload,
  buildSampleDisposedPayload,
  buildSampleStoredPayload,
  changedFields,
  hashPayload,
  HASH_ALGORITHM,
  PAYLOAD_VERSION,
  type ProofPayload,
} from "./blockchain-proof.payload";
import {
  createBlockchainProofRepository,
  type BlockchainProofRepository,
  type NewVersion,
  type ProofKind,
  type VersionRow,
} from "./blockchain-proof.repository";
import type {
  BlockchainProofRecordParamsDTO,
  BlockchainProofVersionParamsDTO,
} from "./blockchain-proof.request.dto";
import type { BlockchainProofVersionResponseDTO } from "./blockchain-proof.response.dto";

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
  anchor(
    recordId: string,
    dataHash: string,
  ): Promise<{
    txHash: string;
    blockNumber: number;
    contractAddress: string;
  }>;
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
  anchor: (recordId, dataHash) => anchorHashOnChain(recordId, dataHash),
};

const tables: Record<ProofKind, string> = {
  deliveries: "delivery_inspection_versions",
  "cooking-batches": "cooking_batch_versions",
  "retained-samples": "retained_sample_versions",
};

export function proofRecordId(kind: ProofKind, versionId: string): string {
  return keccakId(`foodprint:${tables[kind]}:${versionId}`);
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

  // One sender per process, so consecutive transactions never share a nonce.
  let tail: Promise<unknown> = Promise.resolve();
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  }

  function newVersion(
    payload: ProofPayload,
    actorId: string,
    version = 1,
    previousVersionId: string | null = null,
    changeReason: string | null = null,
  ): NewVersion {
    return {
      version,
      dataHash: hashPayload(payload),
      hashAlgorithm: HASH_ALGORITHM,
      payloadVersion: PAYLOAD_VERSION,
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

  const deliveryPayload = (row: Delivery) =>
    buildDeliveryInspectedPayload({
      ...row,
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
  const storedPayload = (row: Sample, cookingCompletedHash: string | null) =>
    buildSampleStoredPayload({ ...row, cookingCompletedHash });
  const disposedPayload = (
    row: Sample,
    disposedByUserId: string,
    previousHash: string | null,
  ) => buildSampleDisposedPayload({ ...row, disposedByUserId, previousHash });

  async function anchorVersion(ref: ProofRef): Promise<VersionRow | null> {
    const db = await connect();
    const row = await repo.findVersion(db, ref.kind, ref.id, null);
    if (!row || row.transactionStatus === "CONFIRMED") return row;
    const recordId = proofRecordId(ref.kind, ref.id);
    try {
      const existing = await chain.read(recordId);
      if (existing.onChainHash !== null) {
        if (same(existing.onChainHash, row.dataHash))
          await repo.markConfirmed(db, ref.kind, ref.id, {
            transactionHash: null,
            blockNumber: null,
            contractAddress: existing.contractAddress,
            recordedAt: now(),
            lastError: "Đã có trên chain, không rõ giao dịch",
          });
        else
          await repo.markFailed(
            db,
            ref.kind,
            ref.id,
            "Hash trên chain khác hash đã lưu",
          );
      } else {
        const result = await chain.anchor(recordId, row.dataHash);
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
    if (row.kind === "deliveries") {
      const delivery = await repo.readDelivery(db, row.recordId);
      return delivery ? deliveryPayload(delivery) : {};
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

  async function scopedVersion(
    params: BlockchainProofVersionParamsDTO,
    principal: AuthPrincipal,
  ) {
    const schoolId = blockchainProofScope(principal);
    const db = await connect();
    const row = await repo.findVersion(
      db,
      params.kind,
      params.versionId,
      schoolId,
    );
    if (!row) throw new HttpError(404, "Không tìm thấy bằng chứng blockchain");
    return { db, row };
  }

  function requireEnabled() {
    if (!enabled()) throw new HttpError(409, "Chức năng blockchain đang tắt");
  }

  return {
    async prepareDeliveryInspected(
      tx: Tx,
      deliveryId: string,
      actorId: string,
    ): Promise<ProofRef | null> {
      if (!enabled() || (await repo.hasDeliveryVersion(tx, deliveryId)))
        return null;
      const delivery = await repo.readDelivery(tx, deliveryId);
      if (!delivery) return null;
      const id = await repo.createDeliveryVersion(
        tx,
        deliveryId,
        newVersion(deliveryPayload(delivery), actorId),
      );
      return { kind: "deliveries", id };
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
      const id = await repo.createCookingBatchVersion(
        tx,
        cookingBatchId,
        newVersion(
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
      const id = await repo.createSampleVersion(
        tx,
        sampleId,
        "STORED",
        newVersion(storedPayload(sample, cookingHash), actorId),
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
      const id = await repo.createSampleVersion(
        tx,
        sampleId,
        "DISPOSED",
        newVersion(
          disposedPayload(sample, actorId, stored.dataHash),
          actorId,
          2,
          stored.id,
          "Tiêu huỷ mẫu",
        ),
      );
      return { kind: "retained-samples", id };
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
      assertPermission(principal, "traceability.view");
      const schoolId = blockchainProofScope(principal);
      const rows = await repo.listVersions(
        await connect(),
        params.kind,
        params.recordId,
        schoolId,
      );
      return rows.map(toDTO);
    },
    async anchor(
      params: BlockchainProofVersionParamsDTO,
      principal: AuthPrincipal,
    ): Promise<BlockchainProofVersionResponseDTO> {
      assertPermission(principal, "traceability.verify");
      requireEnabled();
      const { row } = await scopedVersion(params, principal);
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
      assertPermission(principal, "traceability.verify");
      requireEnabled();
      const { db, row } = await scopedVersion(params, principal);
      if (row.transactionStatus !== "CONFIRMED")
        throw new HttpError(
          409,
          "Bằng chứng chưa được xác nhận trên blockchain",
        );
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
        const { onChainHash } = await chain.read(
          proofRecordId(row.kind, row.id),
        );
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
      const verifiedAt = now();
      await repo.setVerification(db, row.kind, row.id, {
        ...outcome,
        verifiedAt,
      });
      return toDTO({ ...row, ...outcome, verifiedAt });
    },
  };
}

export const blockchainProofService = createBlockchainProofService();
export type BlockchainProofService = ReturnType<
  typeof createBlockchainProofService
>;
