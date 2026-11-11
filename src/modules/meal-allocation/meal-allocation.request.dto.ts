import type { z } from "zod";
import type {
  allocationApplySchema,
  confirmDistributionSchema,
} from "./meal-allocation.validation";

export type ApplyAllocationRequest = z.infer<typeof allocationApplySchema>;
export type ConfirmDistributionRequest = z.infer<
  typeof confirmDistributionSchema
>;
