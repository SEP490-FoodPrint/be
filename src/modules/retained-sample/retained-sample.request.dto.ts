import type { z } from "zod";
import type {
  foodSampleSchema,
  sampleDisposalSchema,
  retainedSampleListQuerySchema,
} from "./retained-sample.validation";
export type FoodSampleInput = z.infer<typeof foodSampleSchema>;
export type SampleDisposalInput = z.infer<typeof sampleDisposalSchema>;
export type RetainedSampleListQuery = z.infer<
  typeof retainedSampleListQuerySchema
>;
