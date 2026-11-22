import type { z } from "zod";
import type {
  approveEnforcementSchema,
  enforcementListQuerySchema,
  rejectEnforcementSchema,
  requestEnforcementSchema,
} from "./supplier-enforcement.validation";

export type RequestEnforcementRequestDTO = z.output<
  typeof requestEnforcementSchema
>;
export type ApproveEnforcementRequestDTO = z.output<
  typeof approveEnforcementSchema
>;
export type RejectEnforcementRequestDTO = z.output<
  typeof rejectEnforcementSchema
>;
export type EnforcementListQueryRequestDTO = z.output<
  typeof enforcementListQuerySchema
>;
