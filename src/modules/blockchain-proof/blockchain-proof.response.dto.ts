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

/** One grade's meal on a day, for picking one to trace. */
export interface BlockchainProofGradeMealDTO {
  /** `<gradeId|none>:<mealType>`, unique within one school and day. */
  key: string;
  schoolId: string;
  schoolName: string;
  /** Null for classes not yet in a grade. */
  gradeId: string | null;
  gradeName: string | null;
  mealType: string;
  classCount: number;
  portions: number;
  /** FINALIZED, DISTRIBUTED, PARTIAL, CANCELLED or ALLOCATED across classes. */
  status: string;
  distributedAt: string | null;
}

/**
 * Readable facts of every step of the meal, including steps that have no
 * proof yet, so a missing proof shows instead of disappearing. A node belongs
 * to a step when its `recordId` is the step's `id` (`recordId` for the
 * distribution).
 */
export interface BlockchainProofChainStepsDTO {
  deliveries: {
    id: string;
    /** Null on the public page. */
    deliveryNo: string | null;
    supplierName: string;
    status: string;
    vehiclePlate: string | null;
    expectedArrivalAt: string | null;
    receivedAt: string | null;
  }[];
  cookingBatches: {
    id: string;
    /** Null on the public page. */
    batchCode: string | null;
    status: string;
    dishes: string[];
    plannedPortions: number | null;
    /** Portions of this batch given to the traced meal. */
    allocatedPortions: number;
    completedAt: string | null;
  }[];
  retainedSamples: {
    id: string;
    cookingBatchId: string;
    dishName: string;
    status: string;
    sampledAt: string | null;
    disposedAt: string | null;
  }[];
  distribution: { recordId: string; date: string };
}

export interface BlockchainProofChainResponseDTO {
  /** Set only when one class meal was asked for. */
  mealAllocationId: string | null;
  schoolId: string;
  date: string;
  /** The grade's meal: every class of the grade together. */
  meal: {
    gradeId: string | null;
    gradeName: string | null;
    mealType: string;
    portions: number;
    status: string;
    distributedAt: string | null;
    classes: {
      id: string;
      className: string;
      portions: number;
      status: string;
      distributedAt: string | null;
    }[];
  };
  steps: BlockchainProofChainStepsDTO;
  /** No broken link and, when verified, every confirmed proof VERIFIED. */
  intact: boolean;
  nodes: (BlockchainProofVersionResponseDTO & { links: ProofLinkCheckDTO[] })[];
}
