import type { z } from "zod";
import type {
  lifecycleParamsSchema,
  lifecycleEmptySchema,
  intakeStateSchema,
} from "./account-lifecycle.validation";

export type LifecycleParamsRequestDTO = z.infer<typeof lifecycleParamsSchema>;
export type LifecycleActionRequestDTO = z.infer<typeof lifecycleEmptySchema>;
export type IntakeStateRequestDTO = z.infer<typeof intakeStateSchema>;
