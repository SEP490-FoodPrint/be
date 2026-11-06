import type { z } from "zod";
import type {
  menuApprovalDecisionSchema,
  menuApprovalParamsSchema,
} from "./menu-approval.validation";

export type MenuApprovalParamsRequestDTO = z.infer<
  typeof menuApprovalParamsSchema
>;

export type MenuApprovalDecisionRequestDTO = z.infer<
  typeof menuApprovalDecisionSchema
>;
