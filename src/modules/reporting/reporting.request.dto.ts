import type { z } from "zod";
import type {
  reportingListQuerySchema,
  reportingReceiveParamsSchema,
  reportingEmptySchema,
} from "./reporting.validation";
export type ReportingListRequestDTO = z.infer<typeof reportingListQuerySchema>;
export type ReportingReceiveParamsRequestDTO = z.infer<
  typeof reportingReceiveParamsSchema
>;
export type ReportingReceiveBodyRequestDTO = z.infer<
  typeof reportingEmptySchema
>;
