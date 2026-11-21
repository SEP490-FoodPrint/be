import type { z } from "zod";
import type {
  allocationApplySchema,
  allocationQuerySchema,
  confirmDistributionSchema,
} from "./meal-allocation.validation";

export type AllocationQueryRequest = z.infer<typeof allocationQuerySchema>;
export type ApplyAllocationRequest = z.infer<typeof allocationApplySchema>;
export type ConfirmDistributionRequest = z.infer<
  typeof confirmDistributionSchema
>;

export type MaterialPlanRequest = z.infer<
  typeof import("./meal-allocation.validation").materialPlanSchema
>;
export type AllocationDraftRequest = z.infer<
  typeof import("./meal-allocation.validation").allocationDraftSchema
>;
export type MaterialApplyRequest = z.infer<
  typeof import("./meal-allocation.validation").materialApplySchema
>;
