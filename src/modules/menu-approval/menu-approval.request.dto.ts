import type { z } from "zod";
import type {
  menuApprovalDecisionSchema,
  menuApprovalParamsSchema,
  menuApprovalWeekQuerySchema,
} from "./menu-approval.validation";

export type MenuApprovalWeekQueryRequestDTO = z.infer<
  typeof menuApprovalWeekQuerySchema
>;

export type MenuApprovalParamsRequestDTO = z.infer<
  typeof menuApprovalParamsSchema
>;

export type MenuApprovalDecisionRequestDTO = z.infer<
  typeof menuApprovalDecisionSchema
>;
