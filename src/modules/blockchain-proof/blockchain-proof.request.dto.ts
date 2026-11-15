import type { z } from "zod";
import type {
  recordParamsSchema,
  versionParamsSchema,
} from "./blockchain-proof.validation";

export type BlockchainProofRecordParamsDTO = z.infer<typeof recordParamsSchema>;
export type BlockchainProofVersionParamsDTO = z.infer<
  typeof versionParamsSchema
>;
