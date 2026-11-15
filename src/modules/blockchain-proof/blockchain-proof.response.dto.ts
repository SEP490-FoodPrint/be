export interface BlockchainProofVersionResponseDTO {
  id: string;
  kind: "deliveries" | "cooking-batches" | "retained-samples";
  recordId: string;
  version: number;
  eventType:
    | "DELIVERY_INSPECTED"
    | "COOKING_COMPLETED"
    | "SAMPLE_STORED"
    | "SAMPLE_DISPOSED";
  dataHash: string;
  hashAlgorithm: string;
  previousVersionId: string | null;
  changeReason: string | null;
  transactionStatus: "PREPARED" | "SUBMITTED" | "CONFIRMED" | "FAILED";
  transactionHash: string | null;
  blockNumber: string | null;
  networkName: string;
  contractAddress: string | null;
  explorerUrl: string | null;
  recordedAt: string | null;
  lastError: string | null;
  verificationStatus: "NOT_VERIFIED" | "VERIFIED" | "MISMATCH" | "FAILED";
  verificationResult: string | null;
  verifiedAt: string | null;
  createdAt: string;
}
