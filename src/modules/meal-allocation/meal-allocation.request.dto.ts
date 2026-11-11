import type { z } from "zod";
import type { allocationApplySchema } from "./meal-allocation.validation";

export type ApplyAllocationRequest = z.infer<typeof allocationApplySchema>;
