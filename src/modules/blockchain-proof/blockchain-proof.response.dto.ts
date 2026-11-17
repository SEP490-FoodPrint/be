export interface BlockchainProofVersionResponseDTO {
  id: string;
  kind:
    | "deliveries"
    | "delivery-declarations"
    | "cooking-batches"
    | "retained-samples"
    | "registrations"
    | "meal-distributions";
  /** Business record id; for meal distributions `<schoolId>:<YYYY-MM-DD>`. */
  recordId: string;
  version: number;
  eventType:
    | "DELIVERY_DECLARED"
    | "DELIVERY_INSPECTED"
    | "COOKING_COMPLETED"
    | "SAMPLE_STORED"
    | "SAMPLE_DISPOSED"
    | "REGISTRATION_SUBMITTED"
    | "REGISTRATION_APPROVED"
    | "MEAL_DISTRIBUTED";
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
  /** Registrations only, on verify: each stored file against its anchored SHA-256. */
  documents?: RegistrationDocumentCheckDTO[];
}

export interface RegistrationDocumentCheckDTO {
  id: string;
  field: string;
  fileName: string;
  /** MISMATCH: content changed; MISSING: file gone; NO_HASH: uploaded before proofs existed. */
  status: "MATCH" | "MISMATCH" | "MISSING" | "NO_HASH";
}

/** A reference hash in a proof compared with the proof it points to. */
export interface ProofLinkCheckDTO {
  field: string;
  /** NOT_LINKED: the reference is null (record older than anchoring). */
  status: "MATCH" | "MISMATCH" | "NOT_LINKED";
}

export interface BlockchainProofChainResponseDTO {
  mealAllocationId: string;
  schoolId: string;
  date: string;
  /** No broken link and, when verified, every confirmed proof VERIFIED. */
  intact: boolean;
  nodes: (BlockchainProofVersionResponseDTO & { links: ProofLinkCheckDTO[] })[];
}
