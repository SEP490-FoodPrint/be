import type { z } from "zod";
import type {
  chainParamsSchema,
  chainQuerySchema,
  recordParamsSchema,
  versionParamsSchema,
} from "./blockchain-proof.validation";

export type BlockchainProofRecordParamsDTO = z.infer<typeof recordParamsSchema>;
export type BlockchainProofVersionParamsDTO = z.infer<
  typeof versionParamsSchema
>;
export type BlockchainProofChainParamsDTO = z.infer<typeof chainParamsSchema>;
export type BlockchainProofChainQueryDTO = z.output<typeof chainQuerySchema>;
