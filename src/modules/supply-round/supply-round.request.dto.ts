import type { z } from "zod";
import type {
  roundApprovalSchema,
  roundDishParamsSchema,
  roundQuerySchema,
} from "./supply-round.validation";

export type RoundQueryDTO = z.infer<typeof roundQuerySchema>;
export type RoundDishParamsDTO = z.infer<typeof roundDishParamsSchema>;
export type RoundApprovalDTO = z.infer<typeof roundApprovalSchema>;
