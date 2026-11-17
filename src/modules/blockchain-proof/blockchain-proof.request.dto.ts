import type { z } from "zod";
import type {
  chainParamsSchema,
  chainQuerySchema,
  gradeChainQuerySchema,
  gradeMealsQuerySchema,
  gradeParamsSchema,
  publicGradeChainQuerySchema,
  publicGradeMealsQuerySchema,
  publicGradeParamsSchema,
  publicSchoolParamsSchema,
  recordParamsSchema,
  versionParamsSchema,
} from "./blockchain-proof.validation";

export type BlockchainProofRecordParamsDTO = z.infer<typeof recordParamsSchema>;
export type BlockchainProofVersionParamsDTO = z.infer<
  typeof versionParamsSchema
>;
export type BlockchainProofChainParamsDTO = z.infer<typeof chainParamsSchema>;
export type BlockchainProofChainQueryDTO = z.output<typeof chainQuerySchema>;
export type BlockchainProofGradeMealsQueryDTO = z.output<
  typeof gradeMealsQuerySchema
>;
export type BlockchainProofGradeParamsDTO = z.output<typeof gradeParamsSchema>;
export type BlockchainProofGradeChainQueryDTO = z.output<
  typeof gradeChainQuerySchema
>;
export type BlockchainProofPublicSchoolParamsDTO = z.output<
  typeof publicSchoolParamsSchema
>;
export type BlockchainProofPublicGradeMealsQueryDTO = z.output<
  typeof publicGradeMealsQuerySchema
>;
export type BlockchainProofPublicGradeParamsDTO = z.output<
  typeof publicGradeParamsSchema
>;
export type BlockchainProofPublicGradeChainQueryDTO = z.output<
  typeof publicGradeChainQuerySchema
>;
